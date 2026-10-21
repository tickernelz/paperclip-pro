# Rencana: Local Browser Bridge (Claude Chrome extension setara, refine + full power)

Keputusan owner (2026-10-18): extension bridge ke browser asli user; Firefox paritas penuh; dua tier tanpa approval; connector di Apps catalog; ada live view + takeover. Target: full otonom sampai rilis + install.

## Kontrak (sudah ditulis, jangan diubah tanpa saya)
`packages/shared/src/local-browser.ts` = satu sumber kebenaran:
- 14 tool `local_browser_*` dengan deskripsi siap-pakai untuk model apa pun, plus `tier` per tool.
- Tier: `refine` (allowlist origin, tanpa evaluate/storage/upload/download/network bodies) dan `full`.
- Error code stabil, frame protokol WS (`hello`, `hello_ack`, `call`, `result`, `event`, `ping`, `pong`).

## Arsitektur
1. Extension (Chromium MV3, Firefox MV2) konek keluar ke `/api/local-browser/bridge?code=...`.
2. Server: registry sesi, dispatch RPC, penegakan tier/origin, audit, normalisasi snapshot, relay viewer.
3. Connector `local-browser` mengekspos tool ke agent lewat tool gateway + skill markdown.
4. UI: panel pairing di Apps detail, tier + allowlist, live view + takeover.

## Pembagian kerja (file tidak bertumpuk)
- BridgeServer: `server/src/realtime/local-browser-ws.ts`, `server/src/services/local-browser/**`, `server/src/routes/local-browser.ts`, tabel `local_browser_connections` + migrasi, test fake extension.
- ConnectorSurface: app definition JSON + generated, `server/src/services/connectors/local-browser/**`, entri `connector-runtime.ts`, panel UI Apps detail.
- ExtensionChromium: `apps/local-browser/chromium/**` (JS murni, tanpa build step).
- ExtensionFirefox: `apps/local-browser/firefox/**` (JS murni, paritas lewat API extension + BiDi bila perlu).

## Titik integrasi yang dibekukan
- WS path: `/api/local-browser/bridge`.
- REST: `POST /api/local-browser/pairing`, `GET /api/local-browser/pairing/:code`, `GET /api/local-browser/sessions`, `DELETE /api/local-browser/sessions/:id`, `GET /api/local-browser/sessions/:id/viewer` (SSE), `POST /api/local-browser/sessions/:id/input`.
- Extension `snapshot` result: `{url,title,nodes:[{ref,role,name,value?,depth,disabled?,checked?,selected?}],truncated,total}`; server yang merender teks + cursor.
- Extension `act` menerima `ref` yang dia hasilkan sendiri.
- Service module: `localBrowserService(db)` dengan `executeTool(binding,name,args)`; connector memanggil itu.

## Urutan
1. BridgeServer + ConnectorSurface + 2 extension paralel.
2. Saya integrasi: gate (tsc semua paket, token gate, comment gate, mcp tools), test gabungan.
3. Commit per slice, CI, tag rilis, install, restart penuh, verifikasi marker + satu sesi pairing nyata.
