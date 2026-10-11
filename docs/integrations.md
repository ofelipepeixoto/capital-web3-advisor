# Preparação de integrações

Esta entrega prepara contratos locais. Não instalou servidor MCP remoto, não
importou workflows em uma instância n8n e não chamou a OpenAI API, fontes pagas,
RPCs, wallets, DEXs ou corretoras. Todos os dados dos exemplos são fictícios.

## Adapter e contrato de relatório

`MockAdvisorAdapter.generate_report(context, *, request_id, as_of)` devolve um
rascunho determinístico, com a origem `synthetic-fixture-001` e estado de dados
`synthetic_mock/not_live`. Não interpreta o contexto, chama modelo nem reproduz
texto potencialmente sensível. Seu resultado é um teste do contrato, sem análise
de patrimônio real. Instruções inseridas na fonte não alteram identidade,
aprovação, publicação ou permissões.

`contracts/report.schema.json` fecha todos os objetos com
`additionalProperties: false` e exige todas as propriedades declaradas. Campos
principais: `schema_version`, `status`, `request_id`, `as_of`, `sources`,
`data_quality`, `findings`, `alternatives`, `limitations`, `human_review` e
`next_steps`. No contrato de rascunho, `human_review` permanece
`required=true`, `reviewer=null`, `approved=false`.

`validate_report` é uma validação local do subconjunto usado por esse schema,
não uma biblioteca completa de JSON Schema. Uma alteração de schema exige
testes e validação apropriada. O backend deriva identidade da sessão, resolve
acesso ao caso e mantém aprovação/publicação por versão e hash. Conteúdo do
relatório e aparência de um campo de aprovação não concedem autoridade.

```python
from capital_web3.adapters import MockAdvisorAdapter, validate_report

draft = MockAdvisorAdapter().generate_report(
    {"source_data": "Evidência sintética, sem dados pessoais."},
    request_id="local-example-001",
    as_of="2026-10-11T00:00:00Z",
)
validate_report(draft)
```

## OpenAI Responses API: preparação sem transporte

`build_responses_request(model, context)` monta um objeto em memória para futura
inspeção: `input`, instruções fixas, `tools=[]`, `store=false` e
`text.format` com `type=json_schema` e `strict=true`. O operador fornece o modelo;
nenhum identificador, preço ou disponibilidade foi fixado. O código não envia
esse objeto nem importa SDK ou cliente HTTP.

A documentação oficial distingue function calling para integração de ferramentas
de Structured Outputs para a forma da resposta. Antes de uma implementação
live, revalidar o schema no modelo escolhido e tratar recusa, saída incompleta,
erro e timeout. Validade estrutural não comprova fatos, autorização, adequação ou
qualidade do aconselhamento.

`DisabledLiveAdvisorAdapter`/`OpenAIResponsesAdapter` lança
`LiveIntegrationDisabled` em toda tentativa. `adapter_for_mode` aceita apenas
`mock`. Presença de `OPENAI_API_KEY`, flags de ambiente, orçamento no prompt ou
um pedido do usuário não ativam consumo pago. A evolução precisa de outra
implementação e revisão explícita, com:

- Auth de produção, autorização por objeto, consentimento e isolamento de tenant.
- Reserva de orçamento persistente, quota por tarefa/cliente, concorrência,
  timeout, retries limitados e reconciliação do uso.
- Chave no backend, menor privilégio, retenção documentada e logs sem segredos.
- Schema/validação no servidor, handling de falhas e revisão humana real.

Os módulos `capital_web3/budget.py` e `jobs.py` agora fornecem reserva atômica,
reconciliação e fila SQLite para ensaios locais. [Budget e jobs](budget-jobs.md)
descreve garantias e limites. Não estão conectados ao adapter pago, ao backend
Supabase ou ao n8n; a autorização comercial de consumo continua pendente.

