function obShell(step, left, right) {
  const names = ['Install OMP', 'Connect a model', 'First agent', 'Done'];
  const steps = names.map((n, i) => `<span class="s ${i < step ? 'done' : i === step ? 'on' : ''}"><span class="n">${i < step ? ic('check', 'i-14') : i + 1}</span>${n}</span>`).join('<span class="ln"></span>');
  return `<div class="ob"><section class="l"><div class="row" style="gap:10px">${MARK(26)}<b style="font-size:16px;font-weight:640">${BRAND}</b></div><div class="steps">${steps}</div>${left}</section><aside class="r">${right}</aside></div>`;
}
const osTabs = (on) => `<div class="os">${[['apple', 'macOS'], ['linux', 'Linux'], ['windows', 'Windows']].map(([i, n]) => `<span class="${n === on ? 'on' : ''}">${ic(i)}${n}</span>`).join('')}</div>`;
const CMD = { macOS: 'curl -fsSL https://omp.sh/install | sh', Linux: 'curl -fsSL https://omp.sh/install | sh', Windows: 'irm https://omp.sh/install.ps1 | iex' };
const checks = (rows) => `<div class="card"><div class="bd col" style="gap:0">${rows.map(r => `<div class="check"><span class="st ${r[0]}">${ic(r[0] === 'ok' ? 'check' : r[0] === 'bad' ? 'x' : r[0] === 'warn' ? 'alert' : r[0] === 'run' ? 'refresh' : 'clock', 'i-14')}</span><span>${r[1]}</span><span class="v">${r[2] || ''}</span></div>`).join('')}</div></div>`;
const whyOmp = `<h2>Why OMP is required</h2><p class="sub" style="margin:0;font-size:var(--t-14);color:var(--ink-2)">${BRAND} runs every agent through OMP. It owns the model connection, tools, skills and sessions; ${BRAND} schedules the work, keeps the record and holds the config.</p>
<div class="col" style="gap:10px;margin-top:6px;font-size:var(--t-13)">${[['layers', 'One runtime', 'No adapter picker. 16 adapter types become one.'], ['sliders', 'Configured here', '467 settings editable in Wardmote, global or per agent.'], ['shield', 'Checked before you continue', 'Wardmote runs omp --version itself and waits for a pass.']].map(r => `<div class="row" style="align-items:flex-start;gap:12px"><span class="art" style="width:32px;height:32px;border-radius:8px;background:var(--bg-2);display:flex;align-items:center;justify-content:center;flex:none">${ic(r[0])}</span><span class="col" style="gap:0"><b style="font-weight:600">${r[1]}</b><span class="sub">${r[2]}</span></span></div>`).join('')}</div>`;

S['ob-install'] = () => obShell(0, `
<h1>Install OMP to continue</h1><p class="lede" style="margin:0">OMP is the agent runtime. Run one command, keep this page open, and it moves on by itself when the check passes.</p>
${osTabs('Linux')}
<div class="code" style="display:flex;align-items:center;font-size:13.5px"><span>${CMD.Linux}</span><span class="sp"></span><span class="btn sm">${ic('copy', 'i-14')}Copy</span></div>
<div class="sub">Other ways: <span class="mono">bun install -g @oh-my-pi/pi-coding-agent</span> · already installed elsewhere? <a style="color:var(--accent)">Set the path</a></div>
${checks([['ok', 'This machine', 'linux x64 · local'], ['run', 'Looking for omp on PATH', 'every 2 s'], ['wait', 'omp --version 18.1.16 or newer', ''], ['wait', 'omp models lists at least one model', '']])}
<div class="row" style="margin-top:auto"><span class="btn ghost">Use a remote machine</span><span class="sp"></span><span class="btn pri" disabled>Continue</span></div>`, whyOmp);

