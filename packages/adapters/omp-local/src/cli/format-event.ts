import pc from "picocolors";
import { parseOmpStdoutLine } from "../ui/parse-stdout.js";

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

export function printOmpStreamEvent(raw: string, debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  const entries = parseOmpStdoutLine(line, new Date().toISOString());
  for (const entry of entries) {
    switch (entry.kind) {
      case "init":
        console.log(pc.dim(`⎿ omp session ${entry.sessionId}${entry.model ? ` · ${entry.model}` : ""}`));
        break;
      case "assistant":
        process.stdout.write(entry.text);
        break;
      case "thinking":
        if (debug) process.stdout.write(pc.dim(entry.text));
        break;
      case "tool_call":
        console.log(pc.cyan(`→ ${entry.name}`) + pc.dim(` ${truncate(JSON.stringify(entry.input) ?? "", 160)}`));
        break;
      case "tool_result":
        if (entry.delta) break;
        console.log(
          entry.isError
            ? pc.red(`← ${entry.toolName ?? "tool"} failed: ${truncate(entry.content, 200)}`)
            : pc.dim(`← ${entry.toolName ?? "tool"} ${truncate(entry.content, 200)}`),
        );
        break;
      case "result":
        console.log(
          entry.isError
            ? pc.red(`✗ ${entry.subtype}${entry.text ? `: ${truncate(entry.text, 400)}` : ""}`)
            : pc.green(`✓ ${entry.subtype} · ${entry.inputTokens}in/${entry.outputTokens}out · $${entry.costUsd.toFixed(4)}`),
        );
        break;
      case "stderr":
        console.log(pc.red(entry.text));
        break;
      case "system":
        console.log(pc.dim(entry.text));
        break;
      case "stdout":
        if (debug) console.log(entry.text);
        break;
      default:
        if (debug) console.log(pc.dim(JSON.stringify(entry)));
        break;
    }
  }
}
