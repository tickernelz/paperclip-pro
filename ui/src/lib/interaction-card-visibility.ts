import { useState } from "react";

export type InteractionCardSurface = "dock" | "thread";

function storageKey(surface: InteractionCardSurface, id: string): string {
  return `paperclip.interaction-card-hidden.${surface}:${id}`;
}

function readHidden(key: string | null): boolean {
  if (!key) return false;
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeHidden(key: string, hidden: boolean) {
  try {
    if (hidden) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch {
    return;
  }
}

/** Session-scoped Hide/Show state for one interaction card; an unseen id starts shown. */
export function useInteractionCardHidden(
  surface: InteractionCardSurface,
  id: string | null,
): [boolean, (hidden: boolean) => void] {
  const key = id ? storageKey(surface, id) : null;
  const [state, setState] = useState(() => ({ key, hidden: readHidden(key) }));
  let current = state;
  if (state.key !== key) {
    current = { key, hidden: readHidden(key) };
    setState(current);
  }
  function setHidden(hidden: boolean) {
    if (key) writeHidden(key, hidden);
    setState({ key, hidden });
  }
  return [current.hidden, setHidden];
}
