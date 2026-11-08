import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BaseSequencer, type TestSpecification } from "vitest/node";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifests = ["serialized-shard-durations.json", "general-server-shard-durations.json"];

function loadDurations(): Map<string, number> {
  const durations = new Map<string, number>();
  for (const manifest of manifests) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(repoRoot, "scripts", manifest), "utf8")) as { durations?: Record<string, unknown> };
      for (const [file, ms] of Object.entries(parsed.durations ?? {})) {
        if (typeof ms === "number" && Number.isFinite(ms)) durations.set(file, ms);
      }
    } catch {
      continue;
    }
  }
  return durations;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export class LongestFirstSequencer extends BaseSequencer {
  private readonly durations = loadDurations();

  private readonly fallback = median([...this.durations.values()]);

  private weight(spec: TestSpecification): number {
    const repoPath = path.relative(repoRoot, spec.moduleId).split(path.sep).join("/");
    return this.durations.get(repoPath) ?? this.fallback;
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => this.weight(b) - this.weight(a) || a.moduleId.localeCompare(b.moduleId));
  }
}
