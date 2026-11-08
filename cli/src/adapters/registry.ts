import type { CLIAdapterModule } from "@tickernelz/wardmote-adapter-utils";
import { printOmpStreamEvent } from "@tickernelz/wardmote-adapter-omp-local/cli";
import { processCLIAdapter } from "./process/index.js";
import { httpCLIAdapter } from "./http/index.js";

const ompLocalCLIAdapter: CLIAdapterModule = {
  type: "omp_local",
  formatStdoutEvent: printOmpStreamEvent,
};

const adaptersByType = new Map<string, CLIAdapterModule>(
  [ompLocalCLIAdapter, processCLIAdapter, httpCLIAdapter].map((a) => [a.type, a]),
);

export function getCLIAdapter(type: string): CLIAdapterModule {
  return adaptersByType.get(type) ?? processCLIAdapter;
}
