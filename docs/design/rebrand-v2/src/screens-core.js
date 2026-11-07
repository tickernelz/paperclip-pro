const prio = (p) => `<span class="row" style="gap:6px"><span class="dot ${p === 'High' ? 'bad' : p === 'Medium' ? 'warn' : ''}"></span>${p}</span>`;
const INBOX = [
  ['Raka', 'Approve push of design/rebrand-v2 and open a draft PR', 'ZHA-5100 · Decision · 6 min', 'dec'],
  ['Bima', 'Resume the mint guard after a false HALT', 'ZHA-4930 · Approval · 22 min', 'app'],
  ['Laras', 'Which settings count as essential?', 'ZHA-5094 · Question · 31 min', 'q'],
  ['Hendra', 'Hire a QA agent, budget $30 a month', 'Approval · 1 h', 'app'],
  ['Sekar', 'Run failed: provider limit reached', 'ZHA-5091 · Failure · 41 min', 'err'],
  ['Wira', 'Weekly report sent to WhatsApp', 'ZHA-5076 · Done · 3 h', 'info'],
  ['Tari', 'Backup check passed', 'Routine · Done · 5 h', 'info'],
];
const decRow = (r, i, actions = true) => `<div class="li wrapli ${i === 0 && !actions ? 'sel' : ''}">${av(r[0])}<div class="li-body"><span class="li-title">${r[1]}</span><span class="li-meta">${r[2]}</span></div>${actions && r[3] === 'dec' ? `<div class="li-actions"><a class="btn sm">Decline</a><a class="btn sm pri">Approve</a></div>` : actions && r[3] !== 'info' ? `<a class="iconbtn" aria-label="Open">${ic('right')}</a>` : ''}</div>`;

S.home = () => shell('home', ['Zhafron Labs', 'Home'], `<a class="btn pri">${ic('plus')}<span class="hide-sm">New task</span></a>`, `<div class="wrap">
<div class="ph"><div class="ph-t"><h1>Good afternoon, Zhafron</h1><span class="sub">4 things need you · 3 agents working · $14.20 spent today</span></div></div>
<div class="grid g-kpi">
 <div class="card card-b"><div class="kpi-l">Needs you</div><div class="kpi-v">4</div><div class="kpi-s">2 decisions, 1 approval, 1 question</div></div>
 <div class="card card-b"><div class="kpi-l">Working now</div><div class="kpi-v">3</div><div class="kpi-s">of 21 agents</div></div>
 <div class="card card-b"><div class="kpi-l">Done today</div><div class="kpi-v">17</div><div class="kpi-s">5 more than yesterday</div></div>
 <div class="card card-b"><div class="kpi-l">Spent today</div><div class="kpi-v">$14.20</div><div class="bar" style="margin-top:8px" aria-label="35% of daily budget"><i style="width:35%"></i></div></div>
</div>
<div class="grid g-main">
 <section class="card"><div class="card-h"><h2>Needs you</h2><span class="sp"></span><a class="btn ghost sm">Open inbox</a></div><div class="list">${INBOX.slice(0, 4).map((r, i) => decRow(r, i)).join('')}</div></section>
 <section class="card"><div class="card-h"><h2>Working now</h2></div><div class="list">${AGENTS.filter((a) => a.st === 'run').map((a) => `<div class="li">${av(a.n)}<div class="li-body"><span class="li-title">${a.n} · ${a.task}</span><span class="li-meta">${a.model}</span></div><span class="dot run" aria-label="running"></span></div>`).join('')}<div class="li wrapli">${av('Sekar')}<div class="li-body"><span class="li-title">Sekar · DCM19 wave 4</span><span class="li-meta">Failed: provider limit reached after 3 backups</span></div><div class="li-actions"><a class="btn sm">${ic('refresh', 'i-14')}Retry</a></div></div></div></section>
 <section class="card hide-md-only"><div class="card-h"><h2>Runs, 14 days</h2><span class="sp"></span><span class="ts">412</span></div><div class="card-b"><div class="chart" aria-label="bar chart of daily runs">${[22, 30, 18, 34, 40, 28, 12, 9, 31, 38, 44, 36, 41, 29].map((v) => `<i style="height:${v * 2}%"></i>`).join('')}</div></div></section>
</div></div>`);

