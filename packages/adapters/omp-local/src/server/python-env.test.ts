import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OMP_PYTHON_ENV_FILE_NAME,
  OMP_PYTHON_SITECUSTOMIZE_FILE_NAME,
  renderOmpPythonEnvData,
  renderOmpSitecustomize,
  writeOmpPythonEnvBridge,
} from "./python-env.js";

const PRINT_API_URL = 'import os;print(os.environ.get("PAPERCLIP_API_URL"))';

function strippedEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith("PAPERCLIP_") || key.startsWith("PYTHON")) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

function python(code: string, env: Record<string, string>) {
  const result = spawnSync("python3", ["-c", code], { env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

describe("OMP Python env bridge sitecustomize", () => {
  let root: string;
  let bridgeDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-pyenv-test-"));
    bridgeDir = path.join(root, "bridge");
    await fs.mkdir(bridgeDir);
    await fs.writeFile(path.join(bridgeDir, OMP_PYTHON_SITECUSTOMIZE_FILE_NAME), renderOmpSitecustomize(), "utf8");
    await fs.writeFile(
      path.join(bridgeDir, OMP_PYTHON_ENV_FILE_NAME),
      renderOmpPythonEnvData({ PAPERCLIP_API_URL: "http://bridge.invalid/api", HOME: "/not-forwarded" }),
      "utf8",
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("restores a PAPERCLIP_* value that the parent stripped from the environment", () => {
    const withBridge = python(PRINT_API_URL, strippedEnv({ PYTHONPATH: bridgeDir }));
    expect(withBridge).toEqual({ status: 0, stdout: "http://bridge.invalid/api", stderr: "" });
    const withoutBridge = python(PRINT_API_URL, strippedEnv({}));
    expect(withoutBridge.stdout).toBe("None");
  });

  it("keeps a value already present in the environment", () => {
    const existing = python(
      PRINT_API_URL,
      strippedEnv({ PYTHONPATH: bridgeDir, PAPERCLIP_API_URL: "http://already.set/api" }),
    );
    expect(existing.stdout).toBe("http://already.set/api");
    const absent = python(PRINT_API_URL, strippedEnv({ PYTHONPATH: bridgeDir }));
    expect(absent.stdout).toBe("http://bridge.invalid/api");
  });

  it("only forwards PAPERCLIP_* keys into the data file", () => {
    expect(JSON.parse(renderOmpPythonEnvData({ PAPERCLIP_RUN_ID: "r", HOME: "/h", PATH: "/bin" }))).toEqual({
      PAPERCLIP_RUN_ID: "r",
    });
  });

  it("stays silent when the data file is missing or malformed", async () => {
    await fs.rm(path.join(bridgeDir, OMP_PYTHON_ENV_FILE_NAME));
    expect(python(PRINT_API_URL, strippedEnv({ PYTHONPATH: bridgeDir }))).toEqual({
      status: 0,
      stdout: "None",
      stderr: "",
    });
    await fs.writeFile(path.join(bridgeDir, OMP_PYTHON_ENV_FILE_NAME), "{not json", "utf8");
    expect(python(PRINT_API_URL, strippedEnv({ PYTHONPATH: bridgeDir }))).toEqual({
      status: 0,
      stdout: "None",
      stderr: "",
    });
    const naive = path.join(root, "naive");
    await fs.mkdir(naive);
    await fs.writeFile(
      path.join(naive, "sitecustomize.py"),
      `import os\nopen(os.path.join(os.path.dirname(__file__), ${JSON.stringify(OMP_PYTHON_ENV_FILE_NAME)}))\n`,
      "utf8",
    );
    const control = python(PRINT_API_URL, strippedEnv({ PYTHONPATH: naive }));
    expect(control.stderr).toContain("FileNotFoundError");
  });

  it("chains to a later sitecustomize instead of shadowing it", async () => {
    const userDir = path.join(root, "user");
    await fs.mkdir(userDir);
    await fs.writeFile(
      path.join(userDir, "sitecustomize.py"),
      "import os\nos.environ['USER_SITECUSTOMIZE_MARKER'] = 'ran'\n",
      "utf8",
    );
    const code = 'import os;print(os.environ.get("PAPERCLIP_API_URL"), os.environ.get("USER_SITECUSTOMIZE_MARKER"))';
    const chained = python(code, strippedEnv({ PYTHONPATH: [bridgeDir, userDir].join(path.delimiter) }));
    expect(chained).toEqual({ status: 0, stdout: "http://bridge.invalid/api ran", stderr: "" });
    await fs.writeFile(path.join(bridgeDir, OMP_PYTHON_SITECUSTOMIZE_FILE_NAME), "import os\n", "utf8");
    const shadowed = python(code, strippedEnv({ PYTHONPATH: [bridgeDir, userDir].join(path.delimiter) }));
    expect(shadowed.stdout).toBe("None None");
  });

  it("skips every bridge dir when chaining so stacked bridges run once and still reach a later sitecustomize", async () => {
    const counted = (body: string) =>
      `import os\nos.environ["BRIDGE_RUNS"] = str(int(os.environ.get("BRIDGE_RUNS", "0")) + 1)\n${body}`;
    const naiveChainer = [
      "import os, sys, importlib.machinery, importlib.util",
      "here = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))",
      "rest = [e for e in sys.path if os.path.realpath(os.path.abspath(e or os.curdir)) != here]",
      'spec = importlib.machinery.PathFinder.find_spec("sitecustomize", rest)',
      'if spec is not None and int(os.environ["BRIDGE_RUNS"]) < 50:',
      "    spec.loader.exec_module(importlib.util.module_from_spec(spec))",
      "",
    ].join("\n");
    const outerDir = path.join(root, "outer");
    const laterDir = path.join(root, "later");
    await fs.mkdir(outerDir);
    await fs.mkdir(laterDir);
    await fs.writeFile(
      path.join(outerDir, OMP_PYTHON_ENV_FILE_NAME),
      renderOmpPythonEnvData({ PAPERCLIP_API_URL: "http://outer.invalid/api" }),
      "utf8",
    );
    await fs.writeFile(
      path.join(laterDir, "sitecustomize.py"),
      'import os\nos.environ["LATER_RUNS"] = str(int(os.environ.get("LATER_RUNS", "0")) + 1)\n',
      "utf8",
    );
    const code = 'import os;print(os.environ.get("BRIDGE_RUNS"), os.environ.get("LATER_RUNS"), os.environ.get("PAPERCLIP_API_URL"))';
    const stacked = strippedEnv({ PYTHONPATH: [outerDir, bridgeDir, laterDir].join(path.delimiter) });

    for (const dir of [outerDir, bridgeDir]) {
      await fs.writeFile(path.join(dir, OMP_PYTHON_SITECUSTOMIZE_FILE_NAME), counted(renderOmpSitecustomize()), "utf8");
    }
    expect(python(code, stacked)).toEqual({ status: 0, stdout: "1 1 http://outer.invalid/api", stderr: "" });

    for (const dir of [outerDir, bridgeDir]) {
      await fs.writeFile(path.join(dir, OMP_PYTHON_SITECUSTOMIZE_FILE_NAME), counted(naiveChainer), "utf8");
    }
    const [naiveBridgeRuns, naiveLaterRuns] = python(code, stacked).stdout.split(" ");
    expect(Number(naiveBridgeRuns)).toBeGreaterThan(1);
    expect(naiveLaterRuns).toBe("None");
  });

  it("writes both files into one private directory and removes it on cleanup", async () => {
    const bridge = await writeOmpPythonEnvBridge({
      runId: "run-pyenv",
      target: null,
      remote: false,
      env: { PAPERCLIP_API_KEY: "secret-token", PATH: "/bin" },
      remoteRootDir: null,
      cwd: root,
      timeoutSec: 0,
      graceSec: 0,
    });
    const dataFile = path.join(bridge.dir, OMP_PYTHON_ENV_FILE_NAME);
    expect((await fs.stat(bridge.dir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(dataFile)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await fs.readFile(dataFile, "utf8"))).toEqual({ PAPERCLIP_API_KEY: "secret-token" });
    expect(bridge.launch("omp", ["--mode", "rpc"])).toEqual({ command: "omp", args: ["--mode", "rpc"] });
    const visible = python(
      'import os;print(os.environ.get("PAPERCLIP_API_KEY"))',
      strippedEnv({ PYTHONPATH: bridge.dir }),
    );
    expect(visible.stdout).toBe("secret-token");
    await bridge.cleanup();
    await expect(fs.access(bridge.dir)).rejects.toThrow();
    expect(python('import os;print(os.environ.get("PAPERCLIP_API_KEY"))', strippedEnv({ PYTHONPATH: bridge.dir })).stdout)
      .toBe("None");
  });

  it("prepends the bridge to the remote host's own PYTHONPATH after the login profile runs", async () => {
    const remoteRoot = path.join(root, "remote");
    const remoteHome = path.join(root, "remote-home");
    const hostSite = path.join(root, "host-site");
    await fs.mkdir(remoteRoot);
    await fs.mkdir(remoteHome);
    await fs.mkdir(hostSite);
    await fs.writeFile(path.join(hostSite, "host_marker.py"), "VALUE = 'host-import-ok'\n", "utf8");
    await fs.writeFile(path.join(remoteHome, ".profile"), `PYTHONPATH=${hostSite}\nexport PYTHONPATH\n`, "utf8");
    const runnerCalls: string[] = [];
    const runner = {
      execute: async (input: { command: string; args?: string[]; cwd?: string; env?: Record<string, string> }) => {
        runnerCalls.push([input.command, ...(input.args ?? [])].join(" "));
        const result = spawnSync(input.command, input.args ?? [], {
          cwd: remoteRoot,
          env: { ...strippedEnv({}), ...(input.env ?? {}) },
          encoding: "utf8",
        });
        return {
          exitCode: result.status,
          signal: null,
          timedOut: false,
          stdout: result.stdout,
          stderr: result.stderr,
          pid: null,
          startedAt: new Date().toISOString(),
        };
      },
    };
    const runEnv = { PAPERCLIP_API_URL: "http://remote.invalid/api", PAPERCLIP_API_KEY: "remote-secret" };
    const bridge = await writeOmpPythonEnvBridge({
      runId: "run-remote-pyenv",
      target: { kind: "remote", transport: "sandbox", remoteCwd: remoteRoot, runner } as never,
      remote: true,
      env: runEnv,
      remoteRootDir: remoteRoot,
      cwd: remoteRoot,
      timeoutSec: 15,
      graceSec: 5,
    });
    expect(bridge.dir).toBe(path.posix.join(remoteRoot, "python-env"));
    const code =
      'import os,host_marker;print(os.environ["PYTHONPATH"]);print(host_marker.VALUE, os.environ.get("PAPERCLIP_API_URL"))';
    const launch = bridge.launch("python3", ["-c", code]);
    expect(launch.command).toBe("sh");
    expect(launch.args.join(" ")).not.toContain("remote-secret");
    const remoteShell = (env: Record<string, string>, command: string, args: string[]) => {
      const quoted = [command, ...args].map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" ");
      const assignments = Object.entries(env).map(([key, value]) => `${key}='${value.replaceAll("'", "'\\''")}'`);
      const script = assignments.length > 0 ? `exec env ${assignments.join(" ")} ${quoted}` : `exec ${quoted}`;
      return spawnSync("sh", ["-lc", script], {
        cwd: remoteRoot,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: remoteHome },
        encoding: "utf8",
      });
    };

    const viaLauncher = remoteShell({}, launch.command, launch.args);
    expect(viaLauncher.stderr).toBe("");
    expect(viaLauncher.stdout.trim().split("\n")).toEqual([
      [bridge.dir, hostSite].join(":"),
      "host-import-ok http://remote.invalid/api",
    ]);

    const literal = remoteShell({ PYTHONPATH: bridge.dir }, "python3", ["-c", code]);
    expect(literal.stderr).toContain("ModuleNotFoundError");

    await bridge.cleanup();
    await expect(fs.access(bridge.dir)).rejects.toThrow();
    expect(runnerCalls.some((call) => call.includes(`rm -rf '${bridge.dir}'`))).toBe(true);
  });
});
