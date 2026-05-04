---
workstream: C
title: Result persistence and operator visibility
owner: Claude
reviewer: Codex
branch: task/auto-result-visibility
closes: "#42"
references: "#45"
lane: autonomous
---

# Workstream C — Result Visibility

**Owner:** Claude
**Reviewer:** Codex
**Lane:** Autonomous

## Issues

- `#42`: `task_runs.result = NULL` quando agente responde via tool calls. Operador não consegue
  ver a resposta sem ir direto no SQLite ou JSONL de sessão.
- `#45`: Comportamentos validados em produção — evidence a documentar em BEST_PRACTICES.md.

## Expected touchpoints

```
src/cli/commands/result.ts        (novo)
src/cli/main.ts                   (wiring + help text)
src/worker/runner.ts              (enrichment de result)
tests/integration/result-cmd.test.ts  (novo)
BEST_PRACTICES.md                 (§12 — validated behaviors)
```

## Tasks

### Task 1 — Enrichment em `runner.ts`

Ao finalizar task em `src/worker/runner.ts`, tentar extrair texto completo do stream:

```typescript
function extractFullAssistantText(agentResult: AgentResult): string {
  // Se o SDK expõe mensagens intermediárias, concatenar todos os blocos
  // de texto de mensagens com role=assistant.
  // Verificar API: agentResult.messages? agentResult.transcript?
  if (agentResult.messages && agentResult.messages.length > 0) {
    return agentResult.messages
      .filter(m => m.role === "assistant")
      .flatMap(m => m.content?.filter(c => c.type === "text").map(c => c.text) ?? [])
      .join("\n\n");
  }
  // Fallback para finalText
  return agentResult.finalText ?? "";
}
```

Verificar a API exata do `@anthropic-ai/claude-agent-sdk@0.2.123`. Se não expõe
histórico completo, documentar limitação e deixar Task 2 como fallback primário.

Atualizar:
```typescript
result: extractFullAssistantText(agentResult) || null
```

### Task 2 — `clawde result <task-id>` CLI command

**Arquivo:** `src/cli/commands/result.ts` (novo)

```typescript
export interface ResultOptions {
  readonly taskId: number;
  readonly dbPath: string;
  readonly format: OutputFormat;
  readonly claudeProjectsDir?: string; // override para testes
}

export async function runResult(options: ResultOptions): Promise<number>
```

Fluxo:
1. Busca `tasks` por `id = taskId`. Se não existe: stderr + exit 1.
2. Busca `task_runs` mais recente para a task (qualquer status).
3. Se `task_run.result` não-NULL: emite e retorna 0.
4. Se NULL e `task_run.session_id` não-NULL:
   - Resolve `<claudeProjectsDir>` = opção injetada ou `~/.claude/projects/`.
   - Procura JSONL: `find <dir> -name "<session_id>.jsonl" 2>/dev/null | head -1`
   - Lê JSONL, filtra `type=message, role=assistant`, extrai `content[].text`.
   - Concatena e emite.
5. Se nada: stderr com sugestão e exit 1.

### Task 3 — Wiring em `src/cli/main.ts`

Importar e rotear `clawde result <task-id>`.

Adicionar ao `HELP_TEXT`:
```
result <task-id>       Exibe resultado de uma task (DB ou sessão JSONL)
```

### Task 4 — `BEST_PRACTICES.md §12`

Se a Fase 2 (Codex/Workstream B) não já adicionou, criar seção §12:

```markdown
## §12 — Comportamentos validados em produção (WSL2 Ubuntu 24.04)

Validados em 2026-05-02, Clawde 0.0.1, Bun 1.3.13, 8 tasks, 274 msgs.

### Reconcile de lease expirado — ✅ funcionando
[...]

### Quota gate com not_before — ✅ funcionando
[...]

### Health endpoint reflete quota — ✅ funcionando
[...]

### Receiver estável durante falhas do worker — ✅ funcionando
[...]
```

(Conteúdo completo no issue #45.)

### Task 5 — Testes em `tests/integration/result-cmd.test.ts`

- `result presente no DB`: imprime direto, exit 0.
- `result NULL, JSONL mockado`: extrai texto do assistente, exit 0.
- `task ID inexistente`: stderr error, exit 1.
- `task succeeded, result NULL, sem session_id`: stderr com sugestão, exit 1.
- `format=json`: output JSON estruturado.

**Injetar** `claudeProjectsDir = tmpdir` em todos os testes que leem JSONL.

## Sequência de execução

```bash
git checkout main && git pull --ff-only
git checkout -b task/auto-result-visibility

# implementar tasks 1-5

bun run ci

GIT_AUTHOR_NAME="Incavenuziano" \
GIT_AUTHOR_EMAIL="222538801+Incavenuziano@users.noreply.github.com" \
GIT_COMMITTER_NAME="Incavenuziano" \
GIT_COMMITTER_EMAIL="222538801+Incavenuziano@users.noreply.github.com" \
git commit -m "feat(cli): result command + runner enrichment (#42)

Closes #42
References #45

runner.ts: extractFullAssistantText concatenates all assistant text
blocks from the stream, not only finalText.

src/cli/commands/result.ts: clawde result <task-id> serves from DB
if present, falls back to session JSONL read.

BEST_PRACTICES.md §12: documents production-validated behaviors from
first real test run (2026-05-02, WSL2 Ubuntu 24.04).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin task/auto-result-visibility
gh pr create --title "feat(cli): clawde result command + result enrichment (#42)" ...
```

## Critérios de aceite (Codex usa pra review)

- [ ] `runner.ts` tenta extrair texto completo (não só finalText).
- [ ] `clawde result <task-id>` wired em main.ts.
- [ ] Se result no DB: serve direto, sem tocar JSONL.
- [ ] Se result NULL + session_id: tenta JSONL, extrai texto assistente.
- [ ] `claudeProjectsDir` injetável (testes determinísticos).
- [ ] Testes: result presente, result NULL + JSONL mock, ID inexistente.
- [ ] Help text atualizado.
- [ ] `BEST_PRACTICES.md §12` com evidências do #45.
- [ ] `bun run ci` clean.
- [ ] PR body fecha #42, referencia #45.
