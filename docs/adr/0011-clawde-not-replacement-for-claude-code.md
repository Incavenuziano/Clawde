# ADR 0011 — Clawde não substitui Claude Code (split síncrono/assíncrono)

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

Discussão pré-implementação levantou risco de framing: tratar Clawde como "substituto"
do Claude Code introduz expectativas erradas e leva a decisões ruins (ex: portar
features interativas pro headless, ou abandonar Claude Code interativo). Análise honesta
mostrou:

- Clawde **usa** `@anthropic-ai/claude-agent-sdk`, que é o mesmo motor do Claude Code.
- O agente subjacente é **idêntico** — modelo, tools, context window, quota.
- Diferença real é **interativo (Claude Code) vs headless agendado/event-driven (Clawde)**.
- Eixo "criativo vs execução" é proxy ruim — execução pode ser interativa, planejamento
  pode ser headless.

Sem esse alinhamento explícito, futuras decisões de feature ("vamos portar slash commands
pro Clawde?", "vamos descontinuar Claude Code interno e usar só Clawde?") seriam mal
calibradas.

## Decisão

**Clawde e Claude Code coexistem, com responsabilidades complementares.** O eixo de divisão
é **presença do operador**, não tipo de trabalho:

| Eixo | Claude Code interativo | Clawde headless |
|------|------------------------|-----------------|
| Operador presente steering | sim | não |
| Trigger | input humano direto | tempo/evento/fila |
| Streaming visível live | sim | log async |
| Interrupção / reajuste | ESC | re-enqueue |
| Audit trail formal | parcial (JSONL) | completo (`events`) |
| Sandbox enforçado | manual | automático |

**Casos de uso por sistema:**

| Use case | Sistema |
|----------|---------|
| Brainstorm, debug interativo | Claude Code |
| Refactor steered live | Claude Code |
| Triagem agendada de PRs | Clawde |
| Resposta a webhook (GitHub, Telegram) | Clawde |
| Smoke test diário | Clawde |
| Exploração ad-hoc com lots of back-and-forth | Claude Code |
| Batch overnight de N tasks | Clawde |
| Tarefa única, presença, quer ajustar mid-flight | Claude Code |

**Não-objetivos explícitos do Clawde:**

1. **Não** substituir slash commands (`/compact`, `/clear`, `/cost`) — UI affordances
   ficam no Claude Code.
2. **Não** suportar ESC/cancel mid-stream — re-enqueue é o equivalente.
3. **Não** integrar com IDE — domínio do Claude Code.
4. **Não** ser "melhor que Claude Code" — é diferente, não superior.

**Reuso bilateral garantido por design** (sem ADR adicional):
- Sessões `~/.claude/projects/<hash>/*.jsonl` compartilhadas (mesmo cwd hash).
- `.claude/agents/`, `.claude/hooks/`, `SKILL.md`, `CLAUDE.md` — fonte única.
- `--session-id` determinístico do Clawde aceita `--resume` no Claude Code e vice-versa.

## Consequências

**Positivas**
- Decisões de feature ficam claras: "isso é interativo? então é Claude Code, não Clawde."
- Documentação (README, BLUEPRINT) pode comunicar com confiança que **vocês usam ambos**.
- Não criamos pressão pra reimplementar features interativas que já existem no CLI.
- Caveats da reusabilidade bilateral (workflow "commit antes de delegar", quota
  compartilhada, audit assimétrico) ficam documentados.

**Negativas**
- Operador precisa entender quando usar qual — curva de aprendizado.
  Mitigação: README explica em 1 página com exemplos concretos.
- Quota Anthropic é compartilhada — uso intensivo no Claude Code reduz capacidade do Clawde
  na mesma janela. Mitigação: thresholds conservadores no `quota_ledger`, ver ADR 0006.

**Neutras**
- Nada impede que, no futuro, alguma feature do Clawde seja exposta também via slash
  command no Claude Code (caminho oposto ao descartado acima).

## Alternativas consideradas

- **"Clawde substitui Claude Code"** — descartado pelos motivos acima; perde affordances
  interativas críticas pra UX de coding.
- **"Eixo é criativo vs execução"** — descartado, é proxy ruim (planejamento pode ser
  headless, execução pode ser síncrona).
- **Clawde só pra automação de CI** — descartado; restringe escopo demais (perde Telegram,
  webhook, scheduled, batch).

## Referências

- `ARCHITECTURE.md` §1.3 (split daemon).
- `BEST_PRACTICES.md` §5.7 (subagent pipeline tests).
- ADR 0002 (split daemon receiver+worker — pré-requisito desta decisão).
- ADR 0008 (Agent SDK — confirma mesmo motor do Claude Code).
