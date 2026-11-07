import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bundledOmpVersion,
  detectRecentProjectFolder,
  ompGateFailure,
  probeOmpInstall,
  readOmpDefaultModel,
  recommendOmpModel,
} from "./readiness.js";

const dirs: string[] = [];

async function fakeOmp(output: string, exitCode = 0): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-readiness-"));
  dirs.push(dir);
  const file = path.join(dir, "omp");
  await fs.writeFile(file, `#!/bin/sh\necho '${output}'\nexit ${exitCode}\n`, { mode: 0o755 });
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe.skipIf(process.platform === "win32")("probeOmpInstall", () => {
  it("rejects an OMP older than 18.1.16 with the update command", async () => {
    const dir = await fakeOmp("omp/18.1.15");
    const probe = await probeOmpInstall({ env: { PATH: dir } });
    expect(probe).toMatchObject({ state: "too_old", version: "18.1.15", path: path.join(dir, "omp") });
    expect(ompGateFailure(probe)).toBe("OMP 18.1.15 is older than 18.1.16. Update it with: omp update");
  });

  it("accepts exactly the minimum and newer versions", async () => {
    const exact = await probeOmpInstall({ env: { PATH: await fakeOmp("omp/18.1.16") } });
    const newer = await probeOmpInstall({ env: { PATH: await fakeOmp("omp/19.0.0") } });
    expect([exact.state, newer.state]).toEqual(["ready", "ready"]);
    expect(ompGateFailure(exact)).toBeNull();
  });

  it("reports a missing OMP with the install command", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "omp-readiness-"));
    dirs.push(empty);
    const probe = await probeOmpInstall({ env: { PATH: empty }, platform: "linux" });
    expect(probe.state).toBe("missing");
    expect(ompGateFailure(probe, "linux")).toBe("OMP was not found. Install it with: curl -fsSL https://omp.sh/install | sh");
  });

  it("lists every copy on PATH in order and gates on the first one", async () => {
    const old = await fakeOmp("omp/18.0.2");
    const current = await fakeOmp("omp/18.18.0");
    const probe = await probeOmpInstall({ env: { PATH: `${old}:${current}` } });
    expect(probe.state).toBe("too_old");
    expect(probe.copies.map((copy) => copy.version)).toEqual(["18.0.2", "18.18.0"]);
  });

  it("treats a binary that fails --version as an unknown version", async () => {
    const probe = await probeOmpInstall({ env: { PATH: await fakeOmp("boom", 2) } });
    expect(probe.state).toBe("unknown_version");
    expect(ompGateFailure(probe)).toContain("omp update");
  });

  it("probes an explicitly chosen file instead of PATH", async () => {
    const dir = await fakeOmp("omp/18.2.0");
    const probe = await probeOmpInstall({ command: path.join(dir, "omp"), env: { PATH: "" } });
    expect(probe).toMatchObject({ state: "ready", version: "18.2.0" });
    expect((await probeOmpInstall({ command: path.join(dir, "missing"), env: { PATH: dir } })).state).toBe("missing");
  });
});

async function sessionFile(agentDir: string, slug: string, cwd: string, mtime: number): Promise<void> {
  const dir = path.join(agentDir, "sessions", slug);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "s.jsonl");
  await fs.writeFile(file, `{"type":"title","title":"x"}\n{"type":"session","cwd":${JSON.stringify(cwd)}}\n`);
  const when = new Date(mtime);
  await fs.utimes(file, when, when);
  await fs.utimes(dir, when, when);
}

describe("detectRecentProjectFolder", () => {
  it("returns the newest OMP session folder that still exists, skipping home and temp", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "omp-home-"));
    dirs.push(home);
    const projects = path.join(home, "Projects");
    const acme = path.join(projects, "acme");
    const older = path.join(projects, "older");
    await fs.mkdir(acme, { recursive: true });
    await fs.mkdir(older, { recursive: true });
    const agentDir = path.join(home, ".omp", "agent");
    await sessionFile(agentDir, "a", older, 1_000_000);
    await sessionFile(agentDir, "b", acme, 2_000_000);
    await sessionFile(agentDir, "c", path.join(projects, "deleted"), 3_000_000);
    await sessionFile(agentDir, "d", home, 4_000_000);
    await sessionFile(agentDir, "e", os.tmpdir(), 5_000_000);
    expect(await detectRecentProjectFolder({}, home)).toBe(acme);
    expect(await detectRecentProjectFolder({}, path.join(home, "nobody"))).toBeNull();
  });
});

describe("OMP default model", () => {
  it("reads modelRoles.default without the thinking suffix and prefers it when listed", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "omp-home-"));
    dirs.push(home);
    await fs.mkdir(path.join(home, ".omp", "agent"), { recursive: true });
    await fs.writeFile(path.join(home, ".omp", "agent", "config.yml"), "modelRoles:\n  default: anthropic/claude-opus-5-5:high\n");
    const preferred = await readOmpDefaultModel({}, home);
    expect(preferred).toBe("anthropic/claude-opus-5-5");
    const models = [{ id: "openai/gpt-6" }, { id: "anthropic/claude-opus-5-5" }];
    expect(recommendOmpModel(models, preferred)).toBe("anthropic/claude-opus-5-5");
    expect(recommendOmpModel(models, "gone/model")).toBe("openai/gpt-6");
    expect(recommendOmpModel([], preferred)).toBeNull();
  });
});

describe("bundledOmpVersion", () => {
  it("reads the Docker pin and ignores blanks", () => {
    expect(bundledOmpVersion({ PAPERCLIP_OMP_BUNDLED_VERSION: "18.18.0" })).toBe("18.18.0");
    expect(bundledOmpVersion({ PAPERCLIP_OMP_BUNDLED_VERSION: " " })).toBeNull();
    expect(bundledOmpVersion({})).toBeNull();
  });
});
