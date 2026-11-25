//! Non-interactive invocation per agent CLI. Without these flags `claude <prompt>` and
//! `cline <prompt>` open an interactive session and never return.

/// Argv (after the binary) that runs one prompt to completion and exits.
pub fn agent_argv(agent: &str, prompt: &str) -> Vec<String> {
    let p = prompt.to_string();
    match agent {
        "claude" | "omp" => vec!["-p".into(), p],
        "codex" => vec!["exec".into(), p],
        "opencode" | "kilo" | "jcode" => vec!["run".into(), p],
        _ => vec![p],
    }
}

#[cfg(test)]
mod tests {
    use super::agent_argv;

    #[test]
    fn every_known_agent_gets_a_non_interactive_form() {
        assert_eq!(agent_argv("claude", "hi"), vec!["-p", "hi"]);
        assert_eq!(agent_argv("omp", "hi"), vec!["-p", "hi"]);
        assert_eq!(agent_argv("codex", "hi"), vec!["exec", "hi"]);
        assert_eq!(agent_argv("opencode", "hi"), vec!["run", "hi"]);
        assert_eq!(agent_argv("kilo", "hi"), vec!["run", "hi"]);
        assert_eq!(agent_argv("jcode", "hi"), vec!["run", "hi"]);
    }
}
