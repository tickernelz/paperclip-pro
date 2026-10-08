import { extractAgentMentionIds } from "@tickernelz/paperclip-pro-shared";

export interface AncestorHandoffCandidate<TIssue = unknown> {
  agentId: string;
  name: string;
  issue: TIssue;
}

const WORD_CHAR = "[\\p{L}\\p{N}_]";

function stripCode(body: string) {
  return body
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1[^\S\n]*$|(?![\s\S]))/gm, " ")
    .replace(/(`+)[\s\S]*?\1/g, " ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function plainMentionPattern(name: string) {
  const trimmed = name.trim();
  const firstWord = trimmed.split(/\s+/)[0] ?? "";
  const names = [...new Set([trimmed, firstWord].filter((value) => value.length > 0))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (names.length === 0) return null;
  return new RegExp(`(?<!${WORD_CHAR})@(?:${names.join("|")})(?!${WORD_CHAR})`, "iu");
}

/** Returns the candidates that `body` mentions by structured agent link or plain `@Name`. */
export function matchAncestorHandoffMentions<TIssue>(
  body: string,
  candidates: readonly AncestorHandoffCandidate<TIssue>[],
): AncestorHandoffCandidate<TIssue>[] {
  if (!body || candidates.length === 0) return [];
  const structured = new Set(extractAgentMentionIds(body));
  const plain = stripCode(body);
  return candidates.filter((candidate) => {
    if (structured.has(candidate.agentId)) return true;
    return plainMentionPattern(candidate.name)?.test(plain) ?? false;
  });
}