S.inbox = () => shell('inbox', ['Zhafron Labs', 'Inbox'], `<span class="seg hide-sm"><span class="on">Needs me</span><span>Decisions</span><span>Approvals</span><span>All</span></span>`, `
<div class="split">
 <div class="pane list-pane"><div class="row show-sm pad" style="padding-bottom:0"><span class="seg"><span class="on">Needs me 4</span><span>All</span></span></div><div class="list">${INBOX.map((r, i) => decRow(r, i, false)).join('')}</div></div>
 <div class="pane detail-pane pad" style="gap:14px">${decisionDetail()}</div>
</div>`, { flush: true });

function decisionDetail() {
  return `<div class="row wrapr"><span class="badge b-acc">Decision</span><span class="ts">ZHA-5100</span><span class="sp"></span><span class="sub">asked 6 min ago by</span>${who('Raka')}</div>
  <h1>Approve push of design/rebrand-v2 and open a draft PR</h1>
  <p style="color:var(--ink-2);max-width:62ch">Docs only: 1 commit, 112 files under docs/design/rebrand-v2. Pushing starts CI; nothing is deployed.</p>
  <div class="col" style="gap:8px"><div class="opt on"><span class="radio"></span><div class="opt-k"><b class="opt-t">Push and open a draft PR</b><span class="opt-d">Recommended · reversible by closing the PR</span></div></div><div class="opt"><span class="radio"></span><div class="opt-k"><b class="opt-t">Keep it local until I read the PDF</b><span class="opt-d">Raka waits</span></div></div></div>
  <div class="field"><span class="label">Note for Raka (optional)</span><div class="input ph area">Anything the agent should follow</div></div>
  <div class="row wrapr"><a class="btn">Decline</a><span class="sp"></span><span class="sub hide-sm"><kbd>A</kbd> approve · <kbd>D</kbd> decline · <kbd>J</kbd> <kbd>K</kbd> move</span><a class="btn pri">${ic('check', 'i-14')}Approve</a></div>`;
}
S['inbox-item'] = () => shell('inbox', ['Inbox', 'ZHA-5100'], `<a class="iconbtn" aria-label="More">${ic('more')}</a>`, `<div class="split showdetail"><div class="pane list-pane"></div><div class="pane detail-pane pad" style="gap:14px">${decisionDetail()}</div></div>`, { flush: true });

S.approvals = () => shell('inbox', ['Zhafron Labs', 'Inbox', 'Approvals'], '', `<div class="wrap">
<div class="ph"><div class="ph-t"><h1>Approvals</h1><span class="sub">Hires, budgets, guard resumes and deploys wait here for a board member</span></div><span class="seg"><span class="on">Pending 2</span><span>All 148</span></span></div>
<div class="grid g-cards">
 <section class="card"><div class="card-h">${av('Hendra')}<div class="col" style="gap:0"><h2>Hire a QA agent</h2><span class="sub">Hendra · 1 h ago</span></div><span class="sp"></span><span class="badge b-warn">Pending</span></div>
  <div class="card-b col" style="gap:12px"><dl class="prop"><dt>Role</dt><dd>QA engineer</dd><dt>Reports to</dt><dd>${who('Jono')}</dd><dt>Setup</dt><dd>Company defaults, 1 change: Thinking Deep</dd><dt>Budget</dt><dd class="mono">$30.00 a month</dd></dl>
  <div class="row wrapr"><a class="btn">Ask for changes</a><span class="sp"></span><a class="btn">Reject</a><a class="btn pri">Approve hire</a></div></div></section>
 <section class="card"><div class="card-h">${av('Bima')}<div class="col" style="gap:0"><h2>Resume the mint guard</h2><span class="sub">Bima · 22 min ago</span></div><span class="sp"></span><span class="badge b-warn">Pending</span></div>
  <div class="card-b col" style="gap:12px"><div class="note info">${ic('info', 'note-i')}<span>The balance drop equals the gas of the guard's own last transaction exactly.</span></div><dl class="prop"><dt>Capital</dt><dd class="mono">$3.00</dd><dt>Evidence</dt><dd><a class="btn link">receipt-0x86c2.json</a></dd></dl>
  <div class="row wrapr"><span class="sp"></span><a class="btn">Keep halted</a><a class="btn pri">Resume</a></div></div></section>
</div></div>`);

