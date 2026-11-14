const GROUP_LABEL = { Collaboration: 'Working together', Automation: 'Automation', Integrations: 'Integrations', Workspace: 'Workspaces', Display: 'Display' };
const featRow = (f, on) => `<div class="setrow"><div class="setrow-k"><b>${f.name}</b><span class="sub">${f.line}</span>${f.ready ? '' : '<span class="badge b-warn" style="align-self:flex-start;margin-top:4px">Not finished yet</span>'}</div><div class="setrow-v" style="flex-direction:row;align-items:center;justify-content:flex-end;gap:12px"><span class="sub hide-sm" style="text-align:end">${on ? f.on : f.off}</span><span class="sw ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="${f.name}" ${f.ready ? '' : 'aria-disabled="true"'}></span></div></div>`;
S.features = () => {
  const list = FEATURES.filter((f) => f.dest === 'Features');
  const onCount = list.filter((f) => f.live).length;
  const groups = ['Collaboration', 'Automation', 'Integrations', 'Workspace', 'Display'];
  return settingsShell('Features', ['Settings', 'Features'], `
<div class="ph"><div class="ph-t"><h1>Features</h1><span class="sub">${onCount} of ${list.length} on. Turning one off hides it; nothing is deleted.</span></div></div>
<div class="row wrapr"><span class="seg" aria-label="Preset"><span>Minimal</span><span class="on">Standard</span><span>Everything</span></span><div class="input ph" style="flex:1;min-width:180px">${ic('search', 'i-14')}Search features</div></div>
<section class="card" style="overflow:hidden">${groups.slice(0, 2).map((g) => `<div class="sec-title">${GROUP_LABEL[g]}<span class="ts">${list.filter((f) => f.group === g && f.live).length} on</span></div>${list.filter((f) => f.group === g).slice(0, g === 'Collaboration' ? 5 : 3).map((f) => featRow(f, f.live)).join('')}`).join('')}</section>`);
};
S['features-more'] = () => {
  const list = FEATURES.filter((f) => f.dest === 'Features');
  return settingsShell('Features', ['Settings', 'Features'], `
<div class="ph"><div class="ph-t"><h1>Features</h1><span class="sub">Integrations, workspaces and display</span></div></div>
<section class="card" style="overflow:hidden">${['Integrations', 'Workspace', 'Display'].map((g) => `<div class="sec-title">${GROUP_LABEL[g]}</div>${list.filter((f) => f.group === g).slice(0, g === 'Integrations' ? 4 : 2).map((f) => featRow(f, f.live)).join('')}`).join('')}</section>
<div class="note info">${ic('info', 'note-i')}<span>Pixels office and Conference room are here, not in the navigation. Open them from Search.</span></div>`);
};
S.advanced = () => {
  const list = FEATURES.filter((f) => f.dest === 'Advanced');
  return settingsShell('Advanced', ['Settings', 'Advanced'], `
<div class="ph"><div class="ph-t"><h1>Advanced</h1><span class="sub">Tools for people who run or develop Wardmote</span></div><a class="btn">${ic('reset', 'i-14')}Reset to defaults</a></div>
<div class="note warn">${ic('alert', 'note-i')}<span>These change how runs are executed or show internal data. Leave them alone unless you know why you need one.</span></div>
<section class="card" style="overflow:hidden">${['Developer', 'Runtime'].map((g) => `<div class="sec-title">${g}</div>${list.filter((f) => f.group === g).slice(0, g === 'Developer' ? 4 : 4).map((f) => `<div class="setrow"><div class="setrow-k"><b>${f.name}</b><span class="sub">${f.line}</span></div><div class="setrow-v" style="flex-direction:row;justify-content:flex-end;align-items:center;gap:10px">${f.live !== f.default ? '<span class="changed-tag">changed</span>' : ''}<span class="sw ${f.live ? 'on' : ''}" role="switch" aria-label="${f.name}"></span></div></div>`).join('')}`).join('')}</section>`);
};

