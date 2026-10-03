import { parseMarkdown, type Nodes, type Root } from "chat";

export const OPENWA_TEXT_LIMIT = 4096;
export const OPENWA_MAX_INLINE_PARTS = 3;
export const OPENWA_DOCUMENT_CAPTION_LIMIT = 1024;
export const OPENWA_RESPONSE_DOCUMENT_NAME = "response.md";
export const OPENWA_RESPONSE_DOCUMENT_MIME = "text/markdown";
const MONOSPACE_TABLE_WIDTH = 48;
const FENCE = "```";

type Parent = Extract<Nodes, { children: unknown }>;
type Definitions = Map<string, string>;

interface RenderContext {
  definitions: Definitions;
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

export type OpenwaFormattedPublication =
  | { kind: "text"; parts: string[] }
  | { kind: "document"; caption: string; document: { filename: string; mimetype: string; content: string } };

function codePoints(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

function sliceCodePoints(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let out = "";
  let count = 0;
  for (const char of text) {
    if (count === limit) break;
    out += char;
    count++;
  }
  return out;
}

function collectDefinitions(node: Nodes, definitions: Definitions): void {
  if (node.type === "definition") {
    definitions.set(node.identifier.toLowerCase(), node.url);
    return;
  }
  if ("children" in node) for (const child of node.children as Nodes[]) collectDefinitions(child, definitions);
}

function plainText(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code" || node.type === "html") return node.value;
  if (node.type === "break") return "\n";
  if (node.type === "image") return node.alt ?? "";
  if ("children" in node) return (node.children as Nodes[]).map(plainText).join("");
  return "";
}

function wrap(marker: string, inner: string): string {
  if (!inner.trim()) return inner;
  const lead = /^\s*/.exec(inner)![0];
  const trail = /\s*$/.exec(inner)![0];
  return lead + marker + inner.slice(lead.length, inner.length - trail.length) + marker + trail;
}

function linkText(label: string, url: string): string {
  const visible = label.trim();
  if (!visible || visible === url || "mailto:" + visible === url) return url;
  return visible + " (" + url + ")";
}

function inline(nodes: readonly Nodes[], context: RenderContext): string {
  let out = "";
  for (const node of nodes) out += inlineNode(node, context);
  return out;
}

function inlineNode(node: Nodes, context: RenderContext): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "strong":
      return context.bold ? inline(node.children, context) : wrap("*", inline(node.children, { ...context, bold: true }));
    case "emphasis":
      return context.italic ? inline(node.children, context) : wrap("_", inline(node.children, { ...context, italic: true }));
    case "delete":
      return context.strike ? inline(node.children, context) : wrap("~", inline(node.children, { ...context, strike: true }));
    case "inlineCode":
      return "`" + node.value + "`";
    case "break":
      return "\n";
    case "link":
      return linkText(plainText(node), node.url);
    case "linkReference": {
      const url = context.definitions.get(node.identifier.toLowerCase());
      const label = plainText(node);
      return url ? linkText(label, url) : label;
    }
    case "image":
      return node.alt ? node.alt + " (" + node.url + ")" : node.url;
    case "imageReference": {
      const url = context.definitions.get(node.identifier.toLowerCase());
      return url ? (node.alt ? node.alt + " (" + url + ")" : url) : (node.alt ?? "");
    }
    case "footnoteReference":
      return "[" + node.identifier + "]";
    case "html":
      return node.value;
    default:
      return "children" in node ? inline(node.children as Nodes[], context) : plainText(node);
  }
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : line ? " ".repeat(codePoints(prefix)) + line : line))
    .join("\n");
}

function listBlock(node: Extract<Nodes, { type: "list" }>, context: RenderContext): string {
  const start = node.start ?? 1;
  const items: string[] = [];
  node.children.forEach((item, index) => {
    const marker = node.ordered ? String(start + index) + ". " : "- ";
    const check = item.checked === true ? "[x] " : item.checked === false ? "[ ] " : "";
    const body = item.children
      .map((child) => block(child as Nodes, context))
      .filter((text) => text.length > 0)
      .join(node.spread || item.spread ? "\n\n" : "\n");
    items.push(marker + indent(check + body, marker));
  });
  return items.join(node.spread ? "\n\n" : "\n");
}

function tableBlock(node: Extract<Nodes, { type: "table" }>, context: RenderContext): string {
  const rows = node.children.map((row) => row.children.map((cell) => plainText(cell).replace(/\s+/g, " ").trim()));
  const columns = Math.max(0, ...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) => Math.max(1, ...rows.map((row) => codePoints(row[column] ?? ""))));
  const lineWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, columns - 1) * 3;
  if (lineWidth <= MONOSPACE_TABLE_WIDTH && !rows.some((row) => row.some((cell) => cell.includes(FENCE)))) {
    const pad = (row: string[]) =>
      widths
        .map((width, column) => {
          const value = row[column] ?? "";
          return value + " ".repeat(width - codePoints(value));
        })
        .join(" | ")
        .trimEnd();
    const lines = rows.map(pad);
    if (lines.length > 1) lines.splice(1, 0, widths.map((width) => "-".repeat(width)).join("-+-"));
    return FENCE + "\n" + lines.join("\n") + "\n" + FENCE;
  }
  const headers = node.children[0]?.children.map((cell) => inline(cell.children, context).trim()) ?? [];
  return node.children
    .slice(1)
    .map((row) =>
      "- " +
      row.children
        .map((cell, column) => {
          const value = inline(cell.children, context).trim();
          const header = headers[column];
          return header ? "*" + header + ":* " + value : value;
        })
        .join("; "),
    )
    .join("\n");
}

