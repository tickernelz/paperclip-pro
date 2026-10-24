import { readClipboardItems, readTextFromClipboard } from "@/lib/clipboard";

export interface TerminalClipboardContent {
  image: Blob | null;
  text: string;
}

export const CLIPBOARD_IMAGE_READ_TIMEOUT_MS = 3_000;

const SHELL_SAFE_PATH = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function shellEscapePath(path: string): string {
  return SHELL_SAFE_PATH.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`;
}

export function pastedImageFromTransfer(data: DataTransfer | null): File | null {
  if (!data || Array.from(data.types).includes("text/plain")) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

async function firstImage(items: ClipboardItem[]): Promise<Blob | null> {
  for (const item of items) {
    const type = item.types.find((entry) => entry.startsWith("image/"));
    if (type) return item.getType(type);
  }
  return null;
}

export async function readTerminalClipboard(): Promise<TerminalClipboardContent> {
  const items = await readClipboardItems();
  if (!items) return { image: null, text: await readTextFromClipboard() };
  for (const item of items) {
    if (item.types.includes("text/plain")) {
      return { image: null, text: await (await item.getType("text/plain")).text() };
    }
  }
  return { image: await firstImage(items), text: "" };
}

export async function readClipboardImage(timeoutMs: number = CLIPBOARD_IMAGE_READ_TIMEOUT_MS): Promise<Blob | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const read = readClipboardItems().then((items) => (items ? firstImage(items) : null)).catch(() => null);
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
