/**
 * @fileoverview Canonicalizes `localPath` install sources for
 * `POST /api/plugins/install`: absolute resolution plus symlink and `..`
 * normalization via `realpath`, validated to be a readable directory before
 * the loader sees it.
 */

import { realpath, stat } from "node:fs/promises";
import path from "node:path";

/** Result of canonicalizing a requested local plugin install path. */
export type LocalPluginPathValidation =
  | { ok: true; canonicalPath: string }
  | { ok: false; reason: string };

/**
 * Canonicalize and validate a raw `localPath` install source.
 *
 * Resolves the request string to an absolute path, then to its real path —
 * collapsing `..` traversal segments and resolving every symlink — and
 * requires the result to be an existing directory. The loader must only ever see the
 * canonical form so that no alias of a path can reach a different decision
 * than the path itself.
 *
 * @param rawPath - The unsanitized `packageName` value from the request body
 */
export async function canonicalizeLocalPluginPath(
  rawPath: string,
): Promise<LocalPluginPathValidation> {
  if (rawPath.includes("\0")) {
    return { ok: false, reason: "path contains a null byte" };
  }

  const absolutePath = path.resolve(rawPath);

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(absolutePath);
  } catch {
    return { ok: false, reason: `path does not exist: ${absolutePath}` };
  }

  try {
    const stats = await stat(canonicalPath);
    if (!stats.isDirectory()) {
      return { ok: false, reason: `path is not a directory: ${canonicalPath}` };
    }
  } catch {
    return { ok: false, reason: `path is not readable: ${canonicalPath}` };
  }

  return { ok: true, canonicalPath };
}
