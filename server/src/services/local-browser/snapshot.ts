import {
  LOCAL_BROWSER_CURSOR_PATTERN,
  LOCAL_BROWSER_SNAPSHOT_DEFAULT_NODES,
  LOCAL_BROWSER_SNAPSHOT_MAX_NODES,
} from "@tickernelz/paperclip-pro-shared";

export interface SnapshotNode {
  ref?: string;
  role?: string;
  name?: string;
  value?: string;
  depth?: number;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
}

export interface SnapshotPayload {
  url?: string;
  title?: string;
  nodes?: SnapshotNode[];
  truncated?: boolean;
  total?: number;
  offset?: number;
  cursor?: string | null;
  cursorReset?: boolean;
}

export interface RenderedSnapshot {
  url: string;
  title: string;
  text: string;
  nodes: number;
  total: number;
  truncated: boolean;
  cursor?: string;
}

const MAX_COLLAPSED_RUN_CHARS = 300;
const MAX_RENDER_DEPTH = 40;
const MAX_NODE_FIELD_CHARS = 160;
const MAX_RENDERED_TEXT_CHARS = 40_000;
const PLAIN_VALUE = /^[\w@.:/+-]{1,120}$/;

export function formatSnapshotCursor(offset: number): string {
  return String(Math.max(0, Math.trunc(offset)));
}

export function parseSnapshotCursor(cursor: string | undefined): number {
  if (typeof cursor !== "string") return 0;
  const trimmed = cursor.trim();
  if (!LOCAL_BROWSER_CURSOR_PATTERN.test(trimmed)) return 0;
  const offset = Number(trimmed);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
}

function payloadOffset(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

export function clampSnapshotMaxNodes(maxNodes: number | undefined): number {
  if (maxNodes === undefined) return LOCAL_BROWSER_SNAPSHOT_DEFAULT_NODES;
  if (!Number.isFinite(maxNodes)) return LOCAL_BROWSER_SNAPSHOT_DEFAULT_NODES;
  return Math.min(Math.max(Math.trunc(maxNodes), 1), LOCAL_BROWSER_SNAPSHOT_MAX_NODES);
}

function quote(text: string): string {
  return JSON.stringify(text);
}

export function boundNodeText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";
  if (value.length <= MAX_NODE_FIELD_CHARS) return value;
  return value.slice(0, MAX_NODE_FIELD_CHARS) + "…";
}

function isTextOnly(node: SnapshotNode): boolean {
  if (node.ref) return false;
  const role = (node.role ?? "").trim().toLowerCase();
  return role === "text" || role === "statictext" || role === "inline-text" || role === "";
}

function formatValue(value: string): string {
  return PLAIN_VALUE.test(value) ? value : quote(value);
}

function clampDepth(depth: unknown): number {
  if (typeof depth !== "number" || !Number.isFinite(depth)) return 0;
  return Math.min(Math.max(Math.trunc(depth), 0), MAX_RENDER_DEPTH);
}

function renderNode(node: SnapshotNode, depth: number): string {
  const indent = "  ".repeat(clampDepth(depth));
  const role = boundNodeText((node.role ?? "node").trim()) || "node";
  const head = node.ref ? boundNodeText(node.ref) + " " + role : role;
  const boundedName = boundNodeText(node.name);
  const boundedValue = boundNodeText(node.value);
  const name = boundedName.length > 0 ? " " + quote(boundedName) : "";
  const value = boundedValue.length > 0 ? "=" + formatValue(boundedValue) : "";
  const flags = [
    node.disabled ? " [disabled]" : "",
    node.checked ? " [checked]" : "",
    node.selected ? " [selected]" : "",
  ].join("");
  return indent + head + name + value + flags;
}

function renderTextRun(run: SnapshotNode[]): string {
  const indent = "  ".repeat(clampDepth(run[0]?.depth));
  const parts: string[] = [];
  let used = 0;
  for (const node of run) {
    const text = boundNodeText((node.name ?? node.value ?? "").trim());
    if (!text) continue;
    if (used + text.length + 1 > MAX_COLLAPSED_RUN_CHARS) {
      parts.push("…");
      break;
    }
    parts.push(text);
    used += text.length + 1;
  }
  if (parts.length === 0) return `${indent}text`;
  return `${indent}text ${quote(parts.join(" "))}`;
}

export function renderSnapshot(
  payload: SnapshotPayload,
  options: { maxNodes?: number; cursor?: string } = {},
): RenderedSnapshot {
  const rawNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const total = typeof payload.total === "number" && payload.total >= 0 ? payload.total : rawNodes.length;
  const reset = payload.cursorReset === true;
  const requested = parseSnapshotCursor(options.cursor);
  const reported = reset ? null : payloadOffset(payload.offset);
  const base = reported ?? (reset ? 0 : requested);
  const start = reported === null ? Math.min(base, rawNodes.length) : 0;
  const maxNodes = clampSnapshotMaxNodes(options.maxNodes);
  const lines: string[] = [];
  let index = start;
  let rendered = 0;

  while (index < rawNodes.length && lines.length < maxNodes) {
    const node = rawNodes[index]!;
    let line: string;
    let consumed: number;
    if (isTextOnly(node)) {
      const run: SnapshotNode[] = [];
      while (index + run.length < rawNodes.length && isTextOnly(rawNodes[index + run.length]!)) {
        run.push(rawNodes[index + run.length]!);
      }
      line = renderTextRun(run);
      consumed = run.length;
    } else {
      line = renderNode(node, node.depth ?? 0);
      consumed = 1;
    }
    const width = rendered === 0 ? line.length : rendered + 1 + line.length;
    if (width > MAX_RENDERED_TEXT_CHARS) break;
    lines.push(line);
    rendered = width;
    index += consumed;
  }

  const nextOffset = base + (index - start);
  const pageComplete = index >= rawNodes.length;
  const truncated = !pageComplete || nextOffset < total || payload.truncated === true;
  const result: RenderedSnapshot = {
    url: typeof payload.url === "string" ? payload.url : "",
    title: typeof payload.title === "string" ? payload.title : "",
    text: lines.join("\n"),
    nodes: lines.length,
    total,
    truncated,
  };
  if (truncated && nextOffset > base) result.cursor = formatSnapshotCursor(nextOffset);
  return boundRenderedSnapshot(result);
}

export function boundRenderedSnapshot(snapshot: RenderedSnapshot): RenderedSnapshot {
  if (snapshot.text.length <= MAX_RENDERED_TEXT_CHARS) return snapshot;
  return { ...snapshot, text: snapshot.text.slice(0, MAX_RENDERED_TEXT_CHARS), truncated: true };
}