const MODELS = [['Opus 5.5', 'Anthropic', 'Recommended'], ['Sonnet 5', 'Anthropic', 'Faster'], ['GPT-6.1 Sol', 'OpenAI', ''], ['DeepSeek 4.1 Flash', 'DeepSeek', 'Cheapest']];
const ctl = (label, help, value, changed, uses) => `<div class="setrow ${changed ? 'changed' : ''}"><div class="setrow-k"><b>${label}</b><span class="sub">${help}</span>${uses ? `<span class="ts" style="margin-top:2px">${uses}</span>` : ''}</div><div class="setrow-v">${value}${changed ? `<span class="row"><span class="changed-tag">${ic('reset', 'i-14')}Changed from default</span><a class="btn link">Reset</a></span>` : ''}</div></div>`;
const styleOpts = (on) => `<div class="col" style="gap:6px">${[['Balanced', 'Good answers at normal cost'], ['Fast', 'Quick replies, lower cost'], ['Thorough', 'Plans first, checks its work']].map(([k, d]) => `<div class="opt ${k === on ? 'on' : ''}"><span class="radio"></span><div class="opt-k"><b class="opt-t">${k}</b><span class="opt-d">${d}</span></div></div>`).join('')}</div>`;
const modelPick = (m) => `<div class="input" role="button" aria-haspopup="listbox"><b style="font-weight:560">${m}</b><span class="sub">${MODELS.find((x) => x[0] === m)[1]}</span><span class="sp"></span>${ic('down', 'i-14')}</div>`;
const thinkSeg = (on) => `<span class="seg">${['Quick', 'Balanced', 'Deep', 'Max'].map((x) => `<span class="${x === on ? 'on' : ''}">${x}</span>`).join('')}</span>`;
const toolSeg = (on) => `<span class="seg">${['Standard', 'Read only', 'Everything'].map((x) => `<span class="${x === on ? 'on' : ''}">${x}</span>`).join('')}</span>`;

S.defaults = () => settingsShell('Agent defaults', ['Settings', 'Agent defaults'], `
<div class="ph"><div class="ph-t"><h1>Agent defaults</h1><span class="sub">Every agent starts from these. 4 agents have their own values.</span></div></div>
<section class="card" style="overflow:hidden">
${ctl('Style', 'Sets how hard agents think and check', styleOpts('Balanced'), false, '')}
${ctl('Model', 'From the models OMP reports', modelPick('Opus 5.5'), true, '17 agents follow this')}
${ctl('Thinking', 'More thinking is slower and costs more', thinkSeg('Deep'), false, '')}
${ctl('Backup models', 'Used when the model is busy or down', `<div class="row"><span class="sw on" role="switch" aria-label="Automatic backup models"></span><span>Automatic: Sonnet 5, then GPT-6.1 Sol</span></div>`, false, '')}
${ctl('Tools', 'What agents may do on the machine', toolSeg('Standard'), false, '')}
</section>
<div class="row wrapr"><a class="btn link">All settings (467)</a><span class="sub">for people who know OMP keys</span></div>
<div class="savebar card" role="status"><span><b>1 change</b> · applies to 17 agents · keeps their sessions</span><span class="sp"></span><a class="btn">Discard</a><a class="btn pri">Save</a></div>`);

S['agent-setup'] = () => shell('agents', ['Agents', 'Raka', 'Setup'], '', `<div class="wrap narrow">
<div class="row wrapr" style="gap:12px">${av('Raka', 'lg')}<div class="col" style="gap:2px"><h1>Raka</h1><span class="sub">Uses company defaults except 2 settings</span></div></div>
<div class="tabs"><span>Overview</span><span>Runs</span><span class="on">Setup</span><span>Instructions</span><span>Skills</span></div>
<section class="card" style="overflow:hidden">
${ctl('Model', 'Default: Opus 5.5', modelPick('GPT-6.1 Sol'), true, '')}
${ctl('Thinking', 'Default: Deep', thinkSeg('Max'), true, '')}
${ctl('Tools', 'Default: Standard', toolSeg('Standard'), false, '')}
${ctl('Stop a run after', 'Default: 1 hour', `<div class="input">1 hour<span class="sp"></span>${ic('down', 'i-14')}</div>`, false, '')}
</section>
<div class="row wrapr"><a class="btn">${ic('reset', 'i-14')}Reset all to defaults</a><span class="sp"></span><a class="btn link">All settings for Raka</a></div>
<div class="savebar card" role="status"><span><b>2 changes</b> · keeps the current session</span><span class="sp"></span><a class="btn">Discard</a><a class="btn pri">Save</a></div></div>`);

