import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const J = (p) => JSON.parse(readFileSync(join(here, p), 'utf8'));
const M = J('../measurements/measure.json');
const C = J('../measurements/contrast.json');
const E = J('../measurements/essential.json');
const B1 = J('../measurements/button-audit-v1.json');
const B2 = J('../measurements/button-audit-v2.json');
const FP = J('../measurements/features-plan.json');
const SIM = J('../measurements/simplify.json');
const CX = J('../measurements/complexity.json');
const OV = J('../measurements/overflow.json');
const PWA = J('../measurements/pwa.json');
const RS = J('../measurements/research.json');
const LEG = J('../logo/legibility.json');

const n = (x) => Number(x).toLocaleString('id-ID');
const d2 = (x) => Number(x).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = '7 November 2026';
const V1SHA = 'de7990a62';
const BASE = M.commit.slice(0, 9);
const S = (s, t, sz) => `../shots/${s}-${t}-${sz}.jpg`;
const pages = [];
let pn = 0;
const SEC_FIRST = {};
const SEC_LAST = {};
const run = (num, t) => `<div class="run"><span>Wardmote · rancangan rebrand v2 · internal (memuat tangkapan layar pihak ketiga) · ${t}</span><span>ZHA-5100 · ${num}</span></div>`;
const page = (title, body) => { pn++; pages.push(`<section class="pg">${body}${run(String(pn).padStart(2, '0'), title)}</section>`); };
const head = (sec, title, where = '') => { const k = sec.split(' ')[0]; SEC_FIRST[k] ??= pn + 1; SEC_LAST[k] = pn + 1; return `<div class="head"><span class="sec">${sec}</span><h2>${title}</h2><span class="where">${where}</span></div>`; };
const img = (src, cap = '', cls = 'shot') => `<figure><img class="${cls}" src="${src}" alt="">${cap ? `<figcaption class="cap">${cap}</figcaption>` : ''}</figure>`;
const fit = (src, h, cap = '') => `<figure class="fit" style="height:${h}mm"><img src="${src}" alt="">${cap ? `<figcaption class="cap">${cap}</figcaption>` : ''}</figure>`;

const screenPage = (sec, title, s, notes) => page(title, `${head(sec, title, `${s} · 1440×900, 768×1024, 390×844, terang dan gelap`)}
<div class="sp4"><div class="d">${fit(S(s, 'light', '1440x900'), 74)}${fit(S(s, 'dark', '1440x900'), 74)}</div>
<div class="m">${fit(S(s, 'light', '768x1024'), 76)}${fit(S(s, 'dark', '390x844'), 76)}${fit(S(s, 'light', '390x844'), 76)}<div class="notes">${notes}</div></div></div>`);

const fails1 = {};
for (const r of B1.failing) for (const f of r.fails) { const k = r.kind.replace(/\[.*\]/, (m) => m) + ' / ' + f; fails1[k] = (fails1[k] || 0) + 1; }
const v1Worst = B1.worst[0];
const v2Worst = B2.worst[0];
const ratioC = (k, pair) => (C[k].find((r) => r.pair === pair) || {}).ratio;
const f1 = SIM.flows;
const FT = FP.rows;
const cnt = FP.counts;
const feat = FT.filter((r) => r.dest === 'Features');
const adv = FT.filter((r) => r.dest === 'Advanced');
const other = FT.filter((r) => !['Features', 'Advanced'].includes(r.dest));

page('Sampul', `
<p class="mono mute" style="margin-bottom:8mm">ZHA-5100 · ${DATE} · revisi v2 · kode produk belum diubah · diukur di ${BASE} · v1 di ${V1SHA} tidak ditimpa · INTERNAL</p>
<div style="display:flex;align-items:center;gap:7mm;margin-bottom:6mm"><img src="../logo/moot/mark-light.svg" style="width:24mm;height:24mm" alt=""><div><div style="font:640 38pt/1 Inter;letter-spacing:-0.03em">Wardmote</div><div class="mute" style="font-size:11pt;margin-top:2mm">rancangan v2: lebih sedikit isian, satu menu Features, semua perangkat, PWA</div></div></div>
<h1 style="font-size:21pt;max-width:235mm">Pengguna baru sampai agent pertama bekerja dengan ${f1.a.v2t.decisions} keputusan dan ${f1.a.v2t.fields} isian, bukan ${f1.a.v1t.decisions} dan ${f1.a.v1t.fields}</h1>
<p class="lede">Revisi atas permintaan Zhafron: memperbaiki warna tombol yang salah, mematangkan gaya, mengurangi isian manual (terutama config OMP), mengganti halaman Experimental dengan menu Features dan Advanced, memastikan semua layar bekerja dari 360 sampai 1920 px, dan menambahkan dukungan PWA. Semua angka dihitung skrip di docs/design/rebrand-v2 dan semua layar dirender lalu dilihat sebelum masuk dokumen ini.</p>
<div style="margin-top:auto;display:grid;grid-template-columns:1fr 1fr;gap:10mm"><div class="toc">@@TOC1@@</div><div class="toc">@@TOC2@@</div></div>`);

const chg = [
  ['Tombol terbaca di semua wadah', `${n(B1.summary.failing)} dari ${n(B1.summary.buttons)} tombol gagal; terendah ${d2(v1Worst.minText)}:1 (Approve di ponsel)`, `${n(B2.summary.failing)} dari ${n(B2.summary.buttons)} gagal; terendah ${d2(v2Worst.minText)}:1`, 'Gerbang baru membaca warna hasil render, bukan pasangan token'],
  ['Keputusan dari instalasi sampai agent pertama bekerja', `${f1.a.v1t.decisions} keputusan, ${f1.a.v1t.fields} isian, ${f1.a.v1t.clicks} klik, ${f1.a.v1t.steps} langkah`, `${f1.a.v2t.decisions} keputusan, ${f1.a.v2t.fields} isian, ${f1.a.v2t.clicks} klik, ${f1.a.v2t.steps} langkah`, 'Deteksi otomatis, impor dari OMP, task pertama sebagai satu-satunya isian'],
  ['Kontrol config yang dilihat pengguna biasa', `${E.essentialCount} baris kunci Essential plus ${E.advancedOmp} Advanced`, `${SIM.counts.controls} pilihan bernama mencakup ${SIM.counts.byControls} kunci; ${SIM.counts.elsewhere} di tab lain; ${SIM.counts.advancedOnly} di All settings`, 'Nama kunci tidak muncul di alur biasa'],
  ['Halaman Experimental', '44 saklar dalam satu halaman, 793 baris', `Features ${cnt.Features} saklar dalam 5 kelompok + 3 preset; Advanced ${cnt.Advanced}; ${cnt.Permanent} jadi permanen, ${cnt.Remove} dihapus, ${cnt.Merge} digabung`, 'Kata Experimental hilang dari UI'],
  ['Ukuran layar yang dirender dan diperiksa', '4 ukuran, 82 tangkapan', `${OV.sizes.length} ukuran, ${n(OV.renders)} render, ${OV.overflow} overflow horizontal`, 'Semua layar inti punya versi ponsel dan tablet'],
  ['PWA', 'Manifest bernama Paperclip, warna tema tetap', `Manifest Wardmote, ${PWA.pass}/${PWA.total} cek validator lulus, warna tema ikut terang dan gelap`, 'Ikon Lingkar Moot 16 sampai 512 px'],
  ['Token', `${CX.v1.tokens} token, 14 di antaranya tidak dipakai`, `${CX.v2.tokens} token, semuanya dipakai`, 'Token jarak dan gerak yang menganggur dibuang'],
];
page('Perubahan dari v1', `${head('0', 'Perubahan dari v1', 'angka dari measurements/*.json')}
<table><thead><tr><th style="width:62mm">Ukuran</th><th style="width:70mm">v1 (${V1SHA})</th><th style="width:78mm">v2</th><th>Cara</th></tr></thead><tbody>${chg.map((r) => `<tr><td><b style="font-weight:600">${r[0]}</b></td><td class="mute">${r[1]}</td><td><b style="font-weight:600">${r[2]}</b></td><td class="mute">${r[3]}</td></tr>`).join('')}</tbody></table>
<div class="half" style="margin-top:4mm;gap:8mm"><div class="notes"><h3>Yang tetap dari v1 (sudah diputuskan)</h3><p>Nama Wardmote, logo Lingkar Moot, OMP satu-satunya runtime dengan gerbang versi 18.1.16 di jalur lokal, hapus 12 adapter, rename dua tahap, berhenti merge upstream penuh, Pixels Office dan Conference Room keluar dari navigasi utama, Docker membundel OMP dengan versi dipin. Keputusan I-1 sampai I-9 sudah dijawab Zhafron; I-1: domain tidak didaftarkan.</p></div>
<div class="notes"><h3>Satu hal yang lebih kompleks</h3><p>CSS v2 punya ${CX.v2.cssRules} aturan lawan ${CX.v1.cssRules} di v1 (${n(CX.v2.cssBytes)} lawan ${n(CX.v1.cssBytes)} byte). Tambahan itu adalah aturan responsif untuk 6 ukuran dan keadaan tombol (hover, tekan, fokus, nonaktif, memuat) yang di v1 tidak ada sama sekali. Jumlah token turun ${CX.v1.tokens - CX.v2.tokens} dan aturan wadah yang menimpa warna anak turun dari ${CX.v1.containerOverrides.length} ke ${CX.v2.containerOverrides.length}.</p></div></div>`);

