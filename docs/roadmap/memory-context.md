# Roadmap: Memory, Context, Skills e Templates

**Status:** proposta separada, nao implementada.
**Data:** 2026-05-02.
**Relacionado:** [`propostas-para-o-clawde.md`](./propostas-para-o-clawde.md) e [`propostas-para-o-clawde-implementation-plan.md`](./propostas-para-o-clawde-implementation-plan.md).

Este roadmap separa as ideias de memoria, contexto, skills, templates e documentos do MVP da camada interativa. Elas continuam importantes, mas formam outro eixo de produto: qualidade de contexto e capacidade documental, nao controle interativo imediato.

---

## Principios

1. **Memoria deve ser citavel e limitada.** O Clawde deve saber de onde veio cada fato e quanto contexto esta injetando.
2. **Progressive disclosure antes de dump completo.** Primeiro resumo curto, depois timeline, depois detalhe.
3. **Privacidade e default-deny para conteudo sensivel.** Tags privadas e redaction devem impedir persistencia e reinjecao.
4. **Skills externas sao curadas, nao instaladas em massa.** Repos como ECC/GSD sao bibliotecas de padroes, nao dependencias globais por default.
5. **Nada de copiar codigo AGPL sem decisao explicita.** `claude-mem` e inspiracao arquitetural, nao fonte de codigo para port direto.

---

## Inspiracoes avaliadas

| Repo | Uso recomendado |
|------|-----------------|
| `thedotmack/claude-mem` | Progressive disclosure, citations, private tags, transcript ingestion. Ideias apenas por causa da AGPL-3.0. |
| `gsd-build/get-shit-done` | STATE.md, handoff, discuss/plan/execute, context rot control. Usar conceitos, nao instalar full sem curadoria. |
| `affaan-m/everything-claude-code` | Catalogo de skills, continuous learning, AgentShield/security scan. Curar skills individuais. |
| `forrestchang/andrej-karpathy-skills` | Guidelines simples: pensar antes, simplicidade, mudancas cirurgicas, sucesso verificavel. Bom candidato para onboarding. |
| `x1xhlol/system-prompts-and-models-of-ai-tools` | Pesquisa/red-team. Nao copiar prompts proprietarios para configs do Clawde. |

---

## Fase M1: Templates e documentos

**Objetivo:** atender o uso pratico de gerar, editar e preencher documentos sem abrir superficie ampla.

**Entregas:**

- Registro de templates.
- Comandos:
  - `clawde templates list`;
  - `clawde templates render`;
  - `clawde templates show <name>`.
- Quick agents curados:
  - document editor;
  - report writer;
  - local researcher.
- Policy por template/agente.

**Exemplos de uso:**

- preencher ata a partir de template;
- gerar relatorio com base em arquivos locais;
- atualizar documento pequeno;
- criar draft para operador revisar.

**Impacto:** alto.

**Risco:** medio.

**Riscos especificos:**

- template conter segredo e vazar em output;
- edicao de docs conflitar com task paralela;
- agente de documento ganhar permissao demais.

**Mitigacao:**

- templates curados;
- redaction antes de output;
- worktree/lock para edicoes;
- agentes read-mostly por default;
- approval para escrita ampla.

**Criterios de aceite:**

- gerar documento a partir de template;
- editar doc pequeno via task auditavel;
- template usado fica registrado em evento;
- operacoes sensiveis continuam passando por approval/pre-flight.

---

## Fase M2: Pesquisa local e web opt-in

**Objetivo:** permitir pesquisa rapida em arquivos e internet sem quebrar garantias de quick task.

**Entregas:**

- Pesquisa local como capability default para agentes permitidos.
- Pesquisa web apenas opt-in:
  - flag `--with-web`;
  - agente explicitamente habilitado;
  - budget de tempo/quota;
  - citacoes obrigatorias.
- Eventos com fontes usadas.

**Impacto:** alto.

**Risco:** medio/alto.

**Riscos especificos:**

- web research abrir superficie externa;
- latencia variavel quebrar promessa de quick task;
- resultados sem fonte virarem memoria ruim;
- quota burn.

**Mitigacao:**

- web disabled por default;
- timeout e budget;
- citations obrigatorias;
- allowlist de agentes;
- fallback para async quando exceder limite.

