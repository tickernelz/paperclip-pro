import { buildAgentMentionHref } from "@tickernelz/paperclip-pro-shared";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

export interface AgentNameMentionCandidate {
  id: string;
  name: string;
  status: string;
}

export type AgentNameMentionIndex = ReadonlyArray<readonly [name: string, agentId: string | null]>;

const SKIPPED_PARENT_TYPES = new Set(["link", "linkReference", "code", "inlineCode", "definition", "html"]);
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;
const MENTION_END_RE = /[\s\p{P}]/u;

export function buildAgentNameMentionIndex(
  agents: ReadonlyArray<AgentNameMentionCandidate> | null | undefined,
): AgentNameMentionIndex | null {
  if (!agents?.length) return null;
  const byName = new Map<string, string | null>();
  for (const agent of agents) {
    if (!agent.name?.trim()) continue;
    const linkable = agent.status !== "terminated" && !byName.has(agent.name);
    byName.set(agent.name, linkable ? agent.id : null);
  }
  const entries = [...byName.entries()];
  if (!entries.some(([, agentId]) => agentId)) return null;
  return entries.sort(([a], [b]) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

function matchAgentNameAt(value: string, nameStart: number, index: AgentNameMentionIndex) {
  for (const entry of index) {
    const name = entry[0];
    if (!value.startsWith(name, nameStart)) continue;
    const end = nameStart + name.length;
    if (end < value.length && !MENTION_END_RE.test(value[end]!)) continue;
    return entry;
  }
  return null;
}

function linkifyAgentNamesInText(value: string, index: AgentNameMentionIndex): MarkdownNode[] | null {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  let at = value.indexOf("@");
  while (at !== -1) {
    let next = at + 1;
    if (at === 0 || !WORD_CHAR_RE.test(value[at - 1]!)) {
      const entry = matchAgentNameAt(value, at + 1, index);
      if (entry) {
        next = at + 1 + entry[0].length;
        if (entry[1]) {
          if (at > cursor) nodes.push({ type: "text", value: value.slice(cursor, at) });
          nodes.push({
            type: "link",
            url: buildAgentMentionHref(entry[1]),
            children: [{ type: "text", value: `@${entry[0]}` }],
          });
          cursor = next;
        }
      }
    }
    at = value.indexOf("@", next);
  }
  if (cursor === 0) return null;
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

function rewriteMarkdownTree(node: MarkdownNode, index: AgentNameMentionIndex) {
  if (!Array.isArray(node.children) || node.children.length === 0) return;
  if (SKIPPED_PARENT_TYPES.has(node.type)) return;
  const nextChildren: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string" && child.value.includes("@")) {
      const linked = linkifyAgentNamesInText(child.value, index);
      if (linked) {
        nextChildren.push(...linked);
        continue;
      }
    }
    rewriteMarkdownTree(child, index);
    nextChildren.push(child);
  }
  node.children = nextChildren;
}

export interface RemarkLinkAgentNameMentionsOptions {
  index: AgentNameMentionIndex;
}

export function remarkLinkAgentNameMentions(options: RemarkLinkAgentNameMentionsOptions) {
  return (tree: MarkdownNode) => {
    rewriteMarkdownTree(tree, options.index);
  };
}
