import type { RoutineListItem } from "@tickernelz/paperclip-pro-shared";
import type { OfficeObjectKind } from "@/lib/pixels-office/officeModel";

export const OFFICE_OBJECT_LABELS: Record<OfficeObjectKind, string> = {
  kanban: "Kanban board",
  mailbox: "Mailbox",
  clock: "Wall clock",
  coins: "Coin stack",
  alarm: "Alarm light",
};

export interface NextRoutineRun {
  routineId: string;
  routineName: string;
  atMs: number;
}

export function nextRoutineRun(routines: readonly RoutineListItem[]): NextRoutineRun | null {
  let best: NextRoutineRun | null = null;
  for (const routine of routines) {
    for (const trigger of routine.triggers) {
      if (!trigger.enabled || !trigger.nextRunAt) continue;
      const atMs = new Date(trigger.nextRunAt).getTime();
      if (Number.isNaN(atMs)) continue;
      if (!best || atMs < best.atMs) {
        best = { routineId: routine.id, routineName: routine.title, atMs };
      }
    }
  }
  return best;
}
