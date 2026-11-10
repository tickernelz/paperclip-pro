export const type = "omp_local";
export const label = "Oh My Pi (OMP)";
export const OMP_INSTALL_COMMAND = "npm install -g @oh-my-pi/pi-coding-agent@latest";

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# omp_local agent configuration

Use when:
- Wardmote should run the local Oh My Pi (OMP) coding-agent CLI with its complete headless tool, skill, rule, hook, extension, task/subagent, memory, and model-provider stack
- You need local OMP sessions resumed across Wardmote heartbeats
- You need built-in, fetched, custom models, custom providers, local engines, or extension-registered providers discovered by OMP itself

Don't use when:
- You need a webhook or hosted agent endpoint rather than a CLI process
- You need live mid-turn steering or interactive OMP dialogs; Wardmote's external adapter contract is heartbeat-oriented
- OMP is unavailable in the selected execution environment

Core fields:
- model: exact OMP selector (provider/model); free text is accepted for custom providers
- command: OMP executable, default omp
- cwd: fallback working directory when Wardmote has no execution workspace
- profile / agentDir: select local OMP auth, settings, sessions, models.yml, and caches; remote runs upload sanitized configuration only
- modelsYaml: optional isolated inline models.yml; provide credentials through Wardmote environment secret bindings
- thinking: off, minimal, low, medium, high, xhigh, max, or auto
- smolModel / slowModel / planModel: role overrides used by OMP's auxiliary work
- tools / noTools: optional comma-separated allowlist and explicit default-tool disable; blank preserves OMP's complete default toolset
- modelCycle: optional selectors passed to OMP --models
- approvalMode: yolo, write, or always-ask; always passed to OMP, defaulting to yolo for headless runs
- extensions / hooks / pluginDirs / configFiles: newline-separated OMP paths
- advisor, prewalk/noPrewalk, planYolo, skills, rules, LSP, PTY, title, allowHome, and ephemeral-session controls map directly to OMP flags
- experimentalContextManagement (default on) sets OMP compaction.experimentalContextManagement in the per-run settings overlay: persistent notes, history://current/full, and new_context rollover instead of summary compaction; requires OMP 18.1.16 or newer, older OMP ignores it
- systemPrompt replaces OMP's base prompt while Wardmote's execution contract remains appended
- timeoutSec / graceSec / maxTime: Wardmote process deadline, termination grace, and OMP in-session deadline

Model behavior:
- Wardmote model listing calls omp models --json and refresh calls omp models refresh --json
- OMP returns available models only; unavailable models remain enterable manually
- Active ~/.omp/agent/models.yml, profile-specific config, runtime discovery, and extension providers are authoritative

Operational behavior:
- Each heartbeat runs omp --mode rpc under Wardmote process supervision: the prompt travels on stdin as a JSON frame and OMP streams JSONL frames back
- The adapter negotiates RPC protocol v2 at startup, so a frame larger than the transport limit arrives as reassembled chunks instead of a degraded one
- Local and ssh runs hold a live stdin channel, so a queued comment can steer the current turn; sandbox runs fall back to one-shot print mode and cannot steer
- Local sessions use an adapter-owned --session-dir and exact --resume id; remote runs are deliberately ephemeral because Wardmote remote runtime directories are per run
- Raw OMP JSONL is streamed unchanged; transport control frames (ready, response, available_commands_update) stay out of the transcript, and unknown events fall back to raw transcript output
- Wardmote skills are linked into OMP's active agent skills directory without modifying the project workspace
`;
