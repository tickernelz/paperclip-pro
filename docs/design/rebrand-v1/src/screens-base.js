const Q = new URLSearchParams(location.search);
const THEME = Q.get('theme') || 'light';
const DIR = Q.get('dir') || '';
const SCREEN = Q.get('screen') || 'dashboard';
const LOCALE_DIR = Q.get('rtl') ? 'rtl' : 'ltr';
document.documentElement.dataset.theme = THEME;
if (DIR) document.documentElement.dataset.dir = DIR;
document.documentElement.dir = LOCALE_DIR;

const BRAND = 'Wardmote';
const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M10 20v-5h4v5"/>',
  inbox: '<path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/>',
  chat: '<path d="M5 5h14v10H10l-4 4v-4H5z"/>',
  task: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  folder: '<path d="M4 7.5V18h16V9h-8l-2-2.5H5z"/>',
  repeat: '<path d="M17 3.5 20 6.5l-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12"/><path d="M7 20.5 4 17.5l3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4.5V8"/><circle cx="9.5" cy="13.5" r="1" fill="currentColor"/><circle cx="14.5" cy="13.5" r="1" fill="currentColor"/>',
  org: '<rect x="9" y="3.5" width="6" height="5" rx="1"/><rect x="3.5" y="15.5" width="6" height="5" rx="1"/><rect x="14.5" y="15.5" width="6" height="5" rx="1"/><path d="M12 8.5v3.5M6.5 15.5V12h11v3.5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  plug: '<path d="M9 4v4M15 4v4"/><path d="M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v4"/>',
  coins: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  activity: '<path d="M3.5 12h4l2.5-6 4 12 2.5-6h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  right: '<path d="m10 7 5 5-5 5"/>',
  x: '<path d="m7 7 10 10M17 7 7 17"/>',
  check: '<path d="m5.5 12.5 4 4 9-9.5"/>',
  alert: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4"/><circle cx="12" cy="16.8" r=".7" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".7" fill="currentColor"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
  terminal: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m7.5 10 2.5 2-2.5 2M12 15h4"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4h-4"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  more: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  key: '<circle cx="8" cy="14" r="3.8"/><path d="M10.8 11.2 19 3M15.5 6.5l2.5 2.5M13.5 8.5l2 2"/>',
  eyeoff: '<path d="M4 4l16 16"/><path d="M10 6.3A8.6 8.6 0 0 1 12 6c5 0 8.5 6 8.5 6a14 14 0 0 1-2.4 3M6.4 7.8C4.6 9.3 3.5 12 3.5 12s3.5 6 8.5 6a8 8 0 0 0 3.6-.9"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1-3.5 3.8-5 7-5s6 1.5 7 5"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z"/><path d="M10 20.5h4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  monitor: '<rect x="3.5" y="4.5" width="17" height="11.5" rx="2"/><path d="M9 20h6M12 16v4"/>',
  server: '<rect x="4" y="4.5" width="16" height="6.5" rx="1.5"/><rect x="4" y="13" width="16" height="6.5" rx="1.5"/><path d="M7.5 7.8h.1M7.5 16.2h.1"/>',
  wifioff: '<path d="M4 4l16 16"/><path d="M8.5 16a5 5 0 0 1 7 0M5.5 12.5a9.7 9.7 0 0 1 4-2.3M14.8 10.3a9.7 9.7 0 0 1 3.7 2.2M2.5 9a14 14 0 0 1 4.5-2.7M12 5.5a14 14 0 0 1 9.5 3.5"/><circle cx="12" cy="19" r=".8" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  branch: '<circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="8" r="2"/><path d="M7 8v8M17 10c0 4-10 2-10 6"/>',
  file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/>',
  spark: '<path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M17.5 6.5 15 9M9 15l-2.5 2.5"/>',
  box: '<path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z"/><path d="M4 7.5 12 11l8-3.5M12 11v9"/>',
  sort: '<path d="M8 5v14M5 16l3 3 3-3M16 19V5M13 8l3-3 3 3"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16 8.5 4.5 8.5-4.5"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4h4"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16"/><path d="M4.5 11.5H15a4.5 4.5 0 0 1 0 9h-2"/>',
  wand: '<path d="m4 20 11-11M14 5V3M18 9h2M17 6l1.5-1.5M10 6l-1-1M18 13l1 1"/>',
  keyboard: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10h.1M10.5 10h.1M14 10h.1M17.5 10h.1M7.5 14h9"/>',
  apple: '<path d="M15.5 4.5c-.5 1.5-1.8 2.5-3 2.4.1-1.4 1.2-2.6 3-2.4zM12.5 8c1 0 2-.6 3.2-.6 1.6 0 2.8.9 3.4 2.1-3 1.6-2.4 5.6.4 6.6-.6 1.6-1.8 3.4-3.2 3.4-1.1 0-1.6-.6-3-.6s-2 .6-3 .6c-1.6 0-4.3-3.6-4.3-7.3 0-3 1.9-4.6 3.8-4.6 1.1 0 1.9.4 2.7.4z"/>',
  linux: '<path d="M12 3.5c-2 0-3 1.6-3 4 0 1.8-.6 2.7-1.6 4.2C6.2 13.5 5.5 15 5.5 16.5c0 1 .6 1.5 1.5 1.5h10c.9 0 1.5-.5 1.5-1.5 0-1.5-.7-3-1.9-4.8-1-1.5-1.6-2.4-1.6-4.2 0-2.4-1-4-3-4z"/><path d="M9 18c0 1.3 1.3 2.5 3 2.5s3-1.2 3-2.5"/>',
  windows: '<path d="M4 6.2 10.8 5.2v6.3H4zM12.2 5 20 3.8v7.7h-7.8zM4 12.9h6.8v6.3L4 18.2zM12.2 12.9H20v7.7L12.2 19.4z"/>',
  docker: '<path d="M3.5 12.5h15.5c.8-1.4 2-1.8 2-1.8s-.8-1-2.2-.6c-.2-1.3-1.2-2-1.2-2s-1 1.1-.7 2.4H3.5c0 4.5 3 7 7.5 7 4 0 6.6-1.8 8-5"/><path d="M6 10h2.5v2.5H6zM9 10h2.5v2.5H9zM12 10h2.5v2.5H12zM9 7h2.5v2.5H9z"/>'
};
const ic = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const MARK = (sz = 22) => {
  const ink = 'currentColor';
  let s = `<svg viewBox="0 0 48 48" width="${sz}" height="${sz}" aria-label="${BRAND}"><circle cx="24" cy="24" r="7.4" fill="${ink}"/>`;
  for (let k = 0; k < 6; k++) {
    const a = (-90 + 60 * k) * Math.PI / 180;
    const x = 24 + 17 * Math.cos(a), y = 24 + 17 * Math.sin(a);
    s += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="5.6" fill="${k === 1 ? 'var(--accent)' : ink}"/>`;
  }
  return s + '</svg>';
};

const HUES = { Wira: 277, Raka: 200, Hendra: 25, Laras: 150, Jono: 320, Bima: 75, Nadia: 350, Sekar: 240, Dimas: 110, Tari: 290, Zhafron: 0 };
const av = (name, cls = '') => {
  const h = HUES[name] ?? 260;
  const bg = name === 'Zhafron' ? 'oklch(0.45 0.02 268)' : `oklch(0.56 0.13 ${h})`;
  return `<span class="av ${cls}" style="background:${bg}">${name.slice(0, 2)}</span>`;
};
const who = (name, sub = '') => `<span class="who">${av(name)}<span>${name}${sub ? ` <span class="sub">${sub}</span>` : ''}</span></span>`;

const AGENTS = [
  { n: 'Wira', role: 'CEO', st: 'run', model: 'claude-opus-5-5', think: 'high', ov: 2, runs: 41, cost: '18.40', task: 'ZHA-5103 WhatsApp report' },
  { n: 'Jono', role: 'Head Director', st: 'idle', model: 'claude-opus-5-5', think: 'high', ov: 0, runs: 12, cost: '6.10', task: '-' },
  { n: 'Raka', role: 'OSS Dev', st: 'run', model: 'claude-opus-5-5', think: 'high', ov: 3, runs: 27, cost: '22.75', task: 'ZHA-5100 rebrand mockup' },
  { n: 'Hendra', role: 'Reviewer', st: 'idle', model: 'gpt-6.1-sol', think: 'xhigh', ov: 4, runs: 33, cost: '14.02', task: '-' },
  { n: 'Laras', role: 'Researcher', st: 'wait', model: 'claude-opus-5-5', think: 'medium', ov: 1, runs: 9, cost: '3.88', task: 'ZHA-5094 vendor map' },
  { n: 'Bima', role: 'Mint farmer', st: 'run', model: 'deepseek-v4.1-flash', think: 'low', ov: 5, runs: 96, cost: '1.92', task: 'Scan AgenticMint' },
  { n: 'Nadia', role: 'Frontend', st: 'idle', model: 'claude-opus-5-5', think: 'high', ov: 0, runs: 14, cost: '7.60', task: '-' },
  { n: 'Sekar', role: 'Odoo engineer', st: 'err', model: 'claude-opus-5-5', think: 'high', ov: 1, runs: 19, cost: '9.30', task: 'DCM19 wave 4' },
  { n: 'Dimas', role: 'HMX engineer', st: 'idle', model: 'gpt-6.1-sol', think: 'high', ov: 2, runs: 22, cost: '11.45', task: '-' },
  { n: 'Tari', role: 'Ops', st: 'idle', model: 'claude-sonnet-5', think: 'medium', ov: 0, runs: 31, cost: '2.70', task: '-' }
];
const stBadge = (s) => ({ run: '<span class="badge b-run"><i class="d"></i>Running</span>', idle: '<span class="badge"><i class="d"></i>Idle</span>', wait: '<span class="badge b-warn"><i class="d"></i>Waiting on you</span>', err: '<span class="badge b-bad"><i class="d"></i>Failed</span>', done: '<span class="badge b-ok"><i class="d"></i>Done</span>', review: '<span class="badge b-acc"><i class="d"></i>In review</span>', blocked: '<span class="badge b-warn"><i class="d"></i>Blocked</span>', todo: '<span class="badge b-line"><i class="d"></i>To do</span>' }[s]);

const TASKS = [
  ['ZHA-5100', 'Wardmote rebrand: mockup PDF, OMP-only onboarding, config center', 'Raka', 'run', 'High', '2 min'],
  ['ZHA-5103', 'Report rebrand PDF to Zhafron on WhatsApp', 'Wira', 'blocked', 'Medium', '4 min'],
  ['ZHA-5098', 'Review: overlay precedence for per-agent OMP settings', 'Hendra', 'review', 'High', '18 min'],
  ['ZHA-5094', 'Map OMP config schema to a typed form generator', 'Laras', 'wait', 'Medium', '32 min'],
  ['ZHA-5091', 'DCM19 wave 4: sales order chain ACL', 'Sekar', 'err', 'High', '41 min'],
  ['ZHA-5088', 'Mint farm: settle AGC cycle 2 and log gas', 'Bima', 'run', 'Low', '1 h'],
  ['ZHA-5085', 'HMX purchase approvals: delegate timeout', 'Dimas', 'todo', 'Medium', '2 h'],
  ['ZHA-5079', 'Local Browser: Firefox 1.3.1 signed xpi', 'Raka', 'done', 'Medium', '3 h'],
  ['ZHA-5077', 'Hindsight weekly curation', 'Tari', 'done', 'Low', '5 h'],
  ['ZHA-5072', 'Costs page: per-model breakdown', 'Nadia', 'todo', 'Low', '1 d'],
  ['ZHA-5069', 'OpenWA admission outcome counters', 'Raka', 'done', 'Medium', '1 d'],
  ['ZHA-5061', 'Org chart: show reporting lines on mobile', 'Nadia', 'todo', 'Low', '2 d'],
  ['ZHA-5058', 'Routine: nightly backup verification', 'Tari', 'done', 'Medium', '2 d'],
  ['ZHA-5050', 'Paperclip runner: drop unused drivers', 'Dimas', 'blocked', 'Low', '3 d']
];

function nav(active, counts = {}) {
  const item = (k, icon, label, ct = '', hot = false) => `<a class="${k === active ? 'on' : ''}">${ic(icon)}<span>${label}</span>${ct !== '' ? `<span class="ct ${hot ? 'hot' : ''}">${ct}</span>` : ''}</a>`;
  return `<nav class="nav" aria-label="Main">
  <div class="brand">${MARK()}<b>${BRAND}</b><span class="co">${ic('down', 'i-14')}</span></div>
  <div class="search">${ic('search', 'i-14')}<span>Search</span><kbd>Ctrl K</kbd></div>
  ${item('dashboard', 'home', 'Home')}
  ${item('inbox', 'inbox', 'Inbox', counts.inbox ?? 4, true)}
  ${item('chat', 'chat', 'Chat')}
  <div class="sec">Work</div>
  ${item('tasks', 'task', 'Tasks', 128)}
  ${item('projects', 'folder', 'Projects')}
  ${item('routines', 'repeat', 'Routines')}
  ${item('goals', 'target', 'Goals')}
  <div class="sec">Team</div>
  ${item('agents', 'bot', 'Agents', 21)}
  ${item('org', 'org', 'Org chart')}
  ${item('omp', 'sliders', 'OMP config')}
  ${item('connectors', 'plug', 'Connectors')}
  <div class="sec">Company</div>
  ${item('costs', 'coins', 'Costs')}
  ${item('activity', 'activity', 'Activity')}
  ${item('settings', 'settings', 'Settings')}
  <div class="foot">${av('Zhafron')}<span class="who"><b>Zhafron</b><span>Zhafron Labs</span></span><span class="sp"></span>${ic(THEME === 'dark' ? 'sun' : 'moon')}</div>
</nav>`;
}

function topbar(crumbs, right = '') {
  const c = crumbs.map((x, i) => i === crumbs.length - 1 ? `<b>${x}</b>` : `<span>${x}</span>${ic('right', 'i-14')}`).join('');
  return `<header class="top"><div class="crumb">${c}</div><div class="sp"></div>${right}</header>`;
}

function shell(active, crumbs, right, body, opts = {}) {
  return `<div class="app">${nav(active, opts.counts)}<main class="main">${topbar(crumbs, right)}<div class="body ${opts.flush ? 'flush' : ''}">${body}</div></main>${opts.over || ''}</div>`;
}

const S = {};
