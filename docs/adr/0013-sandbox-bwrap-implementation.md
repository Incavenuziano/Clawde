# ADR 0013 — Sandbox Nível 2/3: implementação via bubblewrap

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

ADR 0005 estabeleceu a matriz de sandbox em 3 níveis (systemd / +bwrap / +netns)
mas não detalhou implementação. Fase 4 do BACKLOG entregou os módulos.

Decisões pendentes na implementação:

1. **Como invocar bwrap?** subprocess (`spawn`) com argv montado.
2. **Como tratar paths inexistentes em distros variadas?** `existsSync` filter
   nos common mounts (alguns distros não têm `/lib64`).
3. **Network allowlist real (nftables) ou stub?**
4. **DNS dentro do netns isolado?**
5. **Como configurar por agente?**

## Decisão

### Estrutura de módulos

- `src/sandbox/bwrap.ts`: wrapper de baixo nível. `runBwrapped(config, command,
  args, options)` retorna `{exitCode, stdout, stderr, signal}`. `buildBwrapArgs`
  exposto pra teste/inspeção.
- `src/sandbox/netns.ts`: aplica isolation de rede sobre BwrapConfig.
  `generateLoopbackResolvConf(stateDir)` cria arquivo vazio (sem nameservers)
  pra bind-mount em `/etc/resolv.conf` dentro do sandbox.
- `src/sandbox/agent-config.ts`: zod schema + loader de
  `.clawde/agents/<name>/sandbox.toml`. Defaults level=1 quando arquivo ausente.
- `src/sandbox/matrix.ts`: `materializeSandbox({agent, workspacePath, stateDir})`
  → `{level, runDirect, bwrap}`. Nível 1 pula bwrap (`runDirect=true`).

### Mount strategy

- **Common RO mounts** (filtrados por existência): `/usr`, `/bin`, `/lib`,
  `/lib64`, `/etc/ssl`, `/etc/ca-certificates`, `/etc/resolv.conf`. Distros
  sem `/lib64` (ex: musl) ainda funcionam.
- **Workspace ephemeral** é o ÚNICO RW path: `host=workspacePath` →
  `sandbox=/workspace`. Worker passa `--chdir /workspace`.
- **`--clearenv` + setenv específicos**: `HOME=/workspace`, `PATH=/usr/bin:/bin`,
  `LANG=C.UTF-8`. Sem vazamento de env do host.

### Network modes

- `host`: `--share-net`. Para agentes trusted que precisam de internet.
- `allowlist`: `--share-net` + nftables setup externo (T57 stub; allowlist
  real fica como infraestrutura systemd).
- `loopback-only`: NÃO `--share-net` (mantém net unshared do `--unshare-all`).
  Apenas loopback no netns novo. DNS falha (sem nameservers).
- `none`: idem `loopback-only`. Aceito como alias.

### Defaults por agente (`defaultLevelForAgent`)

| Agente | Nível |
|--------|-------|
| telegram-bot, github-pr-handler | 3 (input externo não-confiável) |
| implementer, debugger | 2 (Bash/Edit livres) |
| default, reflector, demais | 1 (systemd hardening only) |

Override via `.clawde/agents/<name>/sandbox.toml`.

### Allowlist real adiada

Allowlist nftables real (DROP egress != domain.com) requer:
- systemd unit prepara netns externo com bridge + nftables rules
- bwrap join nesse netns

Esse trabalho fica pra Fase 8 (multi-host) ou ad-hoc quando demanda surgir.
Por hora "allowlist" no config é tratado como `host` (rede compartilhada),
documentado claramente.

## Consequências

### Positivas

- **Real isolation**: tests E2E confirmam que bwrap bloqueia acesso a paths
  fora do workspace, escritas em `/etc` ficam no tmpfs interno (não vazam pro
  host), HOME do operador não é acessível.
- **Per-agent config**: cada agente tem sandbox.toml próprio, defaults sane.
- **Linux nativo**: bwrap é apt-installable, não precisa Docker daemon.
- **Custo trivial**: ~50-100ms overhead por invocação vs cold start de 2-3s.

### Negativas

- **Linux only**: macOS perde Nível 2/3. Mitigação: produção é Linux por
  decisão (REQUIREMENTS.md).
- **bwrap setuid required**: na maioria das distros, bwrap precisa CAP_SYS_ADMIN
  ou setuid root (default em pacotes). Sem isso, falha. Documentado no
  `BEST_PRACTICES.md` §2.3.
- **Allowlist nftables não implementado**: agentes com network='allowlist'
  ainda têm acesso ao host. Não é bypass se documentado, mas é trade-off real.

## Alternativas consideradas

- **Docker/Podman**: overhead muito maior (daemon, image pull). Bwrap é stateless.
- **firejail**: outro sandbox, menos comum. Bwrap é mais auditado (Flatpak usa).
- **gVisor / firecracker / qemu**: overkill pra perfil pessoal.
- **Implementar allowlist real agora**: prematura optimization sem demanda real.

## Referências

- ADR 0005 (matriz de sandbox).
- `src/sandbox/{bwrap,netns,agent-config,matrix}.ts`.
- `tests/integration/sandbox-bwrap.test.ts` (24 tests).
- bubblewrap: https://github.com/containers/bubblewrap