function block(node: Nodes, context: RenderContext): string {
  switch (node.type) {
    case "paragraph":
      return inline(node.children, context);
    case "heading": {
      const text = inline(node.children, { ...context, bold: true }).trim();
      return text ? "*" + text + "*" : "";
    }
    case "code":
      return FENCE + "\n" + node.value + "\n" + FENCE;
    case "blockquote":
      return blocks(node.children as Nodes[], context)
        .join("\n\n")
        .split("\n")
        .map((line) => (line ? "> " + line : ">"))
        .join("\n");
    case "list":
      return listBlock(node, context);
    case "table":
      return tableBlock(node, context);
    case "thematicBreak":
      return "———";
    case "html":
      return node.value;
    case "definition":
      return "";
    case "footnoteDefinition":
      return "[" + node.identifier + "] " + blocks(node.children as Nodes[], context).join(" ");
    default:
      return "children" in node ? inline((node as Parent).children as Nodes[], context) : plainText(node);
  }
}

function blocks(nodes: readonly Nodes[], context: RenderContext): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    const text = block(node, context);
    if (text.length > 0) out.push(text);
  }
  return out;
}

export function markdownToWhatsappBlocks(markdown: string): string[] {
  const root = parseMarkdown(markdown) as Root;
  const definitions: Definitions = new Map();
  collectDefinitions(root, definitions);
  return blocks(root.children as Nodes[], { definitions, bold: false, italic: false, strike: false });
}

export function markdownToWhatsapp(markdown: string): string {
  return markdownToWhatsappBlocks(markdown).join("\n\n");
}

function hardSplit(text: string, limit: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (codePoints(rest) > limit) {
    const head = sliceCodePoints(rest, limit);
    const space = head.lastIndexOf(" ");
    const cut = space > head.length / 2 ? space : head.length;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

function splitLines(text: string, limit: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const pieces = codePoints(line) > limit ? hardSplit(line, limit) : [line];
    for (const piece of pieces) {
      const candidate = current ? current + "\n" + piece : piece;
      if (codePoints(candidate) <= limit) current = candidate;
      else {
        if (current) out.push(current);
        current = piece;
      }
    }
  }
  if (current) out.push(current);
  return out;
}

function splitBlock(text: string, limit: number): string[] {
  if (codePoints(text) <= limit) return [text];
  const fenced = text.startsWith(FENCE + "\n") && text.endsWith("\n" + FENCE);
  if (!fenced) return splitLines(text, limit);
  const overhead = codePoints(FENCE + "\n" + "\n" + FENCE);
  return splitLines(text.slice(FENCE.length + 1, text.length - FENCE.length - 1), limit - overhead).map(
    (chunk) => FENCE + "\n" + chunk + "\n" + FENCE,
  );
}

export function packWhatsappBlocks(input: readonly string[], options: { limit?: number; firstPartReserve?: number } = {}): string[] {
  const limit = options.limit ?? OPENWA_TEXT_LIMIT;
  const reserve = options.firstPartReserve ?? 0;
  const parts: string[] = [];
  let current = "";
  const capacity = () => (parts.length === 0 ? limit - reserve : limit);
  for (const text of input) {
    for (const piece of splitBlock(text, Math.min(limit, limit - reserve))) {
      const candidate = current ? current + "\n\n" + piece : piece;
      if (codePoints(candidate) <= capacity()) current = candidate;
      else {
        if (current) parts.push(current);
        current = piece;
      }
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function formatOpenwaPublication(input: { markdown: string; prefix?: string | null }): OpenwaFormattedPublication {
  const prefix = input.prefix?.trim() ? input.prefix.trim() : null;
  const converted = markdownToWhatsappBlocks(input.markdown);
  const reserve = prefix ? codePoints(prefix) + 1 : 0;
  const parts = packWhatsappBlocks(converted, { firstPartReserve: reserve });
  if (parts.length === 0) return { kind: "text", parts: [] };
  if (parts.length <= OPENWA_MAX_INLINE_PARTS)
    return { kind: "text", parts: parts.map((part, index) => (index === 0 && prefix ? prefix + "\n" + part : part)) };
  const lead = converted[0] ?? "";
  const room = OPENWA_DOCUMENT_CAPTION_LIMIT - reserve;
  const summary = codePoints(lead) > room ? sliceCodePoints(lead, room - 1).trimEnd() + "…" : lead;
  return {
    kind: "document",
    caption: prefix ? prefix + "\n" + summary : summary,
    document: { filename: OPENWA_RESPONSE_DOCUMENT_NAME, mimetype: OPENWA_RESPONSE_DOCUMENT_MIME, content: input.markdown },
  };
}
