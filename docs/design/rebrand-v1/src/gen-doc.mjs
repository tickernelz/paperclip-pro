import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const J = (p) => JSON.parse(readFileSync(join(here, p), 'utf8'));
const M = J('../measurements/measure.json');
const E = J('../measurements/essential.json');
const C = J('../measurements/contrast.json');
const DIRS = J('../measurements/directions.json');
const MG = J('../measurements/merge.json');
const SW = J('../measurements/swatches.json');
const LG = J('../logo/logo.json');
const LEG = J('../logo/legibility.json');

const n = (x) => Number(x).toLocaleString('id-ID');
const d1 = (x) => Number(x).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const d2 = (x) => Number(x).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a, b) => d1((a / b) * 100) + '%';
const SHA = M.commit.slice(0, 9);
const DATE = '7 November 2026';
const S = (name) => `../shots/${name}.jpg`;
const L = (p) => `../logo/${p}`;
const pages = [];
let pn = 0;

const run = (num, t) => `<div class="run"><span>Wardmote · rancangan rebrand v1 · ${t}</span><span>ZHA-5100 · ${SHA} · ${num}</span></div>`;
const page = (title, body, opts = {}) => {
  pn++;
  pages.push(`<section class="pg${opts.dark ? ' dark' : ''}">${body}${run(String(pn).padStart(2, '0'), title)}</section>`);
};
const SEC_FIRST = {};
const SEC_LAST = {};
const head = (sec, title, where = '') => { const k = /^[A-J0]/.test(sec) ? sec[0] : '·'; SEC_FIRST[k] ??= pn + 1; SEC_LAST[k] = pn + 1; return headHtml(sec, title, where); };
const headHtml = (sec, title, where) => `<div class="head"><span class="sec">${sec}</span><h2>${title}</h2><span class="where">${where}</span></div>`;
const fig = (src, cap, cls = 'shot') => `<figure><img class="${cls}" src="${src}" alt=""><figcaption class="cap">${cap}</figcaption></figure>`;
const pair = (sec, title, where, name, capL, capD, notes = '') => page(title, `${head(sec, title, where)}<div class="half">${fig(S(name + '-light'), '<b>Terang.</b> ' + capL)}${fig(S(name + '-dark'), '<b>Gelap.</b> ' + (capD || 'Token gelap yang sama, tanpa aturan khusus per layar.'))}</div>${notes ? `<div class="notes" style="margin-top:3.5mm;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6mm">${notes}</div>` : ''}`);

const ad = M.adapters;
const nm = M.name;
const ub = M.uiBefore;
const om = M.omp;
const removed = ad.folders.filter((f) => f !== 'omp-local');
const removedFiles = removed.reduce((s, f) => s + ad.perFolder[f].files, 0);
const removedLoc = removed.reduce((s, f) => s + ad.perFolder[f].loc, 0);
const uiAdapterFiles = Object.values(ad.uiAdapterFiles).reduce((a, b) => a + b, 0);
const worst = (rows) => rows.reduce((a, r) => (r.ratio / r.floor < a.ratio / a.floor ? r : a));
const passCount = (k) => `${C[k].filter((r) => r.pass).length}/${C[k].length}`;

page('Sampul', `
<p class="mono mute" style="margin-bottom:9mm">ZHA-5100 · ${DATE} · tahap rancangan, kode produk belum diubah · diukur di ${SHA} (paperclip-pro ${M.cliVersion})</p>
<div style="display:flex;align-items:center;gap:7mm;margin-bottom:6mm"><img src="${L('moot/mark-light.svg')}" style="width:26mm;height:26mm" alt=""><div><div style="font:640 40pt/1 Inter;letter-spacing:-0.03em">Wardmote</div><div class="mute" style="font-size:11pt;margin-top:2mm">nama baru paperclip-pro, diputuskan Zhafron 7 Nov 2026</div></div></div>
<h1 style="font-size:22pt;max-width:230mm">Satu runtime (OMP), satu tempat config, satu bahasa visual terang dan gelap</h1>
<p class="lede">Rancangan rebrand penuh: tiga arah visual dibandingkan dengan angka, satu dipilih; token berpasangan terang/gelap dengan kontras yang dihitung skrip; logo Wardmote tiga arah yang digambar dari skrip dan dilihat di 16 px; onboarding yang tidak bisa dilewati sebelum OMP lulus cek; pusat config OMP global dengan override per agent; semua layar inti dalam dua tema; dan dampak implementasinya dalam angka.</p>
<div style="margin-top:auto;display:grid;grid-template-columns:1fr 1fr;gap:10mm">
<div class="toc">@@TOC1@@</div>
<div class="toc">@@TOC2@@</div></div>`);

page('Ringkasan', `${head('0', 'Ringkasan untuk Zhafron', 'yang perlu diputuskan ada di bagian I')}
<div class="half" style="gap:8mm;flex:1">
<div class="notes">
<h3>Arah yang dipilih: Ledger</h3>
<p>Netral sejuk dengan satu aksen indigo, Inter yang sudah dikirim produk untuk teks, IBM Plex Mono untuk ID, biaya, dan waktu. Dipilih karena jarak warna aksen ke warna status paling besar (ΔOKLab ${d2(DIRS.b.minAccentSeparation)} lawan ${d2(DIRS.a.minAccentSeparation)} Jati dan ${d2(DIRS.c.minAccentSeparation)} Signal): "dipilih" tidak pernah tertukar dengan "berhasil" atau "peringatan". Semua ${C['b-light'].length * 2} pasangan kontras lulus; token UI sekarang lulus ${passCount('now-light')} (terang) dan ${passCount('now-dark')} (gelap).</p>
<h3>Tiga keputusan terpenting</h3>
<ol>
<li><b>OMP satu-satunya runtime, dicek sebelum lanjut.</b> 12 folder adapter (${n(removedFiles)} file, ${n(removedLoc)} baris) dan ${n(uiAdapterFiles - ad.uiAdapterFiles['omp-local'])} file UI adapter dihapus; tipe generik <code>process</code>, <code>http</code>, <code>paperclip_runner</code> diputuskan terpisah.</li>
<li><b>Config OMP pindah ke Wardmote.</b> ${E.searchable} setting dapat dicari (${E.visibleOmp} setting OMP di luar seksi internal ditambah ${E.essentialAdapter} kunci adapter), ${E.essentialCount} di kelompok Essential. Urutan prioritas terbukti: file overlay terakhir menang.</li>
<li><b>Rename dua tahap, berhenti merge upstream penuh.</b> Merge upstream sekarang sudah ${n(MG.currentMethod)} file konflik; setelah rename tahap 1 dan hapus adapter ${n(MG.stage1PlusDropAdapters)}; setelah tahap 2 ${n(MG.stage2PlusDropAdapters)}. Perbaikan keamanan diambil selektif.</li>
</ol>
</div>
<div class="notes">
<h3>Logo yang direkomendasikan: Lingkar Moot</h3>
<div style="display:flex;gap:4mm;align-items:center;margin:1mm 0 2mm"><div class="logo-tile l" style="padding:3mm"><img src="${L('moot/lockup-h-light.svg')}" style="height:12mm" alt=""></div><div class="logo-tile d" style="padding:3mm"><img src="${L('moot/lockup-h-dark.svg')}" style="height:12mm" alt=""></div></div>
<p>Enam kursi mengelilingi satu titik keputusan; satu kursi beraksen berarti ada yang menunggu Anda. Tetap ${LEG.moot['16'].parts} bentuk terpisah dari 128 px sampai 16 px (dihitung dari render, bukan ditaksir), versi satu warna tetap terbaca.</p>
<h3>Yang tidak berubah</h3>
<p>Fitur yang ada, URL perusahaan (<code>/ZHA/...</code>), data, dan pemberitahuan hak cipta di LICENSE (Paperclip AI 2025 dan Zhafron 2026). Mode terang/gelap sudah ada (ThemeContext); yang baru adalah token dan gaya berpasangan, default ikut sistem.</p>
<h3>Apa yang dikerjakan bila disetujui</h3>
<p>Lima task terpisah, tiap task dengan PR dan CI sendiri: (1) token dan komponen dasar, (2) onboarding OMP wajib, (3) pusat config OMP, (4) hapus 12 adapter, (5) rename tahap 1. Rename tahap 2 menyusul satu rilis kemudian.</p>
</div></div>`);

const ver = [
  ['File memuat "paperclip" (tanpa beda huruf)', '6.581 dari 10.603 (64.452 baris)', `${n(nm.filesWithPaperclip)} dari ${n(M.trackedFiles)} (${n(nm.linesWithPaperclip)} baris)`, 'git grep -il; HEAD sudah maju dari 14e21db1c'],
  ['File memuat @tickernelz/paperclip-pro', '3.448', n(nm.filesWithScope), 'git grep -lF'],
  ['package.json bernama @tickernelz/paperclip-pro*', '45 dari 48 (koreksi 13:13)', `${nm.packagesScoped} dari ${nm.packageJsonTracked}; ${nm.publishable} tidak private`, 'baca semua package.json terlacak'],
  ['Token PAPERCLIP_* berbeda', '868 (koreksi: token, bukan file)', `${n(nm.envTokensDistinct)} token, ${n(nm.envOccurrences)} kemunculan, ${n(nm.envFiles)} file`, 'git grep -ohE PAPERCLIP_[A-Z0-9_]+'],
  ['Folder packages/adapters', '13, 12 selain omp-local (koreksi)', `${ad.folders.length}, ${removed.length} selain omp-local`, 'ls packages/adapters'],
  ['AGENT_ADAPTER_TYPES', '16', String(ad.types.length), 'packages/shared/src/constants.ts:27'],
  ['Rujukan omp_local / claude_local / codex_local', '60 / 262 / 429 file', `${ad.refsByWord.omp_local} / ${ad.refsByWord.claude_local} / ${ad.refsByWord.codex_local} file`, 'git grep -lw (kata utuh); metode deskripsi tidak tercatat'],
  ['Agent di company Zhafron', '21, semua omp_local', '21, semua omp_local', 'paperclipListAgents'],
  ['File ts/tsx/css di ui', '2.481 (393 pages, 935 components)', `${n(M.ui.tsTsxCssUi)} di ui/, ${n(M.ui.tsTsxCss)} di ui/src (${M.ui.pages} pages, ${M.ui.components} components)`, 'git ls-files'],
  ['File memakai dark: atau theme', '234', `${M.ui.filesDarkOrTheme} (${M.ui.filesDarkVariant} memakai dark:)`, 'git grep -liE "dark:|theme" ui/src'],
  ['Setting OMP', '602 dalam 11 seksi', `${om.settingsTotal} dalam ${Object.keys(om.sections).length} seksi (internal ${om.sections.internal})`, `omp config list, ${om.version}`],
  ['Kunci config yang dibaca adapter omp-local', 'sekitar 40', String(om.adapterConfigKeys.length), 'regex config.X di src/server tanpa test'],
  ['UI omp-local', 'hanya index.ts', ad.ompUiFiles.map((f) => f.split('/').pop()).join(', ') + '; tidak ada config-fields.tsx', `${ad.configFieldsFiles.length} file config-fields untuk adapter lain`],
  ['Locale di ui/src/i18n', '-', `${M.ui.locales.length} file; en.json memuat ${nm.enStrings} string`, 'ui/src/i18n/locales'],
];
page('Data awal', `${head('0', 'Data awal di deskripsi, diukur ulang', `HEAD ${SHA} · src/measure.py · measurements/measure.json`)}
<table><thead><tr><th style="width:62mm">Butir</th><th style="width:52mm">Deskripsi</th><th style="width:72mm">Terukur di ${SHA}</th><th>Cara ukur</th></tr></thead><tbody>
${ver.map((r) => `<tr><td>${r[0]}</td><td class="mute">${r[1]}</td><td><b style="font-weight:600">${r[2]}</b></td><td class="mute" style="font-size:7.4pt">${r[3]}</td></tr>`).join('')}
</tbody></table>
<p class="cap" style="margin-top:3mm;max-width:none">Selisih kecil (6.581 → ${n(nm.filesWithPaperclip)}) datang dari HEAD yang maju dari 14e21db1c ke ${SHA} setelah deskripsi ditulis. Hitungan rujukan adapter memakai kata utuh, jadi lebih tinggi dari angka deskripsi; angka di bagian H memakai metode ini. Temuan baru: en.json hanya punya ${nm.enStrings} string, jadi 40 locale belum menerjemahkan UI (bagian G).</p>`);