S['all-settings'] = () => settingsShell('Agent defaults', ['Agent defaults', 'All settings'], `
<div class="ph"><div class="ph-t"><h1>All settings</h1><span class="sub">467 settings. Most people never need this page.</span></div></div>
<div class="row wrapr"><div class="input" style="flex:1;min-width:200px">${ic('search', 'i-14')}compaction<span class="sp"></span><span class="ts">9 of 467</span></div><span class="chip on">Essential 36</span><span class="chip">Changed 9</span></div>
<section class="card" style="overflow:hidden">${[['Context notes instead of summaries', 'compaction.experimentalContextManagement', 'sw-on', 'Default'], ['Compact at', 'compaction.thresholdPercent', '82 %', 'Changed'], ['Compaction', 'compaction.enabled', 'sw-on', 'OMP default'], ['Mid-turn compaction', 'compaction.midTurnEnabled', 'sw', 'OMP default'], ['Save handoff to disk', 'compaction.handoffSaveToDisk', 'sw-on', 'OMP default']].map((r, i) => `<div class="setrow ${r[3] === 'Changed' ? 'changed' : ''}"><div class="setrow-k"><b>${r[0]}</b><span class="ts" style="overflow:hidden;text-overflow:ellipsis">${r[1]}</span></div><div class="setrow-v" style="flex-direction:row;align-items:center;gap:10px;justify-content:flex-end">${r[3] === 'Changed' ? '<span class="changed-tag">changed</span>' : `<span class="sub">${r[3]}</span>`}${r[2].startsWith('sw') ? `<span class="sw ${r[2] === 'sw-on' ? 'on' : ''}" role="switch" aria-label="${r[0]}"></span>` : `<div class="input ${i === 1 ? 'err' : ''}" style="width:96px">${r[2]}</div>`}</div></div>${i === 1 ? '<div style="padding:0 16px 10px"><span class="help bad">Must be between 10 and 95</span></div>' : ''}`).join('')}</section>`);

S.providers = () => settingsShell('OMP runtime', ['Settings', 'Models and providers'], `
<div class="ph"><div class="ph-t"><h1>Models and providers</h1><span class="sub">Imported from OMP. Keys stay in OMP's credential store.</span></div><a class="btn">${ic('plus', 'i-14')}Add provider</a></div>
<section class="card">${[['Anthropic', 'Signed in · 12 models', 'ok'], ['OpenAI', 'Signed in · 9 models', 'ok'], ['sub2api', 'Custom · key ending 3f2a · 8 models', 'ok'], ['modelrouter', 'Custom · last check failed 2 h ago', 'warn']].map((p) => `<div class="li wrapli"><span class="dot ${p[2]}"></span><div class="li-body"><span class="li-title">${p[0]}</span><span class="li-meta">${p[1]}</span></div><div class="li-actions" style="width:auto">${p[2] === 'warn' ? '<a class="btn sm">Check again</a>' : '<a class="btn sm ghost">Manage</a>'}</div></div>`).join('')}</section>`);

function obShell(step, main, side) {
  const names = ['Check OMP', 'Connect a model', 'First task'];
  const steps = names.map((n, i) => `<span class="step ${i < step ? 'done' : i === step ? 'on' : ''}"><span class="step-n">${i < step ? ic('check', 'i-14') : i + 1}</span><span class="${i === step ? '' : 'hide-sm'}">${n}</span></span>`).join('<span class="step-ln"></span>');
  return `<div class="ob"><section class="ob-main"><div class="row" style="gap:10px">${MARK(26)}<b style="font-size:16px;font-weight:640">${BRAND}</b></div><div class="steps">${steps}</div>${main}</section><aside class="ob-side">${side}</aside></div>`;
}
const checks = (rows) => `<section class="card card-b">${rows.map((c) => `<div class="check"><span class="check-st ${c[0]}">${ic(c[0] === 'ok' ? 'check' : c[0] === 'bad' ? 'x' : c[0] === 'warn' ? 'alert' : c[0] === 'run' ? 'refresh' : 'clock', 'i-14')}</span><span>${c[1]}</span><span class="check-v">${c[2] || ''}</span></div>`).join('')}</section>`;
const whySide = `<h2>Why OMP</h2><p class="sub" style="font-size:14px;color:var(--ink-2)">${BRAND} runs every agent on OMP. OMP talks to the model and uses the tools; ${BRAND} assigns work, keeps the record and holds the settings.</p><p class="sub" style="font-size:14px;color:var(--ink-2)">You will not need to open OMP's own settings: models, thinking and tools are set here.</p>`;

