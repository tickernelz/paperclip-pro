import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FEATURE_DESTINATIONS,
  FEATURE_PRESETS,
  INSTANCE_FEATURE_CATALOG,
  INSTANCE_FEATURE_KEYS,
  INSTANCE_FEATURE_PLACEMENT,
  NEW_INSTALL_FEATURE_DEFAULTS,
  activeFeaturePreset,
  featureKeysWithDestination,
  featurePlacement,
  featurePresetPatch,
  featureRequirements,
  missingFeatureRequirements,
  withDependentsDisabled,
} from "./feature-catalog.js";
import { instanceExperimentalSettingsSchema } from "./validators/instance.js";

function schemaBooleanFlagKeys(): string[] {
  return Object.entries(instanceExperimentalSettingsSchema.shape)
    .filter(([, fieldSchema]) => {
      let current: z.ZodTypeAny = fieldSchema as z.ZodTypeAny;
      for (;;) {
        if (current instanceof z.ZodDefault) {
          current = current._def.innerType as z.ZodTypeAny;
        } else if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
          current = current.unwrap() as z.ZodTypeAny;
        } else {
          break;
        }
      }
      return current instanceof z.ZodBoolean;
    })
    .map(([key]) => key)
    .sort();
}

describe("INSTANCE_FEATURE_CATALOG", () => {
  it("covers exactly the boolean flag keys of the experimental settings schema", () => {
    expect([...INSTANCE_FEATURE_KEYS]).toEqual(schemaBooleanFlagKeys());
  });

  it("keeps selfHostedDefault in sync with the schema defaults", () => {
    const schemaDefaults = instanceExperimentalSettingsSchema.parse({});
    for (const key of INSTANCE_FEATURE_KEYS) {
      expect(INSTANCE_FEATURE_CATALOG[key].selfHostedDefault, key).toBe(schemaDefaults[key]);
    }
  });

  it("has a non-empty title and description for every flag", () => {
    for (const key of INSTANCE_FEATURE_KEYS) {
      const entry = INSTANCE_FEATURE_CATALOG[key];
      expect(entry.title.trim().length, key).toBeGreaterThan(0);
      expect(entry.description.trim().length, key).toBeGreaterThan(0);
    }
  });
});

describe("INSTANCE_FEATURE_PLACEMENT", () => {
  it("gives every catalog key exactly one known destination", () => {
    expect(Object.keys(INSTANCE_FEATURE_PLACEMENT).sort()).toEqual([...INSTANCE_FEATURE_KEYS]);
    const perKey = INSTANCE_FEATURE_KEYS.map(
      (key) => FEATURE_DESTINATIONS.filter((destination) => featureKeysWithDestination(destination).includes(key)).length,
    );
    expect(perKey.every((count) => count === 1)).toBe(true);
  });

  it("splits the 44 keys into 24 features, 11 advanced, 5 permanent, 3 removed, and 1 merged", () => {
    expect(INSTANCE_FEATURE_KEYS).toHaveLength(44);
    const counts = Object.fromEntries(
      FEATURE_DESTINATIONS.map((destination) => [destination, featureKeysWithDestination(destination).length]),
    );
    expect(counts).toEqual({ features: 24, advanced: 11, permanent: 5, removed: 3, merged: 1 });
  });

  it("groups features into five groups and advanced settings into developer and runtime", () => {
    const groupCount = (destination: "features" | "advanced") => {
      const counts: Record<string, number> = {};
      for (const key of featureKeysWithDestination(destination)) {
        const group = featurePlacement(key, destination)!.group;
        counts[group] = (counts[group] ?? 0) + 1;
      }
      return counts;
    };
    expect(groupCount("features")).toEqual({
      collaboration: 7,
      automation: 6,
      integrations: 7,
      workspace: 2,
      display: 2,
    });
    expect(groupCount("advanced")).toEqual({ developer: 4, runtime: 7 });
  });

  it("makes the K-1 compatibility keys permanent and removes the K-2 keys with the classic interface", () => {
    expect(featureKeysWithDestination("permanent").sort()).toEqual(
      [
        "enableApps",
        "enableExperimentalFileViewer",
        "enableMcpAggregators",
        "enableStreamlinedLeftNavigation",
        "enableStreamlinedUi",
      ].sort(),
    );
    expect(featureKeysWithDestination("removed").sort()).toEqual(
      ["enableAiConnectionRouters", "enableClassicTaskInterface", "enableRunnerPreviewIngress"].sort(),
    );
    expect(INSTANCE_FEATURE_PLACEMENT.enableIsolatedWorkspacesByDefault).toMatchObject({
      destination: "merged",
      into: "enableIsolatedWorkspaces",
    });
  });

  it("marks exactly the five K-3 features as not finished", () => {
    const unfinished = featureKeysWithDestination("features").filter(
      (key) => featurePlacement(key, "features")!.finished === false,
    );
    expect(unfinished.sort()).toEqual(
      [
        "enableFastResponses",
        "enableFirstTaskPlanProposal",
        "enableGitHubReviewBots",
        "enableMemoryConnectors",
        "enableSimplifiedEnglishInteractions",
      ].sort(),
    );
  });

  it("only lets features and advanced settings depend on keys that stay switchable", () => {
    for (const key of INSTANCE_FEATURE_KEYS) {
      for (const required of featureRequirements(key)) {
        expect(["features", "advanced"]).toContain(INSTANCE_FEATURE_PLACEMENT[required].destination);
        expect(featureRequirements(required)).not.toContain(key);
      }
    }
  });
});