page('UI sekarang', `${head('A', 'UI sekarang, diukur dari kode', 'ui/src @ ' + SHA)}
<div class="kpis">
<div class="box"><div class="l">Kelas warna palet Tailwind (bg-red-500, text-zinc-400, ...)</div><div class="big">${n(ub.paletteClassUses)}</div><div class="s">${ub.paletteDistinct} kelas berbeda di ${ub.paletteClassFiles} file. DESIGN.md sendiri menyebutnya utang (Run 4).</div></div>
<div class="box"><div class="l">Varian dark: ditulis manual</div><div class="big">${n(ub.darkVariantUses)}</div><div class="s">di ${M.ui.filesDarkVariant} file. Tiap layar mengatur gelapnya sendiri.</div></div>
<div class="box"><div class="l">Custom property di index.css</div><div class="big">${n(M.ui.indexCssTokens)}</div><div class="s">${n(M.ui.indexCssLines)} baris, satu file.</div></div>
<div class="box"><div class="l">Label menu samping</div><div class="big">${ub.sidebarDistinct}</div><div class="s">${ub.sidebarLabels.length} entri; Chat, Tasks, Org, Connectors muncul dua kali.</div></div>
</div>
<div class="half" style="margin-top:5mm;gap:8mm">
<div class="notes"><h3>Kontras token sekarang (dihitung skrip yang sama)</h3>
<table><thead><tr><th>Pasangan</th><th class="n">Terang</th><th class="n">Gelap</th><th class="n">Batas</th></tr></thead><tbody>
${C['now-light'].map((r, i) => { const dk = C['now-dark'][i]; return `<tr><td>${r.pair}</td><td class="n ${r.pass ? 'pass' : 'fail'}">${d2(r.ratio)}</td><td class="n ${dk.pass ? 'pass' : 'fail'}">${d2(dk.ratio)}</td><td class="n">${r.floor}</td></tr>`; }).join('')}
</tbody></table><p class="cap">Garis batas (border) ${d2(C['now-light'].find((r) => r.pair.startsWith('border')).ratio)}:1 di terang: tepi kartu dan input hampir hilang. Ring fokus terang ${d2(C['now-light'].find((r) => r.pair.startsWith('ring')).ratio)}:1, di bawah 3:1 WCAG 2.2 untuk indikator fokus.</p></div>
<div class="notes"><h3>Kenapa diganti, bukan dipoles</h3>
<ul>
<li>Netral sekarang <code>oklch(L 0 0)</code> murni tanpa rona: abu-abu shadcn bawaan, tidak punya identitas.</li>
<li>Warna status ditulis per layar dengan kelas palet, bukan token: satu status bisa beda warna di dua layar.</li>
<li>${n(ub.darkVariantUses)} varian dark: berarti tema gelap adalah tambalan per elemen. Token berpasangan membuat gelap jadi otomatis.</li>
<li>Teks pakai Inter variable (344 KB) plus italic (379 KB). Angka dan ID tanpa font mono yang dibundel: <code>ui-monospace</code> berbeda tiap OS.</li>
<li>Tidak ada tangkapan layar produksi di PDF ini: tab latar di browser Zhafron tidak merender (5 elemen terlihat) dan memotret butuh membawa tab ke depan, jadi angka diambil dari kode.</li>
</ul></div></div>`);

page('Tiga arah', `${head('A', 'Tiga arah, layar yang sama', 'Tasks 1440×900 · data sama · hanya token yang beda')}
<div class="thirds">
${[['a', 'Jati', 'Hangat seperti kertas dan kayu, IBM Plex Sans, baris 44 px. Tenang dan ramah, tetapi lebih sedikit baris per layar.'], ['b', 'Ledger', 'Netral sejuk, aksen indigo, Inter + Plex Mono, baris 36 px. Rapat tapi bernapas; angka rata dan sejajar.'], ['c', 'Signal', 'Monokrom kontras tinggi, aksen hijau limau, baris 32 px. Paling padat, tetapi aksen hampir sama dengan warna berhasil.']].map(([k, nmx, t]) => `<div>${fig(S('dir-' + k + '-light'), `<b>${k.toUpperCase()} · ${nmx}${k === 'b' ? ' (dipilih)' : ''}.</b> ${t}`)}<div style="height:2mm"></div>${fig(S('dir-' + k + '-dark'), '')}</div>`).join('')}
</div>`);

page('Perbandingan arah', `${head('A', 'Perbandingan dengan angka', 'src/directions.py · src/contrast.py · measurements/directions.json')}
<table><thead><tr><th>Kriteria</th><th>Cara ukur</th><th class="n">A · Jati</th><th class="n">B · Ledger</th><th class="n">C · Signal</th></tr></thead><tbody>
<tr><td>Pasangan kontras lulus</td><td class="mute">23 pasangan per tema, WCAG 2.2: teks 4,5, grafik 3,0</td><td class="n">${DIRS.a.contrastPass}</td><td class="n">${DIRS.b.contrastPass}</td><td class="n">${DIRS.c.contrastPass}</td></tr>
<tr><td>Rasio teks terendah</td><td class="mute">pasangan teks terlemah di dua tema</td><td class="n">${d2(DIRS.a.minTextRatio)}</td><td class="n">${d2(DIRS.b.minTextRatio)}</td><td class="n">${d2(DIRS.c.minTextRatio)}</td></tr>
<tr class="hl"><td>Jarak aksen ke warna status terdekat</td><td class="mute">Δ OKLab, minimum dari terang dan gelap</td><td class="n">${d2(DIRS.a.minAccentSeparation)} (${DIRS.a.accentSeparation[0].nearest})</td><td class="n">${d2(DIRS.b.minAccentSeparation)} (${DIRS.b.accentSeparation[1].nearest})</td><td class="n">${d2(DIRS.c.minAccentSeparation)} (${DIRS.c.accentSeparation[0].nearest})</td></tr>
<tr><td>Baris tabel terlihat di 1440×900</td><td class="mute">(900 − 148 px chrome) / tinggi baris</td><td class="n">${DIRS.a.rowsAt1440x900} (${DIRS.a.rowHeight} px)</td><td class="n">${DIRS.b.rowsAt1440x900} (${DIRS.b.rowHeight} px)</td><td class="n">${DIRS.c.rowsAt1440x900} (${DIRS.c.rowHeight} px)</td></tr>
<tr><td>Perubahan berat font</td><td class="mute">KB woff2 yang ditambah dikurangi yang dibuang</td><td class="n">${d1(DIRS.a.fontDeltaKB)} KB</td><td class="n">+${d1(DIRS.b.fontDeltaKB)} KB</td><td class="n">${d1(DIRS.c.fontDeltaKB)} KB</td></tr>
<tr><td>Font mono dibundel</td><td class="mute">ID, biaya, waktu sama di semua OS</td><td class="n">ya</td><td class="n">ya</td><td class="n">tidak</td></tr>
</tbody></table>
<div class="half" style="margin-top:4mm;gap:8mm"><div class="notes"><h3>Kenapa B</h3><p>Produk ini dipakai untuk memindai status. Aksen dipakai untuk "terpilih" dan tombol utama; bila warnanya dekat dengan status, operator salah baca. Jati: aksen tembaga hanya ${d2(DIRS.a.minAccentSeparation)} dari kuning peringatan. Signal: aksen limau ${d2(DIRS.c.minAccentSeparation)} dari hijau berhasil. Ledger ${d2(DIRS.b.minAccentSeparation)}: lebih dari dua kali lebih jauh. B juga memakai Inter yang sudah ada, jadi tidak ada perubahan metrik teks di ${n(M.ui.tsTsxCss)} file UI.</p></div>
<div class="notes"><h3>Harga pilihan B (aturan performa Zhafron)</h3><p>B menambah ${d1(DIRS.b.fontDeltaKB)} KB (Plex Mono 400/500). A menghemat ${d1(-DIRS.a.fontDeltaKB)} KB karena membuang Inter, tetapi mengganti metrik teks seluruh UI dan memuat ${DIRS.b.rowsAt1440x900 - DIRS.a.rowsAt1440x900} baris lebih sedikit per layar. Penghematan yang tetap bisa diambil di B: subset Inter latin 98 KB (dari 344 KB) dan italic dikeluarkan dari muatan awal. Diukur dengan pyftsubset; dipasang di task token, bukan di sini.</p></div></div>`);

const swRow = (theme, names) => `<div class="sw">${names.map((k) => `<div><i style="background:${SW['b-' + theme][k].hex}"></i><b>--${k}</b>${SW['b-' + theme][k].hex}<br>${SW['b-' + theme][k].oklch.replace('oklch', '')}</div>`).join('')}</div>`;
const NAMES1 = ['bg', 'bg-2', 'bg-3', 'line-soft', 'line', 'line-strong', 'ink'];
const NAMES2 = ['ink-2', 'ink-3', 'accent', 'accent-ink', 'ok', 'warn', 'bad'];
const NAMES3 = ['run', 'focus', 'accent-soft', 'ok-soft', 'warn-soft', 'bad-soft', 'run-soft'];
page('Token warna', `${head('A', 'Token warna Ledger, berpasangan', 'src/tokens.css · OKLCH · hex dihitung dari OKLCH')}
<div class="half" style="gap:8mm"><div><h3>Terang</h3>${swRow('light', NAMES1)}<div style="height:2mm"></div>${swRow('light', NAMES2)}<div style="height:2mm"></div>${swRow('light', NAMES3)}</div>
<div style="background:#15171c;color:#f1f2f5;border-radius:1.6mm;padding:3mm" class="dark"><h3>Gelap</h3>${swRow('dark', NAMES1)}<div style="height:2mm"></div>${swRow('dark', NAMES2)}<div style="height:2mm"></div>${swRow('dark', NAMES3)}</div></div>
<div class="notes" style="margin-top:3mm;display:grid;grid-template-columns:repeat(3,1fr);gap:6mm"><div><h3>Satu rona netral</h3><p>Semua netral memakai rona 265–268 dengan chroma 0,003–0,014: abu-abu yang sedikit biru, cocok dengan aksen indigo 277.</p></div><div><h3>Nama per peran</h3><p>Komponen memakai peran (<code>--ink-3</code>, <code>--run</code>), bukan warna. Ganti tema berarti ganti nilai token, bukan file komponen. Status: run (biru) berjalan, warn menunggu, bad gagal, ok selesai, accent dipilih.</p></div><div><h3>Peta ke index.css</h3><p>Sesuai DESIGN.md, token ini masuk sebagai <code>tokens.css</code> yang di-import index.css; peran shadcn (<code>--background</code>, <code>--primary</code>, ...) dipetakan ke token ini, bukan dihapus.</p></div></div>`);

