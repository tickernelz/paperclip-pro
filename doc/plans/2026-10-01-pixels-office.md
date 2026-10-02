# Plan: Pixels Office — fitur eksperimental bawaan

Tanggal: 2026-10-01
Repo: `/home/zhafron/Projects/paperclip-pro` (HEAD `ad2b961fd`)
Sumber ide: `github.com/gcampton/Agent-Pixels` @ `42de7c5` (2026-06-09)

Status: **MENUNGGU PERSETUJUAN**. Belum ada file yang diubah selain dokumen ini.

---

## 1. Temuan yang mengubah bentuk kerja

### 1.1 Agent-Pixels itu BUKAN app mandiri — sudah plugin Paperclip

Ini fakta paling penting dan tidak terlihat dari luar. `package.json`-nya:

```json
"name": "@agent-pixels/paperclip-plugin",
"paperclipPlugin": { "manifest": "./dist/manifest.js", "worker": "./dist/worker.js", "ui": "./dist/ui/" }
```

`src/manifest.ts:21-25` mendeklarasikan `agent-pixels.camera` dengan kapabilitas
`agents.read`, `ui.sidebar.register`, `ui.page.register`.

Namun, import-nya menunjuk SDK upstream yang tidak ada di repo ini:

- `src/worker.ts:1` → `from "@paperclipai/plugin-sdk"`
- `src/ui/index.tsx:2` → `from "@paperclipai/plugin-sdk/ui"`
- Kita punya `@tickernelz/paperclip-pro-plugin-sdk` (`packages/plugins/sdk/package.json:2`)

API-nya **identik**. Semua simbol yang dipakai upstream ada di SDK kita:

| Simbol upstream | Lokasi di SDK kita |
|---|---|
| `definePlugin`, `runWorker` | `packages/plugins/sdk/src/define-plugin.ts:563` |
| `ctx.agents.list` | `packages/plugins/sdk/src/host-client-factory.ts:272-278` |
| `PaperclipPluginManifestV1` | `packages/plugins/sdk/src` (manifest types) |
| `useHostContext`, `usePluginData` | rute `@…/sdk/ui` |

**Kesimpulan:** kode ini tidak "tidak terurus" secara teknis — ia mati karena
nama package berganti, bukan karena desainnya usang. Ini menurunkan risiko
port secara drastis: bukan tulis-ulang 5.215 baris, melainkan **rewire ~6 baris
import** lalu refine.

### 1.2 Yang benar-benar usang (perlu dibuang, bukan diport)

| Item | Bukti | Keputusan |
|---|---|---|
| Heuristik `activityKind` dari teks nama | `worker.ts:6-19`: `text.includes("research") \|\| "seo" \|\| "analyst"` | **Buang.** Klasifikasi kerja dari *nama* agent itu rapuh dan bias bahasa. Ganti dengan status run heartbeat yang nyata |
| `inferActivityKind` fallback ke `"coding"` | `worker.ts:18` | **Buang** bersama fungsinya |
| Assignment karakter di `localStorage` | `ui/index.tsx:34-52` (`assignmentsStorageKey`, `readStoredAssignments`) | **Pindah ke server.** Ini bug multi-tenant: assignment hilang ganti browser, dan tidak bisa diklaim sebagai fitur bawaan |
| `build.mjs` cari SDK di path hardcode `/home/garratt/dev/...` | `build.mjs:11` | **Buang**, diganti pipeline build repo |
| Manipulasi palet warna karakter | `office/colorize.ts` (223 baris) | **Evaluasi M5**: 136 PNG sudah cukup ragam; hue-shift kemungkinan tidak perlu |
| `matrixEffect` (142 baris) | `office/engine/matrixEffect.ts` | **Evaluasi M5**: murni hiasan spawn/despawn, biaya perawatan tanpa nilai kontrol-plane |

### 1.3 Yang bernilai dan layak diport

Dari 5.215 baris, inti yang sehat dan bisa dipakai apa adanya:

- `office/engine/gameLoop.ts` (37 baris) — `requestAnimationFrame` + `dt` ter-clamp
  `MAX_DELTA_TIME_SEC`. Bersih, port langsung.
