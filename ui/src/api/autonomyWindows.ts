import type { IssueAutonomyWindow, IssueAutonomyWindowList } from "@tickernelz/paperclip-pro-shared";
import { api } from "./client";

export const autonomyWindowsApi = {
  listLive: (companyId: string) => api.get<IssueAutonomyWindowList>(`/companies/${companyId}/autonomy-windows`),
  close: (windowId: string) => api.delete<IssueAutonomyWindow>(`/autonomy-windows/${windowId}`),
};
