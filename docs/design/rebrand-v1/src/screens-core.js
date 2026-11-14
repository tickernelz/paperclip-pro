const prioDot = (p) => `<span class="row" style="gap:6px"><span class="dot ${p === 'High' ? 'bad' : p === 'Medium' ? 'warn' : ''}"></span>${p}</span>`;

S.dashboard = () => shell('dashboard', ['Zhafron Labs', 'Home'], `<span class="btn">${ic('plus')}New task</span>`, `
<div class="ph"><div class="t"><h1>Good afternoon, Zhafron</h1><span class="sub">3 agents running · 4 items need you · spend today $14.20 of $40.00</span></div></div>
<div class="grid g4">
  <div class="card kpi"><div class="l">Needs you</div><div class="v">4</div><div class="dl sub">2 decisions · 1 approval · 1 question</div></div>
  <div class="card kpi"><div class="l">Running now</div><div class="v">3<small>of 21 agents</small></div><div class="dl sub">longest: Raka 38 min</div></div>
  <div class="card kpi"><div class="l">Done today</div><div class="v">17<small>tasks</small></div><div class="dl" style="color:var(--ok)">+5 vs yesterday</div></div>
  <div class="card kpi"><div class="l">Spend today</div><div class="v">$14.20</div><div class="bar" style="margin-top:8px"><i style="width:35%;background:var(--accent)"></i></div></div>
</div>
<div class="grid" style="grid-template-columns:1.35fr 1fr;flex:1;min-height:0">
  <div class="card" style="display:flex;flex-direction:column;min-height:0"><div class="hd"><h3>Needs you</h3><span class="sp"></span><span class="btn ghost sm">Open inbox ${ic('right', 'i-14')}</span></div>
   <div class="list">
    <div class="li">${av('Raka')}<span class="m"><b>Approve push of design/rebrand-v1 and open draft PR</b><span>ZHA-5100 · Decision · asked 6 min ago</span></span><span class="btn sm">Decline</span><span class="btn pri sm">Approve</span></div>
    <div class="li">${av('Bima')}<span class="m"><b>Resume mint guard after HALT R8 (false positive, balance verified)</b><span>ZHA-4930 · Approval · 22 min ago</span></span><span class="btn sm">Review</span></div>
    <div class="li">${av('Laras')}<span class="m"><b>Which OMP sections count as Essential?</b><span>ZHA-5094 · Question · 3 options · 31 min ago</span></span><span class="btn sm">Answer</span></div>
    <div class="li">${av('Hendra')}<span class="m"><b>Hire request: QA agent with omp_local, budget $30/mo</b><span>Approval · 1 h ago</span></span><span class="btn sm">Review</span></div>
   </div></div>
  <div class="card" style="display:flex;flex-direction:column;min-height:0"><div class="hd"><h3>Running now</h3><span class="sp"></span><span class="sub">live</span></div>
   <div class="list">
    ${AGENTS.filter(a => a.st === 'run').map(a => `<div class="li">${av(a.n)}<span class="m"><b>${a.n} <span class="sub" style="font-weight:400">${a.role}</span></b><span>${a.task}</span></span><span class="ts">${a.model}</span><span class="dot run"></span></div>`).join('')}
    <div class="li">${av('Sekar')}<span class="m"><b>Sekar <span class="sub" style="font-weight:400">Odoo engineer</span></b><span style="color:var(--bad)">Run failed: provider 429 after 3 fallbacks</span></span><span class="btn sm">${ic('refresh', 'i-14')}Retry</span></div>
   </div>
   <div class="bd" style="margin-top:auto;border-top:1px solid var(--line-soft)"><div class="row sub" style="justify-content:space-between"><span>Runs, last 14 days</span><span class="mono">412 runs</span></div><div class="chart" style="height:70px">${[22,30,18,34,40,28,12,9,31,38,44,36,41,29].map((v, i) => `<i style="height:${v * 2}%"></i>`).join('')}</div></div></div>
</div>`);

