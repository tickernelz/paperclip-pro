import { lazy, type ComponentType } from "react";

export const STALE_CHUNK_RELOAD_KEY = "wardmote.staleChunkReload";

type ReloadMarkStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface LazyPageOptions {
  reload?: () => void;
  storage?: ReloadMarkStorage | null;
  path?: () => string;
}

function sessionStore(): ReloadMarkStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function clearReloadMark(storage: ReloadMarkStorage | null) {
  try {
    storage?.removeItem(STALE_CHUNK_RELOAD_KEY);
  } catch {
    return;
  }
}

function markReloadOnce(storage: ReloadMarkStorage | null, path: string) {
  if (!storage) return false;
  try {
    if (storage.getItem(STALE_CHUNK_RELOAD_KEY) === path) return false;
    storage.setItem(STALE_CHUNK_RELOAD_KEY, path);
    return true;
  } catch {
    return false;
  }
}

/** React.lazy for code-split pages that reloads once when a deploy removed the chunk the open tab still references. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<T>, options: LazyPageOptions = {}) {
  const reload = options.reload ?? (() => window.location.reload());
  const readPath = options.path ?? (() => window.location.pathname);
  return lazy(async () => {
    const storage = options.storage === undefined ? sessionStore() : options.storage;
    try {
      const component = await load();
      clearReloadMark(storage);
      return { default: component };
    } catch (error) {
      if (!markReloadOnce(storage, readPath())) throw error;
      reload();
      return new Promise<never>(() => {});
    }
  });
}