const f1rows = Object.entries(fails1).sort((a, b) => b[1] - a[1]);
page('Cacat tombol', `${head('1', 'Cacat warna tombol: direproduksi, penyebab, perbaikan', 'laporan Zhafron, tangkapan layar phone-inbox v1')}
<div style="display:grid;grid-template-columns:62mm 62mm 1fr;gap:6mm">
<div>${img('../evidence/before-light.jpg', '<b>Sebelum (v1), terang.</b> Label Approve ' + d2(B1.worst.find((r) => r.screen.includes('phone-inbox&theme=light')).minText) + ':1.')}<div style="height:2mm"></div>${img('../evidence/before-dark.jpg', '<b>Sebelum, gelap.</b> ' + d2(B1.worst.find((r) => r.screen.includes('phone-inbox&theme=dark')).minText) + ':1.')}</div>
<div>${img('../evidence/after-light.jpg', '<b>Sesudah (v2), terang.</b>')}<div style="height:2mm"></div>${img('../evidence/after-dark.jpg', '<b>Sesudah, gelap.</b>')}</div>
<div class="notes"><h3>Penyebab (dikonfirmasi dengan render ulang)</h3><p>Dugaan Wira benar. Di v1 tombol berada di dalam <code>span.m</code>. Aturan <code>.li .m span</code> (spesifisitas 0,2,1) menyetel <code>color: var(--ink-3)</code> dan ukuran 12 px, dan mengalahkan <code>.btn.pri</code> (0,2,0). Warna terhitung: teks <code>${v1Worst.texts[0].fg}</code> di atas <code>${v1Worst.texts[0].bg}</code>. contrast.py v1 lulus 46/46 karena hanya membandingkan pasangan token yang dimaksud (accent-ink di atas accent, 6,13:1), bukan warna yang benar-benar dirender.</p>
<h3>Perbaikan di sumber, bukan per tombol</h3><ul><li>Komponen ditulis dalam <code>@layer components</code>, tata letak dalam <code>@layer layout</code>. Aturan tata letak tidak lagi menyentuh warna atau ukuran teks anak.</li><li>Semua selektor bertipe elemen di dalam wadah (<code>.li .m span</code>, <code>.nav a</code>, <code>.crumb b</code>, ...) diganti nama kelas: ${CX.v1.containerOverrides.length} aturan di v1, ${CX.v2.containerOverrides.length} di v2, dan sisanya hanya menata anak komponen itu sendiri (<code>.seg &gt; span</code>, <code>.tabs &gt; span</code>).</li><li>Akar yang sama ditemukan di dua tempat lain dengan audit: angka lencana Inbox (<code>.navitem.on .count</code> menimpa <code>.count.hot</code>, 1,00:1) dan keadaan hover generik yang menimpa tombol hantu dan tautan. Keduanya diperbaiki dengan cara yang sama.</li></ul></div></div>`);

page('Matriks tombol', `${head('1', 'Matriks tombol: varian × keadaan × tema', 'screen=system · dirender di 6 ukuran')}
<div class="half">${img(S('system', 'light', '1440x900'), '<b>Terang.</b> Primary, Secondary, Ghost, Danger, Delete, Link × default, hover, tekan, fokus, nonaktif, memuat; segmented, chip, ikon, saklar, baris keputusan.')}${img(S('system', 'dark', '1440x900'), '<b>Gelap.</b> Nonaktif memakai latar dan tepi sendiri, bukan opacity 0,45, sehingga label tetap 4,5:1.')}</div>
<div class="notes" style="margin-top:3mm;display:grid;grid-template-columns:repeat(4,1fr);gap:5mm"><div><h3>Indigo: lanjutkan</h3><p>Satu aksi utama per area (Approve, Save, Start). Tidak dipakai untuk segmen terpilih; segmen terpilih memakai tinta gelap agar tidak tertukar dengan aksi.</p></div><div><h3>Netral: alternatif aman</h3><p>Decline, Cancel, Discard. Decline sengaja tidak merah: menolak sebuah keputusan tidak merusak apa pun.</p></div><div><h3>Merah teks: hentikan</h3><p>Stop run, Keep halted. Memutus sesuatu yang berjalan, bisa diulang.</p></div><div><h3>Merah penuh: hapus</h3><p>Hanya untuk tindakan yang menghapus data, selalu dengan konfirmasi. Kuning tidak pernah dipakai untuk tombol, hanya untuk keadaan menunggu.</p></div></div>`);

const kinds2 = {};
for (const r of B2.failing) for (const f of r.fails) kinds2[r.kind + ' / ' + f] = (kinds2[r.kind + ' / ' + f] || 0) + 1;
page('Audit tombol', `${head('1', 'Gerbang baru: kontras dari warna hasil render', 'src/audit-probe.js · src/audit-buttons.py · measurements/button-audit-*.json')}
<div class="half" style="gap:8mm"><div class="notes"><h3>Cara kerja</h3><p>Setiap layar dibuka di Chrome headless pada tiap ukuran dan tema. Skrip membaca <code>getComputedStyle</code> untuk setiap tombol, tab, segmen, chip, item navigasi dan saklar; latar efektif dihitung dengan menumpuk semua latar leluhur (termasuk transparansi dan opacity). Ambang: teks 4,5:1 (3:1 untuk teks besar), tepi tombol terhadap sekitarnya 3:1. Keluar non-nol bila ada yang gagal.</p>
<table><thead><tr><th>Ukuran</th><th class="n">v1</th><th class="n">v2</th></tr></thead><tbody><tr><td>Layar × ukuran × tema</td><td class="n">${B1.summary.screens}</td><td class="n">${B2.summary.screens}</td></tr><tr><td>Tombol diaudit</td><td class="n">${n(B1.summary.buttons)}</td><td class="n">${n(B2.summary.buttons)}</td></tr><tr class="hl"><td>Gagal</td><td class="n fail">${n(B1.summary.failing)}</td><td class="n ${B2.summary.failing ? 'fail' : 'pass'}">${n(B2.summary.failing)}</td></tr><tr><td>Kontras teks terendah</td><td class="n fail">${d2(B1.summary.lowestText)}</td><td class="n pass">${d2(B2.summary.lowestText)}</td></tr></tbody></table></div>
<div class="notes"><h3>Kegagalan v1 per jenis</h3><table><thead><tr><th>Jenis / sebab</th><th class="n">Jumlah</th></tr></thead><tbody>${f1rows.slice(0, 11).map(([k, v]) => `<tr><td class="k">${k.replace('boundary', 'tepi').replace('text', 'teks')}</td><td class="n">${v}</td></tr>`).join('')}</tbody></table><p class="cap">Selain dua tombol Approve, sebab terbanyak adalah tepi tombol sekunder dan segmen (1,32:1 di terang): tombol tidak terlihat sebagai tombol. v2 menaikkan <code>--line-strong</code> menjadi tepi kontrol (3,0:1 atau lebih di kedua tema).</p></div></div>`);

