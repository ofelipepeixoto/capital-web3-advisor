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
A fundação de banco/Storage foi implantada e verificada. Edge v2 e Site v2 foram
exercitados em [homologação sintética na nuvem](docs/evidence/cloud-staging-2026-10-17.md).
O domínio [capital.camaleaoweb3.com.br](https://capital.camaleaoweb3.com.br/)
está ativo com SSL no Sites e aponta para esse Site. É um endereço de
homologação, não um convite para inserir dados reais ou uma validação de piloto.

## Testar

Python 3.11 ou superior; Node.js 24 para transições da interface e contratos da API.
Sem pacotes externos para a demonstração ou estes testes.

```sh
git clone https://github.com/ofelipepeixoto/capital-web3-advisor.git
cd capital-web3-advisor
# Durante a revisão inicial, a implementação completa está nesta branch:
git checkout feat/homologation-evidence
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
| `apps/staging/`, `scripts/build_staging.mjs` | Portal com Auth Supabase e bundle estático; Site v2 de homologação publicado |
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
| Supabase | Fundação Free compartilhada e Edge v2 hospedadas; fluxo sintético com Auth/RLS registrado, sem piloto real |
| n8n | JSONs inativos; importação/execução na instância ainda não realizada |
| Sites | Site v2 publicado no domínio de homologação acima; política de acesso do Sites atualmente `public`, sem validação de uso por clientes |
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

As novas camadas de homologação seguem os quatro PRs iniciais:
`feat/authenticated-human-workflow` → `feat/durable-budgets-jobs` →
`feat/homologation-evidence`. A última contém o candidato completo para testes.
As branches têm dependências explícitas. Os PRs #1–#7 permanecem abertos.
O PR #9, de contexto de leitura, foi integrado à branch de homologação.
Novas camadas seguem para revisão humana. Consulte `docs/homologation.md`.

## Direitos

A licença de distribuição comercial ainda será definida pelo titular.
Nenhuma licença permissiva é concedida por este repositório. Acesso público
ao código não substitui uma licença. Não há cópia integral do material privado
de referência nem de suas fontes de terceiros.
