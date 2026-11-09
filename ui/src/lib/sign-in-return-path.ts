export function signInReturnPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\x00-\x20]/.test(path)) return "/";
  const url = new URL(path, "https://instance.invalid");
  if (url.pathname.replace(/\/+$/, "") === "/auth") return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
