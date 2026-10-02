import { describe, expect, it } from "vitest";
import { tintForHour, type Tint } from "./ambience";

function tintAt(hour: number): Tint {
  return tintForHour(hour, { r: 0, g: 0, b: 0, alpha: 0 });
}

describe("tintForHour", () => {
  it("leaves midday untinted", () => {
    expect(tintAt(12).alpha).toBe(0);
    expect(tintAt(9).alpha).toBe(0);
    expect(tintAt(16).alpha).toBe(0);
  });

  it("darkens deep night the most", () => {
    const night = tintAt(2);
    const evening = tintAt(20);

    expect(night.alpha).toBeGreaterThan(0.4);
    expect(night.alpha).toBeGreaterThan(evening.alpha);
    expect(night.b).toBeGreaterThan(night.r);
  });

  it("warms dawn and dusk instead of cooling them", () => {
    const dawn = tintAt(6);
    const dusk = tintAt(18);
    const night = tintAt(2);

    expect(dawn.r).toBeGreaterThan(dawn.b);
    expect(dusk.r).toBeGreaterThan(dusk.b);
    expect(dusk.r).toBeGreaterThan(night.r);
  });

  it("interpolates between neighbouring hours", () => {
    const start = tintAt(17);
    const end = tintAt(18);
    const middle = tintAt(17.5);

    expect(middle.alpha).toBeGreaterThan(start.alpha);
    expect(middle.alpha).toBeLessThan(end.alpha);
  });

  it("wraps the clock so 24 matches midnight", () => {
    expect(tintAt(24).alpha).toBe(tintAt(0).alpha);
    expect(tintAt(23.5).alpha).toBeGreaterThan(0);
  });
});
