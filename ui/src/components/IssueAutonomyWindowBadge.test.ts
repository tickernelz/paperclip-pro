import { describe, expect, it } from "vitest";
import type { IssueAutonomyWindow } from "@tickernelz/paperclip-pro-shared";
import { coveringAutonomyWindow } from "./IssueAutonomyWindowBadge";

const now = Date.parse("2026-10-08T12:00:00.000Z");
const window = (overrides: Partial<IssueAutonomyWindow>): IssueAutonomyWindow => ({
  id: "w1",
  companyId: "c1",
  rootIssueId: "root",
  rootIssueIdentifier: "ZHA-1",
  rootIssueTitle: "Root",
  grantedByUserId: "u1",
  grantedVia: "whatsapp",
  status: "live",
  expiresAt: new Date(now + 3_600_000),
  maxAccepts: null,
  acceptCount: 0,
  note: null,
  createdAt: new Date(now),
  updatedAt: new Date(now),
  closedAt: null,
  closedByUserId: null,
  ...overrides,
});

describe("coveringAutonomyWindow", () => {
  it("covers the root and its descendants through their ancestors", () => {
    expect(coveringAutonomyWindow([window({})], "root", [], now)?.id).toBe("w1");
    expect(coveringAutonomyWindow([window({})], "child", ["parent", "root"], now)?.id).toBe("w1");
    expect(coveringAutonomyWindow([window({})], "other", ["elsewhere"], now)).toBeNull();
  });

  it("ignores expired, closed and exhausted windows and prefers the latest expiry", () => {
    expect(coveringAutonomyWindow([window({ expiresAt: new Date(now - 1) })], "root", [], now)).toBeNull();
    expect(coveringAutonomyWindow([window({ status: "revoked" })], "root", [], now)).toBeNull();
    expect(coveringAutonomyWindow([window({ maxAccepts: 2, acceptCount: 2 })], "root", [], now)).toBeNull();
    expect(
      coveringAutonomyWindow(
        [window({ id: "soon" }), window({ id: "later", expiresAt: new Date(now + 7_200_000) })],
        "root",
        [],
        now,
      )?.id,
    ).toBe("later");
  });
});
