const RETIRED_KEY_PREFIX = /^paperclip(?=[:.])/;

export function migrateRetiredStorageKeys(storage: Storage) {
  const retiredKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && RETIRED_KEY_PREFIX.test(key)) retiredKeys.push(key);
  }
  for (const key of retiredKeys) {
    const value = storage.getItem(key);
    const nextKey = key.replace(RETIRED_KEY_PREFIX, "wardmote");
    if (value !== null && storage.getItem(nextKey) === null) storage.setItem(nextKey, value);
    storage.removeItem(key);
  }
}