const lv = (k, p) => d2(ratioC(k, p));
page('Evaluasi gaya', `${head('2', 'Evaluasi arah Ledger: dipertahankan, disempurnakan', 'src/contrast.py · measurements/contrast.json')}
<div class="half" style="gap:8mm"><div class="notes"><h3>Diukur ulang</h3><table><thead><tr><th>Kriteria</th><th class="n">v1</th><th class="n">v2</th></tr></thead><tbody>
<tr><td>Pasangan token lulus (terang + gelap)</td><td class="n">${C['v1-light'].filter((r) => r.pass).length + C['v1-dark'].filter((r) => r.pass).length}/${C['v1-light'].length * 2}</td><td class="n">${C['v2-light'].filter((r) => r.pass).length + C['v2-dark'].filter((r) => r.pass).length}/${C['v2-light'].length * 2}</td></tr>
<tr><td>Tepi kontrol di atas permukaan, gelap</td><td class="n">${lv('v1-dark', 'input border (line-strong) on surface')}</td><td class="n">${lv('v2-dark', 'input border (line-strong) on surface')}</td></tr>
<tr><td>Tepi kontrol di atas panel, gelap</td><td class="n">-</td><td class="n">${lv('v2-dark', 'line-strong on bg-3 (control on panel)')}</td></tr>
<tr><td>Label tombol utama saat hover, terang</td><td class="n">tidak ada</td><td class="n">${lv('v2-light', 'accent-ink on accent-hover')}</td></tr>
<tr><td>Label nonaktif, terang</td><td class="n">${d2(B1.failing.find((r) => r.kind === 'btn[disabled]').minText)} (opacity)</td><td class="n">${lv('v2-light', 'ink-3 on bg-3 (disabled label)')}</td></tr>
<tr><td>Jarak aksen ke warna status (ΔOKLab)</td><td class="n">0,13</td><td class="n">0,13</td></tr>
<tr><td>Baris tabel per layar 1440×900</td><td class="n">20</td><td class="n">20</td></tr></tbody></table></div>
<div class="notes"><h3>Keputusan: pertahankan Ledger</h3><p>Masalah v1 bukan arah warnanya. Jarak aksen ke warna status tetap yang terbaik dari tiga arah yang dibandingkan di v1 (0,13 lawan 0,06), kepadatan 36 px per baris tetap, dan Inter tidak menambah muatan. Yang salah adalah penerapannya: kaskade CSS, tepi kontrol terlalu tipis, dan keadaan tombol yang tidak dirancang.</p><h3>Yang disempurnakan</h3><ul><li><code>--line-strong</code> menjadi tepi semua kontrol (tombol, segmen, chip, input, saklar), dinaikkan agar minimal 3:1 di kedua tema.</li><li>Token baru hanya tiga: <code>--accent-hover</code>, <code>--accent-press</code>, <code>--bad-hover</code>; semuanya lulus 4,5:1 dengan label.</li><li>Segmen terpilih memakai tinta (bukan putih di atas abu) agar terpilih terlihat tanpa warna aksen.</li><li>Dibuang: 9 token jarak, 1 durasi, 1 kurva, 1 bayangan yang tidak dipakai satu pun layar v1.</li><li>Logo Lingkar Moot tidak diubah: tinta dan aksennya memakai token yang sama dan sudah 17,07:1 dan 6,30:1.</li></ul></div></div>`);

const haveShot = (k) => existsSync(join(here, '../research', k + '.jpg'));
const shotRefs = RS.filter((r) => haveShot(r.key));
page('Riset', `${head('3', `Riset gaya: ${RS.length} produk`, `diakses ${DATE} · tangkapan layar halaman publik, hanya untuk studi internal`)}
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:3mm">${shotRefs.slice(0, 12).map((r) => `<figure><img class="shot" src="../research/${r.key}.jpg" alt="" style="height:34mm;object-fit:cover;object-position:top"><figcaption class="cap"><b>${r.name}</b> · ${r.url.replace('https://', '')} · ${DATE}</figcaption></figure>`).join('')}</div>
<p class="cap" style="max-width:none;margin-top:3mm">${shotRefs.length} dari ${RS.length} halaman berhasil ditangkap Chrome headless; sisanya menolak klien tanpa kepala atau menampilkan halaman kosong, jadi dipelajari dari halaman yang dibuka langsung. Tidak ada aset, logo, atau teks mereka yang dipakai di mockup.</p>`);

const MATRIX = [
  ['Navigasi', 'Sidebar dengan kelompok, palet perintah (Linear, Raycast)', 'Sidebar 3 kelompok, rail ikon di tablet, bilah bawah 5 item di ponsel, Ctrl K', 'Navigasi bawah dengan lebih dari 5 item'],
  ['Onboarding', 'Jalankan dulu, tanya detail kemudian (Railway, Vercel)', 'Deteksi OS dan omp, impor provider, task pertama satu isian', 'Wizard banyak langkah dengan isian wajib'],
  ['Keadaan kosong', 'Satu kalimat dan satu tombol (Notion)', 'Kalimat apa yang terjadi berikutnya, satu tombol, pintasan', 'Ilustrasi besar'],
  ['Settings dan config', 'Default terdeteksi, override dengan label changed dan reset (Vercel, GitHub, Resend)', 'Agent defaults dengan 5 pilihan bernama, override per agent, bilah simpan', 'File config yang harus ditulis tangan'],
  ['Feature flag', 'Nama manusia, satu kalimat, saklar jelas (PostHog, Supabase)', 'Features berkelompok, preset, label belum selesai', 'Daftar datar puluhan saklar'],
  ['Kepadatan', 'Baris tetap, angka tabular (Attio, Linear)', 'Baris 36 px, Plex Mono untuk ID dan biaya', 'Kartu untuk setiap baris data'],
  ['Tipografi', 'Satu sans sepanjang produk (Linear, Vercel)', 'Inter saja, Plex Mono untuk mesin', 'Font display di label'],
  ['Warna', 'Netral plus satu aksen (Vercel, Linear)', 'Ledger, satu indigo, status punya teks', 'Warna merek sebagai latar'],
  ['Gerak', 'Cepat dan sebab-akibat (Linear, Raycast)', '120 dan 200 ms, hanya warna dan posisi saklar, nol saat gerak dikurangi', 'Animasi masuk halaman'],
];
page('Matriks pola', `${head('3', 'Matriks pola yang diadopsi', '')}
<table><thead><tr><th style="width:30mm">Pola</th><th style="width:72mm">Yang terlihat di referensi</th><th style="width:80mm">Keputusan di Wardmote</th><th>Sengaja tidak ditiru</th></tr></thead><tbody>${MATRIX.map((r) => `<tr><td><b style="font-weight:600">${r[0]}</b></td><td class="mute">${r[1]}</td><td>${r[2]}</td><td class="mute">${r[3]}</td></tr>`).join('')}</tbody></table>`);
page('Referensi', `${head('3', 'Referensi: yang dipelajari dan yang tidak ditiru', `diakses ${DATE}`)}
<table class="dense" style="font-size:6.9pt;line-height:1.3"><thead><tr><th style="width:30mm">Produk</th><th>Yang dipelajari</th><th style="width:78mm">Yang tidak ditiru</th></tr></thead><tbody>${RS.map((r) => `<tr><td><b style="font-weight:600">${r.name}</b><br><span class="mute" style="font-size:6.6pt">${r.url.replace('https://', '')}</span></td><td>${r.learn}</td><td class="mute">${r.skip}</td></tr>`).join('')}</tbody></table>`);

