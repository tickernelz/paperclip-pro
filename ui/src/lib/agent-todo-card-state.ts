const STORAGE_KEY = "paperclip:agent-todo-card:v1";
const EXPANDED = "expanded";
const COLLAPSED = "collapsed";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

/** Whether the pinned agent todo card was left open in this browser; collapsed until the user opens it. */
export function readAgentTodoCardExpanded(storage: StorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === EXPANDED;
  } catch {
    return false;
  }
}

export function writeAgentTodoCardExpanded(expanded: boolean, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, expanded ? EXPANDED : COLLAPSED);
  } catch {
    return;
  }
}
