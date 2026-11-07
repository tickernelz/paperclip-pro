import { useEffect } from "react";
import { Navigate } from "@/lib/router";
import { useDialogActions } from "../context/DialogContext";

export function NewTaskShortcut() {
  const { openNewIssue } = useDialogActions();
  useEffect(() => {
    openNewIssue();
  }, [openNewIssue]);
  return <Navigate to="/issues" replace />;
}
