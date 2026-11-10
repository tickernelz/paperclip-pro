import { migrateRetiredStorageKeys } from "./lib/retired-storage-keys";

for (const readStorage of [() => window.localStorage, () => window.sessionStorage]) {
  try {
    migrateRetiredStorageKeys(readStorage());
  } catch {
    continue;
  }
}