const flowTable = (k) => { const f = f1[k]; const rows = (arr) => arr.map((s, i) => `<tr><td class="n">${i + 1}</td><td>${s[0]}</td><td class="n">${s[1]}</td><td class="n">${s[2]}</td><td class="n">${s[3]}</td></tr>`).join(''); const tot = (t) => `<tr class="hl"><td></td><td><b>Total</b></td><td class="n">${t.decisions}</td><td class="n">${t.clicks}</td><td class="n">${t.fields}</td></tr>`; return `<div class="half" style="gap:6mm"><div><h3>v1</h3><table class="dense"><thead><tr><th class="n">#</th><th>Langkah</th><th class="n">Kep.</th><th class="n">Klik</th><th class="n">Isian</th></tr></thead><tbody>${rows(f.v1)}${tot(f.v1t)}</tbody></table></div><div><h3>v2</h3><table class="dense"><thead><tr><th class="n">#</th><th>Langkah</th><th class="n">Kep.</th><th class="n">Klik</th><th class="n">Isian</th></tr></thead><tbody>${rows(f.v2)}${tot(f.v2t)}</tbody></table></div></div>`; };
page('Alur pengguna baru', `${head('4', 'Alur (a): instalasi sampai agent pertama menjalankan task', 'measurements/simplify.json · Kep. = keputusan yang harus dipahami')}
${flowTable('a')}
<div class="notes" style="margin-top:3mm;display:grid;grid-template-columns:1fr 1fr;gap:8mm"><div><h3>Target terpenuhi</h3><p>Target dari brief: tiga keputusan atau kurang. v2: ${f1.a.v2t.decisions} keputusan bila OMP belum punya model yang sudah sign in (pilih provider), 0 bila sudah (impor dari ~/.omp, model terbaik dipilih otomatis). Satu-satunya isian adalah task pertama, karena itu yang ingin dikerjakan pengguna.</p></div><div><h3>Yang dihapus dari alur</h3><p>Pilih OS (terdeteksi), nama agent (Atlas, bisa diganti), peran (General), folder kerja (terdeteksi dari folder proyek terakhir), membaca 4 nilai config, langkah Done terpisah. Semua tetap bisa diubah setelahnya di halaman agent.</p></div></div>`);
page('Alur override dan global', `${head('4', 'Alur (b) override satu agent dan (c) default semua agent', '')}
<h3 style="margin-bottom:1mm">(b) Mengubah model Raka saja</h3>${flowTable('b')}<h3 style="margin:3mm 0 1mm">(c) Mengubah model default semua agent</h3>${flowTable('c')}
<p class="cap" style="max-width:none;margin-top:2mm">Klik hampir sama; yang hilang adalah isian teks bebas (mengetik id model) dan dialog konfirmasi. Model dipilih dari daftar yang dilaporkan <code>omp models</code>, dan bilah simpan menyebut berapa agent ikut berubah dan apakah sesi tetap.</p>`);

const ctlRows = SIM.controls.map((c) => `<tr><td><b style="font-weight:600">${c.label}</b></td><td>${c.choices.join(', ')}</td><td class="k">${c.keys.join(', ')}</td><td class="mute">${c.how}</td></tr>`).join('');
page('Config OMP disederhanakan', `${head('4', `Config OMP: ${E.essentialCount} kunci Essential jadi ${SIM.counts.controls} pilihan bernama`, 'I-7 tetap: 36 kunci, dikurasi ulang menjadi lapisan')}
<table class="dense"><thead><tr><th style="width:26mm">Pilihan</th><th style="width:46mm">Nilai yang dilihat</th><th style="width:78mm">Kunci OMP yang diisi</th><th>Pemetaan</th></tr></thead><tbody>${ctlRows}</tbody></table>
<div class="half" style="margin-top:3mm;gap:8mm"><div class="notes"><h3>Resolusi dengan I-7</h3><p>Ke-36 kunci Essential tidak dibuang. ${SIM.counts.byControls} diisi oleh ${SIM.counts.controls} pilihan di atas; ${SIM.counts.elsewhere} pindah ke tempat yang sudah ada (${Object.entries(SIM.elsewhere).map(([k, v]) => `<code>${k}</code> ke ${v}`).join(', ')}); ${SIM.counts.advancedOnly} sisanya (${SIM.advancedEssential.map((k) => `<code>${k}</code>`).join(', ')}) tampil sebagai filter Essential di All settings. ${E.searchable} setting tetap bisa dicari di lapisan itu.</p></div>
<div class="notes"><h3>Dua lapis tetap</h3><p>Agent defaults (global) dan Setup per agent (override). Baris yang berbeda dari default berlatar aksen dengan label "Changed from default" dan satu tombol Reset; di atasnya ada "Reset all to defaults". Urutan prioritas overlay sama dengan v1 (terbukti dengan <code>PI_CONFIG_FILES</code>).</p><p class="cap">[INFERENCE] Isi preset Style (nilai thinking, advisor, prewalk, retry) adalah usulan; angka biaya dan kecepatan per preset diukur dari run log di task implementasi.</p></div></div>`);

screenPage('4', 'Agent defaults', 'defaults', `<h3>Global</h3><p>Lima pilihan bernama. "17 agents follow this" dihitung dari agent tanpa override. Bilah simpan muncul hanya bila ada perubahan dan menyebut efek ke sesi (model dan thinking menjaga sesi, sesuai <code>MODEL_SWITCH_ADAPTER_CONFIG_KEYS</code>).</p>`);
screenPage('4', 'Setup per agent', 'agent-setup', `<h3>Override</h3><p>Hanya baris yang diubah yang berlatar aksen. Default ditulis di bawah nama tiap baris, jadi pengguna tahu apa yang ia timpa.</p>`);
page('All settings dan provider', `${head('4', 'Lapisan lanjutan: All settings dan provider', 'power user; nama kunci hanya muncul di sini')}
<div class="half">${img(S('all-settings', 'light', '1440x900'), `<b>All settings.</b> Pencarian ${E.searchable} setting, filter Essential dan Changed, validasi dari skema (batas 10 sampai 95).`)}${img(S('providers', 'dark', '1440x900'), '<b>Models and providers.</b> Diimpor dari OMP; kunci tetap di penyimpanan kredensial OMP, hanya 4 karakter terakhir ditampilkan.')}</div>
<div class="half" style="margin-top:3mm">${fit(S('all-settings', 'dark', '390x844'), 70, '<b>Ponsel.</b> Baris jadi satu kolom.')}${fit(S('providers', 'light', '768x1024'), 70, '<b>Tablet.</b>')}</div>`);