const inboxRows = [
  ['Raka', 'Approve push of design/rebrand-v1 and open draft PR', 'ZHA-5100 · Decision', '6 min', true, 'dec'],
  ['Bima', 'Resume mint guard after HALT R8', 'ZHA-4930 · Approval', '22 min', true, 'app'],
  ['Laras', 'Which OMP sections count as Essential?', 'ZHA-5094 · Question', '31 min', true, 'q'],
  ['Hendra', 'Hire request: QA agent', 'Approval', '1 h', true, 'app'],
  ['Wira', 'Weekly report sent to WhatsApp', 'ZHA-5076 · Done', '3 h', false, 'info'],
  ['Sekar', 'Run failed: provider 429', 'ZHA-5091 · Failure', '41 min', false, 'err'],
  ['Tari', 'Backup verification passed', 'Routine · Done', '5 h', false, 'info']
];
S.inbox = () => shell('inbox', ['Zhafron Labs', 'Inbox'], `<span class="seg"><span class="on">Needs me</span><span>Decisions</span><span>Approvals</span><span>All</span></span>`, `
<div class="split" style="grid-template-columns:420px 1fr">
 <div style="border-right:1px solid var(--line-soft);display:flex;flex-direction:column;min-height:0">
  <div class="row" style="padding:10px 14px;border-bottom:1px solid var(--line-soft)"><span class="input ph" style="flex:1">${ic('search', 'i-14')}Filter inbox</span><span class="iconbtn">${ic('filter')}</span></div>
  <div class="list">${inboxRows.map((r, i) => `<div class="li ${i === 0 ? 'sel' : ''} ${r[4] ? 'unread' : ''}">${av(r[0])}<span class="m"><b>${r[1]}</b><span>${r[2]}</span></span><span class="ts">${r[3]}</span></div>`).join('')}</div>
 </div>
 <div style="display:flex;flex-direction:column;min-height:0;padding:20px 28px;gap:16px;overflow:hidden">
  <div class="row"><span class="badge b-acc">Decision</span><span class="id mono sub">ZHA-5100</span><span class="sp"></span><span class="ts">asked 6 min ago by</span>${who('Raka')}</div>
  <h1>Approve push of design/rebrand-v1 and open draft PR</h1>
  <p style="margin:0;color:var(--ink-2);max-width:640px">The mockup PDF and its sources are committed on <span class="mono">design/rebrand-v1</span> (3 commits, docs only, 41 files). Pushing starts CI; the docs lane runs the documentation suite only.</p>
  <div class="card"><div class="bd col" style="gap:10px">
   <div class="row"><span class="chk on">${ic('check', 'i-14')}</span><b>Push branch and open a draft PR</b><span class="badge b-ok" style="margin-left:auto">Recommended</span></div>
   <div class="sub" style="padding-left:24px">Not destructive · reversible by closing the PR · no deploy</div>
   <div class="row"><span class="chk"></span><span>Keep local until I read the PDF</span></div>
  </div></div>
  <div class="field"><label>Note for Raka (optional)</label><div class="composer" style="min-height:70px"><span class="ph">Add context the agent should follow</span></div></div>
  <div class="row"><span class="btn">Decline</span><span class="sp"></span><span class="sub"><kbd>A</kbd> approve · <kbd>D</kbd> decline · <kbd>J</kbd>/<kbd>K</kbd> next</span><span class="btn pri">${ic('check', 'i-14')}Approve</span></div>
 </div>
</div>`, { flush: true });

S.approvals = () => shell('inbox', ['Zhafron Labs', 'Inbox', 'Approvals'], `<span class="seg"><span>Needs me</span><span>Decisions</span><span class="on">Approvals</span><span>All</span></span>`, `
<div class="ph"><div class="t"><h1>Approvals</h1><span class="sub">Hires, budget raises, guard resumes and deploys wait here until a board member decides</span></div><span class="sp"></span><span class="seg"><span class="on">Pending 2</span><span>All 148</span></span></div>
<div class="grid g2" style="align-items:start">
 <div class="card"><div class="hd">${av('Hendra')}<div class="col" style="gap:0"><h3>Hire: QA agent</h3><span class="sub">requested by Hendra · 1 h ago</span></div><span class="sp"></span><span class="badge b-warn">Pending</span></div>
  <div class="bd col"><dl class="prop"><dt>Role</dt><dd>QA engineer</dd><dt>Reports to</dt><dd>${who('Jono')}</dd><dt>Adapter</dt><dd><span class="mono">omp</span> (only option)</dd><dt>Model</dt><dd><span class="mono">claude-sonnet-5</span><span class="src src-g">Global</span></dd><dt>Budget</dt><dd class="mono">$30.00 / month</dd><dt>Overrides</dt><dd>2 keys: <span class="mono">thinking</span>, <span class="mono">tools.browser</span></dd></dl>
  <div class="row" style="margin-top:6px"><span class="btn">Request changes</span><span class="sp"></span><span class="btn">Reject</span><span class="btn pri">Approve hire</span></div></div></div>
 <div class="card"><div class="hd">${av('Bima')}<div class="col" style="gap:0"><h3>Resume mint guard</h3><span class="sub">requested by Bima · 22 min ago</span></div><span class="sp"></span><span class="badge b-warn">Pending</span></div>
  <div class="bd col"><div class="note info">${ic('info')}<span>HALT R8 on BNB at 08:33. Balance delta equals the last own transaction's gas exactly (0.0000168 BNB).</span></div><dl class="prop"><dt>Capital</dt><dd class="mono">$3.00</dd><dt>Gas today</dt><dd class="mono">0.0000145 BNB</dd><dt>Evidence</dt><dd><span class="btn ghost sm">${ic('file', 'i-14')}receipt-0x86c2.json</span></dd></dl>
  <div class="row" style="margin-top:6px"><span class="sp"></span><span class="btn">Keep halted</span><span class="btn pri">Resume</span></div></div></div>
</div>`);