**Criterios de aceite:**

- pesquisa local funciona sem rede;
- web research so roda com opt-in explicito;
- resposta web lista fontes;
- timeout degrada para async ou falha documentada.

---

## Fase M3: Memory retrieval budget

**Objetivo:** melhorar continuidade sem inflar contexto.

**Entregas:**

- Budget de tokens para memoria injetada.
- Camadas de recuperacao:
  - resumo curto;
  - timeline;
  - detalhe por ID.
- Eventos/memory observations com IDs citaveis.
- Config de quantos itens por agente/profile.

**Impacto:** medio/alto.

**Risco:** medio.

**Riscos especificos:**

- memoria irrelevante contaminar contexto;
- contexto crescer sem controle;
- agentes confiarem em memoria antiga.

**Mitigacao:**

- retrieval por score + recency;
- budget hard cap;
- citations;
- stale markers;
- testes de prompt assembly.

**Criterios de aceite:**

- memoria injetada tem limite mensuravel;
- output referencia IDs/citacoes quando usa memoria;
- detalhes so entram quando solicitados;
- config permite desligar por agente.

---

## Fase M4: Private tags e transcript importer

**Objetivo:** importar conhecimento de Claude Code sem vazar conteudo privado.

**Entregas:**

- Tags privadas, por exemplo `<private>...</private>`.
- Redaction antes de storage.
- Importador experimental de transcripts do Claude Code.
- Modo dry-run do importer.
- Relatorio de itens ignorados/redigidos.

**Impacto:** medio/alto.

**Risco:** alto.

**Riscos especificos:**

- importar secrets;
- importar lixo conversacional;
- duplicar memoria;
- contaminar contexto com conteudo privado;
- copiar comportamento/codigo de `claude-mem` AGPL.

**Mitigacao:**

- opt-in;
- dry-run obrigatorio no primeiro uso;
- redaction forte;
- dedup;
- nada de copiar codigo AGPL;
- testes com fixtures contendo secrets.

**Criterios de aceite:**

- private content nao entra em storage;
- importer mostra preview antes de persistir;
- secrets fake sao redigidos;
- item importado recebe source/citation.

---

## Fase M5: Reflection a partir de sinais operacionais

**Objetivo:** transformar eventos de operacao em aprendizagem.

**Sinais candidatos:**

- approvals negados;
- pre-flight objections;
- CRITICAL overrides;
- cancels;
- task failures recorrentes;
- restore/smoke/alert incidents.

**Entregas:**

- Reflection classifica padroes recorrentes.
- Sugestoes viram memory observations, nao mudancas automaticas de policy.
- Operador pode promover observacao para regra/agente/doc.

**Impacto:** medio.

**Risco:** medio.

**Riscos especificos:**

- sistema aprender regra ruim de incidente isolado;
- reflection virar auto-mutacao de policy;
- excesso de observacoes irrelevantes.

**Mitigacao:**

- humano aprova promocao para regra;
- thresholds de recorrencia;
- citations obrigatorias;
- cleanup/retention de observacoes fracas.

**Criterios de aceite:**

- reflection cria observacoes citaveis;
- nenhuma policy muda automaticamente;
- operador consegue ver origem e promover/ignorar.

---

## Priorizacao

| Ordem | Fase | Impacto | Risco | Motivo |
|-------|------|---------|-------|--------|
| 1 | Templates e documentos | Alto | Medio | Atende uso pratico imediato de documentos. |
| 2 | Pesquisa local/web opt-in | Alto | Medio/alto | Util para quick tasks, mas rede deve ser opt-in. |
| 3 | Memory retrieval budget | Medio/alto | Medio | Melhora continuidade sem inflar contexto. |
| 4 | Private tags/importer | Medio/alto | Alto | Valioso, mas sensivel a privacidade. |
| 5 | Reflection operacional | Medio | Medio | Fecha loop de aprendizagem apos sinais reais. |

---

## Recomendacao

Nao implementar este roadmap antes do MVP interativo basico estar validado. A melhor janela para comecar e depois de:

1. `clawde ask` estar em uso real;
2. conversations existirem;
3. approval/pre-flight estarem definidos;
4. o operador confirmar quais documentos/templates quer automatizar primeiro.