const catRow = (r) => `<tr><td class="k">${r.key.replace(/^enable/, '')}</td><td>${r.title}</td><td class="n">${r.live ? 'on' : 'off'}</td><td><b style="font-weight:600">${r.dest === 'Features' ? 'Features › ' + r.group : r.dest === 'Advanced' ? 'Advanced › ' + r.group : r.dest === 'Permanent' ? 'Permanen' : r.dest === 'Remove' ? 'Hapus' : 'Gabung'}</b>${r.dest === 'Features' && !r.ready ? ' <span class="tag warn">belum selesai</span>' : ''}</td><td>${r.name}: ${r.line}</td><td class="k">${(r.dep || '').replace(/^enable/, '')}</td></tr>`;
const catHead = '<thead><tr><th style="width:44mm">Kunci (tanpa enable)</th><th style="width:40mm">Judul di katalog</th><th class="n" style="width:10mm">Kini</th><th style="width:42mm">Tujuan</th><th>Nama baru dan alasan</th><th style="width:30mm">Bergantung</th></tr></thead>';
page('Features: rancangan', `${head('5', 'Experimental diganti Features dan Advanced', 'packages/shared/src/feature-catalog.ts · instance live · measurements/features-plan.json')}
<div class="kpis" style="grid-template-columns:repeat(5,1fr)">${[['Features', cnt.Features, 'fitur produk, 5 kelompok'], ['Advanced', cnt.Advanced, 'alat operator dan pengembang'], ['Permanen', cnt.Permanent, 'saklar dibuang, perilaku tetap'], ['Hapus', cnt.Remove, 'tidak berlaku lagi'], ['Gabung', cnt.Merge, 'jadi opsi di fitur lain']].map((k) => `<div class="box"><div class="l">${k[0]}</div><div class="big">${k[1]}</div><div class="s">${k[2]}</div></div>`).join('')}</div>
<div class="half" style="margin-top:4mm;gap:8mm"><div class="notes"><h3>Tafsiran Wira diterima</h3><p>Halaman Experimental (793 baris) hilang dan kata "Experimental" tidak muncul di UI. Features berisi fitur yang dipakai pengguna biasa; Advanced berisi saklar yang mengubah cara run dieksekusi atau menampilkan data internal. Satu koreksi: 5 kunci tidak layak jadi saklar sama sekali karena sudah menyala di mana-mana dan v2 bergantung padanya (dijadikan permanen), dan 3 kunci kehilangan arti setelah OMP jadi satu-satunya runtime (dihapus).</p>
<h3>Kurangi isian</h3><p>${feat.length} saklar Features dibagi 5 kelompok dengan satu pencarian. Tiga preset: Minimal (${FP.presets.Minimal}), Standard (${FP.presets.Standard}, sama persis dengan yang menyala sekarang), Everything (${FP.presets.Full}, semua yang sudah punya layar). Ringkasan "N of ${feat.length} on" di judul.</p></div>
<div class="notes"><h3>"Belum selesai" bukan saklar kosong</h3><p>${FP.notReady.length} fitur belum punya layar jadi (kurang dari 2 berkas halaman atau komponen dan mati di instance): ${FP.notReady.map((k) => `<code>${k.replace(/^enable/, '')}</code>`).join(', ')}. Saklarnya tampil nonaktif dengan label "Not finished yet" dan tidak masuk preset. Usulan per fitur ada di halaman Keputusan.</p>
<h3>Mulai ulang</h3><p>Tidak ada satu pun saklar yang butuh restart server: semua dibaca per permintaan dari pengaturan instance. Satu-satunya yang menyentuh restart adalah <code>autoRestartDevServerWhenIdle</code> (Advanced), dan itu justru mengatur restart otomatis dev server.</p></div></div>`);
const half1 = FT.filter((r) => r.dest === 'Features');
page('Tabel saklar 1', `${head('5', `Klasifikasi 44 saklar (1/2): Features (${half1.length})`, '')}<table class="dense" style="font-size:7.2pt">${catHead}<tbody>${half1.map(catRow).join('')}</tbody></table>`);
page('Tabel saklar 2', `${head('5', `Klasifikasi 44 saklar (2/2): Advanced (${adv.length}), permanen, hapus, gabung (${other.length})`, '')}<table class="dense" style="font-size:7.2pt">${catHead}<tbody>${adv.concat(other).map(catRow).join('')}</tbody></table>
<p class="cap" style="max-width:none;margin-top:2mm">Keadaan "kini" dibaca dari instance live (17 on, 27 off). Setelah migrasi: ${FP.liveOnByDest.Features || 0} yang menyala tetap menyala di Features, ${FP.liveOnByDest.Advanced || 0} di Advanced, ${FP.liveOnByDest.Permanent || 0} menjadi perilaku tetap; tidak ada yang menyala lalu mati.</p>`);
screenPage('5', 'Features', 'features', `<h3>Features</h3><p>Preset, satu pencarian, kelompok dengan hitungan yang menyala. Tiap baris: nama, satu kalimat, dan apa yang terlihat saat menyala atau mati. Di ponsel penjelasan efek disembunyikan dan saklar 46×28 px.</p>`);
screenPage('5', 'Features lanjutan dan Advanced', 'advanced', `<h3>Advanced</h3><p>Peringatan di atas, satu tombol Reset to defaults, label "changed" bila berbeda dari default. Tidak ada di navigasi utama: dibuka dari Settings atau Search.</p><p class="cap">Halaman Features bagian kedua (Integrations, Workspaces, Display) dirender sebagai <code>features-more</code> di 12 ukuran.</p>`);
page('Migrasi saklar', `${head('5', 'Migrasi: tidak ada saklar yang hilang diam-diam', '')}
<div class="half" style="gap:8mm"><div class="notes"><h3>Pemetaan</h3><table class="dense"><tbody><tr><td>Penyimpanan</td><td>Kunci tetap sama di <code>instanceExperimentalSettings</code>; yang berubah hanya halaman yang menampilkannya. Tidak ada migrasi data untuk ${cnt.Features + cnt.Advanced} kunci.</td></tr><tr><td>Permanen (${cnt.Permanent})</td><td>Kode membaca <code>true</code> tetap; kunci tetap diterima API satu rilis lalu diabaikan.</td></tr><tr><td>Hapus (${cnt.Remove})</td><td>Diterima dan diabaikan satu rilis, lalu dihapus dari skema.</td></tr><tr><td>Gabung (${cnt.Merge})</td><td><code>IsolatedWorkspacesByDefault</code> jadi opsi "Use for new projects" di Isolated workspaces; nilai lama dibaca saat migrasi.</td></tr></tbody></table></div>
<div class="notes"><h3>API dan 21 agent</h3><p>Tool MCP <code>paperclipGetInstanceSettingExperimental</code> dan <code>paperclipUpdateInstanceExperimental</code> tetap bekerja; nama baru (<code>Features</code>) masuk di rename tahap 2 dengan alias satu rilis, sama seperti tool lain. Tidak satu pun agent di company Zhafron memanggil tool itu dalam instruksinya [INFERENCE: dicek dari nama tool, belum dari log run].</p><h3>Pixels Office dan Conference room (I-6)</h3><p>Keduanya fitur di Features › Working together; tidak ada di navigasi, dibuka lewat Search dan URL.</p></div></div>`);

page('Onboarding v2', `${head('6', 'Onboarding: 3 langkah, tetap tidak bisa dilewati tanpa OMP', 'gerbang 18.1.16 di jalur lokal tetap')}
<div class="half">${img(S('ob-check', 'light', '1440x900'), '<b>Check OMP.</b> OS terdeteksi; satu perintah; layar maju sendiri saat tiga cek lulus. Tidak ada tombol Continue untuk ditekan.')}${img(S('ob-task', 'dark', '1440x900'), '<b>First task.</b> Agent, model dan folder sudah terisi dari deteksi; satu-satunya isian adalah task.')}</div>
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:3mm;margin-top:3mm">${fit(S('ob-check', 'dark', '390x844'), 66, 'Check, ponsel')}${fit(S('ob-connect', 'light', '390x844'), 66, 'Connect, hanya bila OMP belum punya model')}${fit(S('ob-task', 'light', '390x844'), 66, 'First task')}${fit(S('ob-old', 'dark', '390x844'), 66, 'OMP terlalu lama')}${fit(S('ob-offline', 'light', '390x844'), 66, 'Offline')}</div>`);
page('Onboarding keadaan', `${head('6', 'Onboarding: versi lama, offline, mesin lain, connect', 'terang dan gelap')}
<div class="quad">${img(S('ob-old', 'light', '1440x900'), '<b>Versi lama.</b> Satu perintah update, plus peringatan dua omp di PATH.')}${img(S('ob-offline', 'dark', '1440x900'), '<b>Offline.</b> Pilih file omp, bukan mengetik path.')}${img(S('ob-remote', 'dark', '1440x900'), '<b>Mesin lain.</b> Satu isian alamat SSH; folder kerja default ke home.')}${img(S('ob-connect', 'light', '1440x900'), '<b>Connect a model.</b> Dilewati bila OMP sudah punya model yang sign in.')}</div>`);

