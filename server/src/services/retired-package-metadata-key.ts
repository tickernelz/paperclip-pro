import { isPlainRecord } from "../lib/agent-records.js";

export const RETIRED_PACKAGE_METADATA_KEY = "paperclip";

export function readPackageMetadataBlock(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (isPlainRecord(metadata?.wardmote)) return metadata.wardmote;
  const retired = metadata?.[RETIRED_PACKAGE_METADATA_KEY];
  return isPlainRecord(retired) ? retired : null;
}