S.tasks = () => shell('tasks', ['Zhafron Labs', 'Tasks'], `<span class="btn ghost">${ic('filter')}Filter</span><span class="btn ghost">${ic('sort')}Updated</span><span class="btn pri">${ic('plus')}New task</span>`, `
<div class="tabs"><span class="on">Active <span class="ct">23</span></span><span>Mine <span class="ct">4</span></span><span>Backlog <span class="ct">61</span></span><span>Done <span class="ct">1,204</span></span><span>All</span></div>
<table class="tbl"><thead><tr><th style="width:92px">ID</th><th>Title</th><th style="width:150px">Assignee</th><th style="width:140px">Status</th><th style="width:96px">Priority</th><th style="width:80px">Updated</th></tr></thead><tbody>
${TASKS.map((t, i) => `<tr class="${i === 0 ? 'sel' : i === 2 ? 'hov' : ''}"><td class="id">${t[0]}</td><td class="t">${t[1]}</td><td>${who(t[2])}</td><td>${stBadge(t[3])}</td><td>${prioDot(t[4])}</td><td class="ts">${t[5]}</td></tr>`).join('')}
</tbody></table>`);

S.task = () => shell('tasks', ['Zhafron Labs', 'Tasks', 'ZHA-5100'], `<span class="btn ghost">${ic('link')}Share</span><span class="btn">${stBadge('run')}</span>`, `
<div class="split" style="grid-template-columns:1fr 320px">
 <div style="display:flex;flex-direction:column;min-height:0;overflow:hidden">
  <div style="padding:18px 28px 0"><div class="row"><span class="id mono sub">ZHA-5100</span><span class="badge b-line">rebrand</span></div><h1 style="margin-top:6px">Wardmote rebrand: mockup PDF, OMP-only onboarding, config center</h1></div>
  <div class="tabs" style="padding:0 20px;margin-top:10px"><span class="on">Conversation</span><span>Runs <span class="ct">3</span></span><span>Files <span class="ct">2</span></span><span>Activity</span></div>
  <div class="thread" style="padding:16px 28px;flex:1;overflow:hidden">
   <div class="msg">${av('Wira')}<div class="bub"><div class="h"><b>Wira</b><span class="ts">13:12</span></div><div class="tx">Zhafron confirmed the name: Wardmote. Add a logo proposal and keep A to I.</div></div></div>
   <div class="msg">${av('Raka')}<div class="bub"><div class="h"><b>Raka</b><span class="ts">13:41</span><span class="badge b-run" style="height:18px"><i class="d"></i>live</span></div><div class="tx">Measured at b681cebf8: 602 OMP settings, 811 conflicting files on a fresh upstream merge. Drawing three logo directions now.</div>
    <div class="tool" style="margin-top:8px"><div class="th">${ic('terminal', 'i-14')}bash<span class="sp"></span><span style="color:var(--ok)">exit 0 · 2.6 s</span></div><div class="tb">$ git merge-tree --write-tree --name-only HEAD upstream/master | wc -l
742</div></div>
    <div class="tool" style="margin-top:6px"><div class="th">${ic('file', 'i-14')}write docs/design/rebrand-v1/logo/build.py<span class="sp"></span><span class="ts">+184</span></div></div>
    <div class="row sub" style="margin-top:8px"><span class="dot run"></span>Thinking · rendering mark at 16 px</div></div></div>
  </div>
  <div style="padding:12px 28px 18px"><div class="composer"><span class="ph">Reply, or type / for actions. The agent reads this on its next turn.</span><div class="row"><span class="iconbtn">${ic('file')}</span><span class="sp"></span><span class="sub"><kbd>Ctrl Enter</kbd></span><span class="btn pri sm">Send</span></div></div></div>
 </div>
 <aside class="panel" style="padding:16px">
  <dl class="prop"><dt>Status</dt><dd>${stBadge('run')}</dd><dt>Assignee</dt><dd>${who('Raka')}</dd><dt>Reviewer</dt><dd>${who('Hendra')}</dd><dt>Priority</dt><dd>${prioDot('High')}</dd><dt>Project</dt><dd>paperclip-pro</dd><dt>Parent</dt><dd class="mono">ZHA-4722</dd><dt>Model</dt><dd class="mono">opus-5-5 <span class="src src-o">Override</span></dd><dt>Spend</dt><dd class="mono">$4.12</dd></dl>
  <div class="card" style="margin-top:16px"><div class="hd"><h3>Current run</h3><span class="sp"></span><span class="ts">38 min</span></div><div class="bd col" style="gap:6px;font-size:var(--t-12)"><div class="row"><span class="sub">Session</span><span class="sp"></span><span class="mono">resumed</span></div><div class="row"><span class="sub">Context</span><span class="sp"></span><span class="mono">142k / 400k</span></div><div class="bar"><i style="width:35%;background:var(--run)"></i></div><div class="row" style="margin-top:4px"><span class="btn sm">${ic('pause', 'i-14')}Pause</span><span class="btn sm danger">${ic('stop', 'i-14')}Stop</span></div></div></div>
 </aside>
</div>`, { flush: true });

