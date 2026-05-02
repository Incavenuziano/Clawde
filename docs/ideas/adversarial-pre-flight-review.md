# Adversarial Pre-Flight Review

> **Status:** Ideia em elaboração — não implementado  
> **Origem:** Conversa 2026-05-02, análise de referências (claudeclaw-os/warroom, openclaw-mission-control)  
> **Contexto:** Complemento ao two-stage review pipeline existente (P2.4), rodando *antes* da execução

---

## O Problema

O Clawde já tem review *durante* a execução (implementer → spec-reviewer → quality). Mas para tasks de alto risco ou longa duração, o custo de descobrir um problema no meio da execução é alto — trabalho perdido, rollback necessário, possível impacto em dados.

A ideia: **deliberar antes de executar**, quando ainda não há custo de reversão.

---

## Princípio de Design

O eixo continua sendo **presença do operador**:

```
Você presente → Claude Code  →  /war-room skill (interativo)
Você ausente  → Clawde       →  pre_flight stage (headless + Telegram)
```

Os dois compartilham os mesmos agentes (AGENT.md) e a mesma lógica de deliberação. A skill é a interface humana do mesmo mecanismo que o Clawde usa de forma autônoma.

---

## Arquitetura: Pre-Flight Stage no Clawde

### Fluxo

```
Task entra (Telegram / webhook / CLI)
        │
        ▼
  task.pre_flight.enabled?
        │
   NÃO  │  SIM
        │          ┌── PRE_FLIGHT STAGE ──────────────────────┐
        │          │                                           │
        │          │  Round 1..N (max configurável, default 3) │
        │          │  ┌─────────────────────────────────────┐  │
        │          │  │ 1. Planner  → gera abordagem        │  │
        │          │  │ 2. Adversary → desafia o plano      │  │
        │          │  │ 3. Risk     → avalia irreversibilidade│ │
        │          │  │ 4. Planner  → revisa (se objeções)  │  │
        │          │  └─────────────────────────────────────┘  │
        │          │                                           │
        │          │  Consensus check                          │
        │          │  ├── APPROVED    → segue para execução    │
        │          │  ├── NEEDS_HUMAN → pausa + Telegram       │
        │          │  └── BLOCKED     → cancela + notifica     │
        │          └───────────────────────────────────────────┘
        │                      │
        └──────────────────────┘
                   │
                   ▼
           runner.ts (existente)
```

### Integração no runner.ts

```typescript
// Novo check antes de processTask
if (task.preFlight?.enabled) {
  const verdict = await runPreFlight(deps, task)
  if (verdict === "BLOCKED")      return markBlocked(task)
  if (verdict === "NEEDS_HUMAN")  return parkForApproval(task)
  // APPROVED → continua normalmente
}
await processTask(deps, task)
```

### Estrutura de arquivos proposta

```
src/
  pre_flight/
    index.ts       ← orquestrador do loop de deliberação
    consensus.ts   ← regras de resolução de conflito
    notify.ts      ← integração Telegram para NEEDS_HUMAN
    types.ts       ← Round, Verdict, PreFlightConfig

.claude/agents/
  planner.md       ← agente leve, só raciocínio sobre planos
  adversary.md     ← desafia planos, busca suposições ocultas
  risk-assessor.md ← foco em irreversibilidade e segurança
```

---

## Os Três Agentes

### `planner`
- **Papel:** Dado o prompt da task, gera uma abordagem estruturada: fases, dependências, critério de sucesso
- **Sandboxing:** Nível 1 (sem execução — só raciocínio)
- **Output:** Plano estruturado com fases e riscos identificados

### `adversary`
- **Papel:** Recebe o plano e ataca. Pergunta: o que está sendo assumido implicitamente? O que pode dar errado? Existe um caminho mais simples?
- **Output:** Lista de objeções com severidade: `INFO` / `WARN` / `BLOCK`
- **Regra:** Não pode apenas dizer "parece bom" — deve encontrar pelo menos uma pergunta legítima por rodada

### `risk-assessor`
- **Papel:** Foco específico em irreversibilidade, impacto em dados, segurança, sistemas externos
- **Perguntas-chave:** Essa operação pode ser desfeita? Afeta dados de usuário? Envolve sistemas externos?
- **Output:** Veredicto de risco: `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`
- **Regra:** Qualquer `CRITICAL` é veto automático — sem override possível por config

---

## Regras de Consenso

```typescript
type PreFlightVerdict = "APPROVED" | "NEEDS_HUMAN" | "BLOCKED"

function resolveConsensus(rounds: Round[], config: PreFlightConfig): PreFlightVerdict {
  const last = rounds.at(-1)!

  // Veto absoluto: CRITICAL do risk-assessor
  if (last.risk === "CRITICAL") return "BLOCKED"

  // Objeções BLOCK não resolvidas após max rounds
  if (last.adversary.blocks.length > 0) return "NEEDS_HUMAN"

  // Risco HIGH sem config de auto-aprovação
  if (last.risk === "HIGH" && !config.autoApproveHighRisk) return "NEEDS_HUMAN"

  return "APPROVED"
}
```

