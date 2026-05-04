---
workstream: B
title: Deferred task wake-up after quota reset
owner: Codex
reviewer: Claude
branch: task/auto-quota-wakeup
closes: "#44"
lane: autonomous
---

# Workstream B — Deferred Task Wake-Up

**Owner:** Codex
**Reviewer:** Claude
**Lane:** Autonomous

## Issue

`#44`: Tasks deferidas por quota têm `not_before <= now()` após o reset da janela,
mas o `.path` watcher não dispara evento temporal — tasks ficam presas indefinidamente.

## Expected touchpoints

```
deploy/systemd/clawde-deferred-check.service  (novo)
deploy/systemd/clawde-deferred-check.timer    (novo)
tests/unit/sandbox/systemd.test.ts            (novo tests)
docs/BEST_PRACTICES.md                        (opcional — §12)
```

**Não deve tocar:** `src/worker/*`, `src/db/*`, quota logic.
O worker já processa tarefas deferidas elegíveis — só falta ser invocado no momento certo.

## Tasks

### Task 1 — `clawde-deferred-check.service`

```ini
[Unit]
Description=Clawde deferred task check — processa tasks com not_before expirado

[Service]
Type=oneshot
WorkingDirectory=%h/.clawde
EnvironmentFile=-%h/.clawde/config/clawde.env
ExecStart=%h/.clawde/dist/clawde-worker

# Hardening idêntico ao worker (BEST_PRACTICES §10.4)
PrivateTmp=yes
ProtectHome=read-only
ProtectSystem=strict
NoNewPrivileges=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources
CapabilityBoundingSet=
AmbientCapabilities=

ReadWritePaths=%h/.clawde

[Install]
WantedBy=default.target
```

### Task 2 — `clawde-deferred-check.timer`

```ini
[Unit]
Description=Clawde deferred task check (a cada 30 minutos)

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min
Unit=clawde-deferred-check.service
Persistent=true

[Install]
WantedBy=timers.target
```

`OnBootSec=5min`: garante recovery de tasks deferidas antes de um reboot.
`Persistent=true`: se o sistema estiver off no horário agendado, roda imediatamente ao ligar.

### Task 3 — Testes em `systemd.test.ts`

```typescript
test("clawde-deferred-check.timer tem OnUnitActiveSec=30min e OnBootSec=5min", () => {
  const content = readUnit("clawde-deferred-check.timer");
  expect(content).toContain("OnUnitActiveSec=30min");
  expect(content).toContain("OnBootSec=5min");
  expect(content).toContain("Persistent=true");
  expect(content).toContain("Unit=clawde-deferred-check.service");
});

test("clawde-deferred-check.service invoca worker com hardening", () => {
  const content = readUnit("clawde-deferred-check.service");
  expect(content).toContain("ExecStart=%h/.clawde/dist/clawde-worker");
  expect(content).toContain("NoNewPrivileges=yes");
  expect(content).toContain("Type=oneshot");
});
```

### Task 4 — `BEST_PRACTICES.md` §12 (se não existir ainda)

Adicionar nota sobre o timer:

```markdown
### Deferred task wake-up timer

`clawde-deferred-check.timer` (OnUnitActiveSec=30min, OnBootSec=5min) garante
que tasks deferidas por quota sejam retomadas automaticamente após o reset da
janela, sem intervenção do operador. Ativar: `systemctl --user enable --now
clawde-deferred-check.timer`.
```

## Sequência de execução

```bash
git checkout main && git pull --ff-only
git checkout -b task/auto-quota-wakeup

# criar deploy/systemd/clawde-deferred-check.service + .timer
# adicionar testes em systemd.test.ts
# opcional: adicionar nota em BEST_PRACTICES.md §12

bun run ci   # typecheck + lint + test (incluindo novos systemd tests)

GIT_AUTHOR_NAME="Incavenuziano" \
GIT_AUTHOR_EMAIL="222538801+Incavenuziano@users.noreply.github.com" \
GIT_COMMITTER_NAME="Incavenuziano" \
GIT_COMMITTER_EMAIL="222538801+Incavenuziano@users.noreply.github.com" \
git commit -m "fix(deploy): deferred-check timer for quota wake-up

Closes #44

Adds clawde-deferred-check.{service,timer} — runs worker every 30min
(+5min post-boot) so deferred tasks are processed after quota window
resets without operator intervention.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin task/auto-quota-wakeup
gh pr create --title "fix(deploy): deferred-check timer — quota wake-up (#44)" ...
```

## Critérios de aceite (Claude usa pra review)

- [ ] `clawde-deferred-check.timer` tem `OnUnitActiveSec=30min`, `OnBootSec=5min`, `Persistent=true`.
- [ ] `clawde-deferred-check.service` tem hardening idêntico ao worker.
- [ ] Service invoca o worker (não um comando custom).
- [ ] Testes: schedule do timer + hardening do service.
- [ ] Nenhuma alteração em `src/worker/*` ou quota logic.
- [ ] `bun run ci` clean.
- [ ] PR body fecha #44.
