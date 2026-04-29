/**
 * Lista de chaves cujos valores devem ser mascarados antes de logar.
 * Match case-insensitive sobre o nome da chave.
 *
 * Não exaustivo, mas cobre os secrets críticos de BEST_PRACTICES §6.4.
 */

export const SECRET_KEY_PATTERNS = [
  // API tokens / OAuth
  "token",
  "auth",
  "authorization",
  "api_key",
  "apikey",
  "oauth",
  "bearer",
  "secret",

  // Passwords
  "password",
  "passwd",
  "pwd",

  // Specific Anthropic / vendor patterns
  "anthropic_api_key",
  "claude_code_oauth_token",
  "telegram_bot_token",
  "github_pat",
  "github_token",

  // Generic credentials
  "credential",
  "credentials",
  "private_key",
  "ssh_key",
  "session_secret",
  "cookie",
] as const;

/**
 * Padrões de regex para valores que parecem secrets independentemente da chave.
 */
export const SECRET_VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  /sk-ant-[a-zA-Z0-9_-]{32,}/g, // Anthropic API key
  /sk-ant-oat01-[a-zA-Z0-9_-]+/g, // Anthropic OAuth token
  /ghp_[a-zA-Z0-9]{36,}/g, // GitHub PAT
  /xox[baprs]-[a-zA-Z0-9-]+/g, // Slack tokens
  /ya29\.[a-zA-Z0-9_-]+/g, // Google OAuth
];

export const REDACTED_PLACEHOLDER = "[REDACTED]";
