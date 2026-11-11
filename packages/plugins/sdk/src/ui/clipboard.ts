import { getSdkUiRuntimeValue } from "./runtime.js";

export function copyTextToClipboard(text: string): Promise<void> {
  const copy = getSdkUiRuntimeValue<(value: string) => Promise<void>>("copyTextToClipboard");
  return copy(text);
}
