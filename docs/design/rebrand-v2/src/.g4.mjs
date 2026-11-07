
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
<h3>Validator (${PWA.pass}/${PWA.total} lulus)</h3><table class="dense" style="font-size:7.2pt"><tbody>${PWA.checks.map((c) => `<tr><td class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'lulus' : 'gagal'}</td><td>${c.check}</td><td class="mute">${c.detail || ''}</td></tr>`).join('')}</tbody></table></div>
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
