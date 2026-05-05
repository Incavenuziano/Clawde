# War Room Safety Checklist

Antes de deixar Codex executar uma wave:

- [ ] `clawde war-room collect --all` foi executado.
- [ ] `clawde war-room execute --wave <id> --dry-run` foi revisado.
- [ ] Nenhum comando guarded apareceu como execução direta.
- [ ] Nenhum comando blocked apareceu no plano.
- [ ] O escopo da wave é pequeno o suficiente para revisar.
- [ ] Se tocar sandbox, auth, retention, panic ou systemd real, há gate manual.
- [ ] Relatórios não contêm token OAuth, PAT GitHub ou token Telegram.
- [ ] `STATUS.md` continua sendo fonte de verdade para estado de trabalho.

## Lanes

| Lane | Comportamento |
|---|---|
| `green` | Pode executar automaticamente. |
| `yellow` | Exige `--confirm`. |
| `guarded` | Cria gate e para. |
| `blocked` | Nunca executa automaticamente. |

## Exemplos Guarded

- `clawde panic-stop`
- `clawde events purge --confirm`
- `systemctl --user restart clawde-receiver`
- `clawde migrate down`
- `git push origin main`

## Exemplos Blocked

- `git reset --hard`
- `rm -rf /`
- apagar `~/.clawde/backups`
- alterar secrets em massa sem runbook próprio
