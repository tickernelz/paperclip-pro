import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { terminalOriginAllowed, type TerminalOriginPolicy } from "./origin.js";

const livePolicy: TerminalOriginPolicy = {
  deploymentMode: "authenticated",
  allowedHostnames: ["paperclip.zhafron.my.id"],
  bindHost: "127.0.0.1",
  listenPort: 3100,
  hostnameGuardEnabled: true,
  publicBaseUrls: ["https://paperclip.zhafron.my.id"],
};

const tunnelHost = "paperclip.zhafron.my.id";

describe("terminalOriginAllowed", () => {
  let savedPublicUrl: string | undefined;

  beforeEach(() => {
    savedPublicUrl = process.env.PAPERCLIP_PUBLIC_URL;
    delete process.env.PAPERCLIP_PUBLIC_URL;
  });

  afterEach(() => {
    if (savedPublicUrl === undefined) delete process.env.PAPERCLIP_PUBLIC_URL;
    else process.env.PAPERCLIP_PUBLIC_URL = savedPublicUrl;
  });

  it("accepts the live tunnel origin and rejects other schemes, ports and hosts", () => {
    const check = (origin: string, host = tunnelHost) => terminalOriginAllowed({ origin, host }, livePolicy);
    expect(check("https://paperclip.zhafron.my.id")).toBe(true);
    expect(check("https://paperclip.zhafron.my.id:443")).toBe(true);
    expect(check("http://paperclip.zhafron.my.id:8080")).toBe(false);
    expect(check("http://paperclip.zhafron.my.id")).toBe(false);
    expect(check("https://paperclip.zhafron.my.id:8443")).toBe(false);
    expect(check("https://evil.example")).toBe(false);
    expect(check("null")).toBe(false);
  });

  it("accepts a configured hostname over https without a public base url", () => {
    const policy = { ...livePolicy, publicBaseUrls: [] };
    expect(terminalOriginAllowed({ origin: "https://paperclip.zhafron.my.id", host: tunnelHost }, policy)).toBe(true);
    expect(terminalOriginAllowed({ origin: "http://paperclip.zhafron.my.id:3100", host: tunnelHost }, policy)).toBe(false);
  });

  it("accepts the server's own bind origin for local use only on the listen port", () => {
    const check = (origin: string) => terminalOriginAllowed({ origin, host: "127.0.0.1:3100" }, livePolicy);
    expect(check("http://127.0.0.1:3100")).toBe(true);
    expect(check("http://localhost:3100")).toBe(true);
    expect(check("http://127.0.0.1:5173")).toBe(false);
    expect(check("https://127.0.0.1:3100")).toBe(false);
  });

  it("no longer trusts an origin just because it matches the Host header", () => {
    const policy = { ...livePolicy, hostnameGuardEnabled: false };
    expect(terminalOriginAllowed({ origin: "https://other.example", host: "other.example" }, policy)).toBe(false);
  });

  it("rejects a trusted origin arriving on a Host outside the allowed hostnames", () => {
    expect(terminalOriginAllowed({ origin: "https://paperclip.zhafron.my.id", host: "rebind.evil.example" }, livePolicy)).toBe(false);
  });

  it("allows a missing Origin only in local_trusted mode", () => {
    expect(terminalOriginAllowed({ host: tunnelHost }, livePolicy)).toBe(false);
    expect(terminalOriginAllowed({ host: "127.0.0.1:3100" }, { ...livePolicy, deploymentMode: "local_trusted" })).toBe(true);
  });

  it("trusts PAPERCLIP_PUBLIC_URL exactly", () => {
    process.env.PAPERCLIP_PUBLIC_URL = "https://board.example.com:8443/app";
    const policy = { ...livePolicy, hostnameGuardEnabled: false, allowedHostnames: [], publicBaseUrls: [] };
    expect(terminalOriginAllowed({ origin: "https://board.example.com:8443", host: "x" }, policy)).toBe(true);
    expect(terminalOriginAllowed({ origin: "https://board.example.com", host: "x" }, policy)).toBe(false);
  });
});