S.tasks = () => shell('tasks', ['Zhafron Labs', 'Tasks'], `<a class="iconbtn" aria-label="Filter">${ic('filter')}</a><a class="btn pri">${ic('plus')}<span class="hide-sm">New task</span></a>`, `
<div class="tabs"><span class="on">Active 23</span><span>Mine 4</span><span>Backlog 61</span><span>Done</span></div>
<table class="tbl"><thead><tr><th style="width:96px">ID</th><th>Title</th><th style="width:150px">Assignee</th><th style="width:140px">Status</th><th style="width:100px">Priority</th><th style="width:84px">Updated</th></tr></thead><tbody>
${TASKS.map((t, i) => `<tr class="${i === 0 ? 'sel' : ''}"><td class="id c-hide">${t[0]}</td><td class="t c-title">${t[1]}</td><td class="c-meta">${who(t[2])}<span class="show-sm-inline"> · ${t[0]} · ${t[5]}</span></td><td class="c-end">${stBadge(t[3])}</td><td class="c-hide">${prio(t[4])}</td><td class="ts c-hide">${t[5]}</td></tr>`).join('')}
</tbody></table>`);

S.task = () => shell('tasks', ['Zhafron Labs', 'Tasks', 'ZHA-5100'], `<a class="iconbtn" aria-label="Share">${ic('link')}</a>${stBadge('run')}`, `
<div class="split detail">
 <div class="pane"><div class="pad" style="padding-bottom:0"><span class="ts">ZHA-5100</span><h1 style="margin-top:4px">Wardmote rebrand v2: mockup PDF, simpler setup, Features menu</h1>
  <div class="row wrapr show-md" style="margin-top:10px">${who('Raka')}<span class="badge">High</span><span class="badge">$4.12</span><a class="btn sm">Details</a></div></div>
  <div class="tabs" style="padding:0 16px;margin-top:10px"><span class="on">Conversation</span><span>Runs 3</span><span>Files 2</span><span>Activity</span></div>
  <div class="thread">
   <div class="msg">${av('Wira')}<div class="msg-body"><div class="msg-head"><b>Wira</b><span class="ts">14:36</span></div><div class="msg-text">Zhafron wants v2: fewer manual inputs, Features menu, every device, PWA.</div></div></div>
   <div class="msg">${av('Raka')}<div class="msg-body"><div class="msg-head"><b>Raka</b><span class="ts">14:52</span><span class="badge b-run"><span class="badge-dot"></span>live</span></div><div class="msg-text">Reproduced the button defect: 1.08:1 on the phone inbox. Fixing the cascade, then rendering every screen at six sizes.</div>
    <div class="tool"><div class="tool-h">${ic('terminal', 'i-14')}<span>audit-buttons.py</span><span class="sp"></span><span style="color:var(--ok)">exit 1</span></div><div class="tool-b">1170 buttons, 194 failing, lowest 1.02</div></div></div></div>
  </div>
  <div class="pad" style="padding-top:0"><div class="composer"><span class="sub">Reply, or type / for actions</span><div class="row"><a class="iconbtn" aria-label="Attach">${ic('file')}</a><span class="sp"></span><a class="btn pri sm">Send</a></div></div></div>
 </div>
 <aside class="pane pad" style="gap:16px"><dl class="prop"><dt>Status</dt><dd>${stBadge('run')}</dd><dt>Assignee</dt><dd>${who('Raka')}</dd><dt>Reviewer</dt><dd>${who('Hendra')}</dd><dt>Priority</dt><dd>${prio('High')}</dd><dt>Project</dt><dd>paperclip-pro</dd><dt>Model</dt><dd>Opus 5.5 <span class="changed-tag">changed</span></dd><dt>Spent</dt><dd class="mono">$4.12</dd></dl>
  <section class="card"><div class="card-h"><h3>Current run</h3><span class="sp"></span><span class="ts">38 min</span></div><div class="card-b col"><div class="row"><span class="sub">Context</span><span class="sp"></span><span class="mono">142k / 400k</span></div><div class="bar"><i style="width:35%;background:var(--run)"></i></div><div class="row"><a class="btn sm">${ic('pause', 'i-14')}Pause</a><a class="btn sm danger">${ic('stop', 'i-14')}Stop</a></div></div></section></aside>
</div>`, { flush: true });

