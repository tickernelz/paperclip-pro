import type { ProxyOptions } from "vite";

export function createApiProxy(target = "http://localhost:3100"): Record<string, ProxyOptions> {
  return {
    "/api": {
      target,
      ws: true,
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyReq, req) => {
          const originalHost = req.headers.host;
          if (!originalHost) return;
          proxyReq.setHeader("x-forwarded-host", originalHost);
          // Prefer an upstream x-forwarded-proto (an HTTPS tunnel such as
          // ngrok or tailscale funnel terminates TLS and forwards HTTP to
          // vite with the header set). Fall back to the socket's TLS state.
          const upstreamProto = req.headers["x-forwarded-proto"];
          const proto = Array.isArray(upstreamProto) ? upstreamProto[0] : upstreamProto;
          const isTls = (req.socket as { encrypted?: boolean }).encrypted === true;
          proxyReq.setHeader("x-forwarded-proto", proto ?? (isTls ? "https" : "http"));
        });
      },
    },
  };
}
