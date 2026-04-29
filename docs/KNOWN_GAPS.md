# Clawde — Gaps conhecidos vs BEST_PRACTICES.md

> Auditoria de conformidade do `EXECUTION_BACKLOG.md` (143 tasks em 6 waves)
> contra `BEST_PRACTICES.md` (1244 linhas, 13 seções) realizada em 2026-04-29.
>
> **Gaps críticos** (8 itens) foram absorvidos na **Wave 6** do backlog.
> **Gaps importantes** (10 itens) e **gaps documentais aceitáveis** (4 itens)
> ficam registrados aqui como **débito conhecido pós-MVP**.
>
> Este arquivo é o registro explícito de "vimos e escolhemos adiar". Não é
> esquecimento — é decisão.

## Princípio aplicado

A Wave 6 cobre o **mínimo** que o BEST_PRACTICES marca como obrigatório
e cuja ausência impede o próprio sistema de cumprir sua definição de
"production-ready". Os gaps abaixo são **importantes mas não-bloqueantes
pro MVP**. Devem ser endereçados em fase 2 ou conforme demanda real.

---

## Gaps importantes — pós-MVP

### KG-1. Semgrep custom rules

**BP §3.1**: regras custom em `.semgrep/clawde.yml`:
- Proibir `eval`, `new Function`, `child_process.exec` sem `execFile`.
- Proibir concatenação de string em SQL.
- Proibir `console.log` em arquivos `src/`.
- Proibir leitura de `process.env` fora de `src/config/`.

**Por que adiar**: TypeScript + biome já pegam parte (`no-console`,
naming). `execFile` é convenção respeitada em código atual. Risco
residual baixo, mas regras explicitas são complementares.

**Trigger pra implementar**: primeira violação detectada via review humana
ou primeiro PR que tente bypassar convenção.

### KG-2. Property-based tests amplos (fast-check)

**BP §3.4**: invariants via `fast-check` para sanitização, dedup, hooks.

**Cobertura atual**: T-085 (round-trip de cada `EVENT_KIND_VALUE`). Falta:
- `∀ s, sanitizeExternalInput(src, s)` retorna XML válido
- `∀ key, 2 inserts com mesma dedup_key resultam em 1 row` (testado por unit isolado)
- `∀ events com mesmo (task_run_id, event_hash) resultam em 1 row` (hooks dedup)

**Por que adiar**: unit tests existentes cobrem casos representativos.
Property tests pegam edge cases que casos representativos não cobrem,
mas custo de adicionar fast-check é alto pro retorno em projeto solo.

**Trigger pra implementar**: primeiro bug encontrado por payload edge
case que test representativo missou.

### KG-3. Performance baselines

**BP §5.8**: baselines + alerta de regressão >20%.

| Métrica | Baseline alvo | Alerta |
|---------|---------------|--------|
| Worker cold start | <3s | >5s |
| Task simples | <8s | >15s |
| Reindex 100MB JSONL | <30s | >60s |
| `state.db` size 1 ano | <500MB | >2GB |
| Receiver p99 enqueue | <50ms | >200ms |

**Por que adiar**: Clawde é low-volume (dezenas de tasks/dia). Baseline
sob carga não é restrição operacional real no MVP. Alerta de regressão
exige histórico de runs CI que ainda não temos.

**Trigger pra implementar**: após 3 meses de histórico CI estável OU
operador notar lentidão subjetiva.

### KG-4. PII detection / redaction em input externo

**BP §6.4, §7.4**: hashar PII (CPF, email, telefone) antes de logar.
Valor cru fica só em `messages` original + JSONL nativo.

**Cobertura atual**: P2.7 (T-097..T-100) cobre redact de tokens conhecidos
em events. Não cobre PII estruturada (regex pra CPF, email).

**Por que adiar**: input externo Clawde MVP vem de Telegram/webhook do
operador (auto-input), não de público. Risco real é baixo. Implementar
PII regex tem custo de manutenção.

**Trigger pra implementar**: se Telegram bot virar público, ou novo
adapter de input externo for adicionado.

### KG-5. Network egress real (nftables/netns funcional)

**BP §2.6**: nftables `chain output { ip daddr != $allowlist drop; }`
em namespace do worker.

**Cobertura atual**: P2.6 (T-092..T-096) faz `network='allowlist'` falhar
fechado quando backend não existe. Modo `loopback-only` funciona via
unshare net. Mas allowlist real (egress allowlisted) não está implementada.

**Por que adiar**: nftables em user namespace é não-trivial; requer
preparação fora do bwrap. Pra MVP, `loopback-only` ou `host` são
suficientes (operador escolhe trade-off explicitamente).

**Trigger pra implementar**: agente que **precisa** de egress restrito
(ex: `github-pr-handler` com acesso só a `api.github.com`) virar uso
operacional real.

### KG-6. Fuzzing e chaos tests

