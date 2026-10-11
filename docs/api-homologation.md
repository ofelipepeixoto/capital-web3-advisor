# API de homologação de diagnósticos

`supabase/functions/advisory-api/index.ts` implementa a camada HTTP para a
homologação com dados fictícios. É independente da demonstração Python em
memória: exige usuário real do Supabase Auth, RLS e os RPCs da migração `0002`.
Esta implementação não liga OpenAI paga, n8n, custódia ou execução financeira.

## Identidade e autorização

O handler exige `Authorization: Bearer <access-token-do-usuário>` e consulta
`GET /auth/v1/user` no projeto configurado. A resposta deve identificar usuário
não anônimo. Somente depois dessa verificação são chamadas tabelas e RPCs com
**o mesmo token** e chave publishable/anon; não existe cliente service role.
Os RPCs obtêm `auth.uid()` e verificam papéis e atribuição ao caso no banco.
Headers `x-user-id`, `x-role`, subject/case em metadados ou saída do modelo não
criam identidade ou permissão. Corpos de escrita têm chaves fechadas; ator não
é um parâmetro aceito.

Revisão, publicação e revogação enviam os hashes de conteúdo **e manifesto**
que o humano observou. O backend não calcula um hash novo para substituir essa
confirmação. Novas tentativas usam a mesma chave UUID de idempotência, vinculada
ao pedido no banco; a autorização é verificada novamente. A confirmação de
recebimento deriva a identidade no banco e não aprova estratégia ou transação.

## Configuração

| Variável no backend | Regra |
|---|---|
| `SUPABASE_URL` | HTTPS do projeto `*.supabase.co`, sem credenciais, caminho ou redirect |
| `SUPABASE_PUBLISHABLE_KEY` | Chave publishable do projeto; alternativa: `SUPABASE_ANON_KEY` legacy anon |
| `ADVISORY_ALLOWED_ORIGINS` | Origens HTTPS exatas, separadas por vírgula; sem wildcard ou caminho |

Configuração ausente/inválida resulta em `503`, sem chamadas externas. Chave
`sb_secret_...` ou JWT de papel service role é rejeitada. Nenhuma chave concreta
é armazenada neste repositório. A seleção de projeto é configuração do operador;
uma URL no corpo, documento ou modelo não modifica o destino.

Em staging hospedado, preservar a verificação JWT da plataforma. A consulta ao
Auth no handler continua necessária: aceitar somente uma chave `apikey` não
autentica usuário, mesmo quando um gateway permite essa chamada por
compatibilidade. O navegador fornece o JWT do usuário e, quando exigido pelo
gateway, a chave **publishable**, nunca segredo administrativo.

## Rotas

Prefixo hospedado: `/functions/v1/advisory-api`. Os parâmetros `:id` abaixo são
UUIDs opacos; o banco decide se o ator pode acessá-los. A API não aceita queries
livres. Listas têm limite inicial de 100 itens, suficiente para o piloto fictício;
paginação de produção permanece no backlog.

| Método e rota | Comportamento |
|---|---|
| `GET /health` | Estado `configured`; não testa Auth, banco ou disponibilidade dos RPCs |
| `GET /session` | UID verificado e atribuições ativas de staff, lidas sob RLS |
| `GET /cases` | Títulos seguros de casos autorizados |
| `GET /reports` | Metadados de versões autorizadas; cliente vê somente publicação permitida |
| `GET /reports/:id` | Conteúdo client-safe da versão sob RLS |
| `GET /reports/:id/download` | Mesmo conteúdo em JSON com `Content-Disposition`; não gera URL assinada |
| `GET /reports/:id/review-package` | RPC `advisory_get_review_package`; somente staff atribuído |
| `POST /reports/:id/review` | RPC `advisory_review_report`; revisor independente, versão/hash exatos |
| `POST /reports/:id/publish` | RPC `advisory_publish_report`; destinatários ativos e revisão válida |
| `GET /publications` | Publicações autorizadas sob RLS |
| `POST /publications/:id/revoke` | RPC `advisory_revoke_publication`; revogação geral ou por destinatário |
| `POST /publications/:id/receipt` | RPC `advisory_record_receipt`; confirmação idempotente, corpo `{}` |