describe("FEATURE_PRESETS", () => {
  it("holds 3, 8, and 19 finished features", () => {
    expect(FEATURE_PRESETS.minimal).toHaveLength(3);
    expect(FEATURE_PRESETS.standard).toHaveLength(8);
    expect(FEATURE_PRESETS.everything).toHaveLength(19);
    for (const key of [...FEATURE_PRESETS.minimal, ...FEATURE_PRESETS.standard]) {
      expect(FEATURE_PRESETS.everything).toContain(key);
    }
  });

  it("keeps every requirement of a preset feature inside the same preset", () => {
    for (const keys of Object.values(FEATURE_PRESETS)) {
      for (const key of keys) {
        for (const required of featureRequirements(key)) expect(keys).toContain(required);
      }
    }
  });

  it("seeds new installs with exactly the Standard preset", () => {
    expect(Object.keys(NEW_INSTALL_FEATURE_DEFAULTS).sort()).toEqual([...FEATURE_PRESETS.standard].sort());
    expect(Object.values(NEW_INSTALL_FEATURE_DEFAULTS).every((value) => value === true)).toBe(true);
  });

  it("writes only finished features when a preset is applied and recognizes the result", () => {
    const patch = featurePresetPatch("minimal");
    expect(Object.keys(patch).sort()).toEqual([...FEATURE_PRESETS.everything].sort());
    expect(Object.entries(patch).filter(([, on]) => on).map(([key]) => key).sort()).toEqual(
      [...FEATURE_PRESETS.minimal].sort(),
    );
    expect(activeFeaturePreset({ ...patch, enableMemoryConnectors: true })).toBe("minimal");
    expect(activeFeaturePreset({ ...patch, enableCases: true })).toBeNull();
  });
});

describe("feature dependencies", () => {
  it("reports the requirements that are still off", () => {
    expect(missingFeatureRequirements("enablePipelines", {})).toEqual(["enableCases"]);
    expect(missingFeatureRequirements("enablePipelines", { enableCases: true })).toEqual([]);
    expect(missingFeatureRequirements("enableOpenAiDot", { enablePublicMcp: false })).toEqual(["enablePublicMcp"]);
    expect(missingFeatureRequirements("enableCases", {})).toEqual([]);
  });

  it("turns dependents off with the requirement they need", () => {
    expect(withDependentsDisabled({ enableCases: false })).toEqual({ enableCases: false, enablePipelines: false });
    expect(withDependentsDisabled({ enableSummaries: false })).toEqual({
      enableSummaries: false,
      enableStatusCards: false,
    });
    expect(withDependentsDisabled({ enablePublicMcp: false })).toEqual({
      enablePublicMcp: false,
      enableOpenAiDot: false,
    });
  });

  it("never turns a requirement on as a side effect", () => {
    expect(withDependentsDisabled({ enablePipelines: true })).toEqual({ enablePipelines: true });
    expect(withDependentsDisabled({ enableOpenAiDot: true })).toEqual({ enableOpenAiDot: true });
  });
});