- `office/engine/officeState.ts` (802) — state machine agen: kursi, jalur, wander.
  Ini jantungnya.
- `office/layout/tileMap.ts` (105) — walkability + `findPath`. Sudah benar.
- `office/engine/renderer.ts` (700) + `office/sprites/` — pipeline sprite & depth-sort.
- `office/layout/furnitureCatalog.ts` (404) + `layoutSerializer.ts` (382) — layout
  kantor sebagai data (`OfficeLayout`), bukan kode. Ini kunci ekstensibilitas.
- `office/types.ts` (201) — kontrak domain yang rapi.

Model `Character` (`office/types.ts`) sudah punya field yang relevan untuk kita:
`seatId`, `isActive`, `bubbleType`, `inputTokens`, `outputTokens`, `isSubagent`,
`teamName`, `agentName`, `isTeamLead`.

### 1.4 Requirement "1 agent bisa handle multiple tasks" — **sudah model Paperclip**

Ini temuan yang paling menentukan bentuk visualisasinya.

Bukti utamanya adalah **spesifikasi**, bukan sekadar grep:

> `doc/SPEC-implementation.md:1264` — "`maxConcurrentRuns` integer; new agents
> default to `20`; scheduler clamps configured values to `1..50`"

Diperkuat **28 berkas test** di `server/src/__tests__/` yang menetapkan
`heartbeat.maxConcurrentRuns`, jadi ini perilaku yang diuji, bukan insidental.

Model datanya:

- **Issue → `assigneeAgentId` tunggal** (`issue.ts:74`, `:257`, `:561` …)
- **Sebaliknya tidak dibatasi** pada sisi agent: `issue.ts:4215`
  `if (node.assigneeAgentId) agentIds.add(...)` plus
  `heartbeat.getActiveRunIssueSummaryForAgent(agentId)` di `routes/agents.ts:7648`
  — satu agent bisa jadi assignee di banyak issue.

Implikasi untuk UI: `maxConcurrentRuns` adalah **langit-langit konkurensi per
agen**, jadi badge "N task aktif" di karakter **tidak mungkin melebihi angka
itu**. Itu angka yang harus jadi acuan render, bukan asumsi 1:1.

Jadi **tidak ada perubahan model data**. Tampilan Office harus:
render satu karakter per agent, dan menampilkan *beberapa task* di karakter itu
(task aktif + task antri), bukan menggandakan sprite. Ini kontras dengan model
upstream yang implisit 1 agent = 1 pekerjaan.

---

## 2. Keputusan arsitektur

Keputusan user: **built-in server + UI** dan **live activity stream**.

### Konsekuensi: split engine vs shell (WAJIB)

`scripts/check-token-gates.mjs:80` → `SCAN_DIRS = ["components", "pages"]`,
dan mengecualikan `ui/src/lib|context|plugins`. Terverifikasi di baris 7-8, 80, 117.

Agent-Pixels membawa **72 literal warna mentah** (mis. `rgba(0,127,212,0.35)`,
`#ccffcc`), 12 di antaranya di `ui/index.tsx` saja. Taruh di `pages/` →
`pnpm check:token-gates` gagal ~72 kali.

Maka pemisahan ini bukan preferensi, melainkan satu-satunya jalan:

```
ui/src/lib/pixels-office/**     ← engine. Warna sprite = DATA, bukan token desain. Bebas literal.
ui/src/pages/PixelsOffice.tsx   ← shell. Token-only, wajib lolos gate.
ui/src/components/PixelsOfficeCanvasHost.tsx ← jembatan tipis, token-only.
```

Alasan teknisnya sah dan perlu didokumentasikan: palet sprite piksel adalah
*aset gambar yang dienkode sebagai angka*, bukan keputusan tema UI. Sama
seperti `CompanyPatternIcon.tsx` yang sudah ada.

### Siklus hidup render loop (WAJIB ditentukan sekarang)

`startGameLoop(canvas, callbacks)` upstream (`gameLoop.ts:8-37`) punya `rAF`
sendiri dan mengembalikan fungsi cancel. Kalau `rAF` itu dibiarkan hidup di
dalam komponen halaman, ia **tetap berjalan saat tab tersembunyi atau rute
di-background** — pemborosan yang mahal untuk di-retrofit ke 5k LOC nanti.

