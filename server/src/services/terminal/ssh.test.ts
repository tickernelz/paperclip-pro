import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { knownHostsAcceptKey } from "./ssh.js";

const key = randomBytes(51);
const otherKey = randomBytes(51);
const keyB64 = key.toString("base64");

function hashedHost(host: string) {
  const salt = randomBytes(20);
  const hash = createHmac("sha1", salt).update(host).digest("base64");
  return `|1|${salt.toString("base64")}|${hash}`;
}

describe("knownHostsAcceptKey", () => {
  it("accepts a plain host entry with the matching key only", () => {
    const knownHosts = `# comment\nexample.test,10.0.0.5 ssh-ed25519 ${keyB64}\n`;
    expect(knownHostsAcceptKey(knownHosts, "example.test", 22, key)).toBe(true);
    expect(knownHostsAcceptKey(knownHosts, "10.0.0.5", 22, key)).toBe(true);
    expect(knownHostsAcceptKey(knownHosts, "example.test", 22, otherKey)).toBe(false);
    expect(knownHostsAcceptKey(knownHosts, "other.test", 22, key)).toBe(false);
  });

  it("matches hashed entries and non-default ports", () => {
    const knownHosts = `${hashedHost("[box.test]:2222")} ssh-ed25519 ${keyB64}`;
    expect(knownHostsAcceptKey(knownHosts, "box.test", 2222, key)).toBe(true);
    expect(knownHostsAcceptKey(knownHosts, "box.test", 22, key)).toBe(false);
  });

  it("honours wildcards, negation and revocation", () => {
    expect(knownHostsAcceptKey(`*.lab.test,!bad.lab.test ssh-ed25519 ${keyB64}`, "a.lab.test", 22, key)).toBe(true);
    expect(knownHostsAcceptKey(`*.lab.test,!bad.lab.test ssh-ed25519 ${keyB64}`, "bad.lab.test", 22, key)).toBe(false);
    const revoked = `box.test ssh-ed25519 ${keyB64}\n@revoked box.test ssh-ed25519 ${keyB64}`;
    expect(knownHostsAcceptKey(revoked, "box.test", 22, key)).toBe(false);
  });
});
