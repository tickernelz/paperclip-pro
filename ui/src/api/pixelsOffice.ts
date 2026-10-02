import type {
  PixelsOfficeSeatAssignment,
  PixelsOfficeSnapshot,
  PixelsOfficeTimeline,
} from "@tickernelz/paperclip-pro-shared";
import { api } from "./client";

export const pixelsOfficeApi = {
  snapshot: (companyId: string) =>
    api.get<PixelsOfficeSnapshot>(`/companies/${companyId}/pixels-office`),

  timeline: (companyId: string, query: { from: string; to: string; cursor?: string }) => {
    const search = new URLSearchParams({ from: query.from, to: query.to });
    if (query.cursor) search.set("cursor", query.cursor);
    return api.get<PixelsOfficeTimeline>(
      `/companies/${companyId}/pixels-office/timeline?${search.toString()}`,
    );
  },

  replaceSeats: (companyId: string, assignments: PixelsOfficeSeatAssignment[]) =>
    api.put<{ assignments: PixelsOfficeSeatAssignment[] }>(
      `/companies/${companyId}/pixels-office/seats`,
      { assignments },
    ),
};