Maka shell halaman wajib:

1. Menjalankan loop hanya saat halaman terlihat, lewat
   `ui/src/lib/page-visibility.ts:108` `usePageVisibility()` (sudah dipakai
   `LiveUpdatesProvider.tsx:1`).
2. Memanggil fungsi cancel yang dikembalikan `startGameLoop` saat unmount.

### Aset: pipeline Vite sudah cukup, tidak perlu esbuild khusus

Terverifikasi: `ui/vite.config.ts` **tidak** menyetel `publicDir` (default
`ui/public`), dan `ui/tsconfig.json:11` sudah `resolveJsonModule: true`. Jadi
pola upstream `import wallData from "./walls.json"` **langsung jalan** di Vite,
dan sprite di `ui/public/pixels/**` cukup di-`fetch` saat runtime — Vite hanya
menyalin. Tidak perlu plugin esbuild baru.

### Flag: `enablePixelsOffice`

Kontrak flag eksperimental di repo ini ketat dan **compile-enforced** — 4 file
wajib, kalau tidak `pnpm test` merah:

1. `packages/shared/src/validators/instance.ts:49-93` — `enablePixelsOffice: z.boolean().default(false)`
2. `packages/shared/src/types/instance.ts:83-115` — mirror di `InstanceExperimentalSettings`
3. `packages/shared/src/feature-catalog.ts:44-364` — entri metadata (test di
   `feature-catalog.test.ts:33` memaksa katalog mencakup **tepat** seluruh boolean flag)
4. `ui/src/pages/InstanceExperimentalSettings.tsx:296-712` — kartu toggle

Tier: `"managed"`, `cloudDefault: false`, `selfHostedDefault: false` — ikuti
`enableStatusCards` (`feature-catalog.ts:180`).

### Gating tiga lapis

Scout mengonfirmasi ini harus di semua lapis, bukan cukup sembunyikan link:

1. Instance flag
2. **Server-side `assertPixelsOfficeEnabled`** di route → `throw notFound()` saat off
   (template: `server/src/routes/status-cards.ts:26-29`). Supaya fitur tak
   terjangkau via API walau UI-nya disembunyikan.
3. UI gate komponen (template 19 baris: `components/StatusCardsExperimentalGate.tsx`)

### Satu tabel DB baru: `pixels_office_seats`

Domain Office **tidak butuh** tabel — agen + `issues.assigneeAgentId` + heartbeat
run + activity log sudah mencukupi.

Tetapi assignment karakter butuh persistensi **per-company**, menggantikan
`localStorage` upstream. **Keputusan (dikonfirmasi user): tabel baru
`pixels_office_seats`**, bukan kolom jsonb.

Konsekuensi — rencana ini sekarang **membutuhkan satu migrasi**:

1. `packages/db/src/schema/pixels_office_seats.ts` — ikuti templat company-scoped
   `packages/db/src/schema/status_cards.ts` (uuid PK `defaultRandom`, `companyId`
   FK cascade, kolom jsonb bertipe, index komposit)
2. Ekspor datar dari `packages/db/src/schema/index.ts:123`
3. `pnpm db:generate` → migrasi `0285_*` (tertinggi saat ini `0284_fearless_stranger.sql`)
4. `check-migration-numbering.ts` memaksa prefix 4-digit, tanpa duplikat, urutan
   ketat, dan paritas `_journal.json` ↔ nama berkas. **Jangan** sunting journal manual.


### Live stream: WebSocket, bukan polling

`ui/src/context/LiveUpdatesProvider.tsx:52` → `tryCreateWebSocket` dari
`../lib/websocket`, diekspos sebagai `useCompanyLiveEvent(handler)` (baris 113).

**Koreksi:** ini **WebSocket**, bukan SSE. SSE di repo ini hanya dipakai
`server/src/routes/board-chat.ts:210` dan `plugins.ts:1793` (stream plugin).
Satu koneksi di-multiplex dan sudah terfilter ke company aktif (komentar
baris 109), jadi **tidak perlu endpoint SSE baru**.

