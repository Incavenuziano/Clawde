# War Room Runbook

Use War Room quando uma sessão de operação precisa de memória persistente:
incidente, hardening, soak, correção autônoma ou fechamento de evidências.

## Abrir

```bash
clawde war-room open --kind hardening --title "TEST-HARDENING round 2"
```

Kinds aceitos:

- `incident`
- `hardening`
- `release`
- `ops`

## Ver Estado

```bash
clawde war-room status
clawde war-room status --output json
```

## Registrar Nota

```bash
clawde war-room note "Operador autorizou dry-run da wave 1"
```

## Coletar Evidência

```bash
clawde war-room collect --all
```

Coletores disponíveis:

- `--git`
- `--db`
- `--diagnose`
- `--systemd`
- `--github`
- `--logs`

Falha de um coletor não apaga evidências anteriores; o resultado fica marcado
como `error`.

## Planejar A Partir De Markdown

```bash
clawde war-room plan --from docs/TEST-HARDENING-PLAN.md
```

O parser extrai checklists, tabelas simples e comandos comuns. Sempre rode
`execute --dry-run` antes de execução real.

## Executar

```bash
clawde war-room execute --wave wave-1 --dry-run
clawde war-room execute --wave wave-1 --confirm
```

Regras:

- comandos `green` podem rodar;
- comandos `yellow` exigem `--confirm`;
- comandos `guarded` criam gate e param;
- comandos `blocked` não rodam automaticamente.

## Gates

```bash
clawde war-room gate list
clawde war-room gate approve GATE-20260505-0001 --reason "janela manual controlada"
```

Com gate aprovado e `--confirm`, o executor pode rodar o comando guarded
correspondente. Revise `war-room execute --dry-run` antes de aprovar.

## Verificar

```bash
clawde war-room verify --ci
clawde war-room verify --diagnose --smoke
```

## Reportar

```bash
clawde war-room report
clawde war-room report --output json
```

O relatório inclui estado, plano, gates, evidências, verificação e timeline.
Secrets conhecidos são redigidos.

## Fechar

```bash
clawde war-room close --outcome resolved --summary "hardening round fechado"
```

Se não houve verificação:

```bash
clawde war-room close --force --reason "fechamento manual documentado"
```

Use `--force` com cuidado; ele existe para sessões puramente documentais.
