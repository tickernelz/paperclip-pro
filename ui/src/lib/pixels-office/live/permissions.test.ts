import { describe, expect, it } from "vitest";
import type { CurrentBoardAccess } from "../../../api/access";
import { canBoardAssignIssues } from "./permissions";

function access(overrides: Partial<CurrentBoardAccess> = {}): CurrentBoardAccess {
  return {
    user: null,
    userId: "user-1",
    isInstanceAdmin: false,
    companyIds: ["company-1"],
    source: "session",
    keyId: null,
    ...overrides,
  };
}

describe("drag-assign gating", () => {
  it("refuses when the actor has no board access at all", () => {
    expect(canBoardAssignIssues("company-1", undefined)).toBe(false);
    expect(canBoardAssignIssues(null, access())).toBe(false);
  });

  it("refuses a viewer membership and a membership in another company", () => {
    expect(
      canBoardAssignIssues(
        "company-1",
        access({
          memberships: [{ companyId: "company-1", membershipRole: "viewer", status: "active" }],
        }),
      ),
    ).toBe(false);
    expect(
      canBoardAssignIssues(
        "company-1",
        access({
          companyIds: ["company-2"],
          memberships: [{ companyId: "company-2", membershipRole: "admin", status: "active" }],
        }),
      ),
    ).toBe(false);
  });

  it("refuses a membership that is not active yet", () => {
    expect(
      canBoardAssignIssues(
        "company-1",
        access({
          memberships: [{ companyId: "company-1", membershipRole: "admin", status: "pending" }],
        }),
      ),
    ).toBe(false);
  });

  it("allows an active non-viewer member, the local board and an instance admin", () => {
    expect(
      canBoardAssignIssues(
        "company-1",
        access({
          memberships: [{ companyId: "company-1", membershipRole: "operator", status: "active" }],
        }),
      ),
    ).toBe(true);
    expect(canBoardAssignIssues("company-1", access({ source: "local_implicit", companyIds: [] }))).toBe(
      true,
    );
    expect(
      canBoardAssignIssues("company-9", access({ isInstanceAdmin: true, companyIds: [] })),
    ).toBe(true);
  });

  it("falls back to company membership when the server sends no membership rows", () => {
    expect(canBoardAssignIssues("company-1", access())).toBe(true);
    expect(canBoardAssignIssues("company-2", access())).toBe(false);
  });
});