S.agents = () => shell('agents', ['Zhafron Labs', 'Agents'], `<span class="btn">${ic('sliders')}OMP defaults</span><span class="btn pri">${ic('plus')}Hire agent</span>`, `
<div class="row"><span class="input ph" style="width:280px">${ic('search', 'i-14')}Search agents</span><span class="chip on">All 21</span><span class="chip">Running 3</span><span class="chip">Waiting 1</span><span class="chip">Failed 1</span><span class="sp"></span><span class="sub">Every agent runs on OMP 18.17.0</span></div>
<table class="tbl"><thead><tr><th>Agent</th><th style="width:150px">Status</th><th style="width:200px">Model</th><th style="width:90px">Thinking</th><th style="width:100px">Overrides</th><th>Working on</th><th style="width:80px">Runs 7d</th><th style="width:90px">Spend 7d</th></tr></thead><tbody>
${AGENTS.map((a, i) => `<tr class="${i === 2 ? 'hov' : ''}"><td class="t"><span class="who">${av(a.n)}<span>${a.n} <span class="sub">${a.role}</span></span></span></td><td>${stBadge(a.st)}</td><td class="mono" style="font-size:var(--t-12)">${a.model}</td><td>${a.think}</td><td>${a.ov ? `<span class="src src-o">${a.ov} keys</span>` : '<span class="sub">none</span>'}</td><td class="sub">${a.task}</td><td class="num">${a.runs}</td><td class="num">$${a.cost}</td></tr>`).join('')}
</tbody></table>`);

S.agent = () => shell('agents', ['Zhafron Labs', 'Agents', 'Raka'], `<span class="btn">${ic('chat')}Chat</span><span class="btn pri">${ic('play')}Run now</span>`, `
<div class="row" style="gap:14px">${av('Raka', 'xl')}<div class="col" style="gap:2px"><h1>Raka</h1><span class="sub">OSS Dev · reports to Jono · omp 18.17.0 · ${stBadge('run')}</span></div></div>
<div class="tabs"><span>Overview</span><span class="on">Runs <span class="ct">27</span></span><span>OMP config <span class="ct">3</span></span><span>Instructions</span><span>Skills</span><span>Budget</span></div>
<div class="grid" style="grid-template-columns:1fr 1fr;flex:1;min-height:0">
 <div class="card" style="min-height:0;overflow:hidden"><div class="hd"><h3>Runs</h3><span class="sp"></span><span class="seg"><span class="on">All</span><span>Failed</span></span></div>
  <table class="tbl"><tbody>${[['run', 'ZHA-5100', 'issue_assigned', '38 min', '$4.12', 'fresh'], ['done', 'ZHA-5079', 'comment', '22 min', '$1.84', 'resumed'], ['done', 'ZHA-5069', 'blockers_resolved', '12 min', '$0.96', 'resumed'], ['err', 'ZHA-5052', 'timer', '3 min', '$0.11', 'resumed'], ['done', 'ZHA-5049', 'issue_assigned', '47 min', '$6.30', 'fresh'], ['done', 'ZHA-5044', 'comment', '9 min', '$0.70', 'resumed']].map((r, i) => `<tr class="${i === 0 ? 'sel' : ''}"><td style="width:24px"><span class="dot ${r[0] === 'run' ? 'run' : r[0] === 'err' ? 'bad' : 'ok'}"></span></td><td class="id" style="width:84px">${r[1]}</td><td class="sub">${r[2]}</td><td class="sub" style="width:72px">${r[5]}</td><td class="num" style="width:64px">${r[3]}</td><td class="num" style="width:64px">${r[4]}</td></tr>`).join('')}</tbody></table></div>
 <div class="card" style="display:flex;flex-direction:column;min-height:0;overflow:hidden"><div class="hd"><h3>Transcript</h3><span class="badge b-run"><i class="d"></i>live</span><span class="sp"></span><span class="ts">run 7c1e…a2</span></div>
  <div class="bd col" style="gap:8px;overflow:hidden">
   <div class="row sub" style="font-size:var(--t-12)">${ic('info', 'i-14')}Session started fresh: wake reason issue_assigned</div>
   <div class="tool"><div class="th">${ic('search', 'i-14')}find "session reset rules"<span class="sp"></span><span class="ts">0.4 s</span></div><div class="tb">server/src/services/heartbeat/run-state.ts:3
server/src/services/heartbeat/workspaces.ts:2267</div></div>
   <div class="tool"><div class="th">${ic('terminal', 'i-14')}PI_CONFIG_FILES=overlay.yml omp config get lsp.enabled<span class="sp"></span><span style="color:var(--ok)">exit 0</span></div><div class="tb">false</div></div>
   <div class="tx" style="font-size:var(--t-13)">Overlay wins over config.yml and project .omp. Last file in the list wins.</div>
   <div class="row sub" style="font-size:var(--t-12)"><span class="dot run"></span>Writing logo/build.py</div>
  </div></div>
</div>`);