### Tabela de decisão rápida

| Risk     | Adversary blocks | Resultado                          |
|----------|------------------|------------------------------------|
| CRITICAL | qualquer         | BLOCKED                            |
| HIGH     | >= 1             | NEEDS_HUMAN                        |
| HIGH     | 0                | NEEDS_HUMAN (salvo autoApproveHighRisk) |
| MEDIUM   | >= 1             | NEEDS_HUMAN                        |
| MEDIUM   | 0                | APPROVED                           |
| LOW      | qualquer         | APPROVED                           |

---

## Human-in-the-Loop via Telegram

Quando `NEEDS_HUMAN`, o Clawde envia:

```
⚠️ Pre-flight pausado — task #42

Tarefa: "refatorar módulo de autenticação"
Agente: implementer

Plano: [3 fases, ~45min estimado]
Objeções: sessões ativas podem ser invalidadas (WARN)
Risco: HIGH — afeta tokens de sessão em produção

[✅ Aprovar como está]  [✏️ Aprovar com nota]  [❌ Cancelar]
```

Se o operador responde com texto, o texto vira input adicional pro Planner e o loop roda mais uma rodada com essa restrição.

**Timeout:** Se não houver resposta em X minutos (configurável), a task vai para `pending_approval` e fica estacionada.

---

## Como Ativar

### Por task (CLI)
```bash
clawde queue --pre-flight "refatorar módulo de autenticação"
clawde queue --pre-flight --pre-flight-rounds 2 "deploy para produção"
```

### Por agente (AGENT.md)
```markdown
---
name: db-migrator
pre_flight:
  enabled: true
  max_rounds: 2
  require_approval: always
---
```

### Por prioridade (clawde.toml)
```toml
[review.pre_flight]
enabled_for_priorities  = ["CRITICAL"]
auto_approve_risk       = ["LOW", "MEDIUM"]
require_approval_risk   = ["HIGH", "CRITICAL"]
max_rounds              = 3
timeout_minutes         = 30
```

### Por tag
```bash
clawde queue --tag needs-review "tarefa sensível"
```

---

## A Skill /war-room para Claude Code

Quando você está presente, a skill roda o mesmo pipeline interativamente:

```
/war-room "migrar SQLite para Postgres"

[Planner]   Proposta: migração em 3 fases com snapshot pré-migração...
[Adversary] Fase 2 assume zero-downtime mas schema tem FKs circulares → WARN
[Risk]      Risco MEDIUM — reversível se snapshot preservado
[Planner]   Revisado: adicionado checkpoint entre fase 1 e 2
[Adversary] Objeções restantes: apenas INFO
[Consenso]  ✓ APPROVED

Spec salvo em: .claude/specs/2026-05-02-postgres-migration.md
Deseja enfileirar no Clawde? [s/n]
```

Output: task spec refinado para executar no Claude Code, enfileirar no Clawde, ou arquivar como ADR.

---

## Relação com Infraestrutura Existente

| Componente existente       | Relação com pre-flight                                    |
|----------------------------|-----------------------------------------------------------|
| `two-stage review` (P2.4)  | Complementar — pre-flight é *antes*, review é *durante*  |
| `AGENT.md loader` (P2.5)   | Reutilizado — os 3 novos agentes seguem o mesmo padrão   |
| `quota gate` (P1.2)        | Pre-flight consome quota — deve ser contabilizado         |
| `events` (append-only)     | Cada rodada de deliberação gera eventos auditáveis        |
| `Telegram alerts` (Wave 6) | NEEDS_HUMAN usa o mesmo canal de alertas                  |
| `task_runs.not_before`     | NEEDS_HUMAN usa o mesmo mecanismo de suspensão            |

---

## Perguntas em Aberto

1. **Custo de quota:** 3 agentes x N rounds por task. Estimar consumo médio antes de ativar por padrão.
2. **Agentes leves vs. reais:** Instâncias separadas ou mesmo processo com prompts diferentes?
3. **Loop infinito:** Após max_rounds com BLOCK ativo → sempre NEEDS_HUMAN, nunca APPROVED automático.
4. **Aprendizado:** Deliberações são candidatos para o reflection layer — objeções recorrentes podem virar memória pro Planner.
5. **Versioning de specs:** Specs gerados pelo /war-room deveriam ser versionados junto com o código?

---

## Referências Externas Analisadas

- `earlyaidopters/claudeclaw-os` — `warroom/` (voz multi-agente, inspiração para o conceito de "sala")
- `abhi1693/openclaw-mission-control` — modelo de aprovações e governance built-in
- ECC skill `council` — deliberação de 4 vozes para decisões ambíguas
- ECC skill `santa-method` — dual-review adversarial com convergência
- Reflexion (Shinn et al, 2023) — já referenciado no Clawde (ADR 0009)
