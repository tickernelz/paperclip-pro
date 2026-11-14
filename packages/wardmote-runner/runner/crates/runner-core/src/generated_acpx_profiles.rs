// Generated from acpx-profiles.json and cursor-distributions.json. Do not edit.
pub(crate) const QUALIFIED_ACPX_VERSION: &str = "0.13.1";
pub(crate) const ACPX_DRIVER_KIND: &str = "acpx_runtime";

#[derive(Debug)]
pub(crate) struct AcpxReleaseProfile {
    pub agent_server_package: &'static str,
    pub agent_server_version: &'static str,
    pub agent_runtime_package: Option<&'static str>,
    pub agent_runtime_version: Option<&'static str>,
    pub command_digest: &'static str,
    pub requires_provider_policy: bool,
}

pub(crate) fn acpx_release_profile(agent: &str) -> Option<AcpxReleaseProfile> {
    Some(match agent {
        "grok" => AcpxReleaseProfile {
            agent_server_package: "builtin:grok-acp",
            agent_server_version: "1",
            agent_runtime_package: Some("native:grok"),
            agent_runtime_version: Some("1.0.13"),
            command_digest:
                "sha256:d1b26d304e272b864489149564733bd244660037415e0678177ad038f53845c8",
            requires_provider_policy: false,
        },
        "pi" => AcpxReleaseProfile {
            agent_server_package: "pi-acp",
            agent_server_version: "0.0.33",
            agent_runtime_package: Some("@earendil-works/pi-coding-agent"),
            agent_runtime_version: Some("1.0.0"),
            command_digest:
                "sha256:5003035e6540386a3149e1d3bb328f26d2256590b242aa6622d551b4a3dac724",
            requires_provider_policy: true,
        },
        "cursor" => AcpxReleaseProfile {
            agent_server_package: "cursor-agent",
            agent_server_version: "2026.09.26-dd393fe",
            agent_runtime_package: None,
            agent_runtime_version: None,
            command_digest:
                "sha256:f5b41139b70934ac89a4657095f62d07f10992eb2d4ac140d2b0e0500b57a93d",
            requires_provider_policy: true,
        },
        "copilot" => AcpxReleaseProfile {
            agent_server_package: "@github/copilot",
            agent_server_version: "1.0.88",
            agent_runtime_package: None,
            agent_runtime_version: None,
            command_digest:
                "sha256:04d9a473012a87ad521e3b74695890caa164049e4e78e2bbbb5b7fae408b27cf",
            requires_provider_policy: true,
        },
        "claude" => AcpxReleaseProfile {
            agent_server_package: "@agentclientprotocol/claude-agent-acp",
            agent_server_version: "0.73.0",
            agent_runtime_package: Some("@anthropic-ai/claude-agent-sdk"),
            agent_runtime_version: Some("0.3.286"),
            command_digest:
                "sha256:9d73d1f0f121fb96cc8badb28c22d5bff02d8582eb2e40360a81c189e1b9422a",
            requires_provider_policy: false,
        },
        "codex" => AcpxReleaseProfile {
            agent_server_package: "@agentclientprotocol/codex-acp",
            agent_server_version: "1.6.2",
            agent_runtime_package: Some("@openai/codex"),
            agent_runtime_version: Some("0.160.0"),
            command_digest:
                "sha256:7f77704ad58089b4855717bb1fe77db988b7b725fd1823fd2f94f631e6b4f231",
            requires_provider_policy: false,
        },
        _ => return None,
    })
}
