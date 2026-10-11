# Backend Supabase — fundação, workflow humano e gate de implantação

Esta especificação prepara migrações, RPCs e testes para um ambiente **isolado**.
Nenhum projeto ou bucket na nuvem foi criado por estes arquivos. A homologação
descartável da CI usa Auth, PostgREST e Storage reais com fixtures; a API Python
local é independente desse backend.

**Estado:** fonte e testes em revisão; resultados executados e gates restantes
estão em [homologação](homologation.md). A API hospedada e o portal com Auth de
produção permanecem pendentes. Não confundir claims SQL sintéticas com login.

## Modelo e fluxo

As tabelas `public.advisory_*` usam Supabase Auth como referência de identidade. Não armazenam seed, chave privada, passphrase ou credenciais de exchange.

| Tabela | Finalidade | Escrita autenticada pela Data API |
|---|---|---|
| `advisory_cases` | Título seguro para o cliente e identidade do caso | Nenhuma |
| `advisory_case_staff` | Atribuição ativa por caso e função: analyst, reviewer, publisher, admin | Nenhuma |
| `advisory_case_clients` | Clientes ativos do caso | Nenhuma |
| `advisory_reports` | Identidade do relatório dentro do caso | Analista/admin atribuído cria |
| `advisory_report_versions` | Conteúdo seguro para cliente, número de versão e digest calculado no banco | Autor atribuído cria/edita apenas draft; edição só da coluna `content` |
| `advisory_report_assets` | Manifest com referência exata de objeto e hash de bytes | Nenhuma |
| `advisory_human_reviews` | Decisão humana sobre versão, digest do conteúdo e digest do manifest observados | Nenhuma |
| `advisory_publications` | Release de uma versão aprovada | Nenhuma |
| `advisory_publication_recipients` | Pessoas explicitamente autorizadas para um release | Nenhuma |
| `advisory_publication_revocations` | Revogação geral ou de destinatário; registro permanente | Nenhuma |
| `advisory_receipts` | Ciência de recebimento, com horário do servidor | Cliente autorizado insere o próprio recibo |
| `advisory_clarifications` | Pergunta privada de cliente e resposta atribuída a sua thread | Cliente pergunta; staff atribuído responde |
| `advisory_audit_events` | Registro mínimo append-only de mudanças, sem conteúdo do relatório | Nenhuma; triggers registram mudanças |

O fluxo previsto é: atribuição pelo responsável → draft → assets → revisão humana independente → publicação → destinatários específicos → ciência/esclarecimentos → eventual revogação. Recibo é ciência de recebimento; não representa aprovação, adequação financeira, autorização para negociar ou movimentação de fundos.

O autor não pode revisar o próprio relatório. O reviewer precisa ser reviewer/admin ativo do caso; o publisher precisa ser publisher/admin ativo do caso. As funções podem pertencer à mesma pessoa revisora/publicadora, mas não ao autor na revisão. A política comercial pode exigir mais separação; isso ainda precisa ser definido.

Qualquer decisão de revisão, inclusive rejeição, congela o conteúdo e o manifest daquela versão. Correção cria outra versão. Reviews, publications, recipients, revocations, receipts, clarifications e audit são append-only. Não apagar decisão antiga para “despublicar”: inserir revogação. Nova autorização após revogação é um novo release, com registro próprio e destinatários explícitos.

O hash do JSONB é calculado sobre a representação textual de `content` pelo PostgreSQL. A revisão também exige `reviewed_manifest_sha256`: hash de array JSONB ordenado por ID de asset, incluindo ID, bucket, objeto, hash dos bytes e MIME. Array vazio é `[]`. Sob o lock da versão, o banco compara ambos os hashes com o pacote atual. Se um asset mudar depois da inspeção humana e antes da confirmação, o hash observado não corresponde e a revisão falha, mesmo com conteúdo textual igual. O backend precisa conservar os hashes do pacote mostrado ao humano; não os recalcular silenciosamente no momento da confirmação.

Esses hashes não provam leitura humana nem a correspondência com bytes reais de um PDF. O backend futuro precisa validar o schema do relatório e conferir separadamente `bytes_sha256` contra os bytes reais do arquivo.

## Autorização

Todas as tabelas têm RLS habilitada e forçada; grants de `PUBLIC`, `anon` e `authenticated` são revogados e os mínimos necessários são recolocados. Não existem políticas de escrita de approval, publish, membership ou revocation para clientes/staff autenticados.