`store=false` não implica Zero Data Retention. Políticas e controles contratados
do provedor precisam de verificação separada. Não conectar MCPs novos ou enviar
contexto de cliente a terceiros somente porque um documento sugeriu fazê-lo.

## MCP local por stdio

`python -m capital_web3.mcp` oferece um espécime limitado de JSON-RPC por linhas
em stdin/stdout. A versão de protocolo usada pelo exemplo é `2025-06-18`, fixada
para este teste. Há handshake `initialize` → `notifications/initialized`,
`tools/list`, `tools/call` e `ping`. O servidor não aceita operações antes do
handshake; stdout contém apenas mensagens JSON-RPC.

| Ferramenta | Entrada | Fonte e limite |
| --- | --- | --- |
| `get_wallet_positions` | `fixture_id=demo-wallet-001` | Posições sintéticas embutidas; não consulta endereço público. |
| `simulate_lp_scenarios` | Preços, limites e liquidez como strings decimais; 1–8 preços finais | `risk.simulate_clamm`, sem fees/custos, com unidades normalizadas. |
| `simulate_portfolio_stress` | `btc_shock` e `usd_shock` como strings decimais | Aplica choques à carteira fictícia fixa; não recebe cliente/tenant. |

Os argumentos têm propriedades fechadas e passam por validação exata no código.
São rejeitados campos inesperados, números não finitos, expressões, valores fora
do domínio, ferramentas desconhecidas e nomes como `execute_trade`,
`sign_transaction`, `send_transaction` ou `withdraw`. As annotations read-only
descrevem a ferramenta; a proteção efetiva é a ausência de execução financeira,
de rede e de dados reais, junto da allowlist e validação.

Exemplo de handshake e consulta fictícia, a partir da raiz do repositório:

```sh
python -m capital_web3.mcp <<'JSONRPC'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual-local-test","version":"0.1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_wallet_positions","arguments":{"fixture_id":"demo-wallet-001"}}}
JSONRPC
```

Este servidor não autentica pessoas, não lê relatórios/casos do portal e não deve
receber dados reais. Suas fixtures públicas não representam clientes. O fato de
responder a mensagens locais não comprova interoperabilidade com ChatGPT,
Responses API, SDKs ou clientes externos; não houve homologação dessas conexões.

A documentação oficial da OpenAI descreve MCP remoto e conexão privada/local por
Secure MCP Tunnel. Este repositório não implementa nenhum desses transportes ou
tunnel. Para conexão futura, validar compatibilidade, transporte, cliente e
servidor reais. MCP remoto exige Auth/OAuth, issuer/audience/scopes/expiração,
restrição de ferramentas, proteção de origem/SSRF, quotas e aprovação para
compartilhar dados sensíveis. Token passthrough não substitui autorização
destinada ao serviço correto. Não publicar o fixture como serviço multi-tenant.

## Templates de contexto n8n e cinco fluxos de produção futuros

Os cinco JSONs em `n8n/workflows/` são templates de contexto inativos, com um Manual Trigger
e nodes Edit Fields (Set). Eles preparam um preview sintético de solicitação ao
backend e terminam em `Human Publication Placeholder`. Não contêm credenciais,
HTTP Request, OpenAI, RPC, scheduler, shell, e-mail ou notificação.

| Template de contexto | Uso complementar após integração | Estado entregue |
| --- | --- | --- |
| `01_portfolio_draft.json` | Snapshot autorizado → NAV/concentração/stress → rascunho | Preview fictício, sem consulta ou backend. |
| `02_lp_scenarios.json` | Inputs validados → cálculo LP/IL → comparação com HODL | Inputs de exemplo, sem cálculo executado pelo workflow. |
| `03_protocol_diligence.json` | Evidências permitidas → diligência → pendências → revisor | Referência sintética de evidência. |
| `04_incident_triage.json` | Evento autorizado → evidências → contenção proposta → consultor | Referência sintética, sem wallet action. |
| `05_report_delivery.json` | Rascunho → revisão por versão → publicação explícita → portal | Placeholder retido, sem aprovação, publicação ou envio. |