S.org = () => {
  const N = (x, y, n, role, st) => `<div class="onode" style="left:${x}px;top:${y}px">${av(n, 'lg')}<span class="m"><b>${n}</b><span>${role}</span></span><span class="dot ${st}"></span></div>`;
  const E = (x, y, w, h) => `<i class="edge" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></i>`;
  return shell('org', ['Zhafron Labs', 'Org chart'], `<span class="seg"><span class="on">Tree</span><span>List</span></span><span class="btn">${ic('plus')}Hire</span>`, `
<div class="org card" style="overflow:hidden">
${E(560, 84, 2, 36)}${E(150, 120, 822, 2)}${E(150, 120, 2, 34)}${E(424, 120, 2, 34)}${E(698, 120, 2, 34)}${E(972, 120, 2, 34)}
${E(150, 214, 2, 46)}${E(150, 260, 200, 2)}${E(350, 260, 2, 30)}${E(150, 260, 2, 30)}
${E(698, 214, 2, 46)}${E(600, 260, 200, 2)}${E(600, 260, 2, 30)}${E(800, 260, 2, 30)}
${N(472, 30, 'Zhafron', 'Board', '')}
${N(62, 154, 'Wira', 'CEO', 'run')}${N(336, 154, 'Jono', 'Head Director', '')}${N(610, 154, 'Hendra', 'Reviewer', '')}${N(884, 154, 'Tari', 'Ops', '')}
${N(62, 290, 'Bima', 'Mint farmer', 'run')}${N(262, 290, 'Laras', 'Researcher', 'warn')}
${N(512, 290, 'Raka', 'OSS Dev', 'run')}${N(712, 290, 'Nadia', 'Frontend', '')}
${N(62, 420, 'Sekar', 'Odoo engineer', 'bad')}${N(262, 420, 'Dimas', 'HMX engineer', '')}
<div class="row sub" style="position:absolute;left:20px;bottom:16px;gap:16px;font-size:var(--t-12)"><span class="row"><span class="dot run"></span>running</span><span class="row"><span class="dot warn"></span>waiting on you</span><span class="row"><span class="dot bad"></span>failed</span><span>21 agents · 10 shown · drag to pan</span></div>
</div>`);
};