Snapshot awal juga sudah ada: `heartbeatsApi.liveRunsForCompany` →
`GET /companies/{id}/live-runs` (`ui/src/api/heartbeats.ts:233`), dan
`issuesApi.list` menerima `assigneeAgentId`.

Query key yang tersedia (terverifikasi): `queryKeys.ts:382`
`issues.liveRuns(issueId)`, `:705` `liveRuns(companyId)`.

---

## 3. Capability map

Ukuran adalah effort relatif — port + integrasi, bukan tulis dari nol.

| Modul | Tanggung jawab | Bergantung pada | Ukuran |
|---|---|---|---|
| `pixels-contract` | Flag `enablePixelsOffice`, tipe `PixelsOfficeAgent`, validator endpoint | — | S |
| `pixels-engine` | Simulasi + render port dari upstream, engine-only | — | L |
| `pixels-server` | Endpoint agregasi per-company company-scoped + gate | `pixels-contract` | M |
| `pixels-shell` | Halaman, nav, gate UI, host kanvas | `pixels-contract`, `pixels-engine` | M |
| `pixels-seats` | Tabel `pixels_office_seats` + migrasi 0285 + PUT route tulis kursi | `pixels-contract` | M |
| `pixels-live` | `useCompanyLiveEvent` → mutasi engine | keempatnya | M |

Build order:
`pixels-contract` → `pixels-engine` ∥ `pixels-server` ∥ `pixels-seats` →
`pixels-shell` → `pixels-live`

---

## 4. Milestone & kriteria penerimaan

Setiap M punya perintah verifikasi yang bisa dijalankan.

### M0 — Pakai repo apa adanya (spike wajib, ≤ 1 jam)
**Tujuan:** buktikan engine-nya hidup sebelum menulis satu baris pun di repo.

- Clone ke worktree terisolasi, rewire 6 import ke `@tickernelz/paperclip-pro-plugin-sdk`
- Bangun, instal sebagai plugin lokal di instance dev

**Acceptance (bisa difalsifikasi):** dengan N=3 agen yang di-seed, karakter
tampil dan berjalan ke kursi selama 30 detik **tanpa error console**, aset
terambil dari path lokal, di dev server paperclip-pro.

Bukan sekadar "halamannya kebuka" — kalau N=3 tidak berjalan ke kursi dalam
30 detik, spike dianggap **gagal** dan rencana direvisi sebelum M3.

**Verify:** inspeksi browser di `http://localhost:3100`.
**Nilai:** kalau gagal, seluruh rencana ini berubah — lebih murah tahu di jam pertama.

### M1 — Kontrak bersama
Flag di 4 file wajib + tipe `PixelsOfficeAgent` di `shared`.

**Verify:** `pnpm -r typecheck && pnpm test:run --filter shared`
(pastikan `feature-catalog.test.ts` tetap hijau)

### M2 — Endpoint Office
`GET /api/companies/:companyId/pixels-office` company-scoped.

Satu agent, banyak task — bentuk payloadnya:

```
{ id, name, status, urlKey,
  active:  { runId, issueId, toolName } | null,
  queued:  [{ issueId, identifier, title, status }],   // ← multi-task
  recent:  [{ kind, at, summary }] }
```

- Query tunggal: agents → `assigneeAgentId` → heartbeat run → activity log
- `assertPixelsOfficeEnabled`; daftarkan di `routes/openapi.ts` +
  `openapi-routes.test.ts:17-73` (test ini **memaksa** setiap rute berspesifikasi)
- Daftar di `app.ts` (pola `app.ts:665`) + `routes/index.ts:9`

**Verify:** manual `curl` + `pnpm test:run --filter server` .

### M3 — Engine port ke `ui/src/lib/pixels-office/**`
Port `gameLoop`, `officeState`, `renderer`, `tileMap`, `sprites`, `layout`,
`furnitureCatalog`. Buang `colorize` + `matrixEffect` (§1.2) sampai terbukti perlu.
Buang seluruh model sub-agent/tmux (§6).

Perbaikan wajib saat port: ganti `stableNumericId()` dengan `Map` string-keyed
(§5 Kolisi ID).

**Verify:** `pnpm check:token-gates` **hijau** (engine di `lib/`, di luar scan),
harness kanvas di worktree terpisah.

