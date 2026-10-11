# Homologação local de orçamento e jobs

Os módulos `capital_web3/budget.py` e `capital_web3/jobs.py` persistem estado
local em SQLite, sem dependências externas. Não fazem chamadas de rede, não
ativam OpenAI, não conectam n8n e não enviam notificações. O adapter live continua
bloqueado. Este gate comprova invariantes locais; o banco de produção e as
integrações externas exigem homologação própria.

## Identidade e autorização

`TrustedScope(tenant_ref, case_ref, actor_ref, grants)` é criado exclusivamente
pelo backend **depois** de autenticar a pessoa/serviço e verificar atribuição ao
caso, tenant, consentimento e grants. Não constitui autenticação, JWT ou prova de
membership. Não construir esse objeto com campos recebidos do browser, modelo,
PDF ou webhook. Esses módulos são APIs internas, sem endpoint HTTP público.

Toda consulta de reserva/job exige o mesmo tenant, caso e ator. Referência
inexistente e referência sem acesso geram `ScopedNotFound`, com mensagem igual.
`configure_limit`, `claim`, `complete` e `retry` são operações internas de
operador/worker: o futuro serviço HTTP deverá aplicar sua autorização antes de
invocá-las. Workers precisam revalidar atribuição, consentimento e grants atuais
antes do efeito; o job armazena apenas o snapshot de autorização da criação.

## Reserva antes do efeito externo

O ledger abre uma transação `BEGIN IMMEDIATE` por operação. Duas requisições
concorrentes não podem aprovar a mesma folga. Devem existir **dois limites**:
agregado do tenant e limite do caso. Ausência de configuração equivale a zero.
Valores monetários são inteiros em milionésimos de uma única moeda definida pelo
operador. Não são preços de modelos, não há conversão cambial e não ocorre reset
mensal automático. Usar uma janela/ledger nova mediante decisão explícita; nunca
apagar reservas abertas para renovar quota.

```python
from capital_web3.budget import BudgetLedger, TrustedScope, request_digest

# Exemplo local fictício. Na aplicação, a política autenticada resolve o scope.
scope = TrustedScope("demo-tenant", "demo-case", "demo-staff", frozenset({
    "budget:reserve", "budget:reconcile",
}))
ledger = BudgetLedger("/tmp/capital-web3-local-demo/budget.sqlite3")
# Limites de teste em unidades abstratas; não autorizam consumo pago real.
ledger.configure_limit("demo-tenant", cost_limit_micro=100, call_limit=2)
ledger.configure_limit("demo-tenant", "demo-case", cost_limit_micro=100, call_limit=2)
```

`reserve(scope, idempotency_key=..., request_digest=..., worst_cost_micro=...,
worst_calls=..., deadline=...)` segura o pior caso monetário e número máximo de
chamadas. A chave vincula tenant/caso/ator ao digest, limites e deadline. Repetição
idêntica retorna a mesma reserva; alteração conflita, inclusive após reinício.
O digest é SHA-256 de JSON canônico via `request_digest(payload)`; não é evidência
de autorização. Deadline deve ser inteiro no futuro, limitado a 24 horas.

O futuro handler usa `mark_dispatched(scope, reservation_id)` imediatamente antes
do envio. **Somente retorno `True` permite a primeira tentativa.** Retorno
`False` indica dispatch registrado e não autoriza nova chamada. Registrar antes
de enviar pode deixar uma reserva presa após crash; essa falha é segura e exige
reconciliação humana/operacional com evidência de uso.

`settle(..., actual_cost_micro=..., actual_calls=...)` aceita uso verificado
menor ou igual ao reservado, cobra esse uso e libera a diferença. Repetição com
os mesmos valores é idempotente; valores diferentes conflitam. Uso acima do
reservado é rejeitado e o hold permanece: o futuro serviço precisa bloquear nova
execução do caso e encaminhar a discrepância, sem falsificar o custo confirmado.

`cancel` e expiração liberam somente reserva ainda não enviada. Uma reserva
`dispatched` mantém o pior caso após timeout/crash; não se presume custo zero.
Retries do job não podem repetir dispatch da mesma reserva. Se um provedor
permitir retry pago comprovadamente distinto, ele exige nova reserva por
**tentativa** e orçamento para ambas, sem apagar o uso anterior. A composição do
handler com o ledger deve ser validada antes de habilitar transporte pago.

Na documentação oficial OpenAI consultada em 11/10/2026, spend alerts somente
avisam; hard spend limits podem bloquear requests, com propagação não instantânea.
O ledger da aplicação complementa esses controles com reserva antes do passo.
Nenhuma configuração de orçamento/conta OpenAI foi alterada.