S.routines = () => shell('tasks', ['Zhafron Labs', 'Routines'], `<span class="btn pri">${ic('plus')}New routine</span>`, `
<div class="ph"><div class="t"><h1>Routines</h1><span class="sub">Scheduled work that opens a task for an agent</span></div></div>
<table class="tbl"><thead><tr><th>Routine</th><th style="width:160px">Agent</th><th style="width:200px">Schedule</th><th style="width:140px">Last run</th><th style="width:120px">Next</th><th style="width:70px">On</th></tr></thead><tbody>
${[['Nightly backup verification', 'Tari', 'Every day 02:00 WIB', 'done', 'in 12 h', 1], ['Scan AgenticMint leads', 'Bima', 'Every 5 min', 'done', 'in 3 min', 1], ['Weekly memory curation', 'Tari', 'Mon 09:00 WIB', 'done', 'in 2 d', 1], ['WhatsApp morning brief', 'Wira', 'Every day 07:30 WIB', 'done', 'in 18 h', 1], ['Upstream security digest', 'Raka', 'Fri 10:00 WIB', 'todo', 'in 6 d', 1], ['Cost anomaly check', 'Hendra', 'Every 6 h', 'err', 'in 2 h', 1], ['Old: Claude usage sync', 'Jono', 'Every hour', 'todo', 'paused', 0]].map(r => `<tr><td class="t">${r[0]}</td><td>${who(r[1])}</td><td class="sub">${r[2]}</td><td>${stBadge(r[3])}</td><td class="ts">${r[4]}</td><td><span class="sw ${r[5] ? 'on' : ''}"></span></td></tr>`).join('')}
</tbody></table>`);

S.costs = () => shell('costs', ['Zhafron Labs', 'Costs'], `<span class="seg"><span>Today</span><span class="on">30 days</span><span>Quarter</span></span><span class="btn">${ic('download')}CSV</span>`, `
<div class="grid g4">
 <div class="card kpi"><div class="l">Spend, 30 days</div><div class="v">$412.30</div><div class="dl sub">budget $900 · 46%</div></div>
 <div class="card kpi"><div class="l">Tokens in / out</div><div class="v">182M<small>/ 9.4M</small></div><div class="dl sub">cache hit 71%</div></div>
 <div class="card kpi"><div class="l">Runs</div><div class="v">3,118</div><div class="dl sub">$0.13 per run</div></div>
 <div class="card kpi"><div class="l">Fallbacks used</div><div class="v">64</div><div class="dl" style="color:var(--warn)">2.1% of runs</div></div>
</div>
<div class="grid" style="grid-template-columns:1.4fr 1fr;flex:1;min-height:0">
 <div class="card"><div class="hd"><h3>Daily spend by model</h3><span class="sp"></span><span class="row sub" style="gap:12px;font-size:var(--t-12)"><span class="row"><span class="dot acc"></span>opus-5-5</span><span class="row"><span class="dot run"></span>gpt-6.1-sol</span></span></div><div class="bd"><div class="chart" style="height:220px">${Array.from({ length: 30 }, (_, i) => `<i style="height:${30 + ((i * 37) % 55)}%"></i>`).join('')}</div></div></div>
 <div class="card"><div class="hd"><h3>By agent</h3></div><table class="tbl"><tbody>${AGENTS.slice(0, 8).map(a => `<tr><td>${who(a.n)}</td><td style="width:120px"><div class="bar"><i style="width:${Math.min(100, parseFloat(a.cost) * 4)}%;background:var(--accent)"></i></div></td><td class="num" style="width:70px;text-align:right">$${a.cost}</td></tr>`).join('')}</tbody></table></div>
</div>`);

S.connectors = () => shell('connectors', ['Zhafron Labs', 'Connectors'], `<span class="btn pri">${ic('plus')}Connect</span>`, `
<div class="tabs"><span class="on">Connected <span class="ct">9</span></span><span>Browse</span><span>MCP servers <span class="ct">6</span></span><span>Gateways</span><span>Review queue <span class="ct">1</span></span></div>
<div class="grid g3">
${[['chat', 'WhatsApp (OpenWA)', '3 linked numbers · 2 agents', 'ok'], ['globe', 'Local Browser', 'Firefox on linux · full tier', 'ok'], ['branch', 'GitHub', 'tickernelz · 14 repos', 'ok'], ['inbox', 'AgentMail', '2 inboxes', 'ok'], ['server', 'Paperclip projects MCP', 'http · 31 tools', 'ok'], ['chat', 'Slack', 'token expires in 3 days', 'warn'], ['coins', 'Binance wallet', 'read-only · guard on', 'ok'], ['file', 'Notion', 'not used in 30 days', ''], ['bell', 'Telegram', 'disconnected', 'bad']].map(c => `<div class="card"><div class="bd row" style="gap:12px;align-items:flex-start"><span class="empty" style="flex:none"><span class="art" style="width:40px;height:40px;border-radius:10px">${ic(c[0], 'i-20')}</span></span><div class="col" style="gap:2px;flex:1;min-width:0"><b style="font-weight:600">${c[1]}</b><span class="sub">${c[2]}</span></div>${c[3] === 'ok' ? '<span class="badge b-ok">Active</span>' : c[3] === 'warn' ? '<span class="badge b-warn">Attention</span>' : c[3] === 'bad' ? '<span class="badge b-bad">Off</span>' : '<span class="badge">Idle</span>'}</div></div>`).join('')}
</div>`);