**Test (headless, logika murni):** `officeState` reassign kursi, `tileMap.findPath`,
`layoutSerializer` round-trip, pemetaan data endpoint. Jangan uji render kanvas.

Catatan environment: project vitest UI berjalan `environment: "node"`
(`ui/vitest.config.ts:12`). Dua modul yang bergantung environment adalah
`pixelAssets` dan `spriteData` (decode `createImageBitmap`/`canvas.getContext`)
— butuh docblock `@vitest-environment jsdom` per berkas plus mock. Itu justru
target unit paling bernilai karena decode-nya deterministik dan murni.

### M4 — Shell + gate UI
`ui/src/pages/PixelsOffice.tsx` (token-only), gate, item sidebar, mount rute
di `App.tsx` (pola `App.tsx:322-331`), klien api.

Aset: `ui/public/pixels/` (~800 KB setelah buang `brand/` + 40 `char_*.png`
recolor). `getPluginAssetBaseUrl()` diganti total — bukan di-tweak, karena
base URL `/_plugins/...` tidak ada lagi di rute non-plugin.

**Verify:** buka halaman lewat UI; `pnpm check:token-gates` tetap hijau.

**Tabel + rute tulis kursi** (`pixels-seats`):

1. `packages/db/src/schema/pixels_office_seats.ts` — company-scoped, ikuti
   `status_cards.ts`: uuid PK `defaultRandom`, `companyId` FK cascade, dan
   FK `agentId` **wajib `onDelete: "cascade"`** (konvensi repo, `status_cards.ts:33`)
   supaya baris kursi ikut lenyap saat agen dihapus
2. Ekspor datar dari `packages/db/src/schema/index.ts:123`
3. `pnpm db:generate` → migrasi `0285_*`
4. **PUT `/api/companies/:companyId/pixels-office/seats`** — `assertCompanyAccess`,
   aktor **board-only** (bukan agent) per AGENTS.md §8, entri activity-log per
   AGENTS.md §5.3, dan wajib terdaftar di `routes/openapi.ts`
   (`openapi-routes.test.ts` memaksa setiap rute berspesifikasi)

Catatan gate: `check:migrations` ikut berjalan di `typecheck`/`build`/`migrate`
(`packages/db/package.json:41-47`) — numbering memaksa paritas persis
`_journal.json` ↔ nama berkas, dan `check-migration-safety` hanya menerima
escape inline `-- paperclip:migration-safety-ignore <rule>: <reason>`. Satu
`CREATE TABLE` + index + FK cascade seharusnya lolos bersih.

**Verify:** `pnpm -r typecheck` (menjalankan `check:migrations`) +
`pnpm check:token-gates` tetap hijau + halaman terbuka lewat UI.

### M5 — Multi-task + live stream
Badge jumlah task per karakter, warna dari status run, bubble dari live event
via `useCompanyLiveEvent` (WebSocket yang sudah ada). Hapus `colorize`/`matrixEffect`
kalau ternyata tak perlu.

**Verify (bisa difalsifikasi):** picu satu heartbeat sungguhan pada agen yang
sedang pegang ≥2 task, lalu pastikan badge jumlah task dan bubble karakter
berubah **tanpa reload halaman**, dalam batas 10 detik. Pembaruan harus datang
dari `useCompanyLiveEvent`, bukan polling.

### Catatan build akhir
`pnpm -r typecheck && pnpm test:run && pnpm build` sebelum serah-terima, sesuai AGENTS.md §7.

---

## 5. Risiko

