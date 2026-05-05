# Hardening Session Runbook

Use para rodadas como `docs/TEST-HARDENING-PLAN.md`.

## Abrir

```bash
clawde war-room open --kind hardening --title "Hardening <data>"
clawde war-room collect --git --db --diagnose
```

## Planejar

```bash
clawde war-room plan --from docs/TEST-HARDENING-PLAN.md
clawde war-room execute --wave wave-1 --dry-run
```

## Executar Checks

```bash
clawde war-room verify --ci
```

Para smoke/diagnose:

```bash
clawde war-room verify --diagnose --smoke
```

## Registrar Achados

```bash
clawde war-room note "6.7 real permanece manual: não derrubar daemon ativo em automação"
```

## Fechar

```bash
clawde war-room report
clawde war-room close --outcome resolved --summary "Rodada registrada e sem blockers novos"
```
