import type { CLIAdapterModule } from "@tickernelz/paperclip-pro-adapter-utils";
import { printClaudeStreamEvent } from "@tickernelz/paperclip-pro-adapter-claude-local/cli";
import { printCodexStreamEvent } from "@tickernelz/paperclip-pro-adapter-codex-local/cli";
import { printCursorStreamEvent } from "@tickernelz/paperclip-pro-adapter-cursor-local/cli";
import { printCursorCloudEvent } from "@tickernelz/paperclip-pro-adapter-cursor-cloud/cli";
import { printGeminiStreamEvent } from "@tickernelz/paperclip-pro-adapter-gemini-local/cli";
import { printGrokStreamEvent } from "@tickernelz/paperclip-pro-adapter-grok-local/cli";
import { printKimiStreamEvent } from "@tickernelz/paperclip-pro-adapter-kimi-local/cli";
import { formatStdoutEvent as printHermesGatewayStreamEvent } from "@tickernelz/paperclip-pro-hermes-paperclip-adapter/gateway/cli";
import { printHermesStreamEvent } from "@tickernelz/paperclip-pro-hermes-paperclip-adapter/cli";
import { printOpenCodeStreamEvent } from "@tickernelz/paperclip-pro-adapter-opencode-local/cli";
import { printOmpStreamEvent } from "@tickernelz/paperclip-pro-adapter-omp-local/cli";
import { printPiStreamEvent } from "@tickernelz/paperclip-pro-adapter-pi-local/cli";
import { printOpenClawGatewayStreamEvent } from "@tickernelz/paperclip-pro-adapter-openclaw-gateway/cli";
import { processCLIAdapter } from "./process/index.js";
import { httpCLIAdapter } from "./http/index.js";

const claudeLocalCLIAdapter: CLIAdapterModule = {
  type: "claude_local",
  formatStdoutEvent: printClaudeStreamEvent,
};

const codexLocalCLIAdapter: CLIAdapterModule = {
  type: "codex_local",
  formatStdoutEvent: printCodexStreamEvent,
};

const openCodeLocalCLIAdapter: CLIAdapterModule = {
  type: "opencode_local",
  formatStdoutEvent: printOpenCodeStreamEvent,
};

const piLocalCLIAdapter: CLIAdapterModule = {
  type: "pi_local",
  formatStdoutEvent: printPiStreamEvent,
};

const ompLocalCLIAdapter: CLIAdapterModule = {
  type: "omp_local",
  formatStdoutEvent: printOmpStreamEvent,
};

const cursorLocalCLIAdapter: CLIAdapterModule = {
  type: "cursor",
  formatStdoutEvent: printCursorStreamEvent,
};

const cursorCloudCLIAdapter: CLIAdapterModule = {
  type: "cursor_cloud",
  formatStdoutEvent: printCursorCloudEvent,
};

const geminiLocalCLIAdapter: CLIAdapterModule = {
  type: "gemini_local",
  formatStdoutEvent: printGeminiStreamEvent,
};

const grokLocalCLIAdapter: CLIAdapterModule = {
  type: "grok_local",
  formatStdoutEvent: printGrokStreamEvent,
};

const kimiLocalCLIAdapter: CLIAdapterModule = {
  type: "kimi_local",
  formatStdoutEvent: printKimiStreamEvent,
};

const hermesGatewayCLIAdapter: CLIAdapterModule = {
  type: "hermes_gateway",
  formatStdoutEvent: printHermesGatewayStreamEvent,
};

const hermesLocalCLIAdapter: CLIAdapterModule = {
  type: "hermes_local",
  formatStdoutEvent: printHermesStreamEvent,
};

const openclawGatewayCLIAdapter: CLIAdapterModule = {
  type: "openclaw_gateway",
  formatStdoutEvent: printOpenClawGatewayStreamEvent,
};

const adaptersByType = new Map<string, CLIAdapterModule>(
  [
    claudeLocalCLIAdapter,
    codexLocalCLIAdapter,
    openCodeLocalCLIAdapter,
    piLocalCLIAdapter,
    ompLocalCLIAdapter,
    cursorLocalCLIAdapter,
    cursorCloudCLIAdapter,
    geminiLocalCLIAdapter,
    grokLocalCLIAdapter,
    kimiLocalCLIAdapter,
    hermesGatewayCLIAdapter,
    hermesLocalCLIAdapter,
    openclawGatewayCLIAdapter,
    processCLIAdapter,
    httpCLIAdapter,
  ].map((a) => [a.type, a]),
);

export function getCLIAdapter(type: string): CLIAdapterModule {
  return adaptersByType.get(type) ?? processCLIAdapter;
}