S['ob-check'] = () => obShell(0, `<h1>Install OMP</h1><p class="lede">Run this in a terminal on this computer. This page moves on by itself.</p>
<div class="code" style="font-size:13.5px">curl -fsSL https://omp.sh/install | sh</div>
<div class="row wrapr"><a class="btn">${ic('copy', 'i-14')}Copy command</a><span class="sub">Linux detected · <a class="btn link">Other ways</a></span></div>
${checks([['run', 'Looking for omp', 'every 2 s'], ['wait', 'Version 18.1.16 or newer', ''], ['wait', 'At least one model', '']])}
<div class="row" style="margin-top:auto"><a class="btn ghost">Run agents on another machine</a></div>`, whySide);
S['ob-old'] = () => obShell(0, `<h1>Update OMP</h1><p class="lede">OMP 18.0.2 is older than 18.1.16, so some settings set here would be ignored.</p>
<div class="code">omp update</div><a class="btn" style="align-self:flex-start">${ic('copy', 'i-14')}Copy command</a>
${checks([['ok', 'omp found', '/usr/local/bin/omp'], ['bad', 'Version 18.0.2', 'needs 18.1.16']])}
<div class="note warn">${ic('alert', 'note-i')}<span>Two copies of omp are installed. The older one in /usr/local/bin runs first. Remove it, or update it with the command above.</span></div>`, whySide);
S['ob-offline'] = () => obShell(0, `<h1>You are offline</h1><p class="lede">Installing needs the internet once. Connect, or point to an omp you already copied here.</p>
${checks([['bad', 'omp.sh not reachable', '3 tries'], ['wait', 'Version check', '']])}
<div class="field"><span class="label">Path to omp</span><div class="input ph">Choose file${ic('folder', 'i-14')}</div></div>
<div class="row wrapr" style="margin-top:auto"><a class="btn">${ic('refresh', 'i-14')}Try again</a></div>`, whySide);
S['ob-remote'] = () => obShell(0, `<h1>Run agents on another machine</h1><p class="lede">OMP must be installed where agents run. We check it over SSH.</p>
<div class="field"><span class="label">SSH address</span><div class="input">zhafron@lab0.kaitech.io</div><span class="help">Uses your SSH keys. The working folder is your home folder unless you change it later.</span></div>
${checks([['ok', 'Connected', '42 ms'], ['ok', 'omp 18.9.4 found', ''], ['bad', 'No model signed in there', 'next step']])}
<div class="row wrapr" style="margin-top:auto"><a class="btn ghost">Use this computer</a><span class="sp"></span><a class="btn pri">Continue</a></div>`, whySide);
S['ob-connect'] = () => obShell(1, `<h1>Connect a model</h1><p class="lede">OMP has no model signed in yet. Pick where your model comes from.</p>
<div class="col" style="gap:8px">${[['Anthropic', 'Sign in in the browser', 1], ['OpenAI', 'Sign in in the browser', 0], ['OpenRouter', 'Paste an API key', 0], ['Other', 'Any OpenAI-compatible server', 0]].map((p) => `<div class="opt ${p[2] ? 'on' : ''}"><span class="radio"></span><div class="opt-k"><b class="opt-t">${p[0]}</b><span class="opt-d">${p[1]}</span></div></div>`).join('')}</div>
<div class="row" style="margin-top:auto"><span class="sp"></span><a class="btn pri">Sign in with Anthropic</a></div>`, `<h2>Skipped when OMP is ready</h2><p class="sub" style="font-size:14px;color:var(--ink-2)">If OMP already has a signed-in model on this machine, this step is skipped and the best model is picked for you.</p>`);
S['ob-task'] = () => obShell(2, `<h1>What should your first agent do?</h1><p class="lede">Atlas starts as soon as you press Start. You can rename it and change its setup later.</p>
<div class="field"><span class="label">First task</span><div class="input area">Read the README in ~/Projects/acme and list the three riskiest modules.</div></div>
<section class="card card-b col" style="gap:6px"><div class="row"><span class="sub" style="width:84px">Agent</span>Atlas, general assistant</div><div class="row"><span class="sub" style="width:84px">Model</span>Opus 5.5 (recommended)</div><div class="row"><span class="sub" style="width:84px">Folder</span><span class="mono">~/Projects/acme</span></div></section>
<div class="row" style="margin-top:auto"><span class="sp"></span><a class="btn pri">${ic('play', 'i-14')}Start</a></div>`, `<h2>Found on this computer</h2>${checks([['ok', 'OMP 18.17.0', ''], ['ok', 'Anthropic signed in', 'imported'], ['ok', 'Project folder', '~/Projects/acme']])}`);
