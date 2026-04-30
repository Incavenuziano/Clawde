# ADR 0015 — Sandbox em Tools (não no processo inteiro)

## Status

Accepted — supersedes ADR 0005 e ADR 0013 para escopo operacional atual.

## Contexto

ADR 0005/0013 modelaram sandbox 2/3 como proteção do worker inteiro. Na prática,
com Agent SDK in-process, o ponto controlável e testável hoje é o hook
`PreToolUse` para chamadas de tool (`Bash`, `Edit`, `Write`).

Precisamos registrar limites honestos para evitar claims acima do que o runtime
atual consegue garantir.

## Decisão

1. Sandbox nível 2/3 passa a ser aplicado no **nível de tool call**:
   - `Bash`: executado via `bwrap` quando suportado; se não suportado, bloqueado.
   - `Edit`/`Write`: validados por policy de path (`allowed_writes`).
2. O worker continua com hardening systemd nível 1 como defesa-base de processo.
3. Gate adicional obrigatório por `allowedTools` no hook `PreToolUse`.

## Limites conhecidos

- Agent SDK pode não permitir interceptar/substituir todos os caminhos de tool.
- Se não houver interceptação segura para `Bash`, comportamento default é
  **block fail-safe** em nível 2/3.
- Defesa real é em camadas: `allowedTools` restritivo + policy de escrita +
  hardening systemd.

## Estratégia A (reserva futura)

Manter alternativa futura de wrapper subprocess para isolamento mais forte do
processo inteiro. Não é adotada agora por custo/complexidade e por já haver
ganho relevante no gate por tool.

## Consequências

- Claims de “sandbox nível 2/3” devem ser lidas como sandbox de tools, não de
  processo completo.
- Documentação e requisitos devem refletir explicitamente essa redução de
  escopo.

## Referências

- ADR 0005 — sandbox levels
- ADR 0013 — bwrap implementation
- `src/hooks/handlers.ts` (`PreToolUse`)
- `src/sandbox/{bwrap,matrix}.ts`