S['ob-old'] = () => obShell(0, `
<h1>OMP 18.0.2 is too old</h1><p class="lede" style="margin:0">${BRAND} needs 18.1.16 or newer. Older versions ignore settings the config center writes, so agents would run with values you did not choose.</p>
${checks([['ok', 'omp found', '/usr/local/bin/omp'], ['bad', 'Version 18.0.2', 'needs 18.1.16'], ['wait', 'omp models', 'after update']])}
<div class="code" style="display:flex;align-items:center"><span>omp update</span><span class="sp"></span><span class="btn sm">${ic('copy', 'i-14')}Copy</span></div>
<div class="note warn">${ic('alert')}<span>Two omp binaries on PATH: <span class="mono">/usr/local/bin/omp</span> (18.0.2) wins over <span class="mono">~/.bun/bin/omp</span> (18.17.0). Remove the old one or set the path.</span></div>
<div class="row" style="margin-top:auto"><span class="btn">${ic('refresh', 'i-14')}Check again</span><span class="sp"></span><span class="btn pri" disabled>Continue</span></div>`, whyOmp);

S['ob-offline'] = () => obShell(0, `
<h1>No internet connection</h1><p class="lede" style="margin:0">The install script downloads OMP from omp.sh. Connect, or install from a file you already have.</p>
${checks([['ok', 'This machine', 'linux x64'], ['bad', 'omp.sh unreachable', 'DNS failed · 3 tries'], ['wait', 'omp --version', '']])}
<div class="card"><div class="bd col"><b style="font-weight:600">Install without internet</b><span class="sub">Copy the OMP release archive to this machine, then point ${BRAND} at the binary.</span><div class="field"><label>Path to omp</label><div class="input focus">/opt/omp/bin/omp</div></div></div></div>
<div class="row" style="margin-top:auto"><span class="btn">${ic('refresh', 'i-14')}Retry download</span><span class="sp"></span><span class="btn pri">Check this path</span></div>`, `<div class="empty" style="justify-content:flex-start;align-items:flex-start;text-align:left"><span class="art">${ic('wifioff', 'i-20')}</span><h2>Offline is fine after setup</h2><p>Only install and model sign-in need the network. Agents using a local model keep running offline.</p></div>`);

S['ob-remote'] = () => obShell(0, `
<h1>Run agents on another machine</h1><p class="lede" style="margin:0">OMP must be installed where the agents run. ${BRAND} checks it over SSH with the same rules.</p>
<div class="field"><label>SSH target</label><div class="input">zhafron@lab0.kaitech.io</div></div>
<div class="field"><label>Working directory</label><div class="input mono">/srv/agents</div></div>
${checks([['ok', 'SSH connected', '42 ms'], ['ok', 'omp found', '/home/zhafron/.local/bin/omp'], ['warn', 'Version 18.9.4', 'ok, update available'], ['bad', 'omp models: no provider signed in', 'sign in below']])}
<div class="row" style="margin-top:auto"><span class="btn ghost">Back to this machine</span><span class="sp"></span><span class="btn pri">Continue to models</span></div>`, `<h2>What runs where</h2><div class="col" style="gap:8px;font-size:var(--t-13)"><div class="card"><div class="bd row">${ic('monitor')}<span class="col" style="gap:0"><b style="font-weight:600">${BRAND} server</b><span class="sub">this machine · tasks, config, record</span></span></div></div><div class="row" style="justify-content:center">${ic('down')}</div><div class="card"><div class="bd row">${ic('server')}<span class="col" style="gap:0"><b style="font-weight:600">lab0 · OMP 18.9.4</b><span class="sub">agents, tools, model calls</span></span></div></div><p class="sub" style="margin:0">The config overlay is written to the target per run (settings-overlay.ts writes it over SSH today).</p></div>`);

S['ob-model'] = () => obShell(1, `
<h1>Connect a model</h1><p class="lede" style="margin:0">Sign in or paste a key. Keys are stored in OMP's credential store on the target, never in task history.</p>
<div class="grid g3" style="gap:10px">${[['Anthropic', 'Sign in', 1], ['OpenAI', 'Sign in', 0], ['Google', 'Sign in', 0], ['OpenRouter', 'API key', 0], ['Custom (OpenAI-compatible)', 'Base URL + key', 0], ['Local (Ollama)', 'No key', 0]].map(p => `<div class="card" style="${p[2] ? 'box-shadow:0 0 0 1.5px var(--accent)' : ''}"><div class="bd col" style="gap:2px"><b style="font-weight:600">${p[0]}</b><span class="sub">${p[1]}</span></div></div>`).join('')}</div>
${checks([['ok', 'Anthropic signed in', 'zhafron@… · OAuth'], ['ok', '12 models available', 'claude-opus-5-5, claude-sonnet-5, …']])}
<div class="field"><label>Default model for new agents</label><div class="input">claude-opus-5-5<span class="sp"></span><span class="src src-g">Global</span>${ic('down', 'i-14')}</div></div>
<div class="row" style="margin-top:auto"><span class="btn ghost">Back</span><span class="sp"></span><span class="btn pri">Continue</span></div>`, `<h2>Already use OMP?</h2><p class="sub" style="margin:0;font-size:var(--t-14);color:var(--ink-2)">Import your providers and settings from <span class="mono">~/.omp/agent</span>.</p>${checks([['ok', 'config.yml', '135 keys set'], ['ok', 'models.yml', '17 providers · 535 models'], ['warn', 'API keys', 'imported masked · never shown']])}<span class="btn" style="align-self:flex-start">${ic('upload', 'i-14')}Import into Global</span>`);

