import { createHash } from "node:crypto";

import { WARDMOTE_RUNNER_COMPATIBILITY } from "../compatibility.js";
import {
  PRP_PROTOCOL_MIN_VERSION,
  PRP_PROTOCOL_NAME,
  PRP_PROTOCOL_VERSION,
} from "../protocol/replay-contract.js";
import { canonicalCapabilitySemanticCatalog } from "../semantic-tools/catalog.js";

export const WARDMOTE_RUNNER_BUILD_METADATA_SCHEMA =
  "wardmote-runner/build-metadata/v1" as const;
export const WARDMOTE_RUNNER_NATIVE_EXECUTION_SCHEMA =
  "wardmote-runner/native-execution/v1" as const;
export const WARDMOTE_RUNNER_EVAL_INTEGRATION_SCHEMA =
  "wardmote-runner/evals-integration/v1" as const;
export const WARDMOTE_RUNNERD_BUILD_METADATA_SCHEMA =
  "wardmote-runner/runnerd-build-metadata/v1" as const;

export const WARDMOTE_RUNNER_SEMANTIC_CATALOG_SHA256 =
  `sha256:${createHash("sha256")
    .update(canonicalCapabilitySemanticCatalog())
    .digest("hex")}` as const;

/**
 * App-owned release metadata that Evals pins beside every native attempt.
 * Contract versions are independent from package semver so consumers can give
 * a precise mismatch instead of guessing from a package version.
 */
export const WARDMOTE_RUNNER_BUILD_METADATA = Object.freeze({
  schema: WARDMOTE_RUNNER_BUILD_METADATA_SCHEMA,
  package: Object.freeze({
    name: WARDMOTE_RUNNER_COMPATIBILITY.packageName,
    version: WARDMOTE_RUNNER_COMPATIBILITY.packageVersion,
  }),
  contracts: Object.freeze({
    evalIntegration: WARDMOTE_RUNNER_COMPATIBILITY.components.evalIntegration,
    nativeExecution: WARDMOTE_RUNNER_COMPATIBILITY.components.nativeExecution,
    runnerdArtifact: WARDMOTE_RUNNER_COMPATIBILITY.components.runnerdBinary,
    prp: PRP_PROTOCOL_VERSION,
    semanticCatalog: WARDMOTE_RUNNER_COMPATIBILITY.components.catalog,
    harnessDriver: WARDMOTE_RUNNER_COMPATIBILITY.components.harnessDriver,
    controlPlaneAdapter: WARDMOTE_RUNNER_COMPATIBILITY.components.controlPlaneAdapter,
    testkit: WARDMOTE_RUNNER_COMPATIBILITY.components.testkit,
  }),
  prp: Object.freeze({
    name: PRP_PROTOCOL_NAME,
    minimumVersion: PRP_PROTOCOL_MIN_VERSION,
    maximumVersion: PRP_PROTOCOL_VERSION,
  }),
  semanticCatalog: Object.freeze({
    version: WARDMOTE_RUNNER_COMPATIBILITY.components.catalog,
    sha256: WARDMOTE_RUNNER_SEMANTIC_CATALOG_SHA256,
  }),
  runnerd: Object.freeze({
    binaryName: "wardmote-runnerd" as const,
    metadataSchema: WARDMOTE_RUNNERD_BUILD_METADATA_SCHEMA,
    digestAlgorithm: "sha256" as const,
  }),
});

export type WardmoteRunnerBuildMetadata = typeof WARDMOTE_RUNNER_BUILD_METADATA;
