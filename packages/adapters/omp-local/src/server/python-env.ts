import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionTarget } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";
import { writePaperclipMcpMount } from "@tickernelz/paperclip-pro-adapter-utils/paperclip-mcp-mount";

export const OMP_PYTHON_ENV_FILE_NAME = "paperclip-env.json";
export const OMP_PYTHON_SITECUSTOMIZE_FILE_NAME = "sitecustomize.py";
export const OMP_PYTHON_LAUNCHER_FILE_NAME = "paperclip-python-env.sh";

export interface OmpPythonEnvLaunch {
  command: string;
  args: string[];
}

export interface OmpPythonEnvBridge {
  dir: string;
  launch: (command: string, args: string[]) => OmpPythonEnvLaunch;
  cleanup: () => Promise<void>;
}

export function renderOmpSitecustomize(): string {
  return `import os
import sys


def _paperclip_here():
    return os.path.realpath(os.path.dirname(os.path.abspath(__file__)))


def _paperclip_apply_env(here):
    import json
    with open(os.path.join(here, ${JSON.stringify(OMP_PYTHON_ENV_FILE_NAME)}), "r") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        return
    for key, value in data.items():
        if isinstance(key, str) and isinstance(value, str):
            os.environ.setdefault(key, value)


def _paperclip_resolve(entry):
    try:
        return os.path.realpath(os.path.abspath(entry or os.curdir))
    except Exception:
        return None


def _paperclip_is_bridge(entry):
    resolved = _paperclip_resolve(entry)
    if resolved is None:
        return False
    try:
        return os.path.isfile(os.path.join(resolved, ${JSON.stringify(OMP_PYTHON_ENV_FILE_NAME)}))
    except Exception:
        return False


def _paperclip_chain(here):
    import importlib.machinery
    import importlib.util
    rest = [
        entry for entry in sys.path
        if isinstance(entry, str) and _paperclip_resolve(entry) != here and not _paperclip_is_bridge(entry)
    ]
    spec = importlib.machinery.PathFinder.find_spec("sitecustomize", rest)
    if spec is None or spec.loader is None or not spec.origin:
        return
    if _paperclip_resolve(os.path.dirname(spec.origin)) == here:
        return
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


def _paperclip_main():
    if getattr(sys, "_paperclip_env_bridge_loaded", False):
        return
    try:
        setattr(sys, "_paperclip_env_bridge_loaded", True)
    except Exception:
        return
    try:
        here = _paperclip_here()
    except Exception:
        return
    try:
        _paperclip_apply_env(here)
    except Exception:
        pass
    try:
        _paperclip_chain(here)
    except Exception:
        pass


_paperclip_main()
`;
}

export function renderOmpPythonEnvData(env: Record<string, string>): string {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("PAPERCLIP_") && typeof value === "string") data[key] = value;
  }
  return `${JSON.stringify(data)}\n`;
}

export function prependPythonPath(dir: string, existing: string | undefined, separator: string): string {
  return existing ? `${dir}${separator}${existing}` : dir;
}

function shellQuoteSingle(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function renderOmpPythonEnvLauncher(dir: string): string {
  return [
    `PYTHONPATH=${shellQuoteSingle(dir)}"\${PYTHONPATH:+:\$PYTHONPATH}"`,
    "export PYTHONPATH",
    'exec "$@"',
    "",
  ].join("\n");
}

export async function writeOmpPythonEnvBridge(input: {
  runId: string;
  target: AdapterExecutionTarget | null | undefined;
  remote: boolean;
  env: Record<string, string>;
  remoteRootDir: string | null;
  cwd: string;
  timeoutSec: number;
  graceSec: number;
}): Promise<OmpPythonEnvBridge> {
  const remoteDir = path.posix.join(
    input.remoteRootDir ?? path.posix.join(input.cwd, ".paperclip-runtime", "omp"),
    "python-env",
  );
  const mountInput = {
    runId: input.runId,
    target: input.target,
    remote: input.remote,
    localPrefix: "paperclip-omp-pyenv-",
    remoteDir,
    cwd: input.cwd,
    env: input.env,
    timeoutSec: input.timeoutSec,
    graceSec: input.graceSec,
  };
  const data = await writePaperclipMcpMount({
    ...mountInput,
    content: renderOmpPythonEnvData(input.env),
    fileName: OMP_PYTHON_ENV_FILE_NAME,
  });
  try {
    if (input.remote) {
      await writePaperclipMcpMount({
        ...mountInput,
        content: renderOmpSitecustomize(),
        fileName: OMP_PYTHON_SITECUSTOMIZE_FILE_NAME,
      });
      const launcher = await writePaperclipMcpMount({
        ...mountInput,
        content: renderOmpPythonEnvLauncher(data.dir),
        fileName: OMP_PYTHON_LAUNCHER_FILE_NAME,
      });
      return {
        dir: data.dir,
        launch: (command, args) => ({ command: "sh", args: [launcher.filePath, command, ...args] }),
        cleanup: data.cleanup,
      };
    }
    await fs.writeFile(path.join(data.dir, OMP_PYTHON_SITECUSTOMIZE_FILE_NAME), renderOmpSitecustomize(), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    await data.cleanup().catch(() => {});
    throw error;
  }
  return { dir: data.dir, launch: (command, args) => ({ command, args }), cleanup: data.cleanup };
}