page('Tipe, ruang, gerak', `${head('A', 'Tipe, ruang, radius, gerak', 'src/tokens.css :root')}
<div class="half" style="gap:10mm">
<div class="notes"><h3>Tipe: Inter (OFL 1.1) dan IBM Plex Mono (OFL 1.1)</h3>
<table><tbody>${[[32, 640, 'Install OMP to continue', 'judul onboarding'], [24, 600, '$14.20', 'angka KPI'], [20, 620, 'Approvals', 'judul halaman'], [16, 600, 'Running now', 'judul seksi, input ponsel'], [14, 400, 'Wardmote rebrand: mockup PDF, onboarding', 'teks dasar'], [13, 500, 'Inbox · Tasks · Agents', 'menu, tabel'], [12, 500, 'asked 6 min ago', 'meta']].map((r) => `<tr><td class="n" style="width:14mm">${r[0]} px</td><td style="font:${r[1]} ${r[0] * 0.75}pt/1.2 Inter;letter-spacing:${r[0] >= 20 ? '-0.015em' : '0'}">${r[2]}</td><td class="mute" style="width:36mm">${r[3]}</td></tr>`).join('')}<tr><td class="n">12 px</td><td style="font:400 9pt Plex Mono,Inter">ZHA-5100 · $4.12 · 14:02</td><td class="mute">Plex Mono, angka tabular</td></tr></tbody></table>
<p class="cap">Tujuh ukuran (12, 13, 14, 16, 20, 24, 32); UI sekarang memakai ${ub.textSizesDistinct} kelas ukuran teks. Input di ponsel minimal 16 px (aturan DESIGN.md untuk mencegah zoom Safari).</p></div>
<div class="notes"><h3>Ruang (kelipatan 4)</h3><div style="display:flex;gap:3mm;align-items:flex-end;margin-bottom:3mm">${[4, 8, 12, 16, 20, 24, 32, 40, 56].map((v) => `<div style="text-align:center;font:400 6.6pt Plex Mono,Inter;color:#5d6270"><div style="width:${v * 0.42}mm;height:${v * 0.42}mm;background:#4c47c4;opacity:.8;margin:0 auto 1mm;border-radius:.4mm"></div>${v}</div>`).join('')}</div>
<h3>Radius</h3><div style="display:flex;gap:5mm;margin-bottom:3mm">${[['sm', 4], ['md', 6], ['lg', 10], ['pill', 999]].map(([k, v]) => `<div style="text-align:center;font:400 6.6pt Plex Mono,Inter;color:#5d6270"><div style="width:16mm;height:9mm;border:.4mm solid #4c47c4;border-radius:${Math.min(v, 30) * 0.3}mm;margin-bottom:1mm"></div>${k} ${v === 999 ? '' : v + 'px'}</div>`).join('')}</div><p class="cap">Empat radius; UI sekarang memakai ${ub.radiusClassesDistinct} kelas rounded berbeda.</p>
<h3>Gerak</h3><table><tbody><tr><td class="k">--dur-1 120ms</td><td>hover, tekan, toggle</td></tr><tr><td class="k">--dur-2 200ms</td><td>panel, menu, dialog masuk</td></tr><tr><td class="k">--dur-3 320ms</td><td>pindah langkah onboarding</td></tr><tr><td class="k">ease-out (0.22,1,0.36,1)</td><td>semua yang masuk; tanpa pantulan</td></tr><tr><td class="k">prefers-reduced-motion</td><td>semua durasi jadi 0 ms lewat token, satu tempat</td></tr></tbody></table></div></div>`);

const crow = (r, dk) => `<tr><td>${r.pair}</td><td class="k">${r.fg} / ${r.bg}</td><td class="n ${r.pass ? 'pass' : 'fail'}">${d2(r.ratio)}</td><td class="k">${dk.fg} / ${dk.bg}</td><td class="n ${dk.pass ? 'pass' : 'fail'}">${d2(dk.ratio)}</td><td class="n">${r.floor}</td></tr>`;
page('Kontras', `${head('A', 'Kontras dihitung, bukan ditebak', `src/contrast.py · ${C['b-light'].length * 2} pasangan · keluar non-nol bila ada yang gagal`)}
<table><thead><tr><th>Pasangan</th><th>Terang fg / bg</th><th class="n">Rasio</th><th>Gelap fg / bg</th><th class="n">Rasio</th><th class="n">Batas</th></tr></thead><tbody>
${C['b-light'].map((r, i) => crow(r, C['b-dark'][i])).join('')}
</tbody></table>
<p class="cap" style="max-width:none">Warna transparan (soft) dikomposit di atas latarnya dulu, lalu dihitung luminans relatif WCAG. Putaran pertama gagal 3 pasangan lencana terang (ok 4,47; warn 4,18; run 4,31); nilai L token diturunkan sampai lulus, bukan batasnya yang dilonggarkan. Terlemah sekarang: terang ${worst(C['b-light']).pair} ${d2(worst(C['b-light']).ratio)}, gelap ${worst(C['b-dark']).pair} ${d2(worst(C['b-dark']).ratio)}.</p>`);

page('Komponen dan ikon', `${head('A', 'Komponen dasar dan ikon', 'src/screen.html?screen=system')}
<div class="half">${fig(S('system-light'), '<b>Terang.</b> Tombol, status, lencana sumber config, input dengan galat, notice, ikon grid 24 garis 1,6 dengan ujung bulat.')}${fig(S('system-dark'), '<b>Gelap.</b> Satu kosakata status dipakai sama di lencana, baris, grafik, dan log (prinsip 5 DESIGN.md).')}</div>`);

page('Nama', `${head('B', 'Nama: Wardmote', 'final, Zhafron 7 Nov 2026: "Oke wardmote boleh"')}
<div class="half" style="gap:10mm;flex:1">
<div class="notes">
<div style="display:flex;gap:4mm;margin-bottom:4mm"><div class="logo-tile l" style="flex:1;padding:6mm"><img src="${L('moot/wordmark-light.svg')}" style="height:11mm" alt=""></div><div class="logo-tile d" style="flex:1;padding:6mm"><img src="${L('moot/wordmark-dark.svg')}" style="height:11mm" alt=""></div></div>
<h3>Makna</h3><p>Inggris Kuno <i>ward</i> + <i>moot</i>: rapat warga satu distrik. City of London masih memakainya untuk rapat tahunan pemilih di tiap ward (sumber: cityoflondon.gov.uk, panduan pemilu Common Council, dan Wardmote Book). Di produk: tempat manusia dan agent berkumpul, melihat, dan memutuskan. Inbox, Decisions, dan Approvals adalah "wardmote"-nya.</p>
<h3>Cara menulis</h3><table><tbody><tr><td>Teks tampil, judul, dokumen</td><td><b style="font-weight:600">Wardmote</b> (satu kata, W kapital)</td></tr><tr><td>Paket npm, CLI, domain, folder</td><td><code>wardmote</code>, <code>~/.wardmote</code></td></tr><tr><td>Variabel lingkungan (tahap 2)</td><td><code>WARDMOTE_*</code>, alias <code>PAPERCLIP_*</code> satu rilis</td></tr><tr><td>Nama tool MCP (tahap 2)</td><td><code>wardmoteListIssues</code>, alias lama satu rilis</td></tr></tbody></table>
<p class="cap">Wordmark dibuat dari kontur Inter berat 640 (OFL 1.1) lewat skrip, jadi tidak bergantung pada font yang terpasang. Mengganti nama berarti mengganti satu konstanta di <code>logo/build.py</code> dan <code>BRAND</code> di mockup.</p>
</div>
<div class="notes">
<h3>Status ketersediaan, diperiksa ulang ${DATE}</h3>
<table><thead><tr><th>Tempat</th><th>Hasil</th><th>Cara</th></tr></thead><tbody>
<tr><td>npm <code>wardmote</code></td><td><span class="tag ok">bebas</span> 404</td><td class="mute">registry.npmjs.org/wardmote</td></tr>
<tr><td>npm <code>@wardmote/cli</code></td><td><span class="tag ok">bebas</span> 404</td><td class="mute">registry; scope sendiri belum bisa dipastikan (halaman org menjawab 403 untuk klien tanpa login)</td></tr>
<tr><td>github.com/wardmote</td><td><span class="tag ok">bebas</span> 404</td><td class="mute">HTTP</td></tr>
<tr><td>wardmote.com</td><td><span class="tag bad">terdaftar</span> 29 Jul 2026</td><td class="mute">whois Creation Date, RDAP Verisign 200</td></tr>
<tr><td>wardmote.dev, wardmote.app</td><td><span class="tag ok">belum terdaftar</span></td><td class="mute">RDAP Google Registry 404</td></tr>
<tr><td>wardmote.io, wardmote.ai</td><td><span class="tag ok">belum terdaftar</span></td><td class="mute">whois "Domain not found"</td></tr>
<tr><td>Repo lain bernama sama</td><td><span class="tag warn">ada</span></td><td class="mute">dshraddha/wardmote: "one pipeline for every LLM security detector", 0 star</td></tr>
</tbody></table>
<div class="box warn" style="margin-top:3mm"><b style="font-weight:600">Belum diperiksa:</b> merek dagang resmi (WIPO Global Brand Database, USPTO, EUIPO, DJKI Indonesia), handle sosial. Pencarian web atas "wardmote logo software app" hanya menemukan kamus, halaman City of London, dan repo di atas; pencarian web bukan pemeriksaan merek. Dicatat sebagai keputusan terbuka I-1.</div>
</div></div>`);

