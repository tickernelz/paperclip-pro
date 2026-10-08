import { describe, expect, it } from "vitest";
import { matchAncestorHandoffMentions } from "../services/issue-ancestor-handoff.js";

const WIRA = { agentId: "11111111-1111-4111-8111-111111111111", name: "Wira (WhatsApp)", issue: "ZHA-379" };
const BUDI = { agentId: "22222222-2222-4222-8222-222222222222", name: "Budi (HMX Owner)", issue: "ZHA-1" };

function matched(body: string) {
  return matchAncestorHandoffMentions(body, [WIRA, BUDI]).map((candidate) => candidate.issue);
}

describe("matchAncestorHandoffMentions", () => {
  it.each([
    ["@Wira: silakan teruskan ke grup Research Lab0", ["ZHA-379"]],
    ["lapor ke @wira di issue induk", ["ZHA-379"]],
    ["@Wira (WhatsApp) tolong teruskan", ["ZHA-379"]],
    ["(@WIRA)", ["ZHA-379"]],
    ["@Wira", ["ZHA-379"]],
    [`[@Wira (WhatsApp)](agent://${WIRA.agentId}) tolong teruskan`, ["ZHA-379"]],
    ["@Wira dan @Budi (HMX Owner):", ["ZHA-379", "ZHA-1"]],
  ])("matches %j", (body, expected) => {
    expect(matched(body)).toEqual(expected);
  });

  it.each([
    "kirim ke x@wira.com",
    "@Wiraguna tolong",
    "lihat `@Wira` di config",
    "lihat ``@Wira`` di config",
    "```\n@Wira teruskan\n```",
    "~~~ts\n@Wira teruskan\n~~~",
    "```\n@Wira unterminated fence",
    "Wira tolong teruskan",
    "[@Sari](agent://33333333-3333-4333-8333-333333333333) tolong",
    "",
  ])("ignores %j", (body) => {
    expect(matched(body)).toEqual([]);
  });

  it("keeps plain mentions outside code", () => {
    expect(matched("`@Budi` bukan, tapi @Wira ya\n```\n@Budi\n```\n")).toEqual(["ZHA-379"]);
  });
});
