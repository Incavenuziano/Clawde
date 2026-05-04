# Clawde — Deploy Linux

## Pre-requisites

- Ubuntu 22.04+ ou outra distro Linux com systemd user
- Bun instalado e funcional no shell do usuário
- repo do Clawde disponível localmente
- Claude Code SDK instalado nas dependências do projeto

## SDK binary setup

Quando o worker roda via systemd ou a partir de bundle fora do diretório do
projeto, o SDK pode não conseguir resolver o binário certo sozinho.

Execute:

```bash
bash scripts/setup-linux.sh
```

O script:

1. detecta `glibc` vs `musl`
2. procura um binário Linux x64 compatível do Claude
3. instala `~/.clawde/bin/claude` como symlink
4. adiciona `worker.claude_executable_path` em `~/.clawde/config/clawde.toml`
   quando o campo ainda não existe

## Systemd deploy

Depois do setup do binário:

```bash
bun run build
systemctl --user daemon-reload
systemctl --user enable --now clawde-receiver.service
systemctl --user enable --now clawde-worker.path
```

Se você usa timers complementares, habilite também os timers relevantes.

## Smoke test

Depois do deploy:

```bash
clawde diagnose all --output text
```

Para checar só o worker:

```bash
systemctl --user start clawde-worker.service
systemctl --user status clawde-worker.service
```

## Known issues

### `#41` musl vs glibc

Em Ubuntu/Debian, o worker pode falhar se o SDK resolver um binário `musl`
incompatível. O `setup-linux.sh` tenta preferir um binário Linux x64 compatível
com o ambiente atual.

### `#43` bundle fora do diretório do projeto

Quando `worker-main.js` roda em `~/.clawde/dist/`, a resolução relativa ao
`node_modules` do projeto pode não funcionar. Nesse caso,
`worker.claude_executable_path` é o caminho suportado.

### `#47` `claude not found` em WSL2

Se o `claude` só existir via npm do Windows, o systemd user do WSL2 normalmente
não enxerga `/mnt/c/...` no PATH. O setup Linux precisa apontar para um binário
realmente acessível do lado Linux.