S.browser = () => shell('connectors', ['Connectors', 'Local Browser'], `<span class="btn">${ic('refresh')}Re-pair</span>`, `
<div class="row" style="gap:14px"><span class="art" style="width:48px;height:48px;border-radius:12px;background:var(--bg-3);display:flex;align-items:center;justify-content:center">${ic('globe', 'i-20')}</span><div class="col" style="gap:2px"><h1>Local Browser</h1><span class="sub">Agents work in your signed-in browser while you watch and can take over</span></div><span class="sp"></span><span class="badge b-ok"><i class="d"></i>Firefox paired</span></div>
<div class="grid" style="grid-template-columns:1fr 1fr;flex:1;min-height:0">
 <div class="card"><div class="hd"><h3>Paired browsers</h3></div><table class="tbl"><thead><tr><th>Browser</th><th>Owner</th><th>Tier</th><th>Tabs</th></tr></thead><tbody><tr><td class="t">Firefox 147 · linux</td><td>${who('Zhafron')}</td><td><span class="badge b-acc">Full</span></td><td class="num">6</td></tr></tbody></table>
  <div class="bd col"><h3>Permissions</h3>${[['Tabs and navigation', 1], ['All sites (&lt;all_urls&gt;)', 1], ['Cookies and storage', 1], ['Downloads', 0], ['History and bookmarks', 0]].map(p => `<div class="row" style="justify-content:space-between;font-size:var(--t-13)"><span>${p[0]}</span>${p[1] ? '<span class="badge b-ok">Granted</span>' : '<span class="btn sm">Request</span>'}</div>`).join('')}</div></div>
 <div class="card"><div class="hd"><h3>Agent access</h3><span class="sp"></span><span class="sub">who may drive this browser</span></div><div class="bd col">${['Raka', 'Nadia', 'Wira', 'Sekar'].map((n, i) => `<div class="row" style="justify-content:space-between">${who(n)}<span class="sw ${i < 2 ? 'on' : ''}"></span></div>`).join('')}
  <div class="note warn">${ic('alert')}<span>Agents act as you on every signed-in site. Grant only agents whose tasks need your session.</span></div></div></div>
</div>`);

S.chat = () => shell('chat', ['Zhafron Labs', 'Chat', 'Wira'], `<span class="btn ghost">${ic('plus')}New chat</span>`, `
<div class="split" style="grid-template-columns:280px 1fr">
 <div style="border-right:1px solid var(--line-soft)"><div class="list">${[['Wira', 'Report is ready to send', '2 min'], ['Raka', 'Logo directions rendered', '9 min'], ['Hendra', 'APPROVE at 3f1c…', '1 h'], ['Laras', 'Found the schema source', '3 h'], ['Bima', 'Cycle 2 settled', '5 h']].map((c, i) => `<div class="li ${i === 0 ? 'sel' : ''}">${av(c[0])}<span class="m"><b>${c[0]}</b><span>${c[1]}</span></span><span class="ts">${c[2]}</span></div>`).join('')}</div></div>
 <div style="display:flex;flex-direction:column;min-height:0">
  <div class="thread" style="padding:20px 28px;flex:1;overflow:hidden">
   <div class="msg me"><div class="bub"><div class="tx">Status of the rebrand PDF?</div></div></div>
   <div class="msg">${av('Wira')}<div class="bub"><div class="h"><b>Wira</b><span class="ts">13:58</span></div><div class="tx">Raka is on it (ZHA-5100). Measurements are in; logo directions are being rendered and checked at 16 px. I will send the PDF here and on WhatsApp when it lands.</div>
    <div class="card" style="margin-top:8px;max-width:420px"><div class="bd row">${ic('task')}<span class="col" style="gap:0"><b style="font-weight:600">ZHA-5100</b><span class="sub">In progress · Raka · 38 min</span></span><span class="sp"></span><span class="btn sm">Open</span></div></div></div></div>
   <div class="msg me"><div class="bub"><div class="tx">Ok, ping me.</div></div></div>
  </div>
  <div style="padding:12px 28px 18px"><div class="composer"><span class="ph">Message Wira</span><div class="row"><span class="iconbtn">${ic('file')}</span><span class="sp"></span><span class="btn pri sm">Send</span></div></div></div>
 </div>
</div>`, { flush: true });