S['ob-agent'] = () => obShell(2, `
<h1>Create your first agent</h1><p class="lede" style="margin:0">It inherits the global OMP config. Change only what this agent needs.</p>
<div class="field"><label>Name</label><div class="input">Atlas</div></div>
<div class="field"><label>Role</label><div class="chips">${['CEO', 'Engineer', 'Researcher', 'Reviewer', 'Ops', 'General'].map((r, i) => `<span class="chip ${i === 1 ? 'on' : ''}">${r}</span>`).join('')}</div></div>
<div class="field"><label>Working directory</label><div class="input mono">~/Projects/acme</div></div>
<div class="card"><div class="hd"><h3>OMP config</h3><span class="sp"></span><span class="sub">all from Global</span></div><div class="bd col" style="gap:6px;font-size:var(--t-13)">${[['Model', 'claude-opus-5-5'], ['Thinking', 'high'], ['Fallback', 'claude-sonnet-5 → gpt-6.1-sol'], ['Tools', 'default set (34)']].map(r => `<div class="row"><span class="sub" style="width:90px">${r[0]}</span><span class="mono">${r[1]}</span><span class="sp"></span><span class="src src-g">Global</span></div>`).join('')}</div></div>
<div class="row" style="margin-top:auto"><span class="btn ghost">Back</span><span class="sp"></span><span class="btn pri">Create agent</span></div>`, `<h2>First task</h2><div class="composer" style="min-height:120px"><span class="ph">Describe what Atlas should do first, for example: read the README and list the three riskiest modules.</span></div><span class="sub">Optional. You can also skip and assign work later.</span>`);

S['ob-done'] = () => obShell(4, `
<div class="empty" style="align-items:flex-start;text-align:left;justify-content:flex-start;gap:14px;margin-top:20px"><span class="art" style="background:var(--ok-soft);color:var(--ok)">${ic('check', 'i-20')}</span><h1>Atlas is working</h1><p style="font-size:var(--t-14);max-width:460px">Your first run started on OMP 18.17.0 with claude-opus-5-5. You will see questions and approvals in the Inbox.</p></div>
${checks([['ok', 'OMP 18.17.0', 'this machine'], ['ok', 'Anthropic · 12 models', ''], ['ok', 'Atlas created', 'Engineer'], ['run', 'First run', 'started 4 s ago']])}
<div class="row" style="margin-top:auto"><span class="sp"></span><span class="btn pri">Open Home</span></div>`, `<h2>Next</h2><div class="col" style="gap:8px">${[['sliders', 'Review the global OMP config'], ['bot', 'Hire more agents'], ['plug', 'Connect WhatsApp, GitHub, the browser']].map(r => `<div class="card"><div class="bd row">${ic(r[0])}<span>${r[1]}</span><span class="sp"></span>${ic('right', 'i-14')}</div></div>`).join('')}</div>`);

