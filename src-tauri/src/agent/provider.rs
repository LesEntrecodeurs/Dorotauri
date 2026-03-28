use std::path::PathBuf;

use super::model::Provider;

pub struct AgentStartConfig {
    pub prompt: String,
    pub cwd: PathBuf,
    pub skip_permissions: bool,
    pub mcp_config: Option<PathBuf>,
    pub system_prompt_file: Option<PathBuf>,
    pub model: Option<String>,
    pub secondary_paths: Vec<String>,
    pub continue_session: bool,
}

pub trait AgentProviderTrait {
    fn name(&self) -> &str;
    fn build_command(&self, config: &AgentStartConfig, cli_path: Option<&str>) -> Vec<String>;
    fn supports_mcp(&self) -> bool;
    fn supports_skip_permissions(&self) -> bool;
    fn supports_system_prompt_file(&self) -> bool;
}

pub struct ClaudeProvider;

impl AgentProviderTrait for ClaudeProvider {
    fn name(&self) -> &str {
        "claude"
    }

    fn build_command(&self, config: &AgentStartConfig, cli_path: Option<&str>) -> Vec<String> {
        let mut cmd = vec![cli_path.unwrap_or("claude").to_string()];

        if config.skip_permissions {
            cmd.push("--dangerously-skip-permissions".into());
        }
        if let Some(mcp) = &config.mcp_config {
            cmd.push("--mcp-config".into());
            cmd.push(mcp.to_string_lossy().to_string());
        }
        if let Some(f) = &config.system_prompt_file {
            cmd.push("--append-system-prompt-file".into());
            cmd.push(f.to_string_lossy().to_string());
        }
        if config.continue_session {
            cmd.push("--continue".into());
        }
        for path in &config.secondary_paths {
            cmd.push("--add-dir".into());
            cmd.push(path.clone());
        }
        if let Some(model) = &config.model {
            cmd.push("--model".into());
            cmd.push(model.clone());
        }
        if !config.prompt.is_empty() {
            cmd.push("--print".into());
            cmd.push(shell_escape_prompt(&config.prompt));
        }

        cmd
    }

    fn supports_mcp(&self) -> bool {
        true
    }
    fn supports_skip_permissions(&self) -> bool {
        true
    }
    fn supports_system_prompt_file(&self) -> bool {
        true
    }
}

pub struct CodexProvider;

impl AgentProviderTrait for CodexProvider {
    fn name(&self) -> &str {
        "codex"
    }

    fn build_command(&self, config: &AgentStartConfig, cli_path: Option<&str>) -> Vec<String> {
        let mut cmd = vec![cli_path.unwrap_or("codex").to_string()];

        if config.skip_permissions {
            cmd.push("--full-auto".into());
        }
        if !config.prompt.is_empty() {
            cmd.push(shell_escape_prompt(&config.prompt));
        }

        cmd
    }

    fn supports_mcp(&self) -> bool {
        false
    }
    fn supports_skip_permissions(&self) -> bool {
        true
    }
    fn supports_system_prompt_file(&self) -> bool {
        false
    }
}

pub struct GeminiProvider;

impl AgentProviderTrait for GeminiProvider {
    fn name(&self) -> &str {
        "gemini"
    }

    fn build_command(&self, config: &AgentStartConfig, cli_path: Option<&str>) -> Vec<String> {
        let mut cmd = vec![cli_path.unwrap_or("gemini").to_string()];

        if config.skip_permissions {
            cmd.push("-y".into());
        }
        if !config.prompt.is_empty() {
            cmd.push("-p".into());
            cmd.push(shell_escape_prompt(&config.prompt));
        }

        cmd
    }

    fn supports_mcp(&self) -> bool {
        false
    }
    fn supports_skip_permissions(&self) -> bool {
        true
    }
    fn supports_system_prompt_file(&self) -> bool {
        false
    }
}

pub struct OpencodeProvider;

impl AgentProviderTrait for OpencodeProvider {
    fn name(&self) -> &str {
        "opencode"
    }

    fn build_command(&self, config: &AgentStartConfig, cli_path: Option<&str>) -> Vec<String> {
        let mut cmd = vec![cli_path.unwrap_or("opencode").to_string()];

        if config.skip_permissions {
            cmd.push("--auto-approve".into());
        }
        if !config.prompt.is_empty() {
            cmd.push("--prompt".into());
            cmd.push(shell_escape_prompt(&config.prompt));
        }

        cmd
    }

    fn supports_mcp(&self) -> bool {
        false
    }
    fn supports_skip_permissions(&self) -> bool {
        true
    }
    fn supports_system_prompt_file(&self) -> bool {
        false
    }
}

pub fn get_provider(provider: &Provider) -> Box<dyn AgentProviderTrait> {
    match provider {
        Provider::Claude => Box::new(ClaudeProvider),
        Provider::Codex => Box::new(CodexProvider),
        Provider::Gemini => Box::new(GeminiProvider),
        Provider::Opencode => Box::new(OpencodeProvider),
        Provider::Pi | Provider::Local => Box::new(ClaudeProvider),
    }
}

