// Generated from acpx-profiles.json and cursor-distributions.json. Do not edit.
export const QUALIFIED_ACPX_VERSION = "0.13.1" as const;
export const ACPX_DRIVER_KIND = "acpx_runtime" as const;
export const ACPX_DRIVER_PROTOCOL_VERSION = 1 as const;

export const QUALIFIED_ACPX_PROFILE_DATA = {
  "grok": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "grok",
    "agentProfileVersion": 1,
    "agentServerPackage": "builtin:grok-acp",
    "agentServerVersion": "1",
    "agentRuntimePackage": "native:grok",
    "agentRuntimeVersion": "1.0.13",
    "commandDigest": "sha256:d1b26d304e272b864489149564733bd244660037415e0678177ad038f53845c8",
    "permissionPolicy": "interactive"
  },
  "pi": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "pi",
    "agentProfileVersion": 26,
    "agentServerPackage": "pi-acp",
    "agentServerVersion": "0.0.33",
    "agentRuntimePackage": "@earendil-works/pi-coding-agent",
    "agentRuntimeVersion": "1.0.0",
    "commandDigest": "sha256:39148421291d9af4c221571b97fcc3fcc25293b64fe05eab0b7b272e98ee868e",
    "permissionPolicy": "interactive"
  },
  "cursor": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "cursor",
    "agentProfileVersion": 15,
    "agentServerPackage": "cursor-agent",
    "agentServerVersion": "2026.09.26-dd393fe",
    "agentRuntimePackage": null,
    "agentRuntimeVersion": null,
    "commandDigest": "sha256:49249e430593c59b328aa15468a90335b7cabd7c971706a089cf93befa72a0a9",
    "permissionPolicy": "interactive"
  },
  "copilot": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "copilot",
    "agentProfileVersion": 23,
    "agentServerPackage": "@github/copilot",
    "agentServerVersion": "1.0.88",
    "agentRuntimePackage": null,
    "agentRuntimeVersion": null,
    "commandDigest": "sha256:9761ce967e55600c3525fdddc83549024f554685a3984c4f9e00b8bff07a74e7",
    "qualificationStatus": "pending",
    "permissionPolicy": "interactive"
  },
  "claude": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "claude",
    "agentProfileVersion": 1,
    "agentServerPackage": "@agentclientprotocol/claude-agent-acp",
    "agentServerVersion": "0.73.0",
    "agentRuntimePackage": "@anthropic-ai/claude-agent-sdk",
    "agentRuntimeVersion": "0.3.286",
    "commandDigest": "sha256:9d73d1f0f121fb96cc8badb28c22d5bff02d8582eb2e40360a81c189e1b9422a",
    "permissionPolicy": "interactive"
  },
  "codex": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.13.1",
    "agent": "codex",
    "agentProfileVersion": 1,
    "agentServerPackage": "@agentclientprotocol/codex-acp",
    "agentServerVersion": "1.6.2",
    "agentRuntimePackage": "@openai/codex",
    "agentRuntimeVersion": "0.160.0",
    "commandDigest": "sha256:3e88ae296113d4e1ad6a57260d82c3ba97b85794101ae632bfd14f6890e62869",
    "permissionPolicy": "interactive"
  }
} as const;

export const CURSOR_DISTRIBUTION_PINS = {
  "darwin-arm64": {
    "closureSha256": "257424bd48e35412091c6adfc61e4648e836757ec1d240d890bba81a24918c30",
    "executable": "node",
    "entrypoint": "index.js"
  },
  "darwin-x64": {
    "closureSha256": "6f28c799c5afdc64fbdff8a2157f565f17ae7615efe014ac389d63bf70cf2be2",
    "executable": "node",
    "entrypoint": "index.js"
  },
  "linux-x64": {
    "closureSha256": "eadb8bb8ffb0450455b15b88c9b230307a9e149958a0c452d16dd157b4633d74",
    "executable": "node",
    "entrypoint": "index.js"
  }
} as const;
