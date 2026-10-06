import { describe, expect, it } from "vitest";
import {
  openwaOwnerDecisionText,
  openwaOwnerMessageDecision,
  openwaRequestMessages,
  type OpenwaOwnerMessage,
} from "../../services/openwa/approval-discussions.js";

const message = (text: string, quotedRequestId: string | null = null): OpenwaOwnerMessage => ({ deliveryId: text, text, quotedRequestId });

describe("OpenWA owner approval wording", () => {
  it("decides from the opening clause and keeps later negatives as conditions", () => {
    expect(openwaOwnerMessageDecision("boleh, tapi jangan sebut harga")).toBe("approve");
    expect(openwaOwnerMessageDecision("Oke lanjut tapi jangan kirim ke grup")).toBe("approve");
    expect(openwaOwnerMessageDecision("👍")).toBe("approve");
    expect(openwaOwnerMessageDecision("tolak, jangan dibuat")).toBe("reject");
    expect(openwaOwnerMessageDecision("jangan dulu, nanti saja")).toBe("reject");
    expect(openwaOwnerMessageDecision("ok tolak")).toBeNull();
    expect(openwaOwnerMessageDecision("itu di grup kan mas faizin kirim docx dan pdf, pdf nya udah kamu baca?")).toBeNull();
    expect(openwaOwnerMessageDecision("nanti saja, boleh kok")).toBeNull();
    expect(openwaOwnerMessageDecision("Gas!")).toBe("approve");
    expect(openwaOwnerMessageDecision("gasket rusak")).toBeNull();
  });

  it("uses the owner's latest decisive message only", () => {
    const thread = [message("ok, berapa biayanya?"), message("tolak")];
    expect(openwaOwnerDecisionText(thread, "approve")).toBeNull();
    expect(openwaOwnerDecisionText(thread, "reject")).toBe("tolak");
    expect(openwaOwnerDecisionText([message("tolak"), message("kok gitu, oke juga sih"), message("kirim sekarang ya")], "approve")).toBeNull();
    expect(openwaOwnerDecisionText([message("tolak"), message("oke deh"), message("kirim sekarang ya")], "approve")).toBe("oke deh");
    expect(openwaOwnerDecisionText([message("pdf nya udah kamu baca ya?")], "approve")).toBeNull();
    expect(openwaOwnerDecisionText([message("ok?")], "approve")).toBeNull();
    expect(openwaOwnerDecisionText([message("jangan dulu, nanti saja")], "approve")).toBeNull();
    expect(openwaOwnerDecisionText([message("jangan dulu, nanti saja")], "reject")).toBe("jangan dulu, nanti saja");
    expect(openwaOwnerDecisionText([message("boleh, tapi jangan sebut harga")], "approve")).toBe("boleh, tapi jangan sebut harga");
  });

  it("counts an unquoted message only while it is the only open discussion", () => {
    const thread = [message("yang ini gimana?", "a"), message("yang itu?", "b"), message("ok")];
    expect(openwaRequestMessages(thread, "a", 2).map((entry) => entry.text)).toEqual(["yang ini gimana?"]);
    expect(openwaRequestMessages(thread, "a", 1).map((entry) => entry.text)).toEqual(["yang ini gimana?", "ok"]);
    expect(openwaRequestMessages([...thread, message("ok", "b")], "b", 2).map((entry) => entry.text)).toEqual(["yang itu?", "ok"]);
  });
});