S.agents = () => shell('agents', ['Zhafron Labs', 'Agents'], `<a class="btn hide-sm">${ic('sliders')}Company defaults</a><a class="btn pri">${ic('plus')}<span class="hide-sm">Hire agent</span></a>`, `
<div class="row wrapr"><div class="input ph" style="flex:1;max-width:320px">${ic('search', 'i-14')}Search agents</div><span class="chip on">All 21</span><span class="chip">Working 3</span><span class="chip">Waiting 1</span><span class="chip">Failed 1</span></div>
<table class="tbl"><thead><tr><th>Agent</th><th style="width:150px">Status</th><th style="width:170px">Model</th><th style="width:110px">Setup</th><th>Working on</th><th style="width:90px">Spent 7d</th></tr></thead><tbody>
${AGENTS.map((a) => `<tr><td class="t c-title"><span class="who">${av(a.n)}<span>${a.n} <span class="sub">${a.role}</span></span></span></td><td class="c-end">${stBadge(a.st)}</td><td class="c-meta">${MODEL_NAME[a.model] || a.model}${a.ov ? ' · <span class="changed-tag">' + a.ov + ' changed</span>' : ''}</td><td class="c-hide">${a.ov ? `<span class="changed-tag">${a.ov} changed</span>` : '<span class="sub">Defaults</span>'}</td><td class="sub c-hide">${a.task}</td><td class="num c-hide">$${a.cost}</td></tr>`).join('')}
</tbody></table>`);

const MODEL_NAME = { 'claude-opus-5-5': 'Opus 5.5', 'gpt-6.1-sol': 'GPT-6.1 Sol', 'deepseek-v4.1-flash': 'DeepSeek 4.1 Flash', 'claude-sonnet-5': 'Sonnet 5' };

S.agent = () => shell('agents', ['Zhafron Labs', 'Agents', 'Raka'], `<a class="btn hide-sm">${ic('chat')}Chat</a><a class="btn pri">${ic('play')}<span class="hide-sm">Run now</span></a>`, `
<div class="row wrapr" style="gap:12px">${av('Raka', 'lg')}<div class="col" style="gap:2px"><h1>Raka</h1><span class="sub">OSS Dev · reports to Jono</span></div><span class="sp"></span>${stBadge('run')}</div>
<div class="tabs"><span>Overview</span><span class="on">Runs 27</span><span>Setup</span><span>Instructions</span><span>Skills</span><span>Budget</span></div>
<div class="grid g-main">
 <section class="card"><div class="card-h"><h2>Runs</h2></div><table class="tbl"><tbody>${[['run', 'ZHA-5100', 'assigned', '38 min', 'fresh'], ['done', 'ZHA-5079', 'comment', '22 min', 'resumed'], ['done', 'ZHA-5069', 'blockers resolved', '12 min', 'resumed'], ['err', 'ZHA-5052', 'timer', '3 min', 'resumed'], ['done', 'ZHA-5049', 'assigned', '47 min', 'fresh']].map((r, i) => `<tr class="${i === 0 ? 'sel' : ''}"><td class="c-title" style="width:auto"><span class="row"><span class="dot ${r[0] === 'run' ? 'run' : r[0] === 'err' ? 'bad' : 'ok'}"></span><span class="mono">${r[1]}</span></span></td><td class="c-meta sub">${r[2]} · ${r[4]}</td><td class="c-end num" style="width:72px">${r[3]}</td></tr>`).join('')}</tbody></table></section>
 <section class="card"><div class="card-h"><h2>Live transcript</h2><span class="badge b-run"><span class="badge-dot"></span>live</span></div><div class="card-b col"><span class="sub">${ic('info', 'i-14')} Fresh session: newly assigned task</span><div class="tool"><div class="tool-h">${ic('terminal', 'i-14')}<span>render.sh</span><span class="sp"></span><span style="color:var(--ok)">exit 0</span></div><div class="tool-b">456 screenshots in 3 min 12 s</div></div><p class="msg-text">Every screen renders at six sizes in both themes.</p></div></section>
</div>`);

