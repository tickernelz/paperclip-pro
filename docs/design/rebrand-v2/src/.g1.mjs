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
