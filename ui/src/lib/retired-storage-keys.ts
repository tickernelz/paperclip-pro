import { NO_TEST_RUN_TEMPLATE_STORAGE_VALUE } from "./skill-studio-storage";

const RETIRED_KEY_PREFIX = /^paperclip(?=[:.])/;
const RUN_TEMPLATE_KEY_PREFIX = "skillStudio.runTemplate.";
const RETIRED_NO_TEMPLATE_VALUE = "__paperclip_no_template__";

export function migrateRetiredStorageKeys(storage: Storage) {
  const retiredKeys: string[] = [];
  const runTemplateKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null) continue;
    if (RETIRED_KEY_PREFIX.test(key)) retiredKeys.push(key);
    if (key.startsWith(RUN_TEMPLATE_KEY_PREFIX)) runTemplateKeys.push(key);
  }
  for (const key of retiredKeys) {
    const value = storage.getItem(key);
    const nextKey = key.replace(RETIRED_KEY_PREFIX, "wardmote");
    if (value !== null && storage.getItem(nextKey) === null) storage.setItem(nextKey, value);
    storage.removeItem(key);
  }
  for (const key of runTemplateKeys) {
    if (storage.getItem(key) === RETIRED_NO_TEMPLATE_VALUE) storage.setItem(key, NO_TEST_RUN_TEMPLATE_STORAGE_VALUE);
  }
}