S.org = () => {
  const N = (x, y, n, role, st) => `<div class="onode" style="left:${x}px;top:${y}px">${av(n, 'lg')}<span class="col" style="gap:0"><b style="font-size:13px">${n}</b><span class="sub" style="font-size:12px">${role}</span></span>${st ? `<span class="dot ${st}"></span>` : ''}</div>`;
  const E = (x, y, w, h) => `<i class="edge" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></i>`;
  const tree = [['Zhafron', 'Board', '', 0], ['Wira', 'CEO', 'run', 1], ['Bima', 'Mint farmer', 'run', 2], ['Laras', 'Researcher', 'warn', 2], ['Jono', 'Head Director', '', 1], ['Raka', 'OSS Dev', 'run', 2], ['Nadia', 'Frontend', '', 2], ['Hendra', 'Reviewer', '', 1], ['Tari', 'Ops', '', 1]];
  return shell('org', ['Zhafron Labs', 'Org chart'], `<a class="btn">${ic('plus')}<span class="hide-sm">Hire</span></a>`, `
<div class="org card hide-sm">${E(560, 84, 2, 36)}${E(150, 120, 822, 2)}${E(150, 120, 2, 34)}${E(424, 120, 2, 34)}${E(698, 120, 2, 34)}${E(972, 120, 2, 34)}${E(150, 214, 2, 46)}${E(108, 260, 190, 2)}${E(108, 260, 2, 30)}${E(298, 260, 2, 30)}${E(424, 214, 2, 46)}${E(508, 260, 200, 2)}${E(508, 260, 2, 30)}${E(708, 260, 2, 30)}
${N(472, 30, 'Zhafron', 'Board', '')}${N(62, 154, 'Wira', 'CEO', 'run')}${N(336, 154, 'Jono', 'Head Director', '')}${N(610, 154, 'Hendra', 'Reviewer', '')}${N(884, 154, 'Tari', 'Ops', '')}${N(20, 290, 'Bima', 'Mint farmer', 'run')}${N(210, 290, 'Laras', 'Researcher', 'warn')}${N(420, 290, 'Raka', 'OSS Dev', 'run')}${N(620, 290, 'Nadia', 'Frontend', '')}</div>
<div class="card show-sm" style="flex-direction:column">${tree.map((t) => `<div class="li" style="padding-inline-start:${14 + t[3] * 20}px">${av(t[0])}<div class="li-body"><span class="li-title">${t[0]}</span><span class="li-meta">${t[1]}</span></div>${t[2] ? `<span class="dot ${t[2]}"></span>` : ''}</div>`).join('')}</div>`);
};

S.routines = () => shell('routines', ['Zhafron Labs', 'Routines'], `<a class="btn pri">${ic('plus')}<span class="hide-sm">New routine</span></a>`, `
<div class="tabs"><span class="on">Routines 7</span><span>Cases</span><span>Pipelines</span></div>
<table class="tbl"><thead><tr><th>Routine</th><th style="width:160px">Agent</th><th style="width:190px">Runs</th><th style="width:130px">Last run</th><th style="width:64px">On</th></tr></thead><tbody>
${[['Nightly backup check', 'Tari', 'Every day at 02:00', 'done', 1], ['Scan new mint leads', 'Bima', 'Every 5 minutes', 'done', 1], ['Weekly memory cleanup', 'Tari', 'Mondays at 09:00', 'done', 1], ['WhatsApp morning brief', 'Wira', 'Every day at 07:30', 'done', 1], ['Upstream security digest', 'Raka', 'Fridays at 10:00', 'todo', 1], ['Cost anomaly check', 'Hendra', 'Every 6 hours', 'err', 1]].map((r) => `<tr><td class="t c-title">${r[0]}</td><td class="c-meta">${who(r[1])} <span class="show-sm-inline">· ${r[2]}</span></td><td class="sub c-hide">${r[2]}</td><td class="c-hide">${stBadge(r[3])}</td><td class="c-end"><span class="sw ${r[4] ? 'on' : ''}" role="switch" aria-checked="${r[4] ? 'true' : 'false'}" aria-label="${r[0]}"></span></td></tr>`).join('')}
</tbody></table>`);

