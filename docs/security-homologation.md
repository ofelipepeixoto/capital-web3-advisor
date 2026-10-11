# Segurança da homologação

A migração `0002_human_workflow.sql` fecha a passagem entre os registros de
revisão/publicação preparados na primeira migração e o backend autenticado.
Aplica-se somente ao projeto de staging dedicado. Não modifica outro projeto,
não habilita custódia, assinatura ou execução financeira.

## Identidade e decisões humanas

Os cinco RPCs expostos em `public` derivam identidade de `auth.uid()` e exigem
JWT de conta autenticada não anônima. Papéis são atribuições ativas do caso em
`advisory_case_staff`, com origem administrativa controlada. `user_metadata`,
payloads do modelo e IDs de usuário recebidos do navegador não atribuem papéis.

| RPC | Permissão | Efeito |
|---|---|---|
| `advisory_get_review_package` | Staff atribuído ao caso | Pacote de conteúdo e manifesto com hashes calculados pelo banco |
| `advisory_review_report` | Reviewer/admin; diferente do autor | Decisão imutável sobre a versão e manifesto observados |
| `advisory_publish_report` | Publisher/admin; diferente do autor | Publicação e destinatários ativos na mesma transação |
| `advisory_revoke_publication` | Publisher/admin do caso | Revogação imutável global ou de destinatário daquela publicação |
| `advisory_record_receipt` | Destinatário ativo de publicação disponível | Confirma recebimento, sem aprovar plano ou operação |

Revisão, publicação e revogação recebem os hashes de conteúdo e manifesto que
foram exibidos ao humano. O backend não substitui esses hashes por uma consulta
nova no momento de executar a ação. Mudança no pacote exige nova inspeção. A
publicação recebe exatamente a lista de destinatários que o humano confirmou.
O modelo não chama os endpoints de decisão humana.

## Privilégios do banco

`SECURITY DEFINER` é restrito aos RPCs e helpers necessários para a transação
controlada. Todos têm `search_path = ''`, nomes de objeto qualificados e dono
administrativo com `BYPASSRLS`, verificado na migração e suíte SQL, porque as
13 tabelas públicas têm `FORCE ROW LEVEL SECURITY`. Usuários autenticados não
recebem INSERT/UPDATE/DELETE nos registros de revisão, publicação ou revogação.
Recibos também não aceitam INSERT direto: a segunda migração remove o grant e
a policy antigos para exigir o RPC que serializa recebimento com revogação.
As funções expostas revogam EXECUTE de PUBLIC, anon e service_role antes de
conceder somente a authenticated. Cada função ainda verifica identidade e caso.

A tabela de idempotência fica em `advisory_private`, com RLS e FORCE RLS, sem
privilégios de tabela para os papéis de runtime. Os helpers de mutação não são
executáveis por esses papéis. Esse schema não pode ser adicionado aos schemas
expostos do Data API. Permanecem apenas os quatro predicados privados de RLS
intencionalmente executáveis da primeira migração.

## Idempotência e conteúdo exato

As chaves são UUIDs por ator e tipo de ação. O banco calcula SHA-256 de todos
os campos relevantes da requisição. Retry idêntico retorna o registro original;
reutilizar uma chave com outro destinatário, decisão, prazo ou motivo falha.
Um lock transacional da chave evita duas ações concorrentes, e o lock da versão
serializa alterações no conteúdo/manifesto com revisão e publicação. Publicação
faz INSERT do registro e dos destinatários na mesma transação. Falha de qualquer
destinatário deixa zero publicação parcial. Recebimento tem unicidade por
publicação e usuário, obtido da sessão e revalidado em cada repetição.

## Limitações que continuam sendo gates

- Claims sintéticas SQL não comprovam assinatura JWT, login, revogação de sessão
  ou integração HTTP. A suíte HTTP com usuários fictícios reais é etapa própria.
- O banco vincula o manifesto, mas não lê/verifica bytes de Storage. A pipeline
  de upload deve calcular/verificar hash dos bytes e usar escrita única sem
  substituição; homologação de arquivo real segue separada.
- Uma revogação bloqueia novas leituras autorizadas. Não recupera cópias já
  baixadas nem URLs assinadas ainda válidas. Para entrega sensível, preferir
  acesso autenticado com checagem corrente; não emitir links de longa duração.
- O JWT é validado no serviço de Auth/API antes da chamada SQL. Papéis de casos
  são consultados no banco. Garantia estrita de invalidação de sessão em toda
  decisão exige verificar `session_id` corrente, além de JWT válido e curto.
- Não há conexão paga OpenAI, scheduler n8n ativo ou aprovação de lançamento
  comercial implícitos nesta migração.

## Verificação reproduzível

Após aplicar as duas migrações no staging isolado, executar como dono controlado:

```sh
psql --set ON_ERROR_STOP=1 --file supabase/tests/authorization.sql
psql --set ON_ERROR_STOP=1 --file supabase/tests/authorization_human_workflow.sql
```

Ambas usam transação e terminam em ROLLBACK; usuários, casos e decisões são
fictícios. A segunda cobre permissões de funções, segredo de idempotência,
autor separado, staff de outro caso, usuário Auth anônimo, hashes vencidos,
rejeição de versão, destinatário inativo, publicação atômica, replay alterado,
leitura do cliente, recibo e revogação. Não apresentar cenários como resultados
aprovados antes de executar o SQL no Postgres real.

Consultar advisors do Supabase após aplicar e verificar que apenas `public`
contém os RPCs de domínio expostos. A extensão de esquema deve ser revisada
humanamente antes de merge; o projeto de staging não autoriza produção.

Documentação oficial consultada em 11/10/2026: [Database functions](https://supabase.com/docs/guides/database/functions),
[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Changelog](https://supabase.com/changelog). O índice Markdown não foi suportado
pelo leitor; foi consultada a versão HTML. O changelog informa alteração de
exposição automática de tabelas em 2026: os grants explícitos da migração são
intencionais, independentes dos controles por linha.
