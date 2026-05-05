# Incident Response Runbook

## 1. Abrir War Room

```bash
clawde war-room open --kind incident --title "SEV local: <resumo>"
```

## 2. Coletar Estado Antes De Agir

```bash
clawde war-room collect --all
clawde war-room note "Sintoma observado: <texto curto>"
```

## 3. Diagnosticar

```bash
clawde diagnose all
clawde quota status
clawde smoke-test
```

Registre a decisão:

```bash
clawde war-room note "Decisão: pausar receiver antes de mexer no DB"
```

## 4. Ações Guarded

Não rode ações destrutivas direto por automação. Gere gate:

```bash
clawde war-room execute --wave wave-1 --confirm
clawde war-room gate list
```

Aprovação manual:

```bash
clawde war-room gate approve <gate-id> --reason "operador presente e janela validada"
```

## 5. Verificar Recuperação

```bash
clawde war-room verify --diagnose --smoke
clawde war-room collect --all
```

## 6. Fechar

```bash
clawde war-room report > /tmp/clawde-incident-report.md
clawde war-room close --outcome resolved --summary "Sistema voltou ao normal"
```