Fonte: [OpenAI — Spend limits](https://developers.openai.com/api/docs/guides/spend-limits).

## Fila durável e falhas

`DurableJobQueue(path).enqueue(scope, purpose=..., payload=...,
required_scopes=..., deadline=..., idempotency_key=..., max_attempts=3)` aceita
somente `import`, `draft`, `monitor` ou `notification`. Exige `jobs:enqueue`,
`job:<purpose>` e todos os scopes adicionais pedidos, contidos nos grants da
política. O nome `notification` é um contexto futuro; nenhum envio foi
implementado. JSON não finito, payload acima do limite local, finalidade
financeira e deadline inválido são rejeitados.

`claim(worker_id, purposes=(...), lease_seconds=30)` usa uma allowlist de
finalidades do worker. Uma transação seleciona e marca o job, incrementa a
tentativa e emite `claim_token` novo. Uma lease vencida pode ser retomada depois
de reiniciar o processo; token antigo não pode concluir/reagendar o job. Limites:
até cinco tentativas, lease até 300 segundos e atraso de retry até 300 segundos.
Ao exceder tentativas ou deadline, o job termina em falha/expiração.

`complete(id, worker_id, claim_token, result_digest=...)` persiste apenas o hash
do resultado e encerra o job. `retry(..., delay_seconds=..., error_code=...)`
reagenda com atraso delimitado ou registra falha. `cancel(scope,id)` só cancela
job que ainda não foi tomado pelo worker. Chave idempotente de job vincula
payload, finalidade, scopes, deadline e teto de tentativas; replay idêntico não
cria uma nova tarefa, mesmo depois de conclusão/reinício.

A fila tem semântica **pelo menos uma vez**. Leases impedem conclusão por um worker
antigo, mas não desfazem um efeito externo já feito. Cada handler precisa de
idempotência durável no serviço de domínio e de nova validação de acesso antes
de agir. Em especial, completion perdido não pode publicar nova versão, enviar
ou chamar OpenAI novamente. Não há handler externo automatizado nesta entrega.

## Webhook assinado e replay

`SignedWebhookVerifier(path, secret=..., target="/internal/jobs", max_age=300)`
exige segredo protegido de pelo menos 32 bytes e caminho fixo configurado. Aceita
somente POST, body bytes até 64 KiB, timestamp não futuro dentro da janela e
nonce de 16–128 caracteres. A assinatura HMAC-SHA256 cobre:

1. Versão fixa `CW3-HMAC-v1`.
2. Método e caminho exatos.
3. Timestamp e nonce.
4. SHA-256 dos bytes originais do body.

`signing_input(method,target,timestamp,nonce,body)` define os bytes exatos usados
pelo emissor. `verify(...)` compara assinaturas com `hmac.compare_digest` e
consome nonce na mesma transação local. Duas entregas concorrentes e replay após
reinício são negados; tamper não consome nonce válido. Segredo, assinatura e body
não são armazenados na tabela de replay; somente canal derivado, nonce e prazo.

A verificação HMAC não autoriza tenant/caso informado no body. O backend precisa
mapear a credencial a uma identidade de serviço configurada e aplicar ACL antes
de enfileirar. Verificação e enqueue são operações separadas: se houver crash
entre elas, uma entrega deve usar novo nonce assinado e a **mesma chave de
idempotência do domínio**. Este comportamento falha fechado, sem execução dupla.
Um futuro endpoint precisa validar formato do JSON, limite de requests, relógio,
rotação do segredo, logs e entrega/retry nessa composição.

## Evidência e limites desta etapa

```sh
python3 -m unittest tests.test_budget tests.test_jobs -v
```

**15 testes locais aprovados**: quota default zero; limites tenant/caso;
concorrência e teto de chamadas; restart/idempotência; digest alterado; dispatch
único; reconciliação e diferença; cancelamento/expiração; hold após crash;
autorização por referência/grants; lease/recovery/fencing; retry delimitado;
completion/cancel; HMAC/tamper; replay persistente e entrega concorrente.

SQLite nesta etapa é arquivo local com modo `0600`, não Postgres/Supabase nem
filas distribuídas. Dados de payload são fictícios; o arquivo não oferece
criptografia at rest. Guardar banco/backup fora do Git e fora da pasta servida
pela interface, com diretório privado e backup aprovado. Não compartilhar o
arquivo em rede/NFS. Um teste local não comprova controles de acesso ao host,
retenção/LGPD, chave real, DB cloud, interoperabilidade n8n ou idempotência de
provedor. Nenhuma automação foi ativada e nenhuma chamada paga foi executada.