S.costs = () => shell('costs', ['Zhafron Labs', 'Costs'], `<span class="seg"><span>Today</span><span class="on">30 days</span><span class="hide-sm">Quarter</span></span>`, `<div class="wrap">
<div class="grid g-kpi"><div class="card card-b"><div class="kpi-l">Spent, 30 days</div><div class="kpi-v">$412.30</div><div class="kpi-s">46% of $900 budget</div></div><div class="card card-b"><div class="kpi-l">Runs</div><div class="kpi-v">3,118</div><div class="kpi-s">$0.13 per run</div></div><div class="card card-b"><div class="kpi-l">Backup model used</div><div class="kpi-v">2.1%</div><div class="kpi-s">64 runs</div></div></div>
<div class="grid g-main"><section class="card"><div class="card-h"><h2>Daily spend</h2></div><div class="card-b"><div class="chart" style="height:180px">${Array.from({ length: 30 }, (_, i) => `<i style="height:${30 + ((i * 37) % 55)}%"></i>`).join('')}</div></div></section>
<section class="card"><div class="card-h"><h2>By agent</h2></div><div class="list">${AGENTS.slice(0, 6).map((a) => `<div class="li">${who(a.n)}<span class="sp"></span><span class="num">$${a.cost}</span></div>`).join('')}</div></section></div></div>`);

S.connectors = () => shell('connectors', ['Zhafron Labs', 'Connectors'], `<a class="btn pri">${ic('plus')}<span class="hide-sm">Connect</span></a>`, `<div class="wrap">
<div class="tabs"><span class="on">Connected 9</span><span>Browse</span><span>MCP servers 6</span></div>
<div class="grid g-cards">${[['chat', 'WhatsApp', '3 numbers · 2 agents', 'ok'], ['globe', 'Local Browser', 'Firefox · full access', 'ok'], ['branch', 'GitHub', '14 repositories', 'ok'], ['inbox', 'Email', '2 inboxes', 'ok'], ['server', 'Projects MCP', '31 tools', 'ok'], ['chat', 'Slack', 'Token expires in 3 days', 'warn'], ['bell', 'Telegram', 'Disconnected', 'bad']].map((c) => `<section class="card card-b row" style="gap:12px"><span class="empty-art" style="width:40px;height:40px;border-radius:10px">${ic(c[0], 'i-20')}</span><div class="col" style="gap:2px;flex:1"><b style="font-weight:600">${c[1]}</b><span class="sub">${c[2]}</span></div>${c[3] === 'ok' ? '<span class="badge b-ok">Active</span>' : c[3] === 'warn' ? '<a class="btn sm">Renew</a>' : '<a class="btn sm">Reconnect</a>'}</section>`).join('')}</div></div>`);

S.browser = () => shell('connectors', ['Connectors', 'Local Browser'], '', `<div class="wrap narrow">
<div class="ph"><div class="ph-t"><h1>Local Browser</h1><span class="sub">Agents work in your signed-in browser while you watch</span></div><span class="badge b-ok">Firefox paired</span></div>
<section class="card"><div class="card-h"><h2>Who may use it</h2></div>${['Raka', 'Nadia', 'Wira'].map((n, i) => `<div class="setrow"><div class="setrow-k">${who(n)}</div><div class="setrow-v" style="align-items:flex-end"><span class="sw ${i < 2 ? 'on' : ''}" role="switch" aria-label="${n}"></span></div></div>`).join('')}</section>
<div class="note warn">${ic('alert', 'note-i')}<span>Agents act as you on every site you are signed in to. Allow only agents whose tasks need it.</span></div></div>`);

