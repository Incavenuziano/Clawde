# ADR 0005 — Sandbox em 3 níveis (systemd / +bwrap / +netns)

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

Worker do Clawde executa código gerado por LLM, potencialmente influenciado por input
externo não-confiável (Telegram, webhooks, PR descriptions). Risco real:

- Prompt injection que faz Claude executar `Bash` malicioso.
- Tool `Edit`/`Write` em paths fora do worktree (sobrescrevendo `~/.ssh/`).
- Exfiltração via `WebFetch` ou DNS leak.
- Container escape (se containerizado de modo ingênuo).

A v3 do `ARCHITECTURE.md` dizia apenas "containerizar todas automações headless" — vago.
Variantes de risco entre agentes (cleanup interno vs Telegram-driven) requerem **matriz**,
não solução única.

## Decisão

Sandbox em **3 níveis**, escolhido por agente em `.clawde/agents/<name>/sandbox.toml`:

**Nível 1 — systemd hardening (custo zero, padrão para todos)**
```ini
PrivateTmp=yes
ProtectHome=read-only
ProtectSystem=strict
NoNewPrivileges=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
SystemCallFilter=@system-service
ReadWritePaths=/tmp/clawde-%i /home/%u/.clawde/state
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
```

**Nível 2 — Nível 1 + bwrap chroot** (agentes com `Bash`/`Edit` livres)
- Bind mount **somente** do worktree em `/workspace`.
- `/usr`, `/etc/ssl` read-only; resto isolado.
- Capabilities dropadas; `--die-with-parent`.

**Nível 3 — Nível 2 + namespace de rede isolado** (agentes recebendo input externo
não-confiável + tools com I/O de rede)
- `--unshare-net --share-net` desligado, loopback only OU allowlist via nftables.
- DNS via resolver local que só responde domínios da allowlist.

Matriz padrão por agente em §5.3 do `BLUEPRINT.md`. Verificação contínua via testes E2E
de fuga (BEST_PRACTICES §3.5) e `systemd-analyze security` (score ≤2.0).

## Consequências

**Positivas**
- Sandbox **sempre** ativo — nunca executa worker sem hardening.
- Custo zero pro Nível 1 (systemd faz tudo). Custo trivial pro Nível 2 (bwrap nativo Linux).
- Defesa em profundidade: ataque precisa quebrar systemd + bwrap + netns.
- Auditável: `events.kind='sandbox_violation'` registra qualquer bloqueio.
- Decisão por agente — `nightly-cleanup` (Nível 1) e `telegram-handler` (Nível 3) coexistem
  sem comprometer o segundo.

**Negativas**
- **Linux only.** macOS perde Nível 2/3 (bwrap não existe nativo); fallback é
  `sandbox-exec` deprecated. Mitigação: produção alvo é Linux; macOS para dev local.
- bwrap precisa estar instalado e setuid root (config padrão na maioria das distros).
- Nível 3 (netns) requer `CAP_NET_ADMIN` no setup do worker — mitigado por systemd
  capability bounding.
- Performance: bwrap adiciona ~50-100ms por invocação. Aceitável vs cold start de 2-3s.

**Neutras**
- Runbook de "violação detectada" obrigatório (`docs/runbooks/sandbox-breach.md`).

## Alternativas consideradas

- **Docker/Podman containers** — overhead maior (~200MB de daemon), pull de image
  por task = custo. Para low-volume oneshot, bwrap é mais eficiente.
- **Apenas systemd hardening** — insuficiente pra Bash/Edit livres com input externo.
- **VM (firecracker/qemu)** — overkill pra perfil de uso pessoal.
- **Sem sandbox, "confiar no Claude"** — RCE remoto disfarçado de feature; descartado de saída.

## Referências

- `ARCHITECTURE.md` §10.4 (matriz de sandbox).
- `BEST_PRACTICES.md` §2.3 (regra), §3.5 (testes E2E).
- `BLUEPRINT.md` §5.2 (`sandbox.toml`).
- bubblewrap — https://github.com/containers/bubblewrap