const ESS = [
  ['Model', 'model', 'claude-opus-5-5', 'g', 4, 'keep'],
  ['Thinking level', 'thinking', 'high', 'g', 3, 'keep'],
  ['Fallback chain', 'fallbackModels', 'claude-sonnet-5 → gpt-6.1-sol', 'g', 2, 'keep'],
  ['Small model', 'smolModel', 'claude-sonnet-5', 'g', 0, 'new'],
  ['Plan model', 'planModel', 'claude-opus-5-5', 'd', 0, 'new'],
  ['Advisor', 'advisor.enabled', 'on', 'g', 1, 'new'],
  ['Prewalk to small model', 'prewalk.enabled', 'off', 'd', 2, 'new'],
  ['Tools', 'tools', 'default set (34)', 'g', 3, 'new'],
  ['Company skills', 'runtime skills', '12 enabled', 'g', 5, 'keep'],
  ['MCP servers', 'mcp', 'paperclip, context7', 'g', 1, 'new'],
  ['Context notes', 'compaction.experimentalContextManagement', 'on', 'g', 0, 'new'],
  ['Max run time', 'maxTime', '60 min', 'd', 2, 'new']
];
const srcBadge = (s) => s === 'g' ? '<span class="src src-g">Global</span>' : s === 'o' ? '<span class="src src-o">Override</span>' : '<span class="src src-d">OMP default</span>';
const sessTag = (k) => k === 'keep' ? '<span class="badge b-ok" style="height:18px">keeps session</span>' : '<span class="badge b-warn" style="height:18px">new session</span>';

function cfgShell(tab, body, extra = '') {
  return shell('omp', ['Zhafron Labs', 'OMP config', tab], `<span class="btn ghost">${ic('upload')}Import config.yml</span><span class="btn ghost">${ic('download')}Export</span>`, `
<div class="tabs"><span class="${tab === 'Global' ? 'on' : ''}">Global defaults</span><span class="${tab === 'Per agent' ? 'on' : ''}">Per agent <span class="ct">21</span></span><span class="${tab === 'Providers' ? 'on' : ''}">Providers and models <span class="ct">17</span></span><span class="${tab === 'History' ? 'on' : ''}">History</span></div>${body}`, { over: extra });
}

S['cfg-global'] = () => cfgShell('Global', `
<div class="row"><span class="input ph" style="flex:1;max-width:520px">${ic('search', 'i-14')}Search 467 settings by name, key or value</span><span class="seg"><span class="on">Essential 36</span><span>Advanced 431</span><span>Changed 9</span></span><span class="sp"></span><span class="sub">Applies to 21 agents unless overridden</span></div>
<div class="card" style="flex:1;min-height:0;overflow:hidden">
 <div class="cfgh"><span>Setting</span><span>Global value</span><span>Overridden by</span><span>Session</span></div>
 <div class="grp">Model <span class="ct">7</span></div>
 ${ESS.slice(0, 7).map(r => `<div class="cfgrow"><span class="k"><b>${r[0]}</b><code>${r[1]}</code></span><span class="val"><span class="input" style="flex:1;height:28px">${r[2]}</span>${r[3] === 'd' ? srcBadge('d') : ''}</span><span class="ov">${r[4] ? `${r[4]} agents` : '-'}</span><span>${sessTag(r[5])}</span></div>`).join('')}
 <div class="grp">Tools, skills, MCP <span class="ct">9</span></div>
 ${ESS.slice(7, 10).map(r => `<div class="cfgrow"><span class="k"><b>${r[0]}</b><code>${r[1]}</code></span><span class="val"><span class="input" style="flex:1;height:28px">${r[2]}</span></span><span class="ov">${r[4] ? `${r[4]} agents` : '-'}</span><span>${sessTag(r[5])}</span></div>`).join('')}
</div>`);

