---
workstream: A
title: Runtime packaging and SDK executable resolution
owner: Codex
reviewer: Claude
branch: task/auto-runtime-sdk-resolution
closes: "#41, #43, #47"
lane: autonomous
---

# Workstream A — Runtime Packaging and SDK Executable Resolution

**Owner:** Codex
**Reviewer:** Claude
**Lane:** Autonomous

## Issues

- `#41`: SDK instala binário musl mas Ubuntu/Debian usam glibc — worker falha silenciosamente.
- `#43`: `worker-main.js` bundlado em `~/.clawde/dist/` não acha SDK fora do `node_modules`.
- `#47`: worker falha com "claude not found" quando `claude` está apenas no Windows npm — systemd não monta `/mnt/c/`.

## Causa raiz compartilhada

O SDK resolve o binário nativo via caminhos relativos ao `node_modules` ou PATH do shell interativo.
Quando o worker roda via systemd (sem PATH do Windows) ou a partir de um bundle em `~/.clawde/dist/`,
nenhum desses caminhos funciona. O campo `pathToClaudeCodeExecutable` do SDK é o escape hatch correto.

## Expected touchpoints

```
src/config/schema.ts
src/worker/main.ts  (ou runner.ts — onde RealAgentClient é instanciado)
src/sdk/client.ts   (verificar se aceita pathToClaudeCodeExecutable)
scripts/setup-linux.sh          (novo)
config/clawde.toml.example
docs/DEPLOY-LINUX.md            (novo) ou README.md
tests/unit/config/              (schema test)
tests/integration/worker-*      (verif bundle outside project)
```

## Tasks

### Task 1 — Config schema (`src/config/schema.ts`)

Adicionar campo opcional em `WorkerSchema`:

```typescript
claude_executable_path: z.string().optional(),
```

Sem default (undefined = SDK resolve automaticamente).

### Task 2 — Wire no worker

Em `src/worker/main.ts` (ou `runner.ts`), ao instanciar `RealAgentClient`:

```typescript
const agentOptions = {
  // ... opções existentes ...
  ...(config.worker.claude_executable_path?.length
    ? { pathToClaudeCodeExecutable: config.worker.claude_executable_path }
    : {}),
};
```

Verificar a assinatura exata do SDK v0.2.123.

### Task 3 — `scripts/setup-linux.sh`

Script idempotente (`set -euo pipefail`, exec bit 100755) que:

1. Detecta glibc vs musl:
   ```bash
   ldd --version 2>&1 | grep -q musl && LIBC=musl || LIBC=glibc
   ```

2. Localiza binário glibc do SDK:
   ```bash
   CLAUDE_BIN=$(bunx -e "console.log(require.resolve('@anthropic-ai/claude-agent-sdk-linux-x64/claude'))" 2>/dev/null)
   # fallback se bunx falhar:
   # find ~/.bun ~/.npm ~/.local -name 'claude' -path '*linux-x64/claude' 2>/dev/null | head -1
   ```

3. Instala em `~/.clawde/bin/claude` (symlink ou cópia):
   ```bash
   mkdir -p ~/.clawde/bin
   ln -sf "$CLAUDE_BIN" ~/.clawde/bin/claude
   ```

4. Atualiza `~/.clawde/config/clawde.toml` se campo ainda não presente:
   ```bash
   grep -q claude_executable_path ~/.clawde/config/clawde.toml 2>/dev/null \
     || printf '\n[worker]\nclaude_executable_path = "%s"\n' "$HOME/.clawde/bin/claude" \
        >> ~/.clawde/config/clawde.toml
   ```

5. Cobre o #47 — se `LIBC=glibc` e o binário glibc local não é encontrado,
   tenta `which claude` no PATH atual e usa como fallback:
   ```bash
   CLAUDE_BIN=${CLAUDE_BIN:-$(which claude 2>/dev/null)}
   if [[ -z "$CLAUDE_BIN" ]]; then
     echo "setup-linux.sh: ERROR — claude binary not found. Install via native installer." >&2
     exit 1
   fi
   ```

6. Output: `setup-linux.sh: OK — claude binary at ~/.clawde/bin/claude`

**Importante:** `git update-index --chmod=+x scripts/setup-linux.sh`

### Task 4 — `config/clawde.toml.example`

Adicionar seção comentada:

```toml
# Opcional: caminho explícito para o binário glibc do Claude SDK.
# Necessário quando worker é deployado fora do diretório do projeto.
# Execute scripts/setup-linux.sh para configurar automaticamente.
# Docs: docs/DEPLOY-LINUX.md
# claude_executable_path = "~/.clawde/bin/claude"
```

### Task 5 — `docs/DEPLOY-LINUX.md` (novo)

Criar com seções:
- **Pre-requisites** (Ubuntu 22.04+, Bun, systemd user)
- **SDK binary setup** (`bash scripts/setup-linux.sh` + o que faz)
- **Systemd deploy** (copiar units, daemon-reload, enable)
- **Smoke test** (`clawde diagnose all --output text`)
- **Known issues** (referencias #41, #43, #47 + soluções)

### Task 6 — Testes

- `tests/unit/config/`: schema aceita `claude_executable_path` opcional.
- `tests/unit/sandbox/systemd.test.ts` ou similar: `setup-linux.sh` tem exec bit.
- `tests/integration/worker-bootstrap.test.ts`: adicionar test coverage para caso
  em que `CLAWDE_DB_PATH` aponta para tmpdir mas `claude_executable_path` aponta
  para binário real — verifica que worker não falha por binário não encontrado.

## Sequência de execução

```bash
git checkout main && git pull --ff-only
git checkout -b task/auto-runtime-sdk-resolution

# implementar tasks 1-6

bun run ci                    # typecheck + lint + test (inclui novos testes)
bun run build:worker          # verifica que bundle compila
git update-index --chmod=+x scripts/setup-linux.sh

GIT_AUTHOR_NAME="Incavenuziano" \
GIT_AUTHOR_EMAIL="222538801+Incavenuziano@users.noreply.github.com" \
GIT_COMMITTER_NAME="Incavenuziano" \
GIT_COMMITTER_EMAIL="222538801+Incavenuziano@users.noreply.github.com" \
git commit -m "fix(worker): runtime SDK resolution — executable path config + setup script

Closes #41
Closes #43
Closes #47

worker.claude_executable_path in config schema + wire to SDK
pathToClaudeCodeExecutable. scripts/setup-linux.sh detects libc,
installs glibc binary at ~/.clawde/bin/claude, updates clawde.toml.
docs/DEPLOY-LINUX.md covers full deploy sequence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin task/auto-runtime-sdk-resolution
gh pr create --title "fix(worker): runtime SDK binary resolution (#41 #43 #47)" ...
```

## Critérios de aceite (Claude usa pra review)

- [ ] `WorkerSchema` tem `claude_executable_path: z.string().optional()`.
- [ ] Worker passa `pathToClaudeCodeExecutable` quando campo está setado.
- [ ] Worker funciona quando campo está ausente (backward compat).
- [ ] `scripts/setup-linux.sh` tem exec bit 100755 no git.
- [ ] Script detecta glibc vs musl e instala binário correto.
- [ ] Script é idempotente.
- [ ] Script cobre fallback para `which claude` (#47).
- [ ] `docs/DEPLOY-LINUX.md` existe e referencia o script.
- [ ] `config/clawde.toml.example` tem campo comentado.
- [ ] Testes: schema, exec bit, worker bootstrap não falha com claude_executable_path setado.
- [ ] `bun run ci` clean. `bun run build:worker` clean.
- [ ] PR body fecha #41, #43, #47.
