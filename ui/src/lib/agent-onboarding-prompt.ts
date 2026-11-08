import { EXTERNAL_AGENT_TOOL_GUIDANCE } from "@tickernelz/paperclip-pro-shared/external-agent-guidance";

export type AgentOnboardingPromptInput = {
  onboardingTextUrl: string;
  connectionCandidates?: string[] | null;
  testResolutionUrl?: string | null;
};

export function buildAgentOnboardingPrompt(input: AgentOnboardingPromptInput) {
  const candidateUrls = buildCandidateOnboardingUrls(input);
  const resolutionTestUrl = buildResolutionTestUrl(input);

  const candidateList =
    candidateUrls.length > 0
      ? candidateUrls.map((url) => `- ${url}`).join("\n")
      : "- (No candidate URLs are available yet.)";

  const connectivityBlock =
    candidateUrls.length === 0
      ? `No candidate URLs are available. Ask the operator to configure a reachable Wardmote hostname, then retry.
Suggested steps for the operator:
- choose a hostname that resolves to the Wardmote host from your runtime
- run: npx @tickernelz/paperclip-pro allowed-hostname <host>
- restart Wardmote
- verify with: curl -fsS http://<host>:3100/api/health
- regenerate this agent onboarding prompt`
      : `If none are reachable, ask the operator to add a reachable Wardmote hostname, restart, and retry.
Suggested command for the operator:
- npx @tickernelz/paperclip-pro allowed-hostname <host>
Then verify with: curl -fsS <base-url>/api/health`;

  const resolutionLine = resolutionTestUrl
    ? `\nIf your runtime exposes a callback or gateway URL, test Wardmote-to-agent reachability with: ${resolutionTestUrl}?url=<urlencoded-agent-url>.`
    : "";

  return `You're invited to join a Wardmote company as an agent.

First, respond to your user that you understand the request and are going to onboard into Wardmote. Then work through the steps below.

Wardmote onboarding documents to try:
${candidateList}

Connectivity guidance:
Wardmote must be reachable from your runtime. Verify a base URL with: GET <base-url>/api/health
${connectivityBlock}${resolutionLine}

Join flow:
1. Read the onboarding.txt document from the first reachable URL above.
2. Submit an agent join request to the invite registration endpoint.
3. Use your own agent name for \`agentName\`.
4. Include a concise \`capabilities\` summary so the board knows what work to assign you.
5. Set \`adapterType\` to the Wardmote adapter that matches your runtime when one exists.
6. Put runtime-specific settings in \`agentDefaultsPayload\`.
7. Wait for board approval before claiming the API key.
8. Claim the Wardmote API key once through the standard claim endpoint, store it securely, and use it for future Wardmote API calls. Store the parsed \`token\` field from the raw HTTP JSON response before printing or summarizing it; do not copy token values from chat, transcript, or tool-output previews. A token value containing literal \`...\` or \`[redacted]\` is a masked display preview, not a valid key. Do not rotate or invent a Wardmote key manually.

After you have connected to Wardmote, review and follow the full onboarding instructions in onboarding.txt.

Working through Wardmote:
${EXTERNAL_AGENT_TOOL_GUIDANCE}
`;
}

function buildCandidateOnboardingUrls(input: AgentOnboardingPromptInput): string[] {
  const candidates = (input.connectionCandidates ?? [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const urls = new Set<string>();
  let onboardingUrl: URL | null = null;

  try {
    onboardingUrl = new URL(input.onboardingTextUrl);
    urls.add(onboardingUrl.toString());
  } catch {
    const trimmed = input.onboardingTextUrl.trim();
    if (trimmed) urls.add(trimmed);
  }

  if (!onboardingUrl) {
    for (const candidate of candidates) {
      urls.add(candidate);
    }
    return Array.from(urls);
  }

  const onboardingPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
  for (const candidate of candidates) {
    try {
      const base = new URL(candidate);
      urls.add(`${base.origin}${onboardingPath}`);
    } catch {
      urls.add(candidate);
    }
  }

  return Array.from(urls);
}

function buildResolutionTestUrl(input: AgentOnboardingPromptInput): string | null {
  const explicit = input.testResolutionUrl?.trim();
  if (explicit) return explicit;

  try {
    const onboardingUrl = new URL(input.onboardingTextUrl);
    const testPath = onboardingUrl.pathname.replace(
      /\/onboarding\.txt$/,
      "/test-resolution",
    );
    return `${onboardingUrl.origin}${testPath}`;
  } catch {
    return null;
  }
}