**BP §3.6**: 
- Fuzz parser JSONL com `jazzer.js`
- Chaos: mock de `claude -p` com timeout/OOM/stdout corrompido
- Network chaos: bloquear `api.anthropic.com` por 30s

**Por que adiar**: parser tolerante (já testado com fixtures). Chaos
exige infra de injeção que não existe. ROI baixo no MVP.

**Trigger pra implementar**: primeiro caso de produção onde falha
inesperada do SDK ou JSONL malformado causou incidente.

### KG-7. Hash chain em events (alta segurança)

**BP §7.2**: events de impacto crítico (deploy, push, alteração de config)
incluem `prev_hash` SHA-256 dos campos críticos. Cadeia detecta inserção
retroativa.

**Por que adiar**: `_retention_grant` + triggers `events_no_*` já garantem
imutabilidade dentro do schema. Hash chain detectaria adversário com
acesso write ao DB — modelo de ameaça que assumimos como fora de escopo
single-user/single-host.

**Trigger pra implementar**: multi-host com replicação bidirecional, ou
auditoria externa de compliance exigida.

### KG-8. Runbooks (`docs/runbooks/`)

**BP §12.2**: runbooks pra `db-corruption`, `quota-exhausted`,
`oauth-expired`, `sandbox-breach`, `prompt-injection-detected`,
`migration-failed`.

**Por que adiar**: operador é solo dev com contexto profundo do
sistema. Runbooks viram úteis quando há rotação de operador ou time.
`clawde diagnose` (T-106) cobre triagem básica em comando único.

**Trigger pra implementar**: primeiro incidente onde operador precisou
mais de 30min pra triar (postmortem deveria gerar runbook).

### KG-9. Severidades + comunicação de incidentes

**BP §12.1, §12.4**: SLA por SEV1-SEV4. Status em `~/.clawde/state/incident.md`.
Mensagem de status no canal Telegram quando bot down.

**Por que adiar**: single-user sem usuários externos consumindo serviço.
SEV1-SEV4 fica óbvio pelo próprio operador (tem outro trabalho?).

**Trigger pra implementar**: bot público OU 2º host operacional.

### KG-10. Direito ao esquecimento (`forget`)

**BP §10.6**: `clawde forget --user <id>` purga `tasks`+`task_runs`+`messages`,
mantém `events` com `user_id` hashed.

**Por que adiar**: **explicitamente cortado do MVP** pelo operador
(ratificado em decisão fixada). Requer política de retenção/PII séria
(LGPD/GDPR-compliant), audit trail, recurso de validação. Escopo de
fase própria.

**Trigger pra implementar**: bot público OU usuários externos identificáveis,
OU compliance obrigatório.

---

## Gaps documentais aceitáveis

### KG-11. Pentest manual trimestral

**BP §3.7**: checklist de pentest a cada 3 meses.

**Status**: trimestral é cadência apropriada; primeiro ciclo ocorre 3
meses após primeiro deploy production. Não é trabalho de backlog
upfront — é trabalho de operação contínua.

### KG-12. Postmortem template

**BP §12.3**: documento em `docs/postmortems/YYYY-MM-DD-<slug>.md`.

**Status**: criar template após primeiro SEV1/SEV2 real. Sem incidente,
template é cargo cult.

### KG-13. Auditoria de permissões trimestral

**BP §7.5**: revisar `.claude/agents/*/AGENT.md`, revogar tools não usados
em 90 dias.

**Status**: requer 90 dias de histórico operacional. Trabalho de
Wave 7 ou pós-Wave 6, não-bloqueante.

### KG-14. Capacity planning vs uso real

**BP §9.5, §13.7**: revisar baseline anual vs uso real.

**Status**: anual; depende de 1 ano de histórico operacional.
Não-bloqueante pro MVP.

---

## Resumo

| Categoria | Total | Status |
|-----------|-------|--------|
| Gaps **críticos** (Wave 6) | 8 | Absorvidos: T-125..T-143 |
| Gaps **importantes** (pós-MVP) | 10 | Documentados aqui (KG-1..KG-10) |
| Gaps **aceitáveis** (cadência operacional) | 4 | Documentados aqui (KG-11..KG-14) |
| **Total auditados** | **22** | |

Wave 6 + esta documentação = **conformidade declarada** com BEST_PRACTICES
após auditoria.

## Próxima auditoria

- **Tipo**: revisão de KG-1..KG-14 vs uso real
- **Quando**: 3 meses após Wave 6 mergeada (ou primeiro SEV1, o que vier antes)
- **Saída esperada**: KG-X movido pra backlog ativo se trigger ocorreu;
  KG-Y removido se obsoleto.

---

*Auditoria realizada por Claude Opus 4.7 em 2026-04-29 cruzando os 124*
*itens originais do EXECUTION_BACKLOG.md com 1244 linhas do BEST_PRACTICES.md.*
*Wave 6 (T-125..T-143, 19 tasks) adicionada como resultado.*
