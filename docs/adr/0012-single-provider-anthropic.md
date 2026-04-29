# ADR 0012 — Single-provider Anthropic + risco aceito

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

OpenClaw e Hermes suportam multi-provider (Claude, OpenAI, Google, Ollama, OpenRouter
200+ models). Clawde, por design, suporta **apenas Anthropic via Claude Code**.

Discussão pré-implementação levantou explicitamente: **multi-provider importa?** Resposta
ratificada do usuário: **não importa.** Mas o risco de **lock-in** + **dependências
unilaterais da Anthropic** precisa ser registrado como decisão consciente, não como gap
silencioso.

Riscos concretos identificados:

1. **Anthropic muda política Max sobre uso headless** — hoje `claude setup-token` gera OAuth
   1-ano que funciona em CI/headless. Se Anthropic decidir "Max é só interativo", Clawde
   precisa migrar pra API key (= custo por token = perde a vantagem econômica central).
2. **Anthropic muda schema do CLI/SDK** — versão nova quebra parser/integração. Mitigado por
   pin de versão + smoke test diário, mas é mais frágil que API HTTP estável.
3. **Anthropic descontinua/preço-sobe modelo** — Sonnet/Opus podem ficar inviáveis.
4. **Outage do Anthropic** — sem fallback, Clawde para 100%.

## Decisão

**Aceitar single-provider Anthropic como decisão de design.** Justificativas:

- Vantagem econômica central (Max fixo vs $/token) só existe **com** Anthropic.
- Stack mínimo (sem OpenRouter/litellm/abstract layer) = menos código, menos bugs.
- Reuso direto do Agent SDK oficial (ADR 0008) só funciona com Claude Code.
- Multi-provider abstraction é fonte conhecida de complexity tax (LangChain, etc).

**Mitigações arquiteturais que MANTEMOS** (lock-in não significa surrender):

1. **`src/sdk/` é módulo isolado** — trocar de "Agent SDK + Max" pra "API HTTP + key" muda
   1 módulo. Domínio (`src/domain/`), repos (`src/db/`), worker, receiver, hooks ficam
   intactos. Pivot é caro mas viável (estimativa: ~2-3 dias trabalho, não meses).
2. **Pin de versão do CLI** + smoke test diário detecta breaking changes.
3. **`quota_ledger` model é provider-agnóstico** — só conta mensagens; troca de provider
   ajusta unidade (tokens/req).
4. **Hooks programáticos via SDK não bloqueiam migração** — Anthropic SDK Python tem
   contratos similares; OpenAI Assistants API também.
5. **Fallback documentado** em `docs/runbooks/anthropic-outage.md`: pausa worker,
   tasks acumulam em `pending`, restaura quando provider voltar. Não é graceful, mas é
   determinístico.

**Mitigações que NÃO fazemos** (e por quê):

- ❌ Multi-provider abstraction layer agora — overhead pra evento que pode nunca ocorrer.
- ❌ Embedding provider-paralelo (OpenAI/Voyage) — ADR 0010 já decidiu local-only,
  imune a outage Anthropic.
- ❌ Modelo local fallback (Ollama com Llama/Qwen) — qualidade insuficiente pro pipeline
  do Clawde; complexity alta. Reavaliar se modelos open-source SOTA aproximarem Sonnet.

## Consequências

**Positivas**
- Decisão consciente registrada — não vira "ah, ninguém pensou nisso" daqui 6 meses.
- Stack continua mínimo, alinhado com ADRs 0001/0002/0003.
- Foco em fazer 1 provider muito bem, não 5 medianamente.
- Mitigações concretas (módulo SDK isolado, runbook) reduzem custo de pivot caso necessário.

**Negativas**
- Outage do Anthropic = downtime total do Clawde. Aceito como custo.
- Mudança unilateral da política Max headless = pivot obrigatório com migração de credentials,
  ajuste de quota model, possível mudança de stack econômico inteiro. Aceito como risco.
- Não é vendável pra terceiros (gateway pessoal).

**Neutras**
- Reabertura desta ADR é trigger conhecido: se Anthropic mudar política Max OU se modelo
  open-source SOTA atingir paridade, criar ADR superseding.

## Alternativas consideradas

- **Multi-provider via OpenRouter/litellm** — descartado (motivos acima).
- **Multi-provider only para fallback** — abstrair só pra fallback ainda exige toda a
  ginastica de schema-agnostic; descartado.
- **Pivotar pra API key desde já** — descarta a vantagem econômica central; descartado.
- **Fazer SDK pluggable na v1** — premature optimization; mantemos isolamento de módulo
  (que é a parte que importa) sem ginastica de plugin.

## Referências

- ADR 0001 (TypeScript + Bun + claude-agent-sdk).
- ADR 0008 (Agent SDK oficial).
- `ARCHITECTURE.md` §6.4 (gargalos novos).
- `BEST_PRACTICES.md` §12.2 (runbook anthropic-outage a criar).