const OV = [
  ['Model', 'model', 'claude-opus-5-5', 'claude-opus-5-5', 'g', 'keep'],
  ['Thinking level', 'thinking', 'high', 'xhigh', 'o', 'keep'],
  ['Fallback chain', 'fallbackModels', 'sonnet-5 → gpt-6.1-sol', 'sonnet-5 → gpt-6.1-sol', 'g', 'keep'],
  ['Advisor', 'advisor.enabled', 'on', 'on', 'g', 'new'],
  ['Prewalk', 'prewalk.enabled', 'off', 'off', 'd', 'new'],
  ['Tools', 'tools', 'default (34)', 'default + browser (35)', 'o', 'new'],
  ['Company skills', 'runtime skills', '12 enabled', '12 enabled', 'g', 'keep'],
  ['LSP', 'lsp.enabled', 'on', 'off', 'o', 'new'],
  ['Max run time', 'maxTime', '60 min', '60 min', 'd', 'new']
];
S['cfg-agent'] = () => cfgShell('Per agent', `
<div class="row" style="gap:12px">${av('Raka', 'lg')}<div class="col" style="gap:0"><h2>Raka</h2><span class="sub">3 overrides on top of Global · effective config shown</span></div><span class="sp"></span><span class="seg"><span class="on">Effective</span><span>Overrides only</span></span><span class="btn">${ic('reset', 'i-14')}Reset all to Global</span></div>
<div class="card" style="flex:1;min-height:0;overflow:hidden">
 <div class="cfgh" style="grid-template-columns:minmax(0,1fr) minmax(0,.8fr) minmax(0,1fr) 110px"><span>Setting</span><span>Global</span><span>Effective for Raka</span><span>If changed</span></div>
 ${OV.map(r => `<div class="cfgrow ${r[4] === 'o' ? 'chg' : ''}" style="grid-template-columns:minmax(0,1fr) minmax(0,.8fr) minmax(0,1fr) 110px"><span class="k"><b>${r[0]}</b><code>${r[1]}</code></span><span class="sub mono" style="font-size:var(--t-12)">${r[2]}</span><span class="val"><span class="input" style="flex:1;height:28px">${r[3]}</span>${srcBadge(r[4])}${r[4] === 'o' ? `<span class="iconbtn" style="width:24px;height:24px" title="Reset to Global">${ic('reset', 'i-14')}</span>` : ''}</span><span>${sessTag(r[5])}</span></div>`).join('')}
</div>
<div class="note info">${ic('info')}<span>Precedence, lowest to highest: OMP default → your ~/.omp/agent/config.yml → project .omp → ${BRAND} Global → agent Override. Measured with <span class="mono">PI_CONFIG_FILES=global.yml:agent.yml omp config get</span>: the last file wins.</span></div>`);

S['cfg-search'] = () => cfgShell('Global', `
<div class="row"><span class="input focus" style="flex:1;max-width:520px">${ic('search', 'i-14')}compaction<span class="sp"></span><span class="sub">18 of 467</span></span><span class="seg"><span>Essential</span><span class="on">All</span><span>Changed</span></span><span class="chips">${['context 17', 'tools 1'].map(c => `<span class="chip">${c}</span>`).join('')}</span></div>
<div class="card" style="flex:1;min-height:0;overflow:hidden">
 <div class="cfgh"><span>Setting</span><span>Global value</span><span>Overridden by</span><span>Session</span></div>
 ${[['Compaction', 'compaction.enabled', 'sw-on', 'd', 0], ['Context notes instead of summaries', 'compaction.experimentalContextManagement', 'sw-on', 'g', 0], ['Mid-turn compaction', 'compaction.midTurnEnabled', 'sw', 'd', 0], ['Method order', 'compaction.methodOrder', 'snapcompact, summary', 'd', 0], ['Threshold (percent of window)', 'compaction.thresholdPercent', '82', 'g', 1], ['Threshold (tokens)', 'compaction.thresholdTokens', '', 'd', 0], ['Save handoff to disk', 'compaction.handoffSaveToDisk', 'sw-on', 'd', 0], ['Idle compaction', 'compaction.idleEnabled', 'sw', 'd', 0], ['Idle threshold (tokens)', 'compaction.idleThresholdTokens', '200000', 'd', 0]].map((r, i) => `<div class="cfgrow"><span class="k"><b>${r[0]}</b><code>${r[1].replace('compaction', '<mark style="background:var(--warn-soft);color:inherit">compaction</mark>')}</code></span><span class="val">${r[2].startsWith('sw') ? `<span class="sw ${r[2] === 'sw-on' ? 'on' : ''}"></span>` : `<span class="input ${i === 4 ? 'err' : ''}" style="flex:1;height:28px">${r[2] || '<span class="sub">not set</span>'}</span>`}${srcBadge(r[3])}</span><span class="ov">${r[4] ? r[4] + ' agent' : '-'}</span><span>${sessTag('new')}</span></div>${i === 4 ? '<div style="padding:0 14px 8px"><span class="help bad">Must be between 10 and 95. Schema: number, from omp config.</span></div>' : ''}`).join('')}
</div>`);

