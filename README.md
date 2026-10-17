# Capital Web3 — DeFi Portfolio & Risk Advisor

Base pública de desenvolvimento para a **ferramenta interna de consultoria da
Capital Web3**, com um **portal privado de entrega de diagnósticos** aos clientes.
O cliente recebe a análise revisada e escolhe o que implementar.

**Estado: homologação sintética na nuvem, com dados inteiramente fictícios.**
O fluxo hospedado foi exercitado com Auth, RLS, Edge e portal; o piloto com
clientes e a prontidão de produção permanecem pendentes.
Não recebe fundos, assina transações ou opera posições. Nenhum cliente, documento
privado do anexo ou segredo foi publicado. A visibilidade pública deste código
não torna públicos os futuros diagnósticos.

## Destino de staging no plano Free

O titular escolheu o projeto existente `radar-disruptivo`. A adaptação usa os
schemas `capital_web3` e `capital_web3_private`, com Auth e cotas compartilhados.
Consulte [plano e limites do staging Free](docs/free-shared-staging.md).
A fundação de banco/Storage foi implantada e verificada. A jornada COFRE está
hospedada na Edge v5 e Site v6, com MFA da equipe exigido no banco;
veja as [evidências de acesso no domínio oficial](docs/evidence/auth-official-2026-10-17.md),
as [evidências COFRE](docs/evidence/cofre-individual-2026-10-17.md)
e a [homologação anterior](docs/evidence/cloud-staging-2026-10-17.md).
O domínio [capital.camaleaoweb3.com.br](https://capital.camaleaoweb3.com.br/)
está ativo com SSL no Sites e aponta para esse Site. É um endereço de
homologação, não um convite para inserir dados reais ou uma validação de piloto.

## Jornada COFRE Individual em homologação

A nova fatia acrescenta abertura de caso pela equipe provisionada, consentimentos de teste, questionário com opções, inventário categórico, sete controles com evidência, rascunho determinístico e relatório legível/imprimível. CI com banco e navegador aprovada; smoke autenticado na Edge hospedada aprovado. Continua exclusivamente sintética; veja o [estado atual](docs/current-state-2026-10-17.md).

No portal hospedado, entre com a conta fictícia de consultoria já fornecida e
abra **Atendimentos → pessoa fictícia → Criar atendimento fictício**. Complete
as oito etapas e salve o rascunho. A conta de revisão usa **Diagnósticos** para
conferir a versão, aprovar e selecionar o destinatário. O cliente vê somente
versões revisadas e publicadas. As senhas anteriores não foram redefinidas.
Na primeira entrada da equipe, o próprio titular configura seu aplicativo
autenticador; o agente não cadastrou fatores nas contas existentes. Recuperação
por e-mail permanece desabilitada até validar a entrega real de e-mail; a Redirect URL já foi salva.

O repositório e a página já são públicos. A CI completa de #15 e as 18
verificações de MFA na API hospedada passaram. A preparação operacional está
em [#16](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/16): ensaio
de restauração SQLite aprovado, sem substituir restauração isolada do COFRE
hospedado. Contas reais da equipe, retenção/descarte, anexos, restauração e
revisão jurídica/comercial continuam gates antes de clientes reais.

## Navegação revisada

A [revisão UX/UI](docs/ux-navigation-review-2026-10-17.md) registra as correções
de criação de atendimento, proteção das respostas, atalhos de etapas, identificação
de versões e navegação do relatório. Site v6 publicado; CI da PR #17 aprovada.

## Testar

Python 3.11 ou superior; Node.js 24 para transições da interface e contratos da API.
Sem pacotes externos para a demonstração ou estes testes.

```sh
git clone https://github.com/ofelipepeixoto/capital-web3-advisor.git
cd capital-web3-advisor
# Durante a revisão inicial, a implementação completa está nesta branch:
git checkout feat/portal-navigation-ux
make check
make demo
```

Abra **http://127.0.0.1:8765**. Escolha uma identidade fictícia na tela inicial.
As sessões da demonstração são resolvidas no servidor e expiram em uma hora.
O seletor de personas existe exclusivamente para testar os papéis localmente;
ele **não é autenticação para produção**. O servidor só aceita loopback.
Os dados, sessões e auditoria estão em memória e são reiniciados com o processo.
`Ctrl+C` encerra a demonstração.

### Roteiro de teste

1. Entre como **Ana / consultora**: abra o caso A e prepare um rascunho.
2. Entre como **Rui / revisor**: revise, aprove e publique a versão para cliente A.
3. Entre como **Cliente A**: visualize e baixe a análise; confirme recebimento
   ou peça esclarecimento.
4. Entre como **Cliente B**: a análise do caso A não aparece e sua URL é negada.
5. Revogue como Rui: o cliente A perde o acesso, incluindo novo download.

O recebimento confirma a entrega, sem aprovar estratégia, contrato ou transação.

## Estrutura

| Caminho | Responsabilidade |
|---|---|
| `capital_web3/risk.py` | NAV, dívida, concentração, stress, IL e CLAMM com Decimal |
| `capital_web3/service.py` | Casos, autorização por objeto e revisão/publicação por versão |
| `capital_web3/server.py`, `apps/web/` | API local e console/portal de demonstração |
| `apps/staging/`, `scripts/build_staging.mjs` | Portal com Auth/MFA Supabase, questionário COFRE e relatório legível; Site v6 publicado |
| `supabase/functions/advisory-api/cofre.ts` | Validação fechada e regras versionadas do COFRE sintético, sem score |
| `capital_web3/adapters.py`, `contracts/` | Relatório fictício e contratos; OpenAI real bloqueada |
| `capital_web3/mcp.py` | Exemplo MCP local por stdio, com ferramentas de leitura |
| `supabase/` | RLS, workflow humano persistente e API Edge autenticada |
| `capital_web3/budget.py`, `capital_web3/jobs.py` | Reservas/fila SQLite e webhooks assinados; adapters externos desligados |
| `n8n/workflows/` | Templates inativos sem credenciais |
| `tests/`, `.github/workflows/` | Testes de comportamento e CI |
| `docs/` | Arquitetura, escopo, etapas, integração e evidências |

## Serviços e evidência

| Serviço | Estado nesta entrega |
|---|---|
| GitHub | Repositório público criado; implementação preparada em PRs |
| Cálculos/API/portal local | Implementados; verificar `docs/testing.md` para resultados |
| OpenAI API | Adapter fictício; consumo pago desativado |
| MCP | Exemplo local de protocolo; não é servidor remoto homologado |
| Supabase | Fundação e migrações COFRE no Free compartilhado; Edge v5, Auth/MFA/RLS e smoke sintético registrados, sem piloto real |
| n8n | JSONs inativos; importação/execução na instância ainda não realizada |
| Sites | Site v6 publicado no domínio acima, acesso `public`; documentos exigem Auth/RLS, sem liberação de clientes reais |
| Hostinger | Roteiro de staging; nenhum serviço/VPS alterado |

## Plano e evolução

Esta estrutura deriva do plano fornecido **v1.2**, adaptado ao escopo público.
Leia [arquitetura](docs/architecture.md), [backlog](docs/backlog.md),
[staging](docs/staging.md), [testes](docs/testing.md) e
[homologação técnica e gates](docs/homologation.md).
O [portal autenticado para staging](docs/authenticated-staging.md) tem login
Supabase e bundle próprio; segue o roteiro Free compartilhado acima. A
[homologação sintética em nuvem](docs/evidence/cloud-staging-2026-10-17.md)
documenta o que foi exercitado e o que ainda falta antes de um piloto externo.
Começamos por uma fatia executável de revisão e entrega. Integrações financeiras
reais, autenticação de produção, conexão das automações e monitoramento dependem
dos gates descritos nos documentos.

### Implementação para revisão

| PR | Camada | Base |
|---|---|---|
| [#1](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/1) | Motor de risco | main |
| [#2](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/2) | Console e portal local | feat/risk-engine |
| [#3](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/3) | MCP e n8n | feat/private-advisory-demo |
| [#4](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/4) | Fundação Supabase | feat/integration-contracts |
| [#5](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/5) | RPCs humanos e API autenticada | feat/supabase-foundation |
| [#6](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/6) | Budget, jobs e replay | feat/authenticated-human-workflow |
| [#7](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/7) | CI real, correções do portal e evidências | feat/durable-budgets-jobs |
| [#10](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/10) | Portal autenticado de staging | feat/homologation-evidence |
| [#12](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/12) | Homologação cloud e domínio | feat/authenticated-staging-portal |
| [#13](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/13) | Colunas internas protegidas na Data API | feat/cloud-staging-homologation |
| [#14](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/14) | Jornada COFRE Individual sintética | fix/client-data-api-projection |
| [#15](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/15) | MFA, sessões e capacidades de convite/recuperação | feat/cofre-individual-journey |
| [#16](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/16) | Ensaio operacional e prévia de retenção | feat/cofre-individual-journey |
| [#17](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/17) | Navegação e relatório UX/UI | feat/cofre-auth-controls |

As novas camadas de homologação seguem os quatro PRs iniciais:
`feat/authenticated-human-workflow` → `feat/durable-budgets-jobs` →
`feat/homologation-evidence`. `feat/cloud-staging-homologation` contém o candidato cloud. `feat/cofre-individual-journey` acrescenta a jornada COFRE.
As branches têm dependências explícitas. Os PRs #1–#7 permanecem abertos.
O PR #9, de contexto de leitura, foi integrado à branch de homologação.
PR #11 foi integrada à base de #10 e PR #12 registra cloud. PR #13 protege colunas internas; a jornada COFRE segue na camada posterior. O `main` ainda não contém a stack completa. Novas camadas seguem para revisão humana. Consulte `docs/homologation.md`.

## Direitos

A licença de distribuição comercial ainda será definida pelo titular.
Nenhuma licença permissiva é concedida por este repositório. Acesso público
ao código não substitui uma licença. Não há cópia integral do material privado
de referência nem de suas fontes de terceiros.
