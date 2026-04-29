# ADR 0006 — OAuth refresh proativo (detect 401 + weekly check)

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

O Clawde autentica contra a Anthropic via `CLAUDE_CODE_OAUTH_TOKEN` gerado por
`claude setup-token` (validade 1 ano). A v3 do `ARCHITECTURE.md` dizia apenas "renovar
anualmente" — solução frágil:

- Operador esquece a data → token expira → todas as tasks falham com 401 silenciosamente.
- Falha não-determinística (depende do calendário humano, não do sistema).
- Nenhuma detecção precoce — descobre-se quando o daemon já parou.
- Renovação manual exige presença do operador no terminal (limita automação).

## Decisão

**Política dual** de gerenciamento do token:

1. **Reativo — detect 401 + retry com refresh:**
   ```typescript
   async function invokeClaudeWithRefresh(prompt: string) {
     try {
       return await runClaude(prompt);
     } catch (e) {
       if (e.code === 'AUTH_401') {
         await runHeadless('claude setup-token --headless');
         await reloadEnvFromKeychain();
         return await runClaude(prompt);  // 1 retry
       }
       throw e;
     }
   }
   ```

2. **Proativo — weekly check + alerta 30 dias antes:**
   - Job systemd timer (`clawde-oauth-check.timer`) roda semanalmente.
   - Parse JWT do token (campo `exp`).
   - Se `exp - now < 30 dias` → enfileira task `URGENT` "renew oauth token" + alerta operador.
   - Renovação automática via `claude setup-token --headless` se `oauth_auto_refresh=true`
     em `clawde.toml`.

**Fail-safe:** se token expirar e refresh falhar (rede, Anthropic offline, OAuth flow
quebrado), receiver retorna 503 com `reason: "oauth_expired"` e enfileira tasks como
`pending`. Worker recusa novas invocações até operador resolver.

## Consequências

**Positivas**
- **Sem janela cega**: token expira → daemon detecta no próximo invoke E semanalmente.
- Renovação tipicamente automática (operator não vê), exceto em casos de falha.
- Tasks enfileiradas durante "auth down" não são perdidas (continuam pendentes).
- Auditável: `events.kind` cobre `oauth_refresh_attempt`, `oauth_refresh_success`,
  `oauth_expiry_warning`.

**Negativas**
- Refresh automatizado depende de `claude setup-token --headless` funcionar sem TTY.
  Se Anthropic mudar o flow OAuth (ex: forçar device code com confirmação), automação
  quebra. Mitigação: smoke test diário detecta na próxima execução.
- Token renovado tem novo `exp` — código deve relê-lo da credential store (não cache em memória).
- Edge case: refresh acontece concorrente com tasks ativas. Mitigação: lock no
  `~/.clawde/state/oauth.lock` durante refresh, workers esperam.

**Neutras**
- Operator ainda recebe alerta de cortesia 30 dias antes mesmo com auto-refresh ligado —
  visibilidade humana sobre saúde do sistema.

## Alternativas consideradas

- **Renovação manual anual** — descartada pelos motivos acima.
- **Detect 401 sem proativo** — funciona, mas reage tarde demais (tasks já falharam
  durante a janela).
- **Renovação 90 dias antes (não 30)** — descartada; renovações desnecessárias gastam
  rate limits do endpoint OAuth e geram tokens com `exp` overlap confuso.
- **API key (`ANTHROPIC_API_KEY`) sem expiry** — descartado, perde benefício do Max
  subscription.

## Referências

- `ARCHITECTURE.md` §10.5 (procedimento detalhado).
- `BEST_PRACTICES.md` §6.7 (alerta `oauth_expires_30d`), §13.6/13.7 (checklists).
- `BLUEPRINT.md` §1 (`src/auth/`), §2.3 (`EventKind`), §7.1 (`[auth]` config).
- `docs/runbooks/oauth-expired.md` (a criar).
