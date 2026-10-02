import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { combineLayouts } from "../assetLoader";
import { buildDynamicCatalog, type LoadedAssetData } from "../layout/furnitureCatalog";
import type { AgentVisual } from "../officeModel";
import type { OfficeLayout } from "../types";
import { OfficeControllerImpl } from "./controller";

function readJson<T>(relative: string): T {
  const url = new URL(`../../../../public/pixels/${relative}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

function controller(): OfficeControllerImpl {
  const index = readJson<{ furniture: LoadedAssetData["catalog"] }>("pixels-office-assets.json");
  const sprites: LoadedAssetData["sprites"] = {};
  for (const asset of index.furniture) sprites[asset.id] = [["#ffffff"]];
  buildDynamicCatalog({ catalog: index.furniture, sprites });
  const combined = combineLayouts(
    readJson<OfficeLayout>("default-layout-1.json"),
    readJson<OfficeLayout>("agent-pixels-layout-boardroom-kitchen.json"),
  );
  return new OfficeControllerImpl("company-1", combined.layout, combined.cameraBounds);
}

function working(message: string, updatedAtMs: number): AgentVisual {
  return {
    agentId: "agent-1",
    shortName: "Raka",
    status: "running",
    activity: { icon: "read", message, updatedAtMs },
    attention: false,
    working: true,
  };
}

describe("OfficeControllerImpl.syncAgents", () => {
  it("serves the newest progress even when status and activity icon are unchanged", () => {
    const office = controller();
    office.syncAgents([working("Reading a.ts", 1_000)], []);
    office.syncAgents([working("Reading b.ts", 2_000)], []);
    expect(office.visual("agent-1")?.activity).toEqual({
      icon: "read",
      message: "Reading b.ts",
      updatedAtMs: 2_000,
    });
  });
});
