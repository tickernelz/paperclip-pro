import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { IssueRef } from "@tickernelz/paperclip-pro-shared";
import { useOptionalCompany } from "@/context/CompanyContext";
import { queryKeys } from "@/lib/queryKeys";
import {
  ISSUE_REF_STALE_TIME_MS,
  loadIssueRef,
  normalizeIssueRef,
  observeNearViewport,
  readCachedIssueRef,
} from "@/lib/issueRefStatus";

/** Live id/identifier/title/status for a task mention, batched and loaded once the observed element nears the viewport. */
export function useIssueRefStatus(issuePathId: string): {
  issueRef: IssueRef | null;
  updatedAt: number;
  observe: (element: Element | null) => void;
} {
  const queryClient = useQueryClient();
  const companyId = useOptionalCompany()?.selectedCompanyId ?? null;
  const ref = useMemo(() => normalizeIssueRef(issuePathId), [issuePathId]);
  const [element, setElement] = useState<Element | null>(null);
  const [near, setNear] = useState(false);
  const active = Boolean(companyId && ref);
  const seedRef = useRef<{ key: string; value: ReturnType<typeof readCachedIssueRef> } | null>(null);

  const readSeed = () => {
    if (!companyId || !ref) return undefined;
    const key = `${companyId}:${ref}`;
    if (seedRef.current?.key !== key) {
      seedRef.current = { key, value: readCachedIssueRef(queryClient, companyId, ref) };
    }
    return seedRef.current.value;
  };

  useEffect(() => {
    if (!active || near || !element) return;
    return observeNearViewport(element, () => setNear(true));
  }, [active, near, element]);

  const query = useQuery({
    queryKey: queryKeys.issues.ref(companyId ?? "", ref ?? issuePathId),
    queryFn: () => loadIssueRef(queryClient, companyId!, ref!),
    enabled: active && near,
    staleTime: ISSUE_REF_STALE_TIME_MS,
    initialData: () => readSeed()?.ref,
    initialDataUpdatedAt: () => readSeed()?.updatedAt,
  });

  return { issueRef: query.data ?? null, updatedAt: query.dataUpdatedAt, observe: setElement };
}
