import { useEffect } from "react";
import { TerminalWorkspace } from "@/components/terminal/TerminalWorkspace";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";

export function Terminal() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Terminal" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company to open a terminal.</p>;
  }

  return <TerminalWorkspace key={selectedCompanyId} companyId={selectedCompanyId} />;
}
