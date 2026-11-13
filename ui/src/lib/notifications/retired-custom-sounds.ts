const RETIRED_DB_NAME = "paperclip-notifications";

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function moveRetiredCustomSounds(target: IDBDatabase, storeName: string): Promise<number> {
  if (typeof indexedDB.databases !== "function") return 0;
  const databases = await indexedDB.databases();
  if (!databases.some((database) => database.name === RETIRED_DB_NAME)) return 0;
  const retired = await settle(indexedDB.open(RETIRED_DB_NAME));
  let moved = 0;
  try {
    if (retired.objectStoreNames.contains(storeName)) {
      const records = await settle(retired.transaction(storeName, "readonly").objectStore(storeName).getAll());
      const existing = new Set(await settle(target.transaction(storeName, "readonly").objectStore(storeName).getAllKeys()));
      const missing = records.filter((record: { kind: IDBValidKey }) => !existing.has(record.kind));
      if (missing.length > 0) {
        const transaction = target.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        for (const record of missing) store.put(record);
        await committed(transaction);
        moved = missing.length;
      }
    }
  } finally {
    retired.close();
  }
  indexedDB.deleteDatabase(RETIRED_DB_NAME);
  return moved;
}
