import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { FakeOpenwaGateway } from "../../server/src/__tests__/openwa/fake-gateway.js";

const gatewayPort = Number(process.env.OPENWA_E2E_GATEWAY_PORT ?? 27850);
const controlPort = Number(process.env.OPENWA_E2E_CONTROL_PORT ?? 27851);
const gateway = new FakeOpenwaGateway({
  sessionId: process.env.OPENWA_E2E_SESSION_ID ?? "e2e-session",
  ownPhone: process.env.OPENWA_E2E_OWN_PHONE ?? "6285100007040",
  port: gatewayPort,
});

async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
}

function outbound() {
  return {
    sends: gateway.sends,
    reactions: gateway.reactions,
    documents: gateway.documents.map(({ content, ...rest }) => ({ ...rest, bytes: content.length })),
    mediaSends: gateway.mediaSends,
    typing: gateway.typing.length,
  };
}

const routes: Record<string, (body: Record<string, unknown>) => unknown> = {
  "POST /inbound": (body) => gateway.inbound(body as Parameters<FakeOpenwaGateway["inbound"]>[0]),
  "POST /group": (body) => {
    gateway.groups.set(String(body.id), body as never);
    gateway.chats.push({ id: String(body.id), name: String(body.name) });
    return { ok: true };
  },
  "POST /contact": (body) => {
    gateway.contacts.push(body as never);
    if (typeof body.lid === "string" && typeof body.number === "string") gateway.lids.set(body.lid, body.number);
    return { ok: true };
  },
  "POST /media": (body) => {
    gateway.setMedia(String(body.chatId), String(body.messageId), {
      body: Buffer.from(String(body.base64), "base64"),
      contentType: String(body.contentType),
      ...(typeof body.filename === "string" ? { filename: body.filename } : {}),
    });
    return { ok: true };
  },
  "POST /fail-send": (body) => {
    gateway.failNextSend(body);
    return { ok: true };
  },
  "POST /clear": () => {
    for (const list of [gateway.sends, gateway.reactions, gateway.documents, gateway.mediaSends, gateway.typing]) list.splice(0);
    return { ok: true };
  },
  "GET /outbound": () => outbound(),
  "GET /rows": () => gateway.rows,
  "GET /status": () => ({ subscribers: gateway.subscriberCount, baseUrl: gateway.baseUrl, sessionId: gateway.sessionId, ownJid: gateway.ownJid }),
};

const sessionView = {
  id: gateway.sessionId,
  name: "agent",
  status: "ready",
  phone: gateway.ownJid.split("@")[0],
  pushName: "Wira",
  connectedAt: null,
  lastActive: null,
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
  lastError: null,
  restriction: null,
  engineLoaded: true,
};
gateway.overrides.push(
  { method: "GET", path: "/api/docs-json", status: 200, body: { openapi: "3.0.0", info: { title: "OpenWA API", version: "0.23.7" } } },
  { method: "GET", path: "/api/sessions", status: 200, body: [sessionView] },
  { method: "GET", path: "/api/sessions/" + gateway.sessionId, status: 200, body: sessionView },
);
await gateway.start();
createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const handler = routes[(req.method ?? "GET") + " " + new URL(req.url ?? "/", "http://x").pathname];
  try {
    const body = handler ? handler(await json(req)) : { error: "not found" };
    res.writeHead(handler ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(error) }));
  }
}).listen(controlPort, "127.0.0.1", () => {
  process.stdout.write("fake OpenWA gateway " + gateway.baseUrl + " control http://127.0.0.1:" + controlPort + "\n");
});
