import { useQuery } from "@tanstack/react-query";
import { FolderGit2, GitFork } from "lucide-react";
import type { CompanySkillDetail } from "@tickernelz/wardmote-shared";
import { Link } from "@/lib/router";
import { companySkillsApi } from "@/api/companySkills";
import { queryKeys } from "@/lib/queryKeys";
import { skillStudioRoute } from "@/lib/company-skill-routes";
import { formatLineageLabel } from "@/lib/skill-fork";
import { Button } from "@/components/ui/button";

/**
 * Lineage chip for forked skills (PAP-13112, plan §3.1): "Forked from
 * `owner/repo` @ `<short-sha>`" linking back to the original. The fork row only
 * carries `forkedFromSkillId`, so the original's source locator/ref are fetched
 * on demand; if the original is gone we still link by id with a soft label.
 */
export function SkillLineageChip({
  companyId,
  forkedFromSkillId,
}: {
  companyId: string;
  forkedFromSkillId: string | null;
}) {
  const originalQuery = useQuery({
    queryKey: queryKeys.companySkills.detail(companyId, forkedFromSkillId ?? ""),
    queryFn: () => companySkillsApi.detail(companyId, forkedFromSkillId!),
    enabled: Boolean(companyId && forkedFromSkillId),
    staleTime: 60_000,
  });

  if (!forkedFromSkillId) return null;

  const original = originalQuery.data;
  const label = original ? formatLineageLabel(original) : "the original skill";

  return (
    <Link
      to={skillStudioRoute(forkedFromSkillId)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-bg-3 px-2.5 py-0.5 text-xs text-ink-3 transition-colors hover:bg-bg-3 hover:text-ink"
      title={`Forked from ${label}`}
    >
      <GitFork className="h-3 w-3 shrink-0" />
      <span className="truncate">
        Forked from <span className="font-medium text-ink">{label}</span>
      </span>
    </Link>
  );
}

/**
 * Persistent source notice for repo-synced (`project_scan`) skills (PAP-13112,
 * plan §3.3). These stay editable, but their saves land as uncommitted writes
 * in the user's project checkout — disclosed here, with a secondary path to
 * fork instead of touching the tree. No behaviour change (§3.3, Dotta 07-08).
 */
export function ProjectScanNotice({
  skill,
  onEditACopy,
}: {
  skill: CompanySkillDetail;
  onEditACopy: () => void;
}) {
  const location = skill.sourcePath ?? skill.sourceLabel ?? "the project working tree";

  return (
    <div className="flex flex-wrap items-start gap-2 border-b border-line bg-bg-3/40 px-3 py-2 text-xs text-ink-3">
      <FolderGit2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        <span>
          This skill lives in <span className="font-mono text-ink">{location}</span>.
          Saves write to the project working tree and are not committed.
        </span>{" "}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={onEditACopy}
        >
          Edit a copy instead
        </Button>
      </div>
    </div>
  );
}