| Risiko | Bukti | Mitigasi |
|---|---|---|
| **Aset tanpa lisensi** — 136 PNG, nol file LICENSE, nol field `license`, nol penyebutan "licen" di seluruh repo | terverifikasi: `ls`/`git ls-files`/`grep` semuanya kosong | User menyatakan **sudah di-approve pemilik repo** → lanjut. Disarankan simpan bukti tertulis (email/issue komentar) di commit/port untuk jejak audit, karena repo ini tidak punya LICENSE upstream |
| Engine mati walau API identik | SDK belum pernah menjalankan plugin ukuran ini | **M0 spike duluan** — batalkan/ubah rencana kalau gagal |
| Aset kehilangan jatah gratis karena bukan plugin | `plugin-ui-static` serving + base URL `/_plugins/...` hilang. `pixelAssets.ts:260` hardcode `/_plugins/agent-pixels.camera/ui/assets/` | `getPluginAssetBaseUrl()` **harus diganti total**, bukan di-tweak. Taruh aset di `ui/public/pixels/` (dilayani Vite/statik, tanpa rute server baru). `ui/public/` sudah ada dan berisi favicon/fonts |
| Aset 4,4 MB | `du -sh public` — 3,6 MB di antaranya `public/assets/brand` (hero/screenshot JPG README, **bukan** aset runtime) | Buang `brand/` → ~800 KB. 40 `char_*.png` juga merupakan recolor programatik dari `char_[0-5].png` (`generate-character-variants.py`), bisa diwarnai runtime via `colorize.ts` |
| Ruang kursi penuh | jumlah agen bisa melebihi kursi layout | **Keputusan:** pakai konsep `overflowOffice` yang sudah ada di upstream — agen di atas kapasitas masuk kantor overflow. Bukan pagination, bukan ringkasan |
| "1 agen = 1 sprite" vs multi-task | model upstream | Sudah teratasi: §1.4, tidak ada perubahan model data |
| Token gate gagal | 72 literal, `check-token-gates.mjs:80` | Split engine/shell §2, terverifikasi |
| **Kolisi ID karakter** | `PixelOfficeCanvas.tsx:21-27` `stableNumericId()` hash UUID → int 32-bit, tanpa penanganan tabrakan. Dua agen tabrakan jadi satu karakter, satunya hilang diam-diam oleh set `incoming` | Ganti ke `Map` ber-string-keyed oleh `agent.id`. Ini bug port, bukan opsional |
| **Silent truncation di 100 agen** | `worker.ts:24,40` `limit: 100` hardcode, tanpa paginasi | Endpoint M2 harus agregasi server-side; jangan N+1 per-agent. Agen di atas kapasitas kursi → "overflow office" (konsep `overflowOffice` sudah ada di upstream) |
| **Nol test di upstream** | 28 file, 5.215 LOC, tidak ada satu pun spec | Kita mewarisi 5k LOC tanpa coverage. Wajib scope test ke logika murni headless: `officeState` reassign kursi, `tileMap.findPath`, `layoutSerializer` round-trip, pemetaan data endpoint. **Jangan** uji render kanvas |

---

## 6. Yang TIDAK direncanakan (batas scope)

Tidak masuk rencana kecuali diminta:

- Editor layout kantor (`EditTool` di upstream — 7 alat). Demo-only untuk kontrol-plane.
- **Gaya CCTV / scanline / frame kamera** — **diputuskan dibuang** (2026-10-01).
  Tidak perlu allowlist token untuk hiasan gimmick.
- `colorize` hue-shift + `matrixEffect` (§1.2) — dievaluasi di M5, kemungkinan dibuang.
- **Model sub-agent/tmux upstream** — `officeState.ts:456` `nextSubagentId--` (ID negatif) plus
  `Character.isSubagent/parentAgentId/teamName/isTeamLead/leadAgentId` (`types.ts:173-195`)
  adalah silsilah Task-tool Claude Code, **bukan** model Paperclip. Untuk V1:
  buang seluruhnya. Kalau nanti diperlukan, petakan ke relasi issue parent/child
  Paperclip yang nyata, jangan port silsilah tmux apa adanya.
- Token spend per karakter selain tampilan sederhana.
- Publikasi artifact ZIP / rilis npm.

---

## 7. Keputusan yang sudah dikonfirmasi

Disetujui user pada 2026-10-01:

1. **Identitas visual** → kantor modern bersih, pakai token DESIGN.md.
   Scanline/CCTV upstream **dibuang**.
2. **Persistensi assignment kursi** → tabel baru `pixels_office_seats`
   (konsekuensi: rencana butuh **satu migrasi** — lihat §2).
3. **Nama flag** → `enablePixelsOffice`.
4. **Agen melebihi kapasitas kursi** → masuk **kantor overflow**, bukan pagination
   atau ringkasan agregat.

Tidak ada open question yang tersisa.
