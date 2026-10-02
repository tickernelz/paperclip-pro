import type { CurrentBoardAccess } from "../../../api/access";

export function canBoardAssignIssues(
  companyId: string | null | undefined,
  boardAccess: CurrentBoardAccess | undefined,
): boolean {
  if (!companyId || !boardAccess) return false;
  if (boardAccess.source === "local_implicit" || boardAccess.isInstanceAdmin) return true;
  if (!boardAccess.memberships || boardAccess.memberships.length === 0) {
    return boardAccess.companyIds.includes(companyId);
  }
  const membership = boardAccess.memberships.find(
    (entry) => entry.companyId === companyId && entry.status === "active",
  );
  if (!membership) return false;
  return membership.membershipRole !== "viewer" && membership.membershipRole !== null;
}
