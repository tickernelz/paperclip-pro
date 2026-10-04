import { describe, expect, it } from "vitest";
import { OPENWA_GATEWAY_VERSION, OPENWA_OPERATIONS } from "./openwa-operations.js";

const GATEWAY_ADMIN_TAGS = ["audit", "automation", "infrastructure", "integration", "metrics", "plugins", "settings", "webhooks"];
const SEND_PATH = /\/messages\/(send-[a-z]+|reply|forward)$/;

describe("OpenWA operation manifest", () => {
  it("covers every operation of the pinned gateway document exactly once", () => {
    expect(OPENWA_GATEWAY_VERSION).toBe("0.24.0");
    expect(OPENWA_OPERATIONS).toHaveLength(202);
    expect(new Set(OPENWA_OPERATIONS.map((operation) => operation.id)).size).toBe(202);
    expect(new Set(OPENWA_OPERATIONS.map((operation) => operation.method + " " + operation.path)).size).toBe(202);
  });

  it("classifies every gateway administration surface as gateway_admin", () => {
    const misfiled = OPENWA_OPERATIONS.filter(
      (operation) =>
        (GATEWAY_ADMIN_TAGS.includes(operation.tag) ||
          (operation.tag === "auth" && operation.path.startsWith("/api/auth/api-keys")) ||
          operation.requiresUnscopedKey ||
          operation.auth === "metrics_token" ||
          /\/sessions\/\{sessionId\}\/(start|stop|logout|force-kill|qr|pairing-code)$/.test(operation.path) ||
          (operation.method !== "GET" && /\/sessions\/\{sessionId\}\/(proxy|config)$/.test(operation.path)) ||
          ((operation.method === "POST" || operation.method === "DELETE") && /^\/api\/sessions(\/\{sessionId\})?$/.test(operation.path))) &&
        operation.category !== "gateway_admin",
    );
    expect(misfiled.map((operation) => operation.id)).toEqual([]);
  });

  it("names the destination chat for every send, reply and forward", () => {
    const sends = OPENWA_OPERATIONS.filter((operation) => SEND_PATH.test(operation.path));
    expect(sends).toHaveLength(14);
    for (const operation of sends) {
      expect(operation.category, operation.id).toBe("write");
      expect(operation.sendsMessage, operation.id).toBe(true);
      expect(operation.targetChatArg, operation.id).not.toBeNull();
      const [head, tail] = (operation.targetChatArg as string).split("[].");
      const argument = operation.args.properties?.[head];
      expect(argument, operation.id).toBeDefined();
      if (tail) expect(argument?.items?.properties?.[tail], operation.id).toBeDefined();
      expect(operation.args.required ?? [], operation.id).toContain(head);
    }
  });

  it("never lets callers supply the session id and marks session-scoped paths", () => {
    for (const operation of OPENWA_OPERATIONS) {
      expect(operation.args.properties?.sessionId, operation.id).toBeUndefined();
      expect(operation.args.additionalProperties, operation.id).toBe(false);
      expect(operation.sessionScoped, operation.id).toBe(operation.path.includes("{sessionId}"));
      for (const name of operation.pathParams) expect(operation.path, operation.id).toContain("{" + name + "}");
    }
  });

  it("only treats non-mutating GET-style operations as reads", () => {
    const mutatingReads = OPENWA_OPERATIONS.filter(
      (operation) =>
        operation.category === "read" &&
        operation.method !== "GET" &&
        !["AuthValidateController_validate", "MediaController_convertVideo", "MediaController_convertVoice"].includes(operation.id),
    );
    expect(mutatingReads.map((operation) => operation.id)).toEqual([]);
  });

  it("records engine gaps of the active and idle engines", () => {
    const byId = new Map(OPENWA_OPERATIONS.map((operation) => [operation.id, operation]));
    expect(byId.get("GroupController_create")?.engines).toEqual(["baileys"]);
    expect(byId.get("MessageController_getChatHistory")?.engines).toEqual(["whatsapp-web.js"]);
    expect(byId.get("MessageController_sendText")?.engines).toEqual(["whatsapp-web.js", "baileys"]);
  });
});
