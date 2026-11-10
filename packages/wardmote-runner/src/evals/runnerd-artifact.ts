import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  WARDMOTE_RUNNERD_BUILD_METADATA_SCHEMA,
  WARDMOTE_RUNNER_BUILD_METADATA,
} from "./build-metadata.js";

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

async function readVerifiedBuildMetadata(
  bytes: Buffer,
  timeoutMs: number,
): Promise<string> {
  const stagingDirectory = await mkdtemp(join(tmpdir(), "wardmote-runnerd-verified-"));
  const stagedExecutable = join(
    stagingDirectory,
    process.platform === "win32" ? "wardmote-runnerd.exe" : "wardmote-runnerd",
  );

  try {
    await chmod(stagingDirectory, 0o700);
    await writeFile(stagedExecutable, bytes, { flag: "wx", mode: 0o700 });
    await chmod(stagedExecutable, 0o700);
    const { stdout } = await execFileAsync(stagedExecutable, ["--build-metadata"], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
    });
    return stdout;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

export interface WardmoteRunnerdBuildMetadata {
  schema: typeof WARDMOTE_RUNNERD_BUILD_METADATA_SCHEMA;
  binaryName: "wardmote-runnerd";
  packageName: "@tickernelz/wardmote-runner";
  packageVersion: string;
  binaryContractVersion: number;
  nativeExecutionVersion: number;
  harnessDriverVersion: number;
  prp: {
    name: string;
    minimumVersion: number;
    maximumVersion: number;
  };
}

export interface WardmoteRunnerdArtifact {
  executablePath: string;
  sha256: string;
  byteSize: number;
  buildMetadata: WardmoteRunnerdBuildMetadata;
}

export class WardmoteRunnerdArtifactError extends Error {
  readonly code = "wardmote_runnerd_artifact_invalid" as const;

  constructor(
    message: string,
    readonly issue:
      | "path_invalid"
      | "digest_invalid"
      | "digest_mismatch"
      | "metadata_unavailable"
      | "metadata_invalid",
  ) {
    super(message);
    this.name = "WardmoteRunnerdArtifactError";
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WardmoteRunnerdArtifactError(`${path} must be an object`, "metadata_invalid");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WardmoteRunnerdArtifactError(`${path} must be a non-empty string`, "metadata_invalid");
  }
  return value;
}

function version(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new WardmoteRunnerdArtifactError(`${path} must be a positive integer`, "metadata_invalid");
  }
  return value as number;
}

/** Parse the runnerd response without accepting a look-alike binary. */
export function parseWardmoteRunnerdBuildMetadata(
  value: unknown,
): WardmoteRunnerdBuildMetadata {
  const metadata = record(value, "runnerd build metadata");
  if (metadata.schema !== WARDMOTE_RUNNERD_BUILD_METADATA_SCHEMA) {
    throw new WardmoteRunnerdArtifactError(
      `runnerd metadata schema ${String(metadata.schema)} is unsupported; expected ${WARDMOTE_RUNNERD_BUILD_METADATA_SCHEMA}`,
      "metadata_invalid",
    );
  }
  if (metadata.binaryName !== "wardmote-runnerd") {
    throw new WardmoteRunnerdArtifactError(
      `runnerd metadata names unexpected binary ${String(metadata.binaryName)}`,
      "metadata_invalid",
    );
  }
  if (metadata.packageName !== WARDMOTE_RUNNER_BUILD_METADATA.package.name) {
    throw new WardmoteRunnerdArtifactError(
      `runnerd metadata names unexpected package ${String(metadata.packageName)}`,
      "metadata_invalid",
    );
  }
  const prp = record(metadata.prp, "runnerd build metadata.prp");
  const minimumVersion = version(
    prp.minimumVersion,
    "runnerd build metadata.prp.minimumVersion",
  );
  const maximumVersion = version(
    prp.maximumVersion,
    "runnerd build metadata.prp.maximumVersion",
  );
  if (minimumVersion > maximumVersion) {
    throw new WardmoteRunnerdArtifactError(
      "runnerd build metadata.prp minimumVersion must not exceed maximumVersion",
      "metadata_invalid",
    );
  }
  return {
    schema: WARDMOTE_RUNNERD_BUILD_METADATA_SCHEMA,
    binaryName: "wardmote-runnerd",
    packageName: WARDMOTE_RUNNER_BUILD_METADATA.package.name,
    packageVersion: text(metadata.packageVersion, "runnerd build metadata.packageVersion"),
    binaryContractVersion: version(
      metadata.binaryContractVersion,
      "runnerd build metadata.binaryContractVersion",
    ),
    nativeExecutionVersion: version(
      metadata.nativeExecutionVersion,
      "runnerd build metadata.nativeExecutionVersion",
    ),
    harnessDriverVersion: version(
      metadata.harnessDriverVersion,
      "runnerd build metadata.harnessDriverVersion",
    ),
    prp: {
      name: text(prp.name, "runnerd build metadata.prp.name"),
      minimumVersion,
      maximumVersion,
    },
  };
}

/**
 * Resolve one explicitly supplied runnerd artifact, verify its content digest,
 * and read version metadata from that exact executable. This never searches
 * PATH or the App source tree.
 */
export async function resolveWardmoteRunnerdArtifact(input: {
  executablePath: string;
  expectedSha256: string;
  metadataTimeoutMs?: number;
}): Promise<WardmoteRunnerdArtifact> {
  if (!SHA256_PATTERN.test(input.expectedSha256)) {
    throw new WardmoteRunnerdArtifactError(
      "expectedSha256 must use the sha256:<64 lowercase hex> form",
      "digest_invalid",
    );
  }

  let executablePath: string;
  let fileStat: Awaited<ReturnType<typeof stat>>;
  let bytes: Buffer;
  try {
    executablePath = await realpath(input.executablePath);
    fileStat = await stat(executablePath);
    if (!fileStat.isFile()) throw new Error("path is not a file");
    bytes = await readFile(executablePath);
  } catch (error) {
    throw new WardmoteRunnerdArtifactError(
      `runnerd artifact ${input.executablePath} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      "path_invalid",
    );
  }

  const observedSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (observedSha256 !== input.expectedSha256) {
    throw new WardmoteRunnerdArtifactError(
      `runnerd artifact digest mismatch: expected ${input.expectedSha256}, observed ${observedSha256}`,
      "digest_mismatch",
    );
  }

  let stdout: string;
  try {
    stdout = await readVerifiedBuildMetadata(bytes, input.metadataTimeoutMs ?? 5_000);
  } catch (error) {
    throw new WardmoteRunnerdArtifactError(
      `runnerd artifact did not return build metadata: ${error instanceof Error ? error.message : String(error)}`,
      "metadata_unavailable",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new WardmoteRunnerdArtifactError(
      `runnerd build metadata is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      "metadata_invalid",
    );
  }

  return {
    executablePath,
    sha256: observedSha256,
    byteSize: bytes.byteLength,
    buildMetadata: parseWardmoteRunnerdBuildMetadata(parsed),
  };
}