fn shell_escape_prompt(prompt: &str) -> String {
    let escaped = prompt
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\'', "'\\''");
    format!("'{}'", escaped)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config(prompt: &str) -> AgentStartConfig {
        AgentStartConfig {
            prompt: prompt.to_string(),
            cwd: PathBuf::from("/tmp"),
            skip_permissions: false,
            mcp_config: None,
            system_prompt_file: None,
            model: None,
            secondary_paths: Vec::new(),
            continue_session: false,
        }
    }

    #[test]
    fn test_claude_basic_command() {
        let provider = ClaudeProvider;
        let config = default_config("hello world");
        let cmd = provider.build_command(&config, None);
        assert_eq!(cmd[0], "claude");
        assert!(cmd.contains(&"--print".to_string()));
    }

    #[test]
    fn test_claude_skip_permissions() {
        let provider = ClaudeProvider;
        let mut config = default_config("test");
        config.skip_permissions = true;
        let cmd = provider.build_command(&config, None);
        assert!(cmd.contains(&"--dangerously-skip-permissions".to_string()));
    }

    #[test]
    fn test_claude_mcp_and_system_prompt_flags() {
        let provider = ClaudeProvider;
        let mut config = default_config("orchestrate");
        config.skip_permissions = true;
        config.mcp_config = Some(PathBuf::from("/home/user/.claude/mcp.json"));
        config.system_prompt_file = Some(PathBuf::from("/home/user/.dorotoring/instructions.md"));
        let cmd = provider.build_command(&config, None);

        assert!(cmd.contains(&"--dangerously-skip-permissions".to_string()));
        assert!(cmd.contains(&"--mcp-config".to_string()));
        assert!(cmd.contains(&"--append-system-prompt-file".to_string()));
    }

    #[test]
    fn test_claude_secondary_paths() {
        let provider = ClaudeProvider;
        let mut config = default_config("test");
        config.secondary_paths = vec!["/path/a".into(), "/path/b".into()];
        let cmd = provider.build_command(&config, None);

        let add_dir_count = cmd.iter().filter(|s| *s == "--add-dir").count();
        assert_eq!(add_dir_count, 2);
    }

    #[test]
    fn test_claude_custom_cli_path() {
        let provider = ClaudeProvider;
        let config = default_config("test");
        let cmd = provider.build_command(&config, Some("/usr/local/bin/claude"));
        assert_eq!(cmd[0], "/usr/local/bin/claude");
    }

    #[test]
    fn test_codex_full_auto() {
        let provider = CodexProvider;
        let mut config = default_config("test");
        config.skip_permissions = true;
        let cmd = provider.build_command(&config, None);
        assert!(cmd.contains(&"--full-auto".to_string()));
        assert!(!cmd.contains(&"--dangerously-skip-permissions".to_string()));
    }

    #[test]
    fn test_codex_no_mcp_support() {
        let provider = CodexProvider;
        assert!(!provider.supports_mcp());
    }

    #[test]
    fn test_gemini_skip_permissions() {
        let provider = GeminiProvider;
        let mut config = default_config("test");
        config.skip_permissions = true;
        let cmd = provider.build_command(&config, None);
        assert!(cmd.contains(&"-y".to_string()));
    }

    #[test]
    fn test_gemini_prompt_flag() {
        let provider = GeminiProvider;
        let config = default_config("hello");
        let cmd = provider.build_command(&config, None);
        assert!(cmd.contains(&"-p".to_string()));
    }

    #[test]
    fn test_get_provider_returns_correct_type() {
        let p = get_provider(&Provider::Claude);
        assert_eq!(p.name(), "claude");
        assert!(p.supports_mcp());

        let p = get_provider(&Provider::Codex);
        assert_eq!(p.name(), "codex");
        assert!(!p.supports_mcp());

        let p = get_provider(&Provider::Gemini);
        assert_eq!(p.name(), "gemini");
    }

    #[test]
    fn test_shell_escape_single_quotes() {
        let result = shell_escape_prompt("it's a test");
        assert_eq!(result, "'it'\\''s a test'");
    }

    #[test]
    fn test_shell_escape_newlines() {
        let result = shell_escape_prompt("line1\nline2");
        assert_eq!(result, "'line1\\nline2'");
    }

    #[test]
    fn test_claude_continue_session() {
        let provider = ClaudeProvider;
        let mut config = default_config("test");
        config.continue_session = true;
        let cmd = provider.build_command(&config, None);
        assert!(cmd.contains(&"--continue".to_string()));
    }

    #[test]
    fn test_empty_prompt_no_print_flag() {
        let provider = ClaudeProvider;
        let config = default_config("");
        let cmd = provider.build_command(&config, None);
        assert!(!cmd.contains(&"--print".to_string()));
    }
}