O cliente só lê uma **versão exata** quando coexistem publicação vigente, recipient explícito e membership ativa no banco. Membership no caso, autenticação e URL conhecida isoladamente não liberam relatório. Draft novo, versão não publicada, outro caso, destinatário diferente, release expirado/revogado e membership inativa ficam inacessíveis. A exclusão de membership ativa não depende de refresh de claims de papel do JWT: a condição é consultada no banco.

Staff lê apenas casos a que está ativamente atribuído. Clientes não recebem reviewer notes, audit interno, lista de outros signers/funcionários ou perguntas de outro cliente. A thread de esclarecimento é vinculada ao cliente específico, mesmo quando há vários destinatários do mesmo relatório.

O conteúdo de `advisory_report_versions`, os títulos de caso e os assets são seguros para cliente por design. RLS não oculta colunas específicas de um registro visível: prompts, traces, nomes/localizações de backups, notas privadas e dados internos precisam ficar fora dessas tabelas/arquivos.

Claims `user_metadata` não concedem autorização. Contas Supabase Auth anônimas (`is_anonymous=true`) são rejeitadas mesmo se assumirem o papel PostgreSQL `authenticated`. JWTs precisam ser verificados pelo gateway/backend; os testes SQL não validam assinatura de JWT.

## Funções internas e workflow privilegiado

O schema `advisory_private` **não pode ser incluído nos exposed schemas** da Data API. Seus helpers de autorização são booleanos, somente leitura, usam `auth.uid()` do contexto e não aceitam uma identidade arbitrária do chamador. O helper interno de digest não tem `EXECUTE` para clientes. `SECURITY DEFINER` foi limitado a essas consultas e aos triggers que precisam consultar registros protegidos ou escrever audit. Todas têm `search_path` fixo; privilégios `EXECUTE` genéricos são revogados. Os triggers não têm grants de execução para clientes.

Os helpers precisam pertencer a uma role administrativa controlada com `BYPASSRLS` ou superuser. Ser proprietário da tabela isoladamente não contorna `FORCE ROW LEVEL SECURITY` e pode causar recursão das policies. A migração falha antes do DDL se a role instaladora não tem esse atributo; a suíte verifica os owners das funções. Validar acesso/owners no staging; não desativar RLS nem conceder bypass a usuários ou staff para solucionar falha de instalação.

**Cinco RPCs de workflow foram adicionados em `0002_human_workflow.sql`.**
Derivam identidade da sessão, verificam papéis atribuídos no banco e vinculam
decisões aos digests observados; publicação + recipients são atômicos. O handler
da Edge verifica o usuário no Auth e usa o mesmo JWT em PostgREST, sem service
role. Consulte [API](api-homologation.md) e [segurança](security-homologation.md).
Nunca aceitar `reviewer_user_id`, `publisher_user_id`, `revoked_by` ou `case_id`
fornecidos pelo modelo como prova de autoridade. Recibos usam somente RPC.

Uma `service_role`/secret key bypassa RLS. Consultar com ela e obter sucesso **não valida autorização de cliente**. Credenciais desse tipo permanecem só no servidor, com acesso restrito. Preferir uma role/workflow de backend de privilégio mínimo na implementação real. O administrador do banco continua capaz de desabilitar triggers ou alterar registros: este audit não é prova criptográfica contra o DBA. Antes de produção, avaliar retenção e cópia externa protegida contra adulteração.

Nenhuma ferramenta de trade, wallet signing, approval de tokens, swap ou broadcast on-chain existe nesta migração. A aprovação humana aqui se refere exclusivamente ao relatório consultivo.

## Storage privado e revogação

O bucket `capital-web3-advisory` nasce privado, com limite de 10 MiB e tipos PDF, JSON e texto. Se um bucket homônimo já existir publicamente, a migração falha em vez de aceitar exposição. Em projeto compartilhado, revisar limites e tipos do bucket existente também; a migração não altera silenciosamente esse bucket.

A policy de leitura exige coincidência exata de `bucket_id` e `object_name` com um asset de versão autorizada. Não há grant por prefixo de pasta. Uma policy `RESTRICTIVE` protege esse bucket mesmo quando outra policy permissiva ampla existe em `storage.objects`. Upload, update, upsert e delete de clientes/staff autenticados são bloqueados para esse bucket.

