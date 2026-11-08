export function serviceWorkerBuildIdFromFileName(fileName: string): string {
  const base = (fileName.split("/").pop() ?? "").replace(/\.js$/, "");
  return base.replace(/[^A-Za-z0-9_-]/g, "-") || "build";
}
