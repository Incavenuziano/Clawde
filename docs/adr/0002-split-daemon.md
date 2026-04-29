# ADR 0002 — Split daemon: receiver always-on + worker oneshot

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

A v3 do `ARCHITECTURE.md` propunha "poller oneshot via systemd timer" para evitar o
gargalo de RAM idle dos gateways always-on (OpenClaw ~200-400MB, Hermes ~300-500MB).
Mas também mencionava "input adapters: Telegram bot, webhook" — uma contradição, já
que webhooks precisam de listener always-on.

Soluções rejeitadas:
- "Telegram via long-poll cronado" — latência mínima de 5min entre updates do bot,
  inaceitável para UX de chat.
- "Webhooks via cron" — não funciona; webhooks são push, não pull.
- "Tudo always-on como Hermes/OpenClaw" — perde o ganho de RAM idle, principal motivação
  do projeto.

## Decisão

Arquitetura em **duas peças** com responsabilidades estritas:

1. **`clawde-receiver`** — daemon HTTP minimal always-on (~30-50MB RAM):
   - `Bun.serve()` em `127.0.0.1:18790` + unix socket `/run/clawde/receiver.sock`.
   - **Única responsabilidade:** receber input externo (Telegram, webhook, CLI local)
     e enfileirar em `tasks` no SQLite.
   - **Não** invoca `claude`, **não** executa código de tarefas.

2. **`clawde-worker`** — processo oneshot event-driven:
   - Disparado por systemd `.path` unit que watcha mtime de `state.db`.
   - Latência receiver → worker start: ≤1s (vs 5min do polling).
   - Processa fila, escreve resultado, termina. RAM zero quando idle.

## Consequências

**Positivas**
- Resolve a contradição "oneshot vs adapters" sem sacrificar nenhuma das premissas.
- Receiver é trivial e auditável (~200 linhas) — superfície de ataque pequena.
- Worker pode ser hardenado agressivamente (sandbox nível 2/3) sem afetar receiver.
- RAM idle: ~30-50MB do receiver (vs 200-500MB de Hermes/OpenClaw).
- Worker oneshot facilita upgrade do binário (próxima invocação pega a versão nova).

**Negativas**
- Duas unidades systemd em vez de uma (~50% mais ops surface).
- `state.db` vira ponto de coordenação obrigatório entre processos — locks bem testados
  (WAL + busy_timeout) são pré-requisito (ver ADR 0007).
- `.path` unit do systemd watcha mtime, não conteúdo — risco teórico de "spurious wakeup"
  em writes irrelevantes. Mitigação: receiver só toca `state.db` em INSERT real.

**Neutras**
- Cold start do worker (~2-3s) por task. Aceitável pra perfil low-volume.

## Alternativas consideradas

- **Single daemon always-on (modelo Hermes/OpenClaw)** — perde ganho de RAM idle.
- **Tudo oneshot via cron de 5min** — não suporta webhooks, latência ruim de UX.
- **Worker como goroutine/thread dentro do receiver** — junta superfícies (sandbox virou
  problema), requeer ainda always-on com mais memória.

## Referências

- `ARCHITECTURE.md` §1.3 (diagrama), §4.6 (resolução da contradição).
- `BLUEPRINT.md` §3 (HTTP do receiver).
- Padrão paralelo ao `claude-mem` (HTTP server em :37777 only).