S.settings = () => shell('settings', ['Zhafron Labs', 'Settings', 'Company'], '', `
<div class="split" style="grid-template-columns:220px 1fr;gap:28px">
 <div class="col" style="gap:2px;font-size:var(--t-13)"><div class="sec sub" style="padding:4px 8px">Company</div>${['General', 'Members', 'Invites', 'Secrets', 'Environments', 'Budgets'].map((x, i) => `<a style="padding:6px 8px;border-radius:6px;${i === 0 ? 'background:var(--accent-soft);color:var(--accent);font-weight:550' : 'color:var(--ink-2)'}">${x}</a>`).join('')}<div class="sec sub" style="padding:14px 8px 4px">Instance</div>${['General', 'Access', 'OMP runtime', 'Heartbeats', 'Plugins', 'Experimental'].map(x => `<a style="padding:6px 8px;color:var(--ink-2)">${x}</a>`).join('')}</div>
 <div class="col" style="gap:18px;max-width:640px">
  <div class="col" style="gap:2px"><h1>General</h1><span class="sub">Company profile and defaults every agent inherits</span></div>
  <div class="field"><label>Company name</label><div class="input">Zhafron Labs</div></div>
  <div class="field"><label>Task prefix</label><div class="input mono" style="width:120px">ZHA</div><span class="help">Changing it renames future tasks only. Existing IDs stay.</span></div>
  <div class="field"><label>Default reviewer</label><div class="input">${who('Hendra')}<span class="sp"></span>${ic('down', 'i-14')}</div></div>
  <div class="field"><label>Theme</label><span class="seg" style="align-self:flex-start"><span>Light</span><span>Dark</span><span class="on">Follow system</span></span></div>
  <div class="field"><label>Language</label><div class="input" style="width:260px">English<span class="sp"></span>${ic('down', 'i-14')}</div><span class="help">40 locales ship today; 3 UI strings are translated (see the i18n page).</span></div>
  <div class="row" style="border-top:1px solid var(--line-soft);padding-top:14px"><span class="sub">No unsaved changes</span><span class="sp"></span><span class="btn" disabled>Save</span></div>
 </div>
</div>`);

S.instance = () => shell('settings', ['Settings', 'Instance', 'OMP runtime'], '', `
<div class="split" style="grid-template-columns:220px 1fr;gap:28px">
 <div class="col" style="gap:2px;font-size:var(--t-13)"><div class="sec sub" style="padding:4px 8px">Company</div>${['General', 'Members', 'Invites', 'Secrets', 'Environments', 'Budgets'].map(x => `<a style="padding:6px 8px;color:var(--ink-2)">${x}</a>`).join('')}<div class="sec sub" style="padding:14px 8px 4px">Instance</div>${['General', 'Access', 'OMP runtime', 'Heartbeats', 'Plugins', 'Experimental'].map((x, i) => `<a style="padding:6px 8px;border-radius:6px;${i === 2 ? 'background:var(--accent-soft);color:var(--accent);font-weight:550' : 'color:var(--ink-2)'}">${x}</a>`).join('')}</div>
 <div class="col" style="gap:16px;max-width:720px">
  <div class="col" style="gap:2px"><h1>OMP runtime</h1><span class="sub">The single agent runtime of this instance. Replaces Adapters (13 entries today).</span></div>
  <div class="card"><div class="bd col" style="gap:0">
   <div class="check"><span class="st ok">${ic('check', 'i-14')}</span><span>omp found</span><span class="v">~/.local/share/fnm/…/bin/omp</span></div>
   <div class="check"><span class="st ok">${ic('check', 'i-14')}</span><span>Version 18.17.0</span><span class="v">minimum 18.1.16 · pinned none</span></div>
   <div class="check"><span class="st ok">${ic('check', 'i-14')}</span><span>Lists 46 models from 9 providers</span><span class="v">omp models · 1.2 s</span></div>
   <div class="check"><span class="st warn">${ic('alert', 'i-14')}</span><span>Update available: 18.18.2</span><span class="v"><span class="btn sm">Update</span></span></div>
  </div></div>
  <div class="field"><label>Version policy</label><span class="seg" style="align-self:flex-start"><span class="on">Minimum 18.1.16</span><span>Pin exact</span><span>Latest</span></span><span class="help">Runs refuse to start below the minimum. The value comes from the oldest OMP feature the overlay writes (compaction.experimentalContextManagement).</span></div>
  <div class="field"><label>Execution targets</label><table class="tbl card"><tbody><tr><td class="t">${ic('monitor', 'i-14')} This machine</td><td><span class="badge b-ok">omp 18.17.0</span></td><td class="sub">default</td></tr><tr><td class="t">${ic('server', 'i-14')} lab0 · ssh</td><td><span class="badge b-warn">omp 18.9.4</span></td><td class="sub">update pending</td></tr></tbody></table></div>
 </div>
</div>`);