Upload será backend-only, por Storage API, com nomes únicos/endereço por conteúdo e **sem upsert**. O manifest congelado não impede por si só um administrador privilegiado de trocar bytes; o backend deve exigir escrita única, verificar o digest e auditar operações administrativas. Não criar/alterar `storage.objects` diretamente no fluxo real; a suite SQL faz somente fixtures temporárias de metadata, sem upload.

Para revogação previsível, preferir leitura autenticada pela Storage API ou proxy que confira autorização a cada download. URLs assinadas podem continuar válidas até seu TTL e bytes já baixados não são recolhidos pela revogação. Não prometer revogação de arquivo já entregue. Se usar signed URLs, definir TTL curto, exposição nos logs/cache e janela residual no contrato do produto. Usuários removidos também podem continuar com JWT válido: sessão revogada/expiração curta e controles de sessão devem ser testados no backend.

## Execução futura e evidências

O nome `0001_advisory.sql` foi mantido como solicitado. Antes de usar Supabase CLI, criar migration pelo CLI conforme a versão instalada e copiar/revisar este conteúdo no arquivo com timestamp apropriado. Não provisionar automaticamente e não aplicar em produção.

Depois de definir organização, região, custo, responsáveis e staging isolado, aplicar o SQL com uma conexão administrativa protegida. Em uma sessão `psql` configurada sem senha em comando, histórico ou chat:

```bash
psql --set ON_ERROR_STOP=1 --file supabase/migrations/0001_advisory.sql
psql --set ON_ERROR_STOP=1 --file supabase/tests/authorization.sql
```

`authorization.sql` inicia transação e termina com `ROLLBACK`. Usa duas pessoas clientes fictícias, três staff fictícios, duas atribuições de caso, versões/recipients explícitos e `SET LOCAL ROLE` com claims sintéticas. Assertions distinguem denial por ausência de grant, zero linhas por RLS e rejeição por trigger. Simula uma policy Storage ampla para verificar a barreira restrictive. Testes privilegiados de constraints estão separados dos testes de leitura/escrita sob `anon`/`authenticated`.

Isso não substitui os seguintes gates de staging:

1. Aplicação limpa da migração, inspeção das policies/grants/owners/funções e Database/Storage advisors sem bloqueios relevantes.
2. Suite SQL completa sem erro; guardar versão do PostgreSQL/Supabase, SHA do arquivo e log mascarado. Medir query plans/índices sob volume real.
3. Auth real com clientes A/B e staff, JWT válido/expirado/anônimo, remoção de sessão e mudanças de membership. Verificar Data API com tokens desses usuários, inclusive IDs de outra pessoa/caso.
4. Upload de bytes reais pela Storage API do futuro backend, comparação de digest, autorização de download/listagem, ausência de URL pública, deny de update/upsert/delete e comportamento de revogação/cache/signed URL.
5. Workflow humano real: identidade derivada da sessão; não do payload; autor separado do reviewer; digest/assets exatos; publicação+recipients em transação; rejeição sem publicação; versões seguintes não herdando release.
6. Corridas de edição/review/upload, mudança de manifest após inspeção humana, revogação durante download, duplicação de recibo, retries idempotentes, TTL de publicação e revogação específica/geral. Review trava o registro da versão e vincula o hash do manifest observado; validar concorrência na integração real.
7. Privacidade e conteúdo: distinguir relatório entregue de notas/prompts internos, conversas privadas por cliente, logs sem segredos, minimização/retention/deletion definidas. Review dos advisors não significa conformidade regulatória ou LGPD certificada.
8. Snapshot/backup e recuperação, custos/limites, observabilidade e documentação de riscos residuais; liberação humana do staging antes de produção.

Até esses gates passarem, o resultado é **preparado para validação**, com integração persistente não homologada.

## Fontes oficiais consultadas

- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): grants + policies, `TO authenticated`, ownership e testes de allow/deny.
- [Supabase — Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control): RLS de objetos e riscos de bypass por service key.
- [Supabase — Testing Your Database](https://supabase.com/docs/guides/database/testing): testes SQL/pgTAP e rollback.
- [Supabase — Securing Your API](https://supabase.com/docs/guides/api/securing-your-api): exposed schemas e fronteira da Data API.

Consulta: 2026-10-11 UTC. O índice `https://supabase.com/changelog.md` não foi legível pelo serviço de consulta (tipo `text/markdown` não suportado); a verificação do changelog pertinente permanece no gate de implantação. As páginas de RLS, Storage e testes foram lidas diretamente. Nenhuma versão do CLI foi presumida ou instalada.
