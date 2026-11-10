import { createHash } from "node:crypto";

import type { WardmoteJsonSchema } from "../catalog/semantic-action-types.js";
import type { WardmoteSemanticToolDefinition } from "./types.js";

export const WARDMOTE_RUNNER_AUTHORIZED_TOOLS_SCHEMA =
  "paperclip.runner.authorized-tools.v1" as const;

export interface WardmoteRunnerAuthorizedTool {
  readonly operationId: string;
  readonly version: 1;
  readonly description: string;
  readonly inputSchema: WardmoteJsonSchema;
  readonly responseSchema: WardmoteJsonSchema;
}

export interface WardmoteRunnerAuthorizedToolSet {
  readonly schema: typeof WARDMOTE_RUNNER_AUTHORIZED_TOOLS_SCHEMA;
  readonly schemaVersion: 1;
  readonly catalogDigest: string;
  readonly operations: readonly WardmoteRunnerAuthorizedTool[];
}

export function createWardmoteRunnerAuthorizedToolSet(
  definitions: readonly WardmoteSemanticToolDefinition[],
): WardmoteRunnerAuthorizedToolSet {
  const names = new Set<string>();
  const operations = definitions
    .map((definition): WardmoteRunnerAuthorizedTool => {
      if (definition.annotations.version !== 1 || names.has(definition.name)) {
        throw new Error("wardmote_runner_authorized_tools_invalid");
      }
      names.add(definition.name);
      return {
        operationId: definition.name,
        version: 1,
        description: definition.description,
        inputSchema: definition.inputSchema,
        responseSchema: definition.outputSchema,
      };
    })
    .sort((left, right) =>
      left.operationId < right.operationId
        ? -1
        : left.operationId > right.operationId
          ? 1
          : 0,
    );
  return deepFreeze({
    schema: WARDMOTE_RUNNER_AUTHORIZED_TOOLS_SCHEMA,
    schemaVersion: 1,
    catalogDigest: digestOperations(operations),
    operations,
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function digestOperations(
  operations: readonly WardmoteRunnerAuthorizedTool[],
): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(operations))
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error("wardmote_runner_authorized_tools_invalid");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}