S.chat = () => shell('chat', ['Zhafron Labs', 'Chat', 'Wira'], '', `
<div class="split"><div class="pane list-pane hide-md"><div class="list">${[['Wira', 'PDF is ready to send', '2 min'], ['Raka', 'Six sizes rendered', '9 min'], ['Hendra', 'Approved at 3f1c', '1 h']].map((c, i) => `<div class="li ${i === 0 ? 'sel' : ''}">${av(c[0])}<div class="li-body"><span class="li-title">${c[0]}</span><span class="li-meta">${c[1]}</span></div><span class="ts">${c[2]}</span></div>`).join('')}</div></div>
<div class="pane"><div class="thread"><div class="msg me"><div class="msg-body"><div class="msg-text">Status of the rebrand PDF?</div></div></div><div class="msg">${av('Wira')}<div class="msg-body"><div class="msg-head"><b>Wira</b><span class="ts">14:58</span></div><div class="msg-text">Raka is on it. I will send the PDF here and on WhatsApp when it lands.</div></div></div></div><div class="pad" style="padding-top:0"><div class="composer"><span class="sub">Message Wira</span><div class="row"><span class="sp"></span><a class="btn pri sm">Send</a></div></div></div></div></div>`, { flush: true });

const SETTINGS_NAV = (on) => `<div class="col hide-md" style="gap:2px;width:200px;flex:none">${[['Company', ['General', 'Members', 'Secrets', 'Budgets']], ['Instance', ['OMP runtime', 'Agent defaults', 'Features', 'Advanced']]].map(([g, items]) => `<span class="nav-sec" style="padding-inline-start:8px">${g}</span>${items.map((x) => `<a class="navitem ${x === on ? 'on' : ''}">${x}</a>`).join('')}`).join('')}</div>`;
function settingsShell(on, crumbs, body, opts = {}) {
  return shell('settings', crumbs, opts.right || '', `<div class="row" style="align-items:flex-start;gap:28px;flex:1;min-height:0">${SETTINGS_NAV(on)}<div class="col" style="gap:14px;flex:1;min-height:0;max-width:820px">${body}</div></div>`, opts);
}
S.settings = () => settingsShell('General', ['Settings', 'General'], `
<div class="ph-t"><h1>General</h1><span class="sub">Company profile</span></div>
<section class="card"><div class="setrow"><div class="setrow-k"><b>Company name</b></div><div class="setrow-v"><div class="input">Zhafron Labs</div></div></div><div class="setrow"><div class="setrow-k"><b>Task prefix</b><span class="sub">New tasks only; existing IDs stay</span></div><div class="setrow-v"><div class="input mono">ZHA</div></div></div><div class="setrow"><div class="setrow-k"><b>Theme</b></div><div class="setrow-v"><span class="seg"><span>Light</span><span>Dark</span><span class="on">System</span></span></div></div><div class="setrow"><div class="setrow-k"><b>Language</b></div><div class="setrow-v"><div class="input">English${ic('down', 'i-14')}</div></div></div></section>`);
S.instance = () => settingsShell('OMP runtime', ['Settings', 'OMP runtime'], `
<div class="ph-t"><h1>OMP runtime</h1><span class="sub">Every agent runs on OMP. Checked when Wardmote starts and before each run.</span></div>
<section class="card card-b">${[['ok', 'OMP found', '~/.local/bin/omp'], ['ok', 'Version 18.17.0', 'needs 18.1.16 or newer'], ['ok', '46 models from 9 providers', 'refreshed 1 min ago'], ['warn', 'Update available: 18.18.2', '']].map((c) => `<div class="check"><span class="check-st ${c[0]}">${ic(c[0] === 'ok' ? 'check' : 'alert', 'i-14')}</span><span>${c[1]}</span><span class="check-v">${c[2]}</span>${c[0] === 'warn' ? '<a class="btn sm">Update</a>' : ''}</div>`).join('')}</section>
<section class="card"><div class="card-h"><h2>Machines</h2><span class="sp"></span><a class="btn sm">${ic('plus', 'i-14')}Add</a></div><div class="list"><div class="li">${ic('monitor')}<div class="li-body"><span class="li-title">This computer</span><span class="li-meta">OMP 18.17.0 · default</span></div><span class="badge b-ok">Ready</span></div><div class="li wrapli">${ic('server')}<div class="li-body"><span class="li-title">lab0 over SSH</span><span class="li-meta">OMP 18.9.4</span></div><a class="btn sm">Update OMP</a></div></div></section>`);