const CONCEPT = {
  moot: { t: 'Lingkar Moot', why: 'Enam kursi melingkari satu titik pusat: ward (warga) berkumpul di sekitar keputusan. Satu kursi beraksen adalah item yang menunggu Anda, sama dengan titik di menu Inbox, jadi tanda dan produk berbicara dengan bahasa yang sama. Tanpa huruf, jadi tetap berlaku bila nama berganti. Dibangun dari 7 lingkaran pada grid 48: pusat r 7,4, kursi r 5,6 di radius 17; celah antarkursi 5,8 unit, cukup lebar untuk tetap terpisah di 16 px.' },
  gate: { t: 'Gerbang W', why: 'Dua lengkung U yang saling menumpuk membentuk W (ward = pagar, jaga); irisan keduanya diisi aksen sebagai perisai kecil. Monogram, kuat di ukuran besar dan pada lockup. Kelemahan terukur: di 16 px irisan tengah terbaca sebagai garis tegak ketiga, jadi tanda terbaca seperti sisir atau "UU", bukan W.' },
  bubble: { t: 'Balon Perisai', why: 'Balon ucapan (moot = bicara) dengan sisi bawah berbentuk perisai (ward = jaga), dan satu baris agenda dengan titik aksen. Paling mudah dijelaskan, tetapi balon ucapan adalah bentuk yang sangat umum di aplikasi chat, dan titik agenda hanya sekitar 2 px di 16 px.' },
};
const sizes = (k) => `<div class="sizes">${[16, 24, 32, 48].map((s) => `<figure><img src="${L(k + '/mark-light.svg')}" style="width:${s}px;height:${s}px" alt="">${s}</figure>`).join('')}<figure><img src="${L(k + '/mark-light.svg')}" style="width:128px;height:128px" alt="">128</figure><figure><img class="px" src="${L('render/' + k + '-light-16-x8.png')}" style="width:64px;height:64px" alt="">16 px dirender, 4×</figure><figure><img class="px" src="${L('render/' + k + '-dark-16-x8.png')}" style="width:64px;height:64px" alt="">gelap 16 px</figure></div>`;
for (const k of ['moot', 'gate', 'bubble']) {
  const c = CONCEPT[k];
  const lm = LG.concepts[k];
  page('Logo ' + c.t, `${head('J', `Arah logo: ${c.t}${k === 'moot' ? ' (direkomendasikan)' : ''}`, `logo/${k}/*.svg · dibangkitkan logo/build.py`)}
<div style="display:grid;grid-template-columns:1.1fr 1fr;gap:7mm;flex:1;min-height:0">
<div style="display:flex;flex-direction:column;gap:3mm">
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:3mm"><div class="logo-tile l" style="height:38mm"><img src="${L(k + '/mark-light.svg')}" style="width:26mm" alt=""></div><div class="logo-tile d" style="height:38mm"><img src="${L(k + '/mark-dark.svg')}" style="width:26mm" alt=""></div><div class="logo-tile l" style="height:38mm"><img src="${L(k + '/mark-mono.svg')}" style="width:26mm" alt=""></div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:3mm"><div class="logo-tile l" style="height:22mm"><img src="${L(k + '/lockup-h-light.svg')}" style="height:10mm" alt=""></div><div class="logo-tile d" style="height:22mm"><img src="${L(k + '/lockup-h-dark.svg')}" style="height:10mm" alt=""></div></div>
<div style="display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:3mm"><div class="logo-tile l" style="height:34mm"><img src="${L(k + '/lockup-v-light.svg')}" style="height:24mm" alt=""></div><div class="logo-tile d" style="height:34mm"><img src="${L(k + '/lockup-v-dark.svg')}" style="height:24mm" alt=""></div><div class="logo-tile l" style="height:34mm;position:relative;align-items:flex-start;padding-top:5mm\"><div style=\"position:relative;width:18mm;height:18mm;outline:.3mm dashed #4c47c4;outline-offset:3mm\"><img src=\"${L(k + '/mark-light.svg')}\" style=\"width:22mm\" alt=\"\"></div><span style=\"position:absolute;bottom:.6mm;font:400 6pt Plex Mono,Inter;color:#5d6270">area aman = 1/6 sisi</span></div></div>
</div>
<div class="notes" style="display:flex;flex-direction:column;gap:2mm">
<h3>Alasan bentuk</h3><p>${c.why}</p>
<h3>Ukuran ikon dan favicon</h3>${sizes(k)}
<table style="margin-top:2mm"><tbody><tr><td>Bentuk vektor</td><td class="n">${lm.shapes}</td></tr><tr><td>Warna</td><td class="n">${lm.colors} (tinta + aksen); versi satu warna ada</td></tr><tr><td>Komponen terpisah 128 px → 16 px</td><td class="n">${LEG[k]['128'].parts} → ${LEG[k]['16'].parts}</td></tr><tr><td>Lubang (ruang negatif) 128 → 16 px</td><td class="n">${LEG[k]['128'].holes} → ${LEG[k]['16'].holes}</td></tr><tr><td>Kontras tinta / aksen, terang</td><td class="n">${d2(lm.inkContrast_light)} / ${d2(lm.accentContrast_light)}</td></tr><tr><td>Kontras tinta / aksen, gelap</td><td class="n">${d2(lm.inkContrast_dark)} / ${d2(lm.accentContrast_dark)}</td></tr></tbody></table>
</div></div>`);
}

page('Logo perbandingan', `${head('J', 'Perbandingan tiga arah logo', 'logo/legibility.py · logo/logo.json · render Chrome 16–128 px')}
<table><thead><tr><th>Kriteria</th><th>Cara ukur</th><th>Lingkar Moot</th><th>Gerbang W</th><th>Balon Perisai</th></tr></thead><tbody>
<tr class="hl"><td>Terbaca di 16 px</td><td class="mute">render SVG di 16 px lalu dilihat; komponen dan lubang dihitung ImageMagick (ambang 50%)</td><td>Ya: 7 titik tetap 7, cincin dan pusat jelas</td><td>Sebagian: bentuk utuh, tetapi W terbaca sebagai sisir tiga gigi</td><td>Sebagian: balon jelas, titik agenda sekitar 2 px</td></tr>
<tr><td>Jumlah bentuk / warna</td><td class="mute">elemen SVG di luar mask</td><td class="n">${LG.concepts.moot.shapes} / ${LG.concepts.moot.colors}</td><td class="n">${LG.concepts.gate.shapes} / ${LG.concepts.gate.colors}</td><td class="n">${LG.concepts.bubble.shapes} / ${LG.concepts.bubble.colors}</td></tr>
<tr><td>Kontras terhadap latar</td><td class="mute">tinta dan aksen terhadap --bg-2 terang dan --bg gelap</td><td colspan="3">Sama untuk ketiganya karena memakai token yang sama: tinta ${d2(LG.concepts.moot.inkContrast_light)} dan ${d2(LG.concepts.moot.inkContrast_dark)}, aksen ${d2(LG.concepts.moot.accentContrast_light)} dan ${d2(LG.concepts.moot.accentContrast_dark)} (batas grafik 3,0)</td></tr>
<tr><td>Satu warna</td><td class="mute">versi mono dirender, dibandingkan dengan versi warna</td><td>Kursi aksen jadi cincin berlubang; makna tetap</td><td>Perisai hilang; tinggal W garis</td><td>Titik jadi lubang; makna tetap</td></tr>
<tr><td>Kemiripan</td><td class="mute">web: "wardmote logo software app", pola titik melingkar, monogram W, balon perisai</td><td>Tidak ada logo Wardmote. Pola titik melingkar umum (ikon memuat); tanpa titik beraksen</td><td>Monogram W sangat banyak di pasar</td><td>Balon ucapan umum di aplikasi chat</td></tr>
<tr><td>Bebas merek pihak lain</td><td class="mute">tidak memakai bentuk OMP atau Paperclip AI</td><td>ya</td><td>ya</td><td>ya</td></tr>
</tbody></table>
<div class="half" style="margin-top:4mm;gap:8mm">
<div class="notes"><h3>Rekomendasi: Lingkar Moot</h3><p>Satu-satunya arah yang lulus di 16 px tanpa catatan (7 → 7 komponen, 1 → 1 lubang di 128 dan 16 px), dan titik aksennya dipakai lagi di produk sebagai tanda "menunggu Anda". Bila disetujui: (1) SVG final dan favicon 16/32/48/180/512 dari <code>logo/build.py</code>, (2) ganti <code>ui/public/favicon*</code> dan ikon PWA, (3) lockup di menu samping, (4) pemeriksaan merek gambar di WIPO sebelum dipakai publik.</p></div>
<div class="notes"><h3>Eksplorasi AI (bukan tanda final)</h3><div style="display:flex;gap:4mm;align-items:flex-start"><img src="${L('ai-exploration.jpg')}" style="width:58mm;border-radius:1mm;box-shadow:0 0 0 .25mm #c9ccd4" alt=""><p class="cap" style="margin:0"><b>eksplorasi AI.</b> Model <code>sub2api-agy/gemini-3.1-flash-image</code>, 7 Nov 2026. Prompt: "Flat vector logo exploration for a software product named Wardmote: a ring of six round seats around one central dot, one seat in indigo, the rest near-black, on white, minimal, no text, no gradients". Hasilnya raster 1408×768 dengan tepi bergerigi, aksen di atas, bukan di kanan atas. Dipakai hanya untuk memeriksa apakah ide terbaca tanpa penjelasan; kepemilikan hak ciptanya tidak jelas, jadi tidak dipakai.</p></div></div></div>`);

const NAV = [
  ['Home', 'Dashboard, DashboardLive, Status', 'gabung: satu layar "apa yang terjadi, apa yang butuh saya"'],
  ['Inbox', 'Inbox, LegacyInbox, Decisions, WhatNeedsMe, Approvals, JoinRequestQueue', 'gabung jadi tab: Needs me, Decisions, Approvals, All'],
  ['Chat', 'Chat (2 entri), AgentChat(s), BoardChat', 'satu entri; percakapan per agent di dalam'],
  ['Tasks', 'Tasks (2 entri), Issues, MyIssues', 'satu entri; "Mine" jadi tab'],
  ['Projects', 'Projects, Workspaces', 'Workspaces pindah ke detail proyek'],
  ['Routines', 'Routines, Pipelines, Cases', 'Pipelines dan Cases jadi tab Routines (eksperimen tetap di balik flag)'],
  ['Goals', 'Goals', 'tetap'],
  ['Agents', 'Agents, Skills, Terminal', 'Skills dan Terminal pindah ke detail agent'],
  ['Org chart', 'Org (2 entri)', 'satu entri'],
  ['OMP config', '(baru) + Instance > Adapters', 'baru; menggantikan Adapters'],
  ['Connectors', 'Connectors (2 entri), Apps', 'satu entri'],
  ['Costs', 'Costs, Budgets', 'tetap'],
  ['Activity', 'Activity, Audit, Timeline, Artifacts', 'gabung'],
  ['Settings', 'Organization, Settings, Instance', 'satu pohon: Company dan Instance'],
];
page('Arsitektur informasi', `${head('C', 'Navigasi baru: 28 label jadi 14', `ui/src/components/Sidebar.tsx @ ${SHA}`)}
<div class="split" style="grid-template-columns:1fr 70mm">
<table><thead><tr><th style="width:26mm">Navigasi baru</th><th>Halaman dan label sekarang</th><th style="width:70mm">Perlakuan</th></tr></thead><tbody>${NAV.map((r) => `<tr><td><b style="font-weight:600">${r[0]}</b></td><td class="mute">${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table>
<div class="notes"><h3>Prinsip</h3><p>Urutan mengikuti pertanyaan operator di DESIGN.md: apa yang terjadi (Home), apakah butuh saya (Inbox), apa yang saya lakukan (Tasks, Agents). Tiga kelompok: Work, Team, Company.</p><h3>Angka</h3><p>${ub.sidebarLabels.length} entri menu sekarang, ${ub.sidebarDistinct} label berbeda, 4 label muncul dua kali. Baru: 14 entri plus Search. ${M.ui.pageModules.length} modul halaman (tsx non-test) dan ${M.ui.routes.length} path rute di App.tsx; rute lama yang hilang dari menu tetap hidup atau diberi redirect.</p><h3>Pixels Office, Conference Room</h3><p>Tidak masuk navigasi utama; tetap bisa dibuka lewat Search dan URL. Dicatat sebagai keputusan terbuka I-6 karena itu keputusan produk.</p></div></div>`);

const GONE = [
  ['AdapterManager.tsx', '690 baris', 'hapus: hanya ada satu runtime'],
  ['company/settings/instance/adapters, instance/settings/adapters', '2 rute', 'redirect ke Settings > Instance > OMP runtime'],
  ['ui/src/adapters/* selain omp-local', `${uiAdapterFiles - ad.uiAdapterFiles['omp-local']} file, ${ad.configFieldsFiles.length} config-fields`, 'hapus; form diganti pusat config OMP'],
  ['Pemilih adapter di NewAgent dan onboarding', 'ModelSourceTiles, ConnectModelPreview', 'diganti layar "Connect a model" OMP'],
  ['10 halaman UX lab dan dev', 'BootstrapSetup, CrossIssue, Invite, IssueChat, ResponsibleUserDenial, RunTranscript, SystemNotice UxLab; TaskChatLab; IssueChatLongThreadPerf; DesignGuide', 'tidak dihapus; hanya muncul di build dev'],
  ['LegacyInbox.tsx', '1 halaman', 'gabung ke Inbox setelah satu rilis'],
];
page('Halaman yang hilang', `${head('C', 'Yang dihapus atau digabung karena hanya OMP', 'ui/src/pages, ui/src/adapters')}
<table><thead><tr><th style="width:80mm">Bagian</th><th style="width:62mm">Ukuran</th><th>Perlakuan</th></tr></thead><tbody>${GONE.map((r) => `<tr><td>${r[0]}</td><td class="mute">${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table>
<div class="half" style="margin-top:5mm;gap:8mm"><div class="notes"><h3>Halaman agent yang berubah</h3><p>Tab baru "OMP config" menggantikan form adapter. Tab Runs, Instructions, Skills, Budget tetap. Kolom tabel Agents menambah Overrides (jumlah kunci yang diubah agent itu).</p></div><div class="notes"><h3>Halaman yang tidak berubah isinya</h3><p>Task detail, Approvals, Costs, Routines, Connectors, Local Browser, Chat: hanya gaya baru (token Ledger) dan posisi di navigasi. Fungsi dan API tetap, jadi risiko regresi terbatas pada tampilan.</p></div></div>`);

page('Onboarding alur', `${head('D', 'Onboarding: OMP wajib, dicek langsung', 'pengganti OnboardingWizard (3.295 baris) dan OmpSetupCard (391 baris)')}
<div class="flow">${[['1 · Install OMP', 'Deteksi omp di PATH tiap 2 detik; omp --version ≥ 18.1.16; omp models ≥ 1. Continue mati sampai tiga cek lulus.'], ['2 · Connect a model', 'Sign in atau API key di dalam Wardmote; atau impor ~/.omp/agent. Pilih model default Global.'], ['3 · First agent', 'Nama, peran, folder kerja. Config mewarisi Global; override opsional.'], ['4 · Done', 'Run pertama mulai; arahkan ke Home dan Inbox.']].map((s, i) => `<div class="st"><b>${s[0]}</b>${s[1]}</div>${i < 3 ? '<span class="ar">→</span>' : ''}`).join('')}</div>
<div class="half" style="margin-top:5mm;gap:8mm">
<div class="notes"><h3>Keadaan yang digambar</h3><table><tbody><tr><td>Belum terpasang</td><td>perintah per OS, cek berjalan</td><td class="n">D1</td></tr><tr><td>Versi terlalu lama</td><td>dua omp di PATH, mana yang menang</td><td class="n">D2</td></tr><tr><td>Offline</td><td>pasang dari file, tunjuk path</td><td class="n">D2</td></tr><tr><td>Target remote (SSH)</td><td>cek yang sama di mesin target</td><td class="n">D3</td></tr><tr><td>Belum ada provider</td><td>omp models kosong, sign in</td><td class="n">D3</td></tr><tr><td>Agent pertama, selesai</td><td>warisan Global ditampilkan</td><td class="n">D4</td></tr><tr><td>Ponsel</td><td>salin perintah untuk komputer lain</td><td class="n">D4</td></tr></tbody></table></div>
<div class="notes"><h3>Versi minimum dari kode, bukan pilihan bebas</h3><p><code>OMP_CONTEXT_MANAGEMENT_MIN_VERSION = "18.1.16"</code> di <code>settings-overlay.ts:17</code>: overlay per run menulis <code>compaction.experimentalContextManagement</code>, yang diabaikan OMP lebih lama. Cek versi memakai <code>ompVersionAtLeast</code> yang sudah ada. Deteksi memakai probe yang sudah ada (<code>omp_command_unresolvable</code>, <code>omp_version_ok</code> di <code>omp-local/src/server/test.ts</code>), jadi gerbang hanya mengubah perilaku tombol, bukan cara deteksi.</p><h3>Perintah pasang</h3><p>Sama dengan OmpSetupCard sekarang (README oh-my-pi): <code>curl -fsSL https://omp.sh/install | sh</code> untuk macOS dan Linux, <code>irm https://omp.sh/install.ps1 | iex</code> untuk Windows, <code>bun install -g @oh-my-pi/pi-coding-agent</code> untuk semua OS.</p></div></div>`);

pair('D1', 'Install OMP', 'belum terpasang · cek berjalan', 'ob-install', 'Continue mati sampai omp --version lulus. Panel kanan menjelaskan kenapa OMP wajib dengan tiga alasan.', '', `<div><h3>Cek langsung</h3><p>Server menjalankan probe tiap 2 detik selama layar terbuka, berhenti saat lulus atau saat tab disembunyikan. Tidak ada tombol "saya sudah pasang".</p></div><div><h3>Tanpa jalan pintas</h3><p>Tidak ada "Skip". Satu-satunya jalan lain adalah "Use a remote machine", yang menjalankan cek yang sama lewat SSH.</p></div><div><h3>Path manual</h3><p>Untuk omp di lokasi tak standar: path disimpan sebagai <code>command</code> di config Global dan dipakai semua agent.</p></div>`);
page('Onboarding gagal', `${head('D2', 'Versi terlalu lama dan offline', 'terang dan gelap')}
<div class="quad">${fig(S('ob-old-light'), '<b>Versi lama, terang.</b> Menunjukkan dua omp di PATH dan mana yang menang, penyebab paling sering versi "tidak berubah" setelah update.')}${fig(S('ob-old-dark'), '<b>Versi lama, gelap.</b>')}${fig(S('ob-offline-light'), '<b>Offline, terang.</b> Pasang dari arsip rilis lalu tunjuk path; agent dengan model lokal tetap jalan offline.')}${fig(S('ob-offline-dark'), '<b>Offline, gelap.</b>')}</div>`);
page('Onboarding remote', `${head('D3', 'Target remote dan koneksi model', 'terang dan gelap')}
<div class="quad">${fig(S('ob-remote-light'), '<b>Remote, terang.</b> Cek yang sama di mesin target lewat SSH; overlay ditulis ke target per run seperti sekarang (<code>writeOmpSettingsOverlay</code>, cabang remote).')}${fig(S('ob-remote-dark'), '<b>Remote, gelap.</b>')}${fig(S('ob-model-light'), '<b>Connect a model, terang.</b> Impor dari ~/.omp/agent (diukur di mesin ini: 135 kunci di config.yml, 17 provider, 535 model di models.yml).')}${fig(S('ob-model-dark'), '<b>Connect a model, gelap.</b>')}</div>`);
page('Onboarding selesai', `${head('D4', 'Agent pertama, selesai, ponsel', 'terang dan gelap')}
<div class="tall" style="display:grid;grid-template-columns:1fr 1fr 44mm;gap:5mm">
<div style="display:flex;flex-direction:column;gap:3mm">${fig(S('ob-agent-light'), '<b>First agent, terang.</b> Semua nilai bersumber Global.')}${fig(S('ob-done-light'), '<b>Done, terang.</b>')}</div>
<div style="display:flex;flex-direction:column;gap:3mm">${fig(S('ob-agent-dark'), '<b>First agent, gelap.</b>')}${fig(S('ob-done-dark'), '<b>Done, gelap.</b>')}</div>
<div style="display:flex;flex-direction:column;gap:3mm">${fig(S('phone-ob-light'), '<b>Ponsel.</b> Salin perintah untuk komputer yang menjalankan agent.')}${fig(S('phone-ob-dark'), '')}</div></div>`);

page('Docker dan headless', `${head('D', 'Docker dan headless: keputusan terbuka', 'Dockerfile @ ' + SHA)}
<div class="half" style="gap:10mm">
<div class="notes"><h3>Fakta dari Dockerfile</h3><p>Baris 178 memasang lima CLI agent secara global: <code>@anthropic-ai/claude-code</code>, <code>@openai/codex</code>, <code>opencode-ai</code>, <code>@google/gemini-cli</code>, <code>@moonshot-ai/kimi-code</code>. OMP tidak dipasang di image. Artinya image Docker sekarang tidak bisa menjalankan agent omp_local tanpa langkah manual.</p><p>Di image, tidak ada orang yang bisa menjalankan perintah pasang di layar onboarding, jadi gerbang D1 tidak masuk akal di sana.</p></div>
<div class="notes"><h3>Rekomendasi</h3><div class="box acc"><p style="margin:0"><b>Image membundel OMP dengan versi dipin</b> (ganti lima CLI di baris 178 dengan <code>@oh-my-pi/pi-coding-agent@&lt;versi&gt;</code>), dan gerbang onboarding hanya di jalur lokal/desktop. Di Docker, onboarding mulai dari langkah 2 karena langkah 1 sudah pasti lulus; cek versi tetap jalan saat server mulai dan menolak start bila di bawah minimum.</p></div><p class="cap">[INFERENCE] Ukuran image turun karena lima CLI diganti satu; belum diukur karena build image adalah langkah berat yang hanya boleh di CI. Diukur di task implementasi dengan <code>docker image ls</code> sebelum dan sesudah.</p></div></div>`);

page('Config tiga lapis', `${head('E', 'Pusat config OMP: tiga lapis', 'settings-overlay.ts · execute.ts:369-370 · config.ts:146')}
<div class="half" style="gap:9mm">
<div class="notes">
<div class="flow" style="flex-direction:column;gap:1.6mm">${[['OMP default', 'nilai bawaan OMP 18.17.0, lencana abu-abu'], ['~/.omp/agent/config.yml dan .omp proyek', 'dibaca OMP sendiri; bisa diimpor ke Global'], ['Global (instance)', 'disimpan Wardmote, ditulis ke overlay tiap run, lencana biru'], ['Override per agent', 'hanya kunci yang diubah, lencana indigo']].map((r, i) => `<div class="st" style="display:flex;gap:3mm;align-items:center"><span class="mono" style="width:6mm">${i + 1}</span><span><b>${r[0]}</b>${r[1]}</span></div>`).join('')}</div>
<p class="cap" style="margin-top:2mm">Urutan dari lemah ke kuat. Tampilan "Effective" menunjukkan hasil akhir per kunci dengan lencana sumbernya.</p>
<h3>Bukti urutan prioritas (dijalankan ${DATE}, OMP 18.17.0)</h3>
<div class="pre">config.yml global          lsp.enabled = true
.omp/config.yml proyek      lsp.enabled = false   → get: false
proyek + PI_CONFIG_FILES=ov(true)                 → get: true
PI_CONFIG_FILES=ov(false):ov(true)                → get: true
PI_CONFIG_FILES=ov(true):ov(false)                → get: false
prewalk.enabled  global false, overlay true       → get: true</div>
<p class="cap">Overlay mengalahkan config.yml dan .omp proyek; di antara overlay, file terakhir menang. Jadi Global ditulis lebih dulu, Override sesudahnya.</p>
</div>
<div class="notes">
<h3>Bagaimana sampai ke OMP hari ini</h3><p>Tiap run menulis overlay YAML sekali pakai (mode 600) dan memberikannya sebagai <code>--config</code> (<code>execute.ts:369</code>), lalu <code>configFiles</code> agent sebagai <code>--config</code> berikutnya (baris 370). Overlay sekarang hanya berisi 8 kunci (advisor, prewalk, lsp, skills, task.maxRecursionDepth, compaction, omitThinking, retry.fallbackChains).</p>
<h3>Yang berubah</h3><p>Overlay jadi dua file: <code>global.yml</code> lalu <code>agent.yml</code>, isinya semua kunci yang di-set di Wardmote, bukan 8 kunci tetap. Kunci yang tidak di-set tidak ditulis, jadi config.yml pengguna tetap berlaku di bawahnya.</p>
<div class="box warn"><b style="font-weight:600">[INFERENCE]</b> <code>omp config get</code> tidak membaca flag <code>--config</code> (diukur: <code>omp --config ov(false) config get lsp.enabled</code> menjawab true), jadi bukti di kiri memakai <code>PI_CONFIG_FILES</code>. Bahwa <code>--config</code> saat run berlapis dengan urutan yang sama belum dibuktikan dengan run sungguhan; task implementasi membuktikannya dengan satu run yang mencetak setting efektif.</div>
<h3>Seksi internal disembunyikan</h3><p>${E.hiddenInternal} dari ${om.settingsTotal} setting ada di seksi <code>internal</code> dan tidak ditampilkan. Sisa ${E.visibleOmp} setting OMP plus ${E.essentialAdapter} kunci adapter di Essential = ${E.searchable} yang bisa dicari.</p>
</div></div>`);

pair('E1', 'Global defaults', 'OMP config › Global defaults', 'cfg-global', `Kelompok Essential (${E.essentialCount} kunci). Kolom "Overridden by" menghitung agent yang meng-override kunci itu; kolom Session memberi tahu efeknya sebelum Save.`, '', `<div><h3>Essential dan Advanced</h3><p>Essential ${E.essentialCount} kunci: ${E.essentialOmp} setting OMP dan ${E.essentialAdapter} kunci adapter (model, fallback, tools, skills, MCP, run). Advanced ${E.advancedOmp} setting dibangkitkan dari skema <code>omp config list</code>: tipe boolean, number, enum, string, array, record sudah tersedia di keluaran.</p></div><div><h3>Validasi</h3><p>Dari skema: enum hanya nilai yang tercantum, number dengan batas, array dan record sebagai editor terstruktur. Nilai tidak valid tidak bisa disimpan (lihat E3).</p></div><div><h3>Impor</h3><p>"Import config.yml" membaca ~/.omp/agent/config.yml dan models.yml di mesin target, menampilkan diff, lalu menulis ke Global. Rahasia diimpor tersamar.</p></div>`);

pair('E2', 'Override per agent', 'OMP config › Per agent › Raka', 'cfg-agent', 'Tampilan Effective: tiap kunci menunjukkan nilai Global, nilai akhir untuk agent, sumber, dan efek ke sesi. Baris override diberi latar aksen dan tombol reset ke Global.', '', `<div><h3>Hanya kunci yang diubah</h3><p>Override menyimpan kunci yang berbeda dari Global saja. "Reset all to Global" menghapus semua override agent; reset per baris menghapus satu.</p></div><div><h3>Overrides only</h3><p>Tampilan kedua hanya menampilkan baris override, untuk audit cepat; jumlahnya juga tampil di kolom Overrides di tabel Agents.</p></div><div><h3>Model per run tetap ada</h3><p>Override model per issue (<code>issueOverrides.adapterConfig</code>) tetap lapis paling atas untuk satu run; tidak tampil di sini karena bukan config agent.</p></div>`);

page('Cari dan simpan', `${head('E3', 'Pencarian semua setting dan konfirmasi simpan', 'galat validasi · diff · terapkan massal · label sesi')}
<div class="quad">${fig(S('cfg-search-light'), `<b>Cari, terang.</b> Mencari nama, kunci, atau nilai di ${E.searchable} setting; seksi tampil sebagai chip. Galat validasi di baris, dari skema.`)}${fig(S('cfg-search-dark'), '<b>Cari, gelap.</b>')}${fig(S('cfg-save-light'), '<b>Simpan, terang.</b> Diff per kunci dengan sumber lama dan baru, label sesi baru, dan terapkan ke banyak agent sekaligus.')}${fig(S('cfg-save-dark'), '<b>Simpan, gelap.</b>')}</div>`);

const MSK = ['model', 'fallbackModels', 'modelEfforts', 'thinking', 'thinkingEffort', 'effort'];
page('Aturan sesi', `${head('E', 'Label "memulai sesi baru atau tidak", dari kode', 'run-state.ts:3 · workspaces.ts:2267, 2295, 3521–3560')}
<div class="half" style="gap:9mm">
<div class="notes"><h3>Yang mempertahankan sesi (omp_local)</h3>
<table><thead><tr><th>Kunci atau kategori</th><th>Sumber di kode</th></tr></thead><tbody>
<tr><td>${MSK.map((k) => `<code>${k}</code>`).join(' ')}</td><td class="mute"><code>MODEL_SWITCH_ADAPTER_CONFIG_KEYS</code>; dibuang dari sidik jari karena <code>MODEL_SWITCHING_RESUME_ADAPTER_TYPES</code> berisi omp_local</td></tr>
<tr><td><code>instructionsFilePath</code>, <code>instructionsBundleMode</code>, <code>instructionsRootPath</code>, <code>instructionsEntryFile</code>, <code>promptTemplate</code>, <code>bootstrapPromptTemplate</code></td><td class="mute"><code>RESUME_NEUTRAL_ADAPTER_CONFIG_KEYS</code></td></tr>
<tr><td>Instruksi dan skill perusahaan (kategori <code>instructions</code>, <code>runtimeSkills</code>)</td><td class="mute"><code>RESUME_NEUTRAL_SESSION_CONFIG_CATEGORIES</code>; omp_local ada di <code>PROMPT_REAPPLIED_ON_RESUME_ADAPTER_TYPES</code></td></tr>
<tr><td>Jadwal heartbeat</td><td class="mute"><code>SCHEDULING_AGENT_RUNTIME_CONFIG_KEYS</code></td></tr>
</tbody></table>
<p class="cap">Semua kunci adapter lain, termasuk <code>tools</code>, <code>skills</code> (daftar --skills OMP), <code>env</code>, <code>prewalk</code>, <code>advisor</code>, mengubah sidik jari kategori <code>adapterConfig</code> dan sesi berikutnya mulai baru. Alasan reset per kunci sudah dicatat di run (<code>describeChangedAdapterConfigKeys</code>), jadi tab History bisa menampilkannya.</p></div>
<div class="notes"><h3>Yang harus dikerjakan agar label benar</h3><p>Setting Global saat ini tidak ada di <code>adapterConfig</code>, jadi sidik jari sesi tidak melihatnya. Agar label "new session" jujur, isi overlay Global harus ikut masuk sidik jari (kategori <code>adapterConfig</code> atau kategori baru), dan pengecualian di kiri berlaku sama untuk kunci Global.</p>
<div class="box warn"><b style="font-weight:600">[INFERENCE]</b> Mengubah satu kunci Global yang tidak session-neutral akan memulai sesi baru di semua agent yang mewarisinya (21 agent di company Zhafron). Karena itu dialog simpan menampilkan jumlah agent terdampak. Rasio resume dan fresh sebelum dan sesudah diukur dari run log di task implementasi.</div>
<h3>Reset yang memang disengaja</h3><p>Lepas dari config: wake <code>issue_assigned</code>, <code>execution_approval_requested</code>, pemulihan reviewer, dan heartbeat tanpa task selalu mulai baru (<code>shouldResetTaskSessionForWake</code>, run-state.ts:789). Ini tidak diubah.</p></div></div>`);

page('Provider dan model', `${head('E4', 'Provider dan model kustom', 'CRUD · rahasia tersamar · ambil daftar dari /v1/models')}
<div class="half">${fig(S('cfg-providers-light'), '<b>Terang.</b> Provider bawaan dan kustom (OpenAI-compatible). Kunci API hanya bisa diganti, tidak pernah ditampilkan.')}${fig(S('cfg-providers-dark'), '<b>Gelap.</b> "Used by" menunjukkan agent yang memakai model, sebelum model dihapus.')}</div>
<div class="notes" style="margin-top:3mm;display:grid;grid-template-columns:repeat(3,1fr);gap:6mm"><div><h3>Bentuk data yang sudah ada</h3><p>models.yml di mesin ini: 17 provider, 535 model; tiap provider punya <code>api</code>, <code>apiKey</code>, <code>auth</code>, <code>baseUrl</code>, <code>models</code>. Layar ini memetakan field itu satu lawan satu.</p></div><div><h3>Rahasia</h3><p>Kunci ditulis ke penyimpanan kredensial OMP di target dan ke secrets Wardmote yang sudah ada; respons API tidak pernah membawa nilainya, hanya 4 karakter terakhir.</p></div><div><h3>Lensa keamanan berlaku</h3><p>Fitur ini menyentuh rahasia dan akses tool. Task implementasi wajib menyapu semua titik masuk (API, impor, ekspor, log run, transkrip) dan dibuktikan dengan uji negatif.</p></div></div>`);

const essRows = E.essential;
const GN = { model: 'Model', tools: 'Tools, skills, MCP', context: 'Konteks', run: 'Run dan instruksi' };
page('Daftar Essential', `${head('E', `Kelompok Essential: ${E.essentialCount} kunci`, 'src/essential.py · measurements/essential.json · diperiksa ke omp config list')}
<div class="cols2 dense" style="font-size:7.3pt">
${['model', 'tools', 'context', 'run'].map((g) => `<div style="margin-bottom:3mm"><h3>${GN[g]}</h3><table><tbody>${essRows.filter((r) => r.group === g).map((r) => `<tr><td style="width:38mm">${r.label}</td><td class="k">${r.key}</td><td class="mute" style="width:16mm">${r.source === 'omp' ? r.section : 'adapter'}</td><td style="width:20mm">${r.session === 'keep' ? '<span class="tag ok">sesi tetap</span>' : '<span class="tag warn">sesi baru</span>'}</td></tr>`).join('')}</tbody></table></div>`).join('')}
</div>
<p class="cap" style="max-width:none">Semua ${E.essentialOmp} kunci OMP terbukti ada di <code>omp config list</code> di luar seksi internal; semua ${E.essentialAdapter} kunci adapter terbukti dibaca <code>omp-local/src/server</code>. ${E.adapterKeysNotInEssential.length} kunci adapter lain (mis. <code>noPty</code>, <code>graceSec</code>, <code>rpcSteering</code>) masuk Advanced. Rekomendasi Wira "30 sampai 40" terpenuhi: ${E.essentialCount}.</p>`);

pair('F1', 'Home', 'Dashboard 1440×900', 'dashboard', 'Tiga pertanyaan operator: apa yang terjadi (Running now), apakah butuh saya (Needs you), berapa biayanya (KPI).');
pair('F2', 'Inbox', 'Inbox › Needs me', 'inbox', 'Satu kotak untuk keputusan, approval, dan pertanyaan. Detail di kanan; A/D/J/K tanpa mouse.');
pair('F3', 'Approvals', 'Inbox › Approvals', 'approvals', 'Hire menampilkan config OMP yang akan dipakai dan override-nya. Resume guard menampilkan bukti.');
pair('F4', 'Tasks', 'Tasks › Active', 'tasks', 'Baris 36 px, 20 baris per layar. ID mono, status satu kosakata.');
pair('F5', 'Task detail', 'Tasks › ZHA-5100', 'task', 'Percakapan, tool call, dan status run langsung dalam satu kolom; properti dan run sekarang di panel kanan.');
pair('F6', 'Agents', 'Agents', 'agents', 'Kolom Overrides menghitung kunci yang diubah per agent. Tidak ada kolom adapter: semua OMP.');
pair('F7', 'Agent detail', 'Agents › Raka › Runs', 'agent', 'Run dengan alasan wake dan resumed/fresh; transkrip langsung di kanan.');
pair('F8', 'Org chart', 'Org chart', 'org', 'Status tiap agent di simpul. Garis lapor sederhana, tanpa dekorasi.');
pair('F9', 'Routines', 'Routines', 'routines', 'Jadwal, agent, hasil terakhir, berikutnya, saklar.');
pair('F10', 'Costs', 'Costs › 30 days', 'costs', 'KPI biaya, token, run, dan fallback; per model dan per agent.');
pair('F11', 'Connectors', 'Connectors', 'connectors', 'Satu daftar untuk koneksi; yang butuh perhatian diberi lencana.');
pair('F12', 'Local Browser', 'Connectors › Local Browser', 'browser', 'Browser terpasang, izin, dan agent yang boleh memakai sesi Anda.');
pair('F13', 'Chat', 'Chat › Wira', 'chat', 'Pesan sendiri di kanan (biru aksen), agent di kiri: aturan DESIGN.md tetap.');
pair('F14', 'Settings perusahaan', 'Settings › Company › General', 'settings', 'Company dan Instance dalam satu pohon. Tema default ikut sistem.');
pair('F15', 'Settings instance', 'Settings › Instance › OMP runtime', 'instance', 'Menggantikan Adapters: versi, kebijakan versi, target eksekusi dengan versi OMP masing-masing.');
page('Tablet dan ponsel', `${head('F16', 'Tablet 1024×768 dan ponsel 390×844', 'terang dan gelap')}
<div style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:4mm;align-items:start">
<div style="display:flex;flex-direction:column;gap:3mm">${fig(S('tablet-tasks-light'), '<b>Tablet.</b> Menu jadi rail ikon 60 px; baris dua tingkat.')}${fig(S('tablet-tasks-dark'), '')}</div>
<div>${fig(S('phone-inbox-light'), '<b>Inbox ponsel.</b> Approve dan Decline 36 px di baris.')}</div>
<div>${fig(S('phone-task-dark'), '<b>Task ponsel, gelap.</b> Input 16 px (tanpa zoom Safari).')}</div>
<div>${fig(S('phone-inbox-dark'), '<b>Inbox ponsel, gelap.</b>')}</div></div>`);

page('Keadaan', `${head('G', 'Kosong, memuat, galat', 'Tasks · terang dan gelap')}
<div class="thirds">${['tasks-empty', 'tasks-loading', 'tasks-error'].map((s, i) => `<div style="display:flex;flex-direction:column;gap:2mm">${fig(S(s + '-light'), ['<b>Kosong.</b> Mengatakan langkah pertama, dengan pintasan.', '<b>Memuat.</b> Skeleton dengan tinggi baris final; tanpa spinner sebelum 300 ms.', '<b>Galat.</b> Apa yang terjadi, bahwa data aman, dan apa yang bisa dilakukan; koneksi putus jadi toast.'][i])}${fig(S(s + '-dark'), '')}</div>`).join('')}</div>`);

page('Keyboard dan fokus', `${head('G', 'Keyboard, fokus, gerak berkurang', 'WCAG 2.2 AA')}
<div class="split">${fig(S('keyboard-light'), '<b>Lembar pintasan</b> (tekan ?). Baris terfokus memakai ring 2 px warna --focus.')}
<div class="notes"><h3>Fokus</h3><p>Ring 2 px, offset 2 px, warna <code>--focus</code>. Kontras ring terhitung: terang ${d2(C['b-light'].find((r) => r.pair === 'focus ring on surface').ratio)}, gelap ${d2(C['b-dark'].find((r) => r.pair === 'focus ring on surface').ratio)} (batas 3,0). Token sekarang ${d2(C['now-light'].find((r) => r.pair.startsWith('ring')).ratio)} di terang.</p><h3>Urutan tab</h3><p>Menu → topbar → isi → panel kanan. Dialog mengunci fokus; Esc menutup dan fokus kembali ke pemicunya.</p><h3>Target sentuh</h3><p>Desktop minimal 24 px (WCAG 2.5.8); ponsel 36 px untuk aksi utama.</p><h3>Gerak berkurang</h3><p><code>prefers-reduced-motion</code> mengubah ketiga token durasi jadi 0 ms di satu tempat (tokens.css); tidak ada animasi yang menyampaikan informasi sendirian.</p><h3>Warna bukan satu-satunya sinyal</h3><p>Setiap status punya teks ("Running", "Failed"), bukan hanya titik warna.</p></div></div>`);

page('Bahasa dan RTL', `${head('G', 'i18n dan kanan-ke-kiri', 'ui/src/i18n · ' + M.ui.locales.length + ' locale')}
<div class="split">${fig(S('i18n-light'), '<b>Pengaturan bahasa</b> dengan pratinjau Bahasa Indonesia.')}
<div class="notes"><h3>Temuan terukur</h3><p>${M.ui.locales.length} file locale (${M.ui.locales.slice(0, 12).join(', ')}, ...), tetapi en.json hanya memuat ${nm.enStrings} string (layar "Create your first organization"). Sisa UI ditulis langsung dalam bahasa Inggris di komponen. Menerjemahkan dulu tidak berguna; ekstraksi string adalah langkah pertama.</p><h3>Rekomendasi</h3><p>Ekstraksi string dilakukan bersama penggantian gaya per layar (task yang sama menyentuh file yang sama), mulai dari onboarding dan pusat config. Bahasa Indonesia jadi locale kedua yang lengkap.</p><h3>RTL</h3><p>Komponen baru wajib memakai properti logis (<code>margin-inline</code>, <code>border-inline-start</code>), jadi ar, fa, he, ur cukup <code>dir="rtl"</code>. Menu pindah ke kanan otomatis.</p><figure style="margin-top:2mm"><img class="shot" src="${S('rtl-light')}" alt=""><figcaption class="cap"><b>dir=rtl.</b> Struktur yang sama; label masih Inggris karena belum diekstrak.</figcaption></figure></div></div>`);
const LAYERS = [
  ['Nama tampil di UI', `${n(nm.displayNameUiFiles)} file, ${n(nm.displayNameUiLines)} baris (\\bPaperclip\\b di ui/src, tanpa test)`, '1', 'teks; aman'],
  ['Paket npm', `${nm.packagesScoped} package.json, ${nm.publishable} dipublikasikan; scope dirujuk di ${n(nm.filesWithScope)} file`, '1', 'nama baru <code>wardmote</code> dan <code>@wardmote/*</code>; paket lama diberi deprecate yang menunjuk ke baru'],
  ['Bin CLI', `<code>paperclip-pro</code>; dipanggil di ${nm.binInvocationFiles} file`, '1', '<code>wardmote</code>; shim <code>paperclip-pro</code> satu rilis'],
  ['Folder home', `<code>~/.paperclip-pro</code> di ${nm.homeDirFiles} file`, '1', 'pindah otomatis ke <code>~/.wardmote</code> dengan symlink balik; DB tertanam ikut pindah'],
  ['Nama service', `<code>paperclip-pro.service</code> di ${nm.serviceFiles} file`, '1', 'unit baru, unit lama dinonaktifkan oleh perintah install'],
  ['Skill', `${nm.skillsPrefixed.length} dari ${nm.skills.length} folder skills/ berawalan paperclip`, '1', 'rename folder; agent membaca dari sync, bukan nama tetap'],
  ['Variabel lingkungan', `${n(nm.envTokensDistinct)} token PAPERCLIP_* berbeda, ${n(nm.envOccurrences)} kemunculan, ${n(nm.envFiles)} file`, '2', 'baca WARDMOTE_* lalu PAPERCLIP_* (alias satu rilis)'],
  ['Nama tool MCP', `${n(nm.mcpTools)} tool, semua berawalan paperclip; identitas paperclipX di ${n(nm.mcpToolNameFiles)} file`, '2', 'tool wardmoteX; nama lama didaftarkan sebagai alias satu rilis karena 21 agent aktif memakainya'],
];
page('Dampak rename', `${head('H', 'Ukuran rename per lapis', `HEAD ${SHA} · measurements/measure.json`)}
<table><thead><tr><th style="width:34mm">Lapis</th><th style="width:100mm">Ukuran terukur</th><th class="n" style="width:12mm">Tahap</th><th>Cara</th></tr></thead><tbody>${LAYERS.map((r) => `<tr><td><b style="font-weight:600">${r[0]}</b></td><td>${r[1]}</td><td class="n">${r[2]}</td><td class="mute">${r[3]}</td></tr>`).join('')}</tbody></table>
<div class="half" style="margin-top:4mm;gap:8mm"><div class="notes"><h3>Total</h3><p>"paperclip" (tanpa beda huruf) ada di ${n(nm.filesWithPaperclip)} dari ${n(M.trackedFiles)} file terlacak (${pct(nm.filesWithPaperclip, M.trackedFiles)}), ${n(nm.linesWithPaperclip)} baris. Repo sudah punya mesin rename yang teruji: <code>scripts/fork/rename-to-paperclip-pro.mjs</code> (345 baris, dengan daftar yang dilindungi: org GitHub upstream, namespace skill dan plugin). Rename ke Wardmote adalah aturan baru di skrip itu, bukan sed manual.</p></div>
<div class="notes"><h3>Yang tidak di-rename</h3><p>Pemberitahuan hak cipta di LICENSE: "${nm.licenseCopyright[0]}" dan "${nm.licenseCopyright[1]}" tetap utuh (MIT mewajibkannya). Rujukan ke repo upstream <code>paperclipai/paperclip</code> dan namespace yang dilindungi skrip tetap. Riwayat git tidak ditulis ulang.</p></div></div>`);

page('Hapus adapter', `${head('H', 'Menghapus 12 adapter selain omp-local', 'packages/adapters · ui/src/adapters · server/package.json')}
<div class="split" style="grid-template-columns:1fr 84mm">
<table><thead><tr><th>Folder</th><th class="n">File</th><th class="n">Baris</th><th>Tipe</th><th class="n">File merujuk</th></tr></thead><tbody>
${removed.map((f) => { const t = { 'claude-local': 'claude_local', 'codex-local': 'codex_local', 'cursor-cloud': 'cursor_cloud', 'cursor-local': 'cursor', 'gemini-local': 'gemini_local', 'grok-local': 'grok_local', hermes: 'hermes_local', 'hermes-gateway': 'hermes_gateway', 'kimi-local': 'kimi_local', 'openclaw-gateway': 'openclaw_gateway', 'opencode-local': 'opencode_local', 'pi-local': 'pi_local' }[f]; return `<tr><td class="k">${f}</td><td class="n">${ad.perFolder[f].files}</td><td class="n">${n(ad.perFolder[f].loc)}</td><td class="k">${t}</td><td class="n">${ad.refsByWord[t]}</td></tr>`; }).join('')}
<tr class="hl"><td><b>Total 12</b></td><td class="n">${removedFiles}</td><td class="n">${n(removedLoc)}</td><td></td><td></td></tr>
<tr><td class="k">omp-local (tetap)</td><td class="n">${ad.perFolder['omp-local'].files}</td><td class="n">${n(ad.perFolder['omp-local'].loc)}</td><td class="k">omp_local</td><td class="n">${ad.refsByWord.omp_local}</td></tr>
</tbody></table>
<div class="notes"><h3>Di luar folder adapter</h3><ul><li>UI: ${uiAdapterFiles} file di ui/src/adapters (${n(8757)} baris); ${uiAdapterFiles - ad.uiAdapterFiles['omp-local']} dihapus, ${ad.configFieldsFiles.length} di antaranya config-fields.</li><li>Server: 11 dependensi adapter di server/package.json; registry di server/src/adapters.</li><li>Dockerfile baris 178: lima CLI agent global.</li><li>Rujukan per kata di tabel saling tumpang tindih (satu file bisa merujuk banyak tipe), jadi tidak dijumlahkan.</li></ul>
<h3>Tipe generik, keputusan sendiri</h3><table><tbody><tr><td class="k">process</td><td class="n">${ad.refsByWord.process}</td><td>jalankan perintah bebas</td></tr><tr><td class="k">http</td><td class="n">${ad.refsByWord.http}</td><td>webhook ke agen luar</td></tr><tr><td class="k">paperclip_runner</td><td class="n">${ad.refsByWord.paperclip_runner}</td><td>runner native (Rust); package terpisah</td></tr></tbody></table><p class="cap">Rekomendasi I-4: hapus process dan http dari UI tetapi pertahankan di server satu rilis; paperclip_runner dibekukan, bukan dihapus, karena juga punya driver yang dipakai di jalur lain.</p>
<h3>Perkiraan kerja</h3><p>[INFERENCE] 3 PR berurutan: (1) UI dan pemilih adapter, (2) server registry dan dependensi, (3) folder paket dan Dockerfile; tiap PR lewat CI penuh. Agent yang ada tidak tersentuh (21/21 sudah omp_local).</p></div></div>`);

page('Merge upstream', `${head('H', 'Konflik merge upstream: sekarang dan setelah rename', 'src/sim-merge.sh · git merge-tree di worktree sekali pakai di ~/Projects')}
<div class="split" style="grid-template-columns:1fr 92mm">
<div><table><thead><tr><th>Skenario</th><th class="n">File konflik</th><th class="n">vs sekarang</th></tr></thead><tbody>
<tr><td>Fork vs upstream mentah (tanpa rename upstream)</td><td class="n">${n(MG.rawNoRename)}</td><td class="n mute">acuan</td></tr>
<tr class="hl"><td><b>Cara sync sekarang</b>: upstream di-rename dengan skrip fork, lalu merge</td><td class="n">${n(MG.currentMethod)}</td><td class="n">0</td></tr>
<tr><td>Rename tahap 1, aturan skrip diperluas ke Wardmote</td><td class="n">${n(MG.stage1RulesExtended)}</td><td class="n">+${n(MG.stage1RulesExtended - MG.currentMethod)} (${pct(MG.stage1RulesExtended - MG.currentMethod, MG.currentMethod)})</td></tr>
<tr><td>Rename tahap 1, aturan skrip tidak diperluas</td><td class="n">${n(MG.stage1RulesNotExtended)}</td><td class="n">+${n(MG.stage1RulesNotExtended - MG.currentMethod)}</td></tr>
<tr><td>Tahap 1 + hapus 12 adapter</td><td class="n">${n(MG.stage1PlusDropAdapters)}</td><td class="n">+${n(MG.stage1PlusDropAdapters - MG.currentMethod)} (${pct(MG.stage1PlusDropAdapters - MG.currentMethod, MG.currentMethod)})</td></tr>
<tr><td>Tahap 1 + 2 + hapus adapter</td><td class="n">${n(MG.stage2PlusDropAdapters)}</td><td class="n">+${n(MG.stage2PlusDropAdapters - MG.currentMethod)} (${pct(MG.stage2PlusDropAdapters - MG.currentMethod, MG.currentMethod)})</td></tr>
</tbody></table>
<p class="cap" style="max-width:none">Basis fork ${MG.base.slice(0, 9)}, upstream master ${MG.upstream.slice(0, 9)}, merge base ${MG.mergeBase.slice(0, 9)} (sync terakhir 11 Okt). Upstream maju ${n(MG.upstreamAhead)} commit dalam ${MG.upstreamDays} hari, fork ${n(MG.forkAhead)}. Dari konflik skenario "tahap 1 + hapus adapter", ${MG.stage1PlusDropAdaptersInRemovedDirs} ada di folder adapter yang dihapus (ubah/hapus). Simulasi rename memakai sed sederhana untuk tahap 1 dan 2 di kedua sisi; skrip rename sungguhan akan sedikit berbeda.</p></div>
<div class="notes"><h3>Apa artinya</h3><p>Sync penuh berikutnya sudah ${n(MG.currentMethod)} file konflik hari ini, sebelum rename apa pun. Sync terakhir (11 Okt) butuh dokumen keputusan konflik 135 baris. Setelah rename dan hapus adapter, angkanya naik ${pct(MG.stage2PlusDropAdapters - MG.currentMethod, MG.currentMethod)}.</p>
<h3>Isi upstream yang relevan</h3><p>${n(1180)} dari ${n(MG.upstreamAhead)} commit berawalan <code>fix</code>; 22 berawalan <code>fix(security)</code> atau <code>security</code>; 208 menyebut security, CVE, vulnerab, atau GHSA di pesannya (grep kata kunci, belum ditriase).</p>
<div class="box acc"><b style="font-weight:600">Rekomendasi I-2:</b> setelah rename, berhenti merge upstream penuh. Ganti dengan digest mingguan (routine "Upstream security digest" di F9) yang mendaftar commit fix(security)/security dan CVE, lalu cherry-pick yang menyentuh kode yang masih ada. Harga: fitur upstream baru tidak datang otomatis; pilihannya per fitur.</div></div></div>`);

page('Performa', `${head('H', 'Performa dan fitur: sebelum dan sesudah', 'aturan Zhafron: angka sebelum diputuskan')}
<table><thead><tr><th style="width:58mm">Aspek</th><th style="width:62mm">Sekarang</th><th style="width:62mm">Usulan</th><th>Dampak ke pengguna</th></tr></thead><tbody>
<tr><td>Font dimuat</td><td>Inter 344 KB + italic 379 KB</td><td>Inter 344 KB + Plex Mono ${d1(DIRS.b.fontsAddedKB)} KB (subset latin Inter 98 KB opsional)</td><td>+${d1(DIRS.b.fontDeltaKB)} KB bila tanpa subset; −246 KB dengan subset latin. Diukur pyftsubset.</td></tr>
<tr><td>Baris tabel per layar 1440×900</td><td>tidak seragam (tinggi baris per halaman)</td><td>${DIRS.b.rowsAt1440x900} (36 px)</td><td>jumlah informasi per layar setara atau naik</td></tr>
<tr><td>CSS warna</td><td>${n(ub.paletteClassUses)} kelas palet, ${n(ub.darkVariantUses)} dark:</td><td>token peran; dark: hanya untuk pengecualian</td><td>[INFERENCE] CSS hasil build mengecil; diukur dari ukuran bundle di CI saat migrasi</td></tr>
<tr><td>Langkah onboarding</td><td>6 langkah (Step 0–5), OMP opsional</td><td>4 langkah, OMP wajib</td><td>pengguna tanpa OMP tidak bisa lanjut; disengaja, sesuai keputusan Zhafron</td></tr>
<tr><td>Pilihan runtime</td><td>${ad.types.length} tipe adapter</td><td>1 (OMP)</td><td>fitur hilang untuk pengguna yang memakai Claude Code, Codex, dan lainnya langsung; 0 dari 21 agent Zhafron terdampak</td></tr>
<tr><td>Config OMP</td><td>8 kunci di overlay, sisanya di luar produk</td><td>${E.searchable} dapat dicari, global dan per agent</td><td>tidak perlu membuka omp untuk config; sesi baru bila kunci yang tidak session-neutral berubah, dan layar menyebutnya</td></tr>
<tr><td>Ukuran repo</td><td>${n(M.trackedFiles)} file terlacak</td><td>−${removedFiles} file paket adapter, −${uiAdapterFiles - ad.uiAdapterFiles['omp-local']} file UI adapter</td><td>[INFERENCE] waktu CI turun karena suite adapter hilang; diukur dari durasi pipeline sebelum dan sesudah</td></tr>
<tr><td>Merge upstream</td><td>${n(MG.currentMethod)} file konflik per sync penuh</td><td>cherry-pick selektif</td><td>perbaikan keamanan tetap masuk; fitur upstream tidak otomatis</td></tr>
</tbody></table>`);

const DEC = [
  ['I-1', 'Pemeriksaan merek dan domain Wardmote', 'Nama sudah final. Terbuka: .com terdaftar (29 Jul 2026); merek resmi belum dicek.', 'Daftarkan <code>wardmote.dev</code> dan <code>wardmote.app</code> (keduanya belum terdaftar), pakai .dev untuk dokumen dan instalasi; cek WIPO, USPTO, EUIPO, DJKI sebelum rilis publik. Tidak membeli .com sekarang.', 'Saya siapkan task pemeriksaan merek dan daftar domain untuk disetujui; pembelian domain butuh kartu Anda.'],
  ['I-2', 'Berhenti merge upstream penuh', `${n(MG.currentMethod)} konflik hari ini, ${n(MG.stage2PlusDropAdapters)} setelah rename dan hapus adapter.`, 'Ya, setelah rename tahap 1. Cherry-pick perbaikan keamanan lewat digest mingguan.', 'Routine digest mingguan dan catatan di doc/upstream-sync.'],
  ['I-3', 'Rename dua tahap', `Tahap 2 menyentuh ${n(nm.envTokensDistinct)} token env dan ${n(nm.mcpTools)} tool MCP yang dipakai 21 agent aktif.`, 'Ya. Tahap 1: nama tampil, UI, CLI, npm, folder home, service, skill. Tahap 2 satu rilis kemudian dengan alias env dan tool.', 'Perluas rename-to-paperclip-pro.mjs jadi skrip rename Wardmote; uji alias dengan run sungguhan.'],
  ['I-4', 'Tipe generik process, http, paperclip_runner', `${ad.refsByWord.process} / ${ad.refsByWord.http} / ${ad.refsByWord.paperclip_runner} file merujuk.`, 'Hapus process dan http dari UI, pertahankan di server satu rilis; bekukan paperclip_runner.', 'Bagian dari PR hapus adapter.'],
  ['I-5', 'Gerbang onboarding di Docker', 'Image sekarang memasang 5 CLI, tanpa OMP.', 'Gerbang hanya di jalur lokal/desktop; image membundel OMP dengan versi dipin; server menolak start di bawah versi minimum.', 'Ubah Dockerfile baris 178; ukur ukuran image di CI.'],
  ['I-6', 'Pixels Office dan Conference Room', 'Keduanya ada di menu sekarang.', 'Keluarkan dari navigasi utama, tetap bisa dibuka lewat Search dan URL.', 'Perubahan Sidebar saja.'],
  ['I-7', 'Jumlah setting Essential', `${E.essentialCount} kunci terukur (rekomendasi Wira 30–40).`, `Pakai ${E.essentialCount} kunci di halaman E; sisanya ${E.advancedOmp} di Advanced dari skema.`, 'Generator form dari omp config list.'],
  ['I-8', 'Logo', 'Tiga arah digambar dan dirender.', 'Lingkar Moot.', 'Favicon, ikon PWA, lockup menu; cek merek gambar.'],
  ['I-9', 'Font', `B menambah ${d1(DIRS.b.fontDeltaKB)} KB.`, 'Terima, dan pasang subset latin Inter (−246 KB) di task token.', 'Bagian dari task token.'],
];
page('Keputusan terbuka', `${head('I', 'Keputusan terbuka, masing-masing dengan rekomendasi', 'jawab per nomor; diam berarti belum disetujui')}
<div class="cols2" style="font-size:8.2pt">${DEC.slice(0, 6).map((d) => `<div class="dec" style="margin-bottom:3mm"><h3><span class="mono" style="color:#4c47c4">${d[0]}</span>${d[1]}</h3><p class="mute">${d[2]}</p><p class="rec">Rekomendasi: ${d[3]}</p><p>Bila disetujui: ${d[4]}</p></div>`).join('')}</div>`);
page('Keputusan terbuka 2', `${head('I', 'Keputusan terbuka (lanjutan) dan urutan kerja', '')}
<div class="cols2" style="font-size:8.2pt">${DEC.slice(6).map((d) => `<div class="dec" style="margin-bottom:3mm"><h3><span class="mono" style="color:#4c47c4">${d[0]}</span>${d[1]}</h3><p class="mute">${d[2]}</p><p class="rec">Rekomendasi: ${d[3]}</p><p>Bila disetujui: ${d[4]}</p></div>`).join('')}
<div class="dec"><h3>Urutan kerja bila semua disetujui</h3><ol style="margin:0;padding-left:4mm;font-size:8.2pt"><li>Token Ledger + komponen dasar + subset font (tanpa ubah fungsi).</li><li>Onboarding OMP wajib (lokal) + Dockerfile.</li><li>Pusat config OMP: overlay dua file, sidik jari sesi, layar Global/Per agent/Providers.</li><li>Hapus 12 adapter (3 PR).</li><li>Rename tahap 1, rilis.</li><li>Rename tahap 2 dengan alias, satu rilis kemudian.</li></ol><p class="cap">Setiap langkah: PR draft, CI hijau di SHA persis, review Hendra untuk yang menyentuh auth, rahasia, atau kontrak.</p></div></div>`);

page('Sumber', `${head('·', 'Sumber dan cara render ulang', 'docs/design/rebrand-v1/')}
<div class="half" style="gap:10mm"><div class="notes"><table><tbody>
<tr><td class="k">src/measure.py</td><td>semua angka repo, UI, adapter, OMP → measurements/measure.json</td></tr>
<tr><td class="k">src/sim-merge.sh</td><td>simulasi merge upstream di worktree sekali pakai di ~/Projects → measurements/merge.json</td></tr>
<tr><td class="k">src/tokens.css</td><td>token Ledger terang/gelap (sumber halaman A)</td></tr>
<tr><td class="k">src/directions.css</td><td>token arah Jati dan Signal</td></tr>
<tr><td class="k">src/contrast.py</td><td>kontras semua pasangan; keluar non-nol bila Ledger gagal</td></tr>
<tr><td class="k">src/directions.py</td><td>perbandingan tiga arah → measurements/directions.json</td></tr>
<tr><td class="k">src/essential.py</td><td>daftar Essential diperiksa ke skema OMP</td></tr>
<tr><td class="k">src/screen.html + screens-*.js + app.css</td><td>semua layar; <code>?screen=tasks&amp;theme=dark&amp;dir=a</code></td></tr>
<tr><td class="k">src/render.sh</td><td>Chrome headless → shots/*.jpg</td></tr>
<tr><td class="k">logo/build.py, logo/legibility.py</td><td>SVG logo dari skrip; render 16–128 px dan hitung komponen</td></tr>
<tr><td class="k">src/gen-doc.mjs, doc.css, build-pdf.sh</td><td>dokumen ini</td></tr>
<tr><td class="k">src/fonts/</td><td>IBM Plex (OFL 1.1, lisensi di OFL-IBM-Plex.txt); Inter dipakai dari ui/public/fonts (OFL 1.1, NOTICE.md)</td></tr>
</tbody></table></div>
<div class="notes"><h3>Render ulang</h3><div class="pre">cd docs/design/rebrand-v1/src
python3 measure.py
./sim-merge.sh
python3 contrast.py && python3 directions.py
python3 essential.py
(cd ../logo && python build.py && python3 legibility.py)
./render.sh
node gen-doc.mjs && ./build-pdf.sh</div><p class="cap">logo/build.py butuh fonttools dan uharfbuzz (venv). Semua langkah berat dijalankan dengan nice -n 19, satu per satu.</p>
<h3>Batas dokumen ini</h3><p>Mockup adalah HTML statis, bukan kode produk. Angka diambil di ${SHA}; HEAD akan maju. Tidak ada tangkapan layar produksi. Butir bertanda [INFERENCE] belum diukur dan punya cara ukurnya masing-masing.</p></div></div>`);


const SECS = [['0', 'Ringkasan dan data awal yang diverifikasi ulang'], ['A', 'Bahasa visual: UI sekarang, tiga arah, token, kontras, ikon'], ['B', 'Nama Wardmote dan status ketersediaannya'], ['J', 'Logo baru: tiga arah, ukuran kecil, perbandingan'], ['C', 'Arsitektur informasi'], ['D', 'Onboarding OMP wajib'], ['E', 'Pusat config OMP: global, override, hasil akhir'], ['F', 'Layar inti desktop, tablet, ponsel'], ['G', 'Keadaan dan aksesibilitas'], ['H', 'Dampak implementasi dalam angka'], ['I', 'Keputusan terbuka dengan rekomendasi'], ['\u00b7', 'Sumber dan cara render ulang']];
const range = (k) => { const a = SEC_FIRST[k], b = SEC_LAST[k]; const p = (x) => String(x).padStart(2, '0'); return a === b ? p(a) : `${p(a)}\u2013${p(b)}`; };
const tocHtml = (list) => list.map(([k, t]) => `<span>${k}</span><span>${t}</span><span>${range(k)}</span>`).join('');
pages[0] = pages[0].replace('@@TOC1@@', tocHtml(SECS.slice(0, 6))).replace('@@TOC2@@', tocHtml(SECS.slice(6)));

const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Wardmote rebrand v1</title>
<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="doc.css"></head><body>
${pages.join('\n')}
</body></html>
`;
writeFileSync(join(here, 'doc.html'), html);
console.log(`doc.html: ${pn} pages`);
