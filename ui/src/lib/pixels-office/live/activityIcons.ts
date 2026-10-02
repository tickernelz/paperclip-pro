import type { ActivityIcon } from "../officeModel";

const RULES: ReadonlyArray<readonly [RegExp, ActivityIcon]> = [
  [/web|http|fetch|browser|crawl|url|scrape|navigate/, "web"],
  [/comment|reply|message|chat|notify|email|slack|discord|ask_user|respond|mention|interaction/, "comment"],
  [/think|plan|reason|reflect|sequential|todo|goal/, "think"],
  [/write|edit|create|update|patch|insert|append|replace|delete|remove|rename|move|upload/, "write"],
  [/bash|shell|exec|run|command|terminal|test|build|install|deploy|git|docker|script|compile/, "run"],
  [/read|view|cat|open|glob|grep|search|find|list|ls|inspect|diff|show|get|fetch_file|notebook/, "read"],
];

const EXACT: Readonly<Record<string, ActivityIcon>> = {
  ls: "read",
  cd: "run",
  task: "think",
  agent: "think",
};

function normalizeToolName(toolName: string): string {
  const withoutServer = toolName.includes("__")
    ? toolName.slice(toolName.lastIndexOf("__") + 2)
    : toolName;
  return withoutServer.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function activityIconForTool(toolName: string | null | undefined): ActivityIcon {
  if (!toolName) return "think";
  const name = normalizeToolName(toolName);
  if (!name) return "think";
  const exact = EXACT[name];
  if (exact) return exact;
  for (const [pattern, icon] of RULES) {
    if (pattern.test(name)) return icon;
  }
  return "other";
}