S['cfg-save'] = () => cfgShell('Per agent', `<div class="card" style="flex:1"></div>`, `<div class="modal-back"><div class="modal" style="width:640px">
 <div class="hd"><h2>Save 3 changes</h2><span class="sub">Raka · compared with the current effective config</span></div>
 <div class="bd">
  <div class="code diff" style="padding:6px 0"><div class="del">- thinking: high          (Global)</div><div class="add">+ thinking: xhigh         (Override)</div><div class="del">- lsp.enabled: true       (OMP default)</div><div class="add">+ lsp.enabled: false      (Override)</div><div class="add">+ tools: [+browser]       (Override)</div></div>
  <div class="note warn">${ic('alert')}<span><b>Raka's next run starts a new session.</b> <span class="mono">lsp.enabled</span> and <span class="mono">tools</span> are not session-neutral. Only model, fallbackModels, modelEfforts, thinking, thinkingEffort, effort, instruction files and company skills keep the session (run-state.ts, workspaces.ts).</span></div>
  <div class="field"><label>Also apply to</label><div class="chips">${['Nadia', 'Dimas', 'Sekar'].map(n => `<span class="chip on">${av(n)}${n}</span>`).join('')}<span class="chip">${ic('plus', 'i-14')}Add agents</span></div><span class="help">4 agents in total. 2 of them already override thinking; their value is replaced.</span></div>
 </div>
 <div class="ft"><span class="sub"><kbd>Esc</kbd> cancel</span><span class="sp"></span><span class="btn">Cancel</span><span class="btn pri">Save for 4 agents</span></div>
</div></div>`);

S['cfg-providers'] = () => cfgShell('Providers', `
<div class="split" style="grid-template-columns:320px 1fr;gap:16px">
 <div class="card" style="min-height:0;overflow:hidden"><div class="hd"><h3>Providers</h3><span class="sp"></span><span class="btn sm">${ic('plus', 'i-14')}Add</span></div><div class="list">${[['Anthropic', 'OAuth · 12 models', 'ok'], ['sub2api-claude', 'custom · openai-compatible · 8', 'ok'], ['OpenRouter', 'API key · 214', 'ok'], ['modelrouter', 'custom · 41', 'warn'], ['Ollama (local)', 'no key · 3', 'ok'], ['omniroute', 'custom · 66', 'bad']].map((p, i) => `<div class="li ${i === 1 ? 'sel' : ''}"><span class="dot ${p[2]}"></span><span class="m"><b>${p[0]}</b><span>${p[1]}</span></span></div>`).join('')}</div></div>
 <div class="card" style="min-height:0;overflow:hidden"><div class="hd"><h3>sub2api-claude</h3><span class="badge b-ok">Reachable · 212 ms</span><span class="sp"></span><span class="btn sm danger">Delete</span></div>
  <div class="bd col" style="gap:12px">
   <div class="grid g2" style="gap:12px"><div class="field"><label>Base URL</label><div class="input mono">https://sub2api.example/v1</div></div><div class="field"><label>API format</label><div class="input">openai-completions<span class="sp"></span>${ic('down', 'i-14')}</div></div></div>
   <div class="field"><label>API key</label><div class="input">${ic('lock', 'i-14')}<span class="mono">sk-•••••••••••••3f2a</span><span class="sp"></span><span class="btn sm">Replace</span></div><span class="help">Write-only. Stored in OMP's credential store on each target; ${BRAND} keeps a fingerprint, not the key.</span></div>
   <div class="row"><h3>Models</h3><span class="sub">8</span><span class="sp"></span><span class="btn sm">${ic('refresh', 'i-14')}Fetch from /v1/models</span><span class="btn sm">${ic('plus', 'i-14')}Add model</span></div>
   <table class="tbl"><thead><tr><th>Model id</th><th>Context</th><th>Max out</th><th>Reasoning</th><th>Used by</th></tr></thead><tbody>${[['claude-opus-5-5', '400k', '64k', 'yes', '14 agents'], ['claude-opus-5', '400k', '64k', 'yes', '2 agents'], ['claude-sonnet-5', '200k', '64k', 'yes', 'fallback'], ['claude-haiku-5', '200k', '32k', 'no', '-']].map(m => `<tr><td class="mono">${m[0]}</td><td class="num">${m[1]}</td><td class="num">${m[2]}</td><td>${m[3]}</td><td class="sub">${m[4]}</td></tr>`).join('')}</tbody></table>
  </div></div>
</div>`);