const BP = [
  ['Ponsel kecil 360', 'Bilah bawah 5 item (Home, Inbox, Tasks, Chat, More)', '1', 'Baris bertumpuk: judul, meta, status di kanan', 'Halaman penuh; detail menggantikan daftar', 'Lembar dari bawah, tombol selebar layar', '44 px; saklar 46×28; input 16 px (tanpa zoom iOS)'],
  ['Ponsel 390–430', 'Sama', '1', 'Sama', 'Sama', 'Sama', 'Bilah bawah memakai env(safe-area-inset-bottom)'],
  ['Ponsel landscape', 'Bilah bawah tetap; tinggi 360–430 px', '1–2', 'Sama', 'Sama', 'Lembar maks. tinggi layar, isi bergulir', 'Kolom input tetap terlihat di atas keyboard [INFERENCE]'],
  ['Tablet portrait 768', 'Rail ikon 64 px, tanpa label', '1', 'Tabel jadi daftar bertumpuk', 'Detail menggantikan daftar', 'Dialog tengah, lebar maks. 560', '44 px'],
  ['Tablet landscape 1024', 'Sidebar 232 px dengan label', '2', 'Tabel penuh', 'Daftar + detail berdampingan', 'Dialog tengah', '32 px tombol (pointer), 44 px bila sentuh [INFERENCE: media pointer coarse]'],
  ['Laptop 1280–1440', 'Sidebar 232 px', '2–3', 'Tabel penuh, baris 36 px', 'Panel kanan 320 px', 'Dialog tengah', '32 px'],
  ['Layar lebar 1920', 'Sidebar 232 px', '3 di Home', 'Tabel penuh', 'Panel kanan', 'Dialog tengah', 'Isi dibatasi 1440 px agar baris tidak terlalu panjang'],
  ['Ultrawide 2560', 'Sama dengan 1920', '3', 'Sama', 'Sama', 'Sama', 'Isi tetap 1440 px di tengah; tidak dirender, mengikuti aturan 1920 [INFERENCE]'],
];
page('Titik henti', `${head('7', 'Responsif: titik henti dan aturan', 'src/app.css · @layer layout dan components')}
<table class="dense"><thead><tr><th style="width:30mm">Ukuran</th><th style="width:48mm">Navigasi</th><th style="width:12mm">Kolom</th><th style="width:40mm">Tabel</th><th style="width:40mm">Panel samping</th><th style="width:38mm">Dialog</th><th>Sentuh dan aman</th></tr></thead><tbody>${BP.map((r) => `<tr>${r.map((c, i) => i === 0 ? `<td><b style="font-weight:600">${c}</b></td>` : `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
<div class="notes" style="margin-top:3mm;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6mm"><div><h3>Tanpa aksi hover-saja</h3><p>Semua aksi baris adalah tombol yang terlihat (Approve, Decline, Retry, panah Open). Tidak ada menu yang hanya muncul saat kursor di atas baris.</p></div><div><h3>Properti logis</h3><p>CSS memakai <code>inset-inline</code>, <code>border-inline</code>, <code>margin-inline</code>, jadi bahasa kanan-ke-kiri tidak perlu aturan sendiri.</p></div><div><h3>Bukti</h3><p>${n(OV.renders)} render (${OV.screens} layar × ${OV.sizes.length} ukuran × 2 tema, ditambah bilah judul desktop). check-responsive.py: overflow horizontal ${OV.overflow}, sasaran sentuh di bawah 24 px pada ukuran di bawah 1024: ${OV.smallTargets}.</p></div></div>`);
page('Satu layar enam ukuran', `${head('7', 'Satu layar di enam ukuran: Tasks', '360, 390, 768, 1024, 1440, 1920')}
<div style="display:grid;grid-template-columns:0.42fr 0.46fr 0.78fr 1.05fr 1.6fr;gap:3mm;align-items:start">${fit(S('tasks', 'light', '360x740'), 70, '360×740')}${fit(S('tasks', 'dark', '390x844'), 70, '390×844')}${fit(S('tasks', 'light', '768x1024'), 70, '768×1024')}${fit(S('tasks', 'dark', '1024x768'), 70, '1024×768')}${fit(S('tasks', 'light', '1440x900'), 70, '1440×900')}</div>
<div style="display:grid;grid-template-columns:1.2fr 1fr;gap:4mm;margin-top:3mm">${fit(S('home', 'dark', '1920x1080'), 66, '<b>1920×1080.</b> Home memakai kolom ketiga (grafik run).')}<div class="notes"><h3>Yang berubah per ukuran</h3><ul><li>Di bawah 768 tabel menjadi baris bertumpuk; kolom prioritas dan waktu disembunyikan dan dipindah ke meta.</li><li>Di bawah 1024 sidebar menjadi rail, panel samping disembunyikan dan isinya muncul di tab Details.</li><li>Di bawah 600 navigasi pindah ke bawah, dialog menjadi lembar.</li><li>Tidak ada ukuran font yang mengecil di ponsel; input justru naik ke 16 px.</li></ul></div></div>`);

screenPage('8', 'Home', 'home', `<p>Jawab tiga hal: apa yang butuh saya, siapa yang bekerja, berapa biayanya. Approve dan Decline langsung di baris; di ponsel keduanya selebar layar.</p>`);
screenPage('8', 'Inbox', 'inbox', `<p>Daftar dan detail berdampingan di 1024 ke atas. Di ponsel dan tablet portrait, daftar dulu; detail dibuka sebagai halaman (<code>inbox-item</code>, dirender di 12 ukuran).</p><p>Pilihan keputusan berupa opsi bertombol radio, satu direkomendasikan.</p>`);
screenPage('8', 'Approvals', 'approvals', `<p>Hire menampilkan setup dalam bahasa biasa ("Company defaults, 1 change"), bukan daftar kunci.</p>`);
screenPage('8', 'Tasks', 'tasks', `<p>Baris 36 px di desktop; baris bertumpuk di bawah 768.</p>`);
screenPage('8', 'Task detail', 'task', `<p>Percakapan dan tool call dalam satu kolom. Properti di panel kanan pada 1024 ke atas; di bawahnya ringkasan satu baris dengan tombol Details.</p>`);
screenPage('8', 'Agents', 'agents', `<p>Kolom Setup menyebut "N changed" bila agent punya override; model ditampilkan dengan nama manusia.</p>`);
screenPage('8', 'Agent detail', 'agent', `<p>Tab Setup menggantikan "OMP config". Run menyebut alasan wake dan resumed atau fresh.</p>`);
screenPage('8', 'Org chart', 'org', `<p>Pohon di 768 ke atas; daftar bertingkat di ponsel karena pohon 1000 px tidak terbaca di 360 px.</p>`);
screenPage('8', 'Routines', 'routines', `<p>Cases dan Pipelines menjadi tab Routines. Saklar memakai role switch dengan label.</p>`);
screenPage('8', 'Costs', 'costs', `<p>Tiga angka, satu grafik, satu daftar per agent.</p>`);
screenPage('8', 'Connectors', 'connectors', `<p>Yang butuh tindakan memakai tombol (Renew, Reconnect), bukan lencana warna.</p>`);
screenPage('8', 'Local Browser', 'browser', `<p>Satu daftar agent dengan saklar, satu peringatan.</p>`);
screenPage('8', 'Chat', 'chat', `<p>Pesan sendiri di kanan berwarna aksen dengan label 4,5:1; agent di kiri.</p>`);
screenPage('8', 'Settings', 'settings', `<p>Company dan Instance dalam satu pohon: General, Members, Secrets, Budgets; OMP runtime, Agent defaults, Features, Advanced.</p>`);
screenPage('8', 'OMP runtime', 'instance', `<p>Pengganti Adapters: cek OMP, versi minimum, mesin. Update OMP satu tombol per mesin.</p>`);

page('Keadaan', `${head('9', 'Kosong, memuat, galat', 'terang dan gelap, desktop dan ponsel')}
<div class="thirds">${['tasks-empty', 'tasks-loading', 'tasks-error'].map((s, i) => `<div style="display:flex;flex-direction:column;gap:2mm">${img(S(s, 'light', '1440x900'), ['<b>Kosong.</b> Apa yang terjadi berikutnya dan satu tombol.', '<b>Memuat.</b> Kerangka dengan tinggi baris akhir; aria-busy.', '<b>Galat.</b> Apa yang terjadi, bahwa data aman, dua aksi.'][i])}<div style="display:grid;grid-template-columns:1fr 1fr;gap:2mm">${fit(S(s, 'dark', '390x844'), 60)}${fit(S(s, 'dark', '768x1024'), 60)}</div></div>`).join('')}</div>`);
page('Keyboard dan aksesibilitas', `${head('9', 'Keyboard, fokus, gerak berkurang, bahasa', 'WCAG 2.2 AA')}
<div class="split">${img(S('keyboard', 'dark', '1440x900'), '<b>Lembar pintasan</b> (tekan ?). Baris terfokus memakai cincin 2 px.')}
<div class="notes"><h3>Fokus</h3><p>Cincin 2 px, jarak 2 px, warna <code>--focus</code>: ${lv('v2-light', 'focus ring on surface')}:1 terang, ${lv('v2-dark', 'focus ring on surface')}:1 gelap.</p><h3>Sentuh</h3><p>44 px minimal di bawah 1024 px; 0 sasaran di bawah 24 px (check-responsive.py).</p><h3>Gerak berkurang</h3><p>Transisi hanya warna dan posisi saklar, 120 dan 200 ms; <code>prefers-reduced-motion</code> membuat keduanya 0 ms di tokens.css.</p><h3>Status bukan warna saja</h3><p>Setiap lencana punya teks; saklar punya <code>role="switch"</code> dan label.</p><h3>Bahasa</h3><p>40 berkas locale, en.json hanya 3 string (temuan v1). Layar Language menulis itu apa adanya; ekstraksi string mendahului terjemahan, dimulai dari onboarding dan Settings.</p></div></div>`);

const pwaIcons = [['favicon-16.png', 16], ['favicon-32.png', 32], ['favicon-48.png', 48], ['apple-touch-icon-180.png', 90], ['icon-any-192.png', 96], ['icon-maskable-512.png', 128], ['icon-monochrome-512.png', 96]];
page('PWA', `${head('10', 'PWA: manifest, ikon, validator', 'src/pwa.py · pwa/site.webmanifest · pwa/head.html')}
<div class="half" style="gap:8mm"><div class="notes"><h3>Ikon dari Lingkar Moot</h3><div style="display:flex;gap:4mm;align-items:flex-end;margin-bottom:2mm">${pwaIcons.map(([f, s]) => `<figure style="text-align:center;font:400 6.4pt Plex Mono,Inter;color:#5d6270"><img src="../pwa/${f}" style="width:${s}px;height:${s}px;${s <= 48 ? 'image-rendering:pixelated;' : ''}${f.includes('mono') ? 'background:#15171c;border-radius:4px;' : ''}" alt=""><div>${f.replace('.png', '')}</div></figure>`).join('')}</div>
<p class="cap">Dirender dari SVG skrip dan dilihat di 16, 32, 48, 180, 192 dan 512 px. Maskable: tanda di dalam lingkaran aman 80% (validator mengukur piksel terjauh). Latar ikon memakai <code>--bg</code> gelap agar tanda terang ${d2(PWA.markOnBgDark)}:1.</p>
<h3>Validator (${PWA.pass}/${PWA.total} lulus)</h3><table class="dense" style="font-size:6.6pt;columns:2"><tbody></tbody></table><div style="columns:2;column-gap:5mm;font-size:6.8pt;line-height:1.35">${PWA.checks.map((c) => `<div><span class="${c.pass ? 'pass' : 'fail'}">${c.pass ? '✓' : '✗'}</span> ${c.check}${c.detail ? ` <span class="mute">(${c.detail})</span>` : ''}</div>`).join('')}</div></div>
<div class="notes"><h3>Yang berubah dari manifest sekarang</h3><table class="dense"><tbody><tr><td>name</td><td>${PWA.oldName} → Wardmote</td></tr><tr><td>theme_color</td><td>${PWA.oldTheme} tetap → meta theme-color dengan media query: terang ${PWA.themeLight}, gelap ${PWA.themeDark}</td></tr><tr><td>shortcuts</td><td>${PWA.oldShortcuts.join(', ')} → Inbox, Decisions, Tasks, New task</td></tr><tr><td>screenshots</td><td>tidak ada → wide 1800×1125 dan narrow 780×1688 untuk dialog pasang</td></tr><tr><td>status bar iOS</td><td>black-translucent → default (mengikuti tema, teks tidak hilang di tema terang)</td></tr></tbody></table>
<h3>Yang tetap</h3><p>sw.js sudah punya handler fetch, push, notificationclick, install, activate, halaman offline, dan pembaruan teruji (service-worker-updates.ts). <code>launch_handler</code> navigate-existing dan <code>display_override</code> window-controls-overlay tetap.</p></div></div>`);
page('PWA alur', `${head('10', 'PWA: pasang, versi baru, offline, notifikasi, bilah judul', 'terang dan gelap')}
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:3mm">${img(S('pwa-install', 'light', '1440x900'), '<b>Ajakan pasang.</b> Muncul setelah kunjungan ketiga dan bukan di onboarding; Not now menyembunyikannya 30 hari.')}${img(S('pwa-update', 'dark', '1440x900'), '<b>Versi baru.</b> Toast dengan Reload; tidak memuat ulang sendiri saat ada isian.')}${img(S('pwa-wco', 'light', '1440x900'), '<b>Window controls overlay.</b> Bilah judul sendiri berisi nama dan jumlah Inbox; tombol jendela OS di kanan.')}</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr) 1.4fr;gap:3mm;margin-top:3mm">${fit(S('pwa-offline', 'light', '390x844'), 72, '<b>Offline.</b> Isi terakhir tetap terbaca; Approve dan Decline nonaktif dengan alasan.')}${fit(S('pwa-offline', 'dark', '768x1024'), 72)}${fit(S('pwa-notify', 'light', '390x844'), 72, '<b>Izin notifikasi.</b> Diminta setelah keputusan pertama, bukan saat datang.')}${fit(S('pwa-install', 'dark', '390x844'), 72)}<div class="notes"><h3>Antrean aksi offline</h3><p>Tidak ada: approve dan reply dinonaktifkan saat offline, karena keputusan basi yang terkirim kemudian bisa salah. Dicatat sebagai keputusan terbuka.</p><h3>Tombol kembali</h3><p>Di mode standalone, tombol kembali Android dan gestur iOS mengikuti riwayat router; topbar menampilkan breadcrumb sebagai jalan kembali.</p></div></div>`);
const TESTS = [
  ['Android Chrome', 'Pasang dari menu, ikon maskable tidak terpotong, shortcut Decisions membuka Inbox Decisions, notifikasi push masuk dan membuka task, tombol kembali sistem'],
  ['iOS Safari 17+', 'Add to Home Screen memakai apple-touch-icon, status bar terbaca di terang dan gelap, safe-area bawah tidak menutupi bilah navigasi, keyboard tidak menutupi composer'],
  ['Chrome atau Edge desktop', 'Pasang dari bilah alamat, window-controls-overlay aktif, tautan Wardmote membuka jendela yang sudah ada (navigate-existing), toast versi baru'],
  ['Semua', 'Mode pesawat: halaman terakhir terbaca, aksi nonaktif, kembali online memuat ulang sekali'],
];
page('PWA uji manual', `${head('10', 'Uji manual per perangkat untuk Zhafron', 'belum diuji di perangkat nyata')}
<div class="box warn" style="margin-bottom:3mm"><b style="font-weight:600">[INFERENCE]</b> Tidak ada yang diuji di perangkat nyata dalam task ini. Yang terbukti: manifest lulus validator skrip, berkas ikon berukuran benar, sw.js punya handler yang dibutuhkan, dan semua layar dirender di Chrome headless pada 6 ukuran. Perilaku pasang, notifikasi, dan bilah judul hanya bisa dibuktikan di perangkat.</div>
<table><thead><tr><th style="width:40mm">Perangkat</th><th>Yang diuji</th><th style="width:30mm">Hasil</th></tr></thead><tbody>${TESTS.map((t) => `<tr><td><b style="font-weight:600">${t[0]}</b></td><td>${t[1]}</td><td class="mute">belum</td></tr>`).join('')}</tbody></table>`);

page('Kompleksitas', `${head('11', 'Kompleksitas v1 lawan v2', 'src/complexity.py · measurements/complexity.json')}
<table><thead><tr><th>Ukuran</th><th class="n">v1</th><th class="n">v2</th><th>Penjelasan</th></tr></thead><tbody>
<tr><td>Token</td><td class="n">${CX.v1.tokens}</td><td class="n">${CX.v2.tokens}</td><td>12 token menganggur dibuang, 3 token keadaan tombol ditambah</td></tr>
<tr><td>Varian tombol</td><td class="n">${CX.v1.buttonVariants.length}</td><td class="n">${CX.v2.buttonVariants.length}</td><td>Tambah Delete (merah penuh) dan Link; satu arti per warna</td></tr>
<tr><td>Jenis layar mockup</td><td class="n">${CX.v1.screens}</td><td class="n">${CX.v2.screens}</td><td>Tambah Features, Advanced, Agent defaults, Setup, All settings, PWA; hapus wizard 7 langkah</td></tr>
<tr><td>Aturan CSS</td><td class="n">${CX.v1.cssRules}</td><td class="n">${CX.v2.cssRules}</td><td>Naik karena aturan responsif dan keadaan tombol; v1 tidak responsif</td></tr>
<tr><td>Aturan wadah yang menimpa warna anak</td><td class="n">${CX.v1.containerOverrides.length}</td><td class="n">${CX.v2.containerOverrides.length}</td><td>Akar cacat tombol</td></tr>
<tr><td>Kontrol config yang dilihat pengguna biasa</td><td class="n">${E.essentialCount}</td><td class="n">${SIM.counts.controls}</td><td>Pilihan bernama memetakan ke kunci</td></tr>
<tr><td>Saklar di satu halaman</td><td class="n">44</td><td class="n">${cnt.Features}</td><td>Advanced terpisah, 9 kunci tidak lagi jadi saklar</td></tr>
</tbody></table>
<div class="notes" style="margin-top:3mm"><h3>Diuji dengan "apa yang hilang bila dibuang"</h3><p>Dibuang dari v1: kartu KPI dengan sub-baris dekoratif, kolom Overridden by (diganti angka di bawah label), dialog diff sebelum simpan (diganti bilah simpan), badge tipe adapter, langkah Done di onboarding, wizard pilih peran. Dipertahankan: grafik run di Home hanya di 1920 px ke atas, karena di bawahnya grafik itu menggeser daftar Needs you.</p></div>`);

const DEC = [
  ['K-1', 'Kunci kompatibilitas', `${cnt.Permanent} kunci (FileViewer, StreamlinedLeftNavigation, StreamlinedUi, Apps, McpAggregators) menyala di mana-mana dan v2 bergantung padanya; ClassicTaskInterface (${FT.find((r) => r.key === 'enableClassicTaskInterface').uiFiles} berkas UI) mati dan hanya menjaga layar lama.`, 'Jadikan permanen 5 kunci dan hapus ClassicTaskInterface bersama layar lamanya di task UI.', 'Hapus percabangan di berkas yang menyebut kunci itu; uji UI di CI.'],
  ['K-2', 'Kunci yang kehilangan arti', `RunnerPreviewIngress (deprecated, mengikuti runner), AiConnectionRouters (memilih harness per task; 0 berkas UI, tidak ada lagi yang dipilih karena OMP satu-satunya).`, 'Hapus keduanya, diterima dan diabaikan API satu rilis.', 'Bagian dari PR hapus adapter.'],
  ['K-3', `${FP.notReady.length} fitur belum selesai`, FP.notReady.map((k) => k.replace(/^enable/, '')).join(', ') + '.', 'Tampilkan dengan label Not finished yet dan saklar nonaktif; selesaikan ChatConnectors dahulu karena 20 berkas server sudah ada, tunda sisanya.', '[INFERENCE] 1–3 hari per fitur untuk layar Settings-nya; diukur ulang saat diambil.'],
  ['K-4', 'Antrean aksi offline', 'Approve atau reply saat offline bisa terkirim basi.', 'Tidak mengantre; nonaktifkan aksi saat offline.', 'Tidak ada kerja tambahan.'],
  ['K-5', 'Preset Features', `Minimal ${FP.presets.Minimal}, Standard ${FP.presets.Standard}, Everything ${FP.presets.Full}.`, 'Pakai Standard sebagai default instalasi baru (sama dengan keadaan instance sekarang).', 'Satu tabel pemetaan di kode.'],
  ['K-6', 'Preset Style di Agent defaults', 'Balanced, Fast, Thorough memetakan 4 kunci.', 'Pakai, dan ukur biaya per preset dari run log 7 hari setelah dipasang.', 'Dashboard biaya per preset.'],
];
page('Keputusan terbuka', `${head('12', 'Keputusan terbuka, masing-masing dengan rekomendasi', 'I-1 sampai I-9 sudah dijawab dan tidak dibuka lagi')}
<div class="cols2" style="font-size:8.2pt">${DEC.map((d) => `<div class="dec" style="margin-bottom:3mm"><h3><span class="mono" style="color:#4c47c4">${d[0]}</span>${d[1]}</h3><p class="mute">${d[2]}</p><p class="rec">Rekomendasi: ${d[3]}</p><p>Bila disetujui: ${d[4]}</p></div>`).join('')}</div>`);

page('Sumber', `${head('·', 'Sumber dan cara render ulang', 'docs/design/rebrand-v2/')}
<div class="half" style="gap:10mm"><div class="notes"><table class="dense"><tbody>
<tr><td class="k">src/screen.html + screens-*.js</td><td>semua layar; <code>?screen=tasks&amp;theme=dark</code></td></tr>
<tr><td class="k">src/tokens.css, app.css</td><td>token Ledger v2, CSS berlapis (@layer)</td></tr>
<tr><td class="k">src/jobs.py, render.sh</td><td>${n(OV.renders)} render di 6 ukuran × 2 tema</td></tr>
<tr><td class="k">src/audit-probe.js, audit-buttons.py</td><td>kontras dari warna hasil render</td></tr>
<tr><td class="k">src/check-responsive.py</td><td>overflow horizontal dan sasaran sentuh di semua ukuran</td></tr>
<tr><td class="k">src/contrast.py</td><td>pasangan token v1 dan v2</td></tr>
<tr><td class="k">src/features.py, features_plan.py</td><td>katalog 44 saklar dan klasifikasinya</td></tr>
<tr><td class="k">src/simplify.py</td><td>pemetaan kontrol ke kunci, hitungan alur a, b, c</td></tr>
<tr><td class="k">src/pwa.py</td><td>ikon, manifest, validator</td></tr>
<tr><td class="k">src/complexity.py</td><td>kompleksitas v1 lawan v2</td></tr>
<tr><td class="k">src/research.sh, research-retry.sh</td><td>tangkapan layar referensi (internal)</td></tr>
<tr><td class="k">src/gen-doc.mjs, doc.css, build-pdf.sh</td><td>dokumen ini</td></tr>
</tbody></table></div>
<div class="notes"><h3>Render ulang</h3><div class="pre">python3 -m http.server 18960 --bind 127.0.0.1  # di root repo
cd docs/design/rebrand-v2/src
python3 features.py && python3 features_plan.py
python3 contrast.py && python3 simplify.py
./render.sh && python3 check-responsive.py
python3 audit-buttons.py --jobs &lt;(python3 jobs.py audit) \\
  --out ../measurements/button-audit-v2.json
python3 pwa.py && python3 complexity.py
node gen-doc.mjs && ./build-pdf.sh</div>
<h3>Batas dokumen ini</h3><p>Mockup HTML statis, bukan kode produk. Tidak ada uji di perangkat nyata. Tangkapan layar referensi milik pemiliknya dan hanya untuk studi internal. Butir [INFERENCE] punya cara ukurnya masing-masing.</p></div></div>`);

const SECS = [['0', 'Perubahan dari v1'], ['1', 'Cacat tombol: penyebab, matriks, audit'], ['2', 'Evaluasi gaya Ledger'], ['3', 'Riset 16 produk dan matriks pola'], ['4', 'Kurangi isian: alur dan config OMP'], ['5', 'Features dan Advanced (44 saklar)'], ['6', 'Onboarding'], ['7', 'Responsif: titik henti'], ['8', 'Layar inti di 3 ukuran × 2 tema'], ['9', 'Keadaan dan aksesibilitas'], ['10', 'PWA'], ['11', 'Kompleksitas'], ['12', 'Keputusan terbuka'], ['·', 'Sumber']];
const p2 = (x) => String(x).padStart(2, '0');
const range = (k) => (SEC_FIRST[k] === SEC_LAST[k] ? p2(SEC_FIRST[k]) : `${p2(SEC_FIRST[k])}\u2013${p2(SEC_LAST[k])}`);
const toc = (l) => l.map(([k, t]) => `<span>${k}</span><span>${t}</span><span>${range(k)}</span>`).join('');
pages[0] = pages[0].replace('@@TOC1@@', toc(SECS.slice(0, 7))).replace('@@TOC2@@', toc(SECS.slice(7)));
const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Wardmote rebrand v2</title>\n<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="doc.css"></head><body>\n${pages.join('\n')}\n</body></html>\n`;
writeFileSync(join(here, 'doc.html'), html);
console.log(`doc.html: ${pn} pages`);
