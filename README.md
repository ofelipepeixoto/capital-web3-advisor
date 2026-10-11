# Capital Web3 — DeFi Portfolio & Risk Advisor

Base pública de desenvolvimento para a **ferramenta interna de consultoria da
Capital Web3**, com um **portal privado de entrega de diagnósticos** aos clientes.
O cliente recebe a análise revisada e escolhe o que implementar.

**Estado: ambiente local de testes, com dados inteiramente fictícios.**
Não recebe fundos, assina transações ou opera posições. Nenhum cliente, documento
privado do anexo ou segredo foi publicado. A visibilidade pública deste código
não torna públicos os futuros diagnósticos.

## Testar

Python 3.11 ou superior. Sem pacotes externos para a demonstração.

```sh
git clone https://github.com/ofelipepeixoto/capital-web3-advisor.git
cd capital-web3-advisor
# Durante a revisão inicial, a implementação completa está nesta branch:
git checkout feat/integration-contracts
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
| `capital_web3/adapters.py`, `contracts/` | Relatório fictício e contratos; OpenAI real bloqueada |
| `capital_web3/mcp.py` | Exemplo MCP local por stdio, com ferramentas de leitura |
| `supabase/` | Migração RLS e testes SQL propostos para staging |
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
| Supabase | SQL e testes preparados; nenhum projeto/banco remoto alterado |
| n8n | JSONs inativos; importação/execução na instância ainda não realizada |
| Sites | Interface reaproveitável e roteiro; nenhum Site publicado |
| Hostinger | Roteiro de staging; nenhum serviço/VPS alterado |

## Plano e evolução

Esta estrutura deriva do plano fornecido **v1.2**, adaptado ao escopo público.
Leia [arquitetura](docs/architecture.md), [backlog](docs/backlog.md),
[staging](docs/staging.md) e [testes](docs/testing.md).
Começamos por uma fatia executável de revisão e entrega. Integrações financeiras
reais, autenticação de produção, automações persistentes e monitoramento dependem
dos gates descritos nos documentos.

## Direitos

A licença de distribuição comercial ainda será definida pelo titular.
Nenhuma licença permissiva é concedida por este repositório. Acesso público
ao código não substitui uma licença. Não há cópia integral do material privado
de referência nem de suas fontes de terceiros.
