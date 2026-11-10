export const COMPANY_PACKAGE_EXTENSION_FILE = ".wardmote.yaml";
export const COMPANY_PACKAGE_EXTENSION_SCHEMA = "wardmote/v1";

const CURRENT_EXTENSION_NAMES = [".wardmote.yaml", ".wardmote.yml"];
const RETIRED_EXTENSION_NAMES = [".paperclip.yaml", ".paperclip.yml"];

function baseName(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  return slash === -1 ? filePath : filePath.slice(slash + 1);
}

function directoryPrefix(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  return slash === -1 ? "" : filePath.slice(0, slash + 1);
}

export function isCompanyPackageExtensionFile(filePath: string): boolean {
  return CURRENT_EXTENSION_NAMES.includes(baseName(filePath));
}

export function isRetiredCompanyPackageExtensionFile(filePath: string): boolean {
  return RETIRED_EXTENSION_NAMES.includes(baseName(filePath));
}

export function findCompanyPackageExtensionPath(paths: Iterable<string>): string | null {
  const all = Array.from(paths);
  for (const name of CURRENT_EXTENSION_NAMES) {
    if (all.includes(name)) return name;
  }
  return all.find(isCompanyPackageExtensionFile) ?? null;
}

export function adoptRetiredCompanyPackageExtension<T>(files: Record<string, T>): Record<string, T> {
  const retired = Object.keys(files).filter(isRetiredCompanyPackageExtensionFile).sort();
  if (retired.length === 0) return files;
  const out: Record<string, T> = { ...files };
  for (const path of retired) {
    const prefix = directoryPrefix(path);
    const target = `${prefix}${COMPANY_PACKAGE_EXTENSION_FILE}`;
    const hasCurrent = CURRENT_EXTENSION_NAMES.some((name) => `${prefix}${name}` in out);
    delete out[path];
    if (!hasCurrent) out[target] = files[path]!;
  }
  return out;
}
