import { describe, expect, it } from "vitest";
import { localBrowserStorageInputSchema } from "./local-browser.js";

const parse = (value: unknown) => localBrowserStorageInputSchema.safeParse(value);
const cookie = { kind: "cookies", op: "get" } as const;

describe("local browser storage input", () => {
  it("accepts a cookie write with every attribute the browser can store", () => {
    const result = parse({
      ...cookie,
      op: "set",
      url: "https://app.test/",
      entries: [
        { name: "sid", value: "v", domain: ".app.test", path: "/admin", secure: true, httpOnly: true, sameSite: "strict", expirationDate: 1893456000, storeId: "2" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts domain, whole-jar and store scopes for reads and clears", () => {
    expect(parse({ ...cookie, domain: "example.com" }).success).toBe(true);
    expect(parse({ ...cookie, allDomains: true, storeId: "3" }).success).toBe(true);
    expect(parse({ ...cookie, op: "clear", allDomains: true, confirmAll: true }).success).toBe(true);
  });

  it("refuses a scope it cannot honour", () => {
    expect(parse({ ...cookie, allDomains: true, url: "https://app.test/" }).success).toBe(false);
    expect(parse({ ...cookie, allDomains: true, domain: "app.test" }).success).toBe(false);
    expect(parse({ ...cookie, url: "https://app.test/", domain: "app.test" }).success).toBe(false);
  });

  it("refuses cookie options on page storage and empty writes", () => {
    expect(parse({ kind: "local", op: "get", domain: "app.test" }).success).toBe(false);
    expect(parse({ kind: "session", op: "get", storeId: "2" }).success).toBe(false);
    expect(parse({ ...cookie, entries: [{ name: "a", value: "b" }] }).success).toBe(false);
    expect(parse({ ...cookie, op: "set", url: "https://app.test/", entries: [] }).success).toBe(false);
    expect(parse({ ...cookie, op: "set", entries: [{ name: "a", value: "b" }] }).success).toBe(false);
  });

  it("lets a per-entry domain stand in for the call target", () => {
    expect(parse({ ...cookie, op: "set", entries: [{ name: "a", value: "b", domain: ".app.test" }] }).success).toBe(true);
    expect(parse({ ...cookie, op: "set", entries: [{ name: "a", value: "b" }] }).success).toBe(false);
  });

  it("refuses a domain that is not a bare host", () => {
    for (const domain of ["*.app.test", "https://app.test", "app.test/path", "-bad.test", "bad host"]) {
      expect(parse({ ...cookie, domain }).success).toBe(false);
    }
    for (const domain of ["app.test", ".app.test", "localhost", "app.test."]) {
      expect(parse({ ...cookie, domain }).success).toBe(true);
    }
  });

  it("refuses to clear the whole jar without a name or a confirmation", () => {
    expect(parse({ ...cookie, op: "clear", allDomains: true }).success).toBe(false);
    expect(parse({ ...cookie, op: "clear", allDomains: true, name: "sid" }).success).toBe(true);
    expect(parse({ ...cookie, op: "clear", allDomains: true, confirmAll: true }).success).toBe(true);
    expect(parse({ ...cookie, op: "clear", domain: "app.test" }).success).toBe(true);
  });

  it("keeps cookie-only options off page storage", () => {
    expect(parse({ kind: "local", op: "set", url: "https://app.test/", entries: [{ name: "a", value: "b", secure: true }] }).success).toBe(false);
    expect(parse({ kind: "local", op: "set", url: "https://app.test/", entries: [{ name: "a", value: "b" }] }).success).toBe(true);
    expect(parse({ ...cookie, limit: 10 }).success).toBe(true);
    expect(parse({ ...cookie, op: "clear", limit: 10 }).success).toBe(false);
  });

  it("keeps the same-site values the browsers speak", () => {
    for (const sameSite of ["no_restriction", "lax", "strict", "unspecified"]) {
      expect(parse({ ...cookie, op: "set", url: "https://app.test/", entries: [{ name: "a", value: "b", sameSite }] }).success).toBe(true);
    }
    expect(parse({ ...cookie, op: "set", url: "https://app.test/", entries: [{ name: "a", value: "b", sameSite: "none" }] }).success).toBe(false);
  });
});
