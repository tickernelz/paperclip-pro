import type {
  PixelsOfficeSeatAssignment,
  PixelsOfficeSnapshot,
} from "@tickernelz/paperclip-pro-shared";
import { api } from "./client";

export const pixelsOfficeApi = {
  snapshot: (companyId: string) =>
    api.get<PixelsOfficeSnapshot>(`/companies/${companyId}/pixels-office`),

  replaceSeats: (companyId: string, assignments: PixelsOfficeSeatAssignment[]) =>
    api.put<{ assignments: PixelsOfficeSeatAssignment[] }>(
      `/companies/${companyId}/pixels-office/seats`,
      { assignments },
    ),
};