Corpo da revisão:

```json
{
  "decision": "approved",
  "expected_content_sha256": "<64 caracteres hexadecimais minúsculos observados>",
  "expected_manifest_sha256": "<64 caracteres hexadecimais minúsculos observados>",
  "private_notes": "Texto privado da revisão",
  "idempotency_key": "<UUID estável desta submissão>"
}
```

`decision` pode ser `approved` ou `rejected`. Corpo da publicação:

```json
{
  "recipient_user_ids": ["<UUID do destinatário selecionado>"],
  "expected_content_sha256": "<hash observado>",
  "expected_manifest_sha256": "<hash observado>",
  "expires_at": null,
  "idempotency_key": "<UUID estável desta submissão>"
}
```

`expires_at` também aceita timestamp UTC ISO 8601; o banco verifica a validade
temporal. São permitidos até 50 destinatários distintos, novamente validados
contra membership no banco. Revogação aceita exatamente
`recipient_user_id` (UUID ou `null` para todos), `reason`, os dois hashes
`expected_*` e `idempotency_key`.

Respostas de sucesso têm `{data, request_id}`. Erros retornam código genérico
e identificador criado no servidor. `404 resource_unavailable` representa tanto
objeto inexistente como não autorizado; `409 state_conflict` exige nova leitura e
revisão do estado, sem recalcular hashes para simular anuência. Conteúdo do banco,
notas privadas, JWTs e erros do provedor não são expostos em erros ou logs.

## Limites e teste local

Há limite de 16 KiB para JSON de escrita, deadline total de 5 segundos para ler
o corpo, 2 MiB para JSON upstream e timeout de 8 segundos por chamada upstream.
Um corpo que não termina é cancelado com `408`. Redirecionamentos são recusados. CORS permite
somente origens configuradas e preflight para GET/POST com headers conhecidos;
não substitui autorização. Respostas usam `Cache-Control: no-store`.

O teste de contrato usa Node.js 24 e executa o **mesmo arquivo TypeScript** com
supressão nativa de tipos, sem simular TypeScript como compilação Deno:

```sh
node --test tests/test_api_staging.mjs
```

Nesse teste, Auth e PostgREST são simulados: ele verifica fronteiras HTTP e
encaminhamento dos contratos, não prova políticas RLS ou funcionamento remoto.
Para integração Supabase CLI, o runner Node pode construir
`createHandler(envReader, fetch, {localTest: true})`. Essa opção explícita no
código aceita somente `http://127.0.0.1:54321`, sem URL arbitrária. O entrypoint
Deno não a passa; nenhuma variável ou request ativa essa exceção no deploy.
A integração real usa Auth/PostgREST/Storage do Supabase local em Docker e
usuários fictícios, conforme roteiro e CI de homologação do projeto.

## O que falta para produção

Este handler não inclui MFA, controle persistente de sessão do produto,
ratelimits/quotas distribuídas, paginação, observabilidade de produção ou fluxo
de criação/ingestão de documentos. `getUser()` não deve ser anunciado como prova
de revogação instantânea de todo access token após logout: é necessário homologar
a semântica do Auth e implementar o controle de sessão adequado. Membership
inativo e revogação de publicação continuam sendo verificados no banco a cada
acesso. Teste de contrato, integração Docker e deploy cloud são evidências
distintas; aprovação humana do piloto não equivale a GO de produção.

Fontes técnicas oficiais verificadas em 11/10/2026:

- [Supabase: Authorization headers](https://supabase.com/docs/guides/functions/auth-headers).
- [Supabase: Securing Edge Functions](https://supabase.com/docs/guides/functions/auth).
- [Supabase: Auth e JWT](https://supabase.com/docs/guides/auth/jwts).
- [Supabase: getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