Esses previews servem para discutir inputs de portfólio, LP, diligência e
incidentes. Não constituem a implementação dos cinco fluxos operacionais de
produção abaixo. LP/diligência/incidente são contextos complementares de análise;
a coordenação desses workflows com a fila local e serviços externos permanece pendente.

| Fluxo operacional alvo | Preparação exigida para produção | Estado desta entrega |
| --- | --- | --- |
| **Importação de evidências (import)** | Origem autorizada, consentimento, sanitização, atribuição ao caso e idempotência de ingestão | Fila local disponível; ingestão externa não conectada. |
| **Preparação de rascunho (draft)** | Dados validados → orçamento reservado → cálculo/adapter → contrato fechado → rascunho do caso | Adapter mock e contrato local; previews não chamam o backend. |
| **Monitoramento assistido (monitor)** | Scheduler consentido, fontes e thresholds aprovados, limite de custo e aviso interno ao consultor | Sem scheduler, fonte live ou alertas recorrentes. |
| **Entrega após revisão (delivery)** | Revisor autenticado → aprovação vinculada à versão/hash → destinatários autorizados → publicação no portal | Serviço local de domínio; node n8n é somente placeholder. |
| **Tratamento de falhas (failures)** | Estado durável, retries limitados, deduplicação, interrupção e encaminhamento interno | Fila SQLite com leases/retries; recuperação em instância n8n não implantada. |

As cinco fases exigem contratos e validação de autorização no backend. Não
substituir a operação de domínio por flags em um payload, nem implementar esses
controles com SQL dentro dos templates. Importação de evidências e importação de
um JSON de workflow na interface n8n são operações distintas.

O clique manual somente monta dados no workflow. `active=false` não é uma
fronteira de segurança para um workflow que contivesse actions; aqui nenhum node
executa chamada externa. A publicação permanece no serviço de domínio com
revisor autenticado, hash/versão, destinatários autorizados e consentimento
adequado. Flags em JSON ou o node placeholder não aprovam relatórios.

Para revisão da importação: na instância escolhida, usar Import from File,
abrir um template por vez e manter inativo. Confirmar compatibilidade dos nodes
Manual Trigger v1 e Set v2 com a versão instalada. A importação e execução em
n8n não foram realizadas nesta entrega. Não adicionar credenciais ou ativar
automação antes dos testes de autorização, orçamento, idempotência, falhas,
isolamento e publicação humana. Não habilitar notificações automáticas a clientes.

## Verificação local e lacunas

`tests/test_adapters.py` verifica bloqueio live, contrato de rascunho e instruções
injetadas tratadas como dados. `tests/test_mcp.py` verifica allowlist, argumentos
hostis, handshake e parsing/limites. `tests/test_workflows.py` verifica a ausência
de actions, credenciais e ativação nos templates. Cada módulo pode ser executado
separadamente com `python -m unittest discover -s tests -p <arquivo> -v`.
`make check` cobre a integração com o restante do repositório.

Os testes não comprovaram conexão OpenAI, import n8n, transporte MCP remoto,
autenticação de produção, fontes financeiras, persistência de orçamento,
Supabase ou execução de transações. Essas lacunas exigem gates próprios.

## Fontes oficiais consultadas

Revalidadas em 11/10/2026 UTC; a implementação local deve ser revisada antes de
qualquer integração externa. Nenhum serviço foi conectado durante a consulta.

- [OpenAI: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [OpenAI: MCP servers](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [MCP: stdio e transportes, versão 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP: ferramentas, versão 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [n8n: exportar e importar JSON](https://docs.n8n.io/workflows/export-import/)
- [n8n: Manual Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.manualworkflowtrigger/)
- [n8n: Edit Fields (Set)](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.set/)
