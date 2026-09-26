import { createContext, useCallback, useContext, useState, type Dispatch, type SetStateAction } from "react";

// A phase can move from the live tail into persisted history. Its expansion
// belongs to the logical phase, not whichever component currently hosts it.
// Only an explicit user choice is remembered: an absent key means the user has
// expressed no preference and the caller's auto rule still governs.
export const TaskChatExpansionState = createContext<Map<string, boolean> | null>(null);

export function useTaskChatExpansion(id: string, auto: boolean): [boolean, Dispatch<SetStateAction<boolean>>] {
  const memory = useContext(TaskChatExpansionState);
  const [explicit, setExplicit] = useState<boolean | undefined>(() => memory?.get(id));
  const open = explicit ?? memory?.get(id) ?? auto;
  const update = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    setExplicit((previous) => {
      const current = previous ?? memory?.get(id) ?? auto;
      const next = typeof value === "function" ? value(current) : value;
      memory?.set(id, next);
      return next;
    });
  }, [id, memory, auto]);
  return [open, update];
}
