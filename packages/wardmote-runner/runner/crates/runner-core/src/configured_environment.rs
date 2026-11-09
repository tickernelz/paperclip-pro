//! Controller-selected task environment; mirrors configured-environment.ts.
use crate::local_runner::LocalRunnerError;
use std::process::Command;

const MARKER: &str = "WARDMOTE_CONFIGURED_ENV_KEYS";
const RESERVED: &[&str] = &[
    "AGENT_HOME",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
    "BASH_ENV",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CODEX_API_KEY",
    "CODEX_HOME",
    "COPILOT_GITHUB_TOKEN",
    "CURSOR_API_KEY",
    "CURSOR_AUTH_TOKEN",
    "ENV",
    "GH_ENTERPRISE_TOKEN",
    "GH_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
    "GITHUB_TOKEN",
    "HOME",
    "NODE_OPTIONS",
    "NODE_PATH",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "WARDMOTE_ACPX_CREDENTIAL_BINDING",
    "WARDMOTE_AGENT_ID",
    "WARDMOTE_AGENT_KEY_ID",
    "WARDMOTE_AGENT_MESSAGE_KEY",
    "WARDMOTE_AGENT_PRIVATE_KEY",
    "WARDMOTE_AGENT_PUBLIC_KEY",
    "WARDMOTE_AI_PROVIDER_KEY",
    "WARDMOTE_API_BRIDGE_MODE",
    "WARDMOTE_API_KEY",
    "WARDMOTE_API_URL",
    "WARDMOTE_APPROVAL_ID",
    "WARDMOTE_APPROVAL_STATUS",
    "WARDMOTE_COMPANY_ID",
    "WARDMOTE_CONFIGURED_ENV_KEYS",
    "WARDMOTE_EXECUTION_MODE",
    "WARDMOTE_EXTERNAL_CHAT_EXECUTION_BOUND_KEY",
    "WARDMOTE_GITHUB_AUTH_MODE",
    "WARDMOTE_GITHUB_BRIDGE_TOKEN",
    "WARDMOTE_GITHUB_BROKER_TOKEN",
    "WARDMOTE_GITHUB_BROKER_URL",
    "WARDMOTE_GITHUB_HOST_HOME",
    "WARDMOTE_GITHUB_LAUNCHER_DIR",
    "WARDMOTE_GIT_METADATA_ROOTS",
    "WARDMOTE_GIT_TOKEN",
    "WARDMOTE_HARNESS_CHECKOUT_KEY",
    "WARDMOTE_INSTANCE_ID",
    "WARDMOTE_LINKED_ISSUE_IDS",
    "WARDMOTE_NATIVE_MCP_NAME",
    "WARDMOTE_NATIVE_MCP_TOKEN",
    "WARDMOTE_NATIVE_MCP_URL",
    "WARDMOTE_NORMALIZED_SESSION_ID",
    "WARDMOTE_PROVIDER_TRACE_MAX_BYTES",
    "WARDMOTE_PROVIDER_TRACE_PATH",
    "WARDMOTE_RUNNER_BOOTSTRAP_TICKET",
    "WARDMOTE_RUNNER_EXTERNAL_SANDBOX",
    "WARDMOTE_RUNNER_INSTANCE_ID",
    "WARDMOTE_RUNNER_NETWORK_ACCESS",
    "WARDMOTE_RUNNER_NETWORK_ROOTS",
    "WARDMOTE_RUNTIME_PRIMARY_URL",
    "WARDMOTE_RUNTIME_SERVICES_JSON",
    "WARDMOTE_RUNTIME_SERVICE_INTENTS_JSON",
    "WARDMOTE_RUN_ID",
    "WARDMOTE_TASK_ID",
    "WARDMOTE_WAKE_COMMENT_ID",
    "WARDMOTE_WAKE_PAYLOAD_JSON",
    "WARDMOTE_WAKE_REASON",
    "WARDMOTE_WORKSPACES_JSON",
    "WARDMOTE_WORKSPACE_AUTHORITATIVE_ROOT",
    "WARDMOTE_WORKSPACE_BRANCH",
    "WARDMOTE_WORKSPACE_CWD",
    "WARDMOTE_WORKSPACE_ID",
    "WARDMOTE_WORKSPACE_REALIZATION_MODE",
    "WARDMOTE_WORKSPACE_REPO_REF",
    "WARDMOTE_WORKSPACE_REPO_URL",
    "WARDMOTE_WORKSPACE_SOURCE",
    "WARDMOTE_WORKSPACE_WORKTREE_PATH",
    "PATH",
    "PERL5LIB",
    "PERL5OPT",
    "PYTHONHOME",
    "PYTHONPATH",
    "RUBYLIB",
    "RUBYOPT",
    "SHELL",
    "USERPROFILE",
    "XAI_API_KEY",
];

fn eligible_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    !key.is_empty()
        && key.len() <= 128
        && key
            .bytes()
            .enumerate()
            .all(|(i, b)| b == b'_' || b.is_ascii_alphabetic() || (i > 0 && b.is_ascii_digit()))
        && !RESERVED.contains(&upper.as_str())
        && ![
            "LD_",
            "DYLD_",
            "GIT_CONFIG_",
            "WARDMOTE_RUNNER_",
            "WARDMOTE_NATIVE_",
            "WARDMOTE_GITHUB_",
            "WARDMOTE_ACPX_",
            "WARDMOTE_VERIFIED_",
        ]
        .iter()
        .any(|prefix| upper.starts_with(prefix))
}

pub(crate) fn apply_configured_environment(
    command: &mut Command,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<(), LocalRunnerError> {
    let Some(raw) = lookup(MARKER) else {
        return Ok(());
    };
    let invalid = || LocalRunnerError::invalid("invalid configured environment projection");
    if raw.len() > 20_000 {
        return Err(invalid());
    }
    let mut names: Vec<String> = serde_json::from_str(&raw).map_err(|_| invalid())?;
    if names.len() > 128 || names.iter().any(|name| !eligible_key(name)) {
        return Err(invalid());
    }
    names.sort();
    if names.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(invalid());
    }
    let mut bytes = 0;
    // Validate all values before modifying the child launch specification.
    let mut values = Vec::new();
    for name in &names {
        let value = lookup(name).ok_or_else(invalid)?;
        let size = name.len() + value.len();
        bytes += size;
        if value.contains('\0') || size > 65_536 || bytes > 262_144 {
            return Err(invalid());
        }
        values.push((name, value));
    }
    command.envs(values);
    command.env(
        MARKER,
        serde_json::to_string(&names).map_err(|_| invalid())?,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn rejects_reserved_malformed_missing_and_oversized_environment() {
        for raw in [
            "not-json",
            "[1]",
            "[\"NODE_OPTIONS\"]",
            "[\"WARDMOTE_API_KEY\"]",
            "[\"WARDMOTE_RUNNER_BOOTSTRAP_TICKET\"]",
            "[\"OPENAI_API_KEY\"]",
            "[\"LD_PRELOAD\"]",
            "[\"bad=name\"]",
            "[\"CUSTOM\",\"CUSTOM\"]",
            "[\"MISSING\"]",
        ] {
            let mut command = Command::new("unused");
            assert!(
                apply_configured_environment(&mut command, |key| if key == MARKER {
                    Some(raw.into())
                } else {
                    None
                })
                .is_err()
            );
            assert_eq!(command.get_envs().count(), 0);
        }
        let mut command = Command::new("unused");
        assert!(
            apply_configured_environment(&mut command, |key| Some(if key == MARKER {
                "[\"CUSTOM\"]".into()
            } else {
                "x".repeat(65_536)
            }))
            .is_err()
        );
    }

    #[test]
    #[cfg(unix)]
    fn child_receives_only_selected_task_values_across_configuration_changes() {
        for secret in [None, Some("first-secret"), Some("rotated-secret"), None] {
            let mut source = BTreeMap::from([
                ("HOST_SECRET", "unbound-secret".to_string()),
                ("NODE_OPTIONS", "unbound-loader".to_string()),
            ]);
            let names = if let Some(value) = secret {
                source.insert("WARDMOTE_PAGE_AWS_SECRET_ACCESS_KEY", value.into());
                vec!["WARDMOTE_PAGE_AWS_SECRET_ACCESS_KEY"]
            } else {
                vec![]
            };
            source.insert(MARKER, serde_json::to_string(&names).unwrap());
            let mut command = Command::new("/bin/sh");
            command.env_clear().args(["-c", "printf '%s|%s|%s' \"$WARDMOTE_PAGE_AWS_SECRET_ACCESS_KEY\" \"$HOST_SECRET\" \"$NODE_OPTIONS\""]);
            apply_configured_environment(&mut command, |key| source.get(key).cloned()).unwrap();
            let output = command.output().unwrap();
            assert!(output.status.success());
            assert_eq!(
                String::from_utf8(output.stdout).unwrap(),
                format!("{}||", secret.unwrap_or_default())
            );
        }
    }
}
