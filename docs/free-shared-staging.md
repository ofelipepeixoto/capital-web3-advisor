# Staging no Supabase Free compartilhado

Decisão do titular em 11/10/2026: usar o projeto existente `radar-disruptivo`,
mantendo o plano Free. Não criar terceiro projeto, contratar Pro, pausar serviços
existentes ou modificar os dados das outras aplicações.

## Mudança e leitura do diff

Esta branch adapta os templates ainda não implantados: `public.advisory_*` passa
a `capital_web3.advisory_*`; `advisory_private` passa a `capital_web3_private`.
O diff SQL é principalmente essa qualificação de nomes. Não é uma migração de
uma instalação antiga em uso: se já houver instalação Capital, parar e preparar
uma migração de dados própria. As branches anteriores conservam o desenho dedicado.

1. `0001_advisory.sql`: cria namespaces exclusivos; falha em colisões; RLS
   forçada, grants mínimos e bucket `capital-web3-advisory` privado. As cinco
   policies novas no Storage são delimitadas ao bucket, com barreiras restritivas.
2. `0002_human_workflow.sql`: mesmas regras de revisão, publicação e recibo,
   agora nos namespaces próprios. Nenhum RPC concede papel por metadados do usuário.
3. Handler Edge: fixa `Accept-Profile` e `Content-Profile` em `capital_web3`
   somente para PostgREST. Continua propagando o JWT validado do próprio usuário.
4. CI: instala uma aplicação fictícia vizinha antes das migrações, inclusive
   nomes iguais em `public` e no schema privado antigo. As suítes verificam que
   esses objetos permanecem utilizáveis e que usuários sem vínculo não recebem
   acesso aos casos da Capital.

## Limites do compartilhamento

Schemas não são projetos/servidores separados. Auth, chaves administrativas,
configurações de e-mail, redirect URLs, CPU, banco e cotas são compartilhados.
Um administrador ou uma chave com BYPASSRLS continua tendo alcance no projeto.
Uma conta da Capital também é uma identidade válida no Auth comum; as regras
das outras aplicações continuam responsáveis pelo que essa identidade pode fazer
nelas. Não declarar isolamento integral entre produtos ou criar contas de clientes
reais antes da revisão desse compartilhamento.

As tabelas da Capital exigem vínculo no caso e papel explícito; autenticação
isolada não basta. A aplicação vizinha não é alterada para adaptar a Capital.
O orçamento Supabase permanece no Free. Consumo OpenAI segue desativado; n8n,
MCP remoto e hospedagem têm gates separados.

## Implantação controlada

- Executar `make check` e a CI Supabase antes de aplicar os templates.
- Ler a configuração e registrar fingerprints dos objetos preexistentes.
- Aplicar 0001 e 0002 atomicamente, com lock timeout 5s e statement timeout 30s.
  Não executar `db reset`, `db push` do repositório inteiro ou fixtures de CI
  no projeto compartilhado. O histórico de migrações das outras aplicações
  pertence a elas; usar apenas a migração aditiva explicitamente selecionada.
- Conferir 13 tabelas públicas da aplicação + 1 privada, RLS, grants, owners,
  bucket privado e fingerprints dos objetos anteriores.
- Adicionar **somente `capital_web3`** à lista atual de Exposed schemas nas
  configurações da Data API. Preservar todos os schemas anteriores. Nunca expor
  `capital_web3_private`. Esta opção não é alterada pelos templates.
- Não usar `ALTER ROLE authenticator SET pgrst.db_schemas` como atalho: o override
  interfere no gerenciamento da lista pelo painel. Usar o painel/API de gestão.
- A Edge `advisory-api` só deve ser ativada com origens privadas autorizadas;
  configurar `ADVISORY_ALLOWED_ORIGINS`. Sem configuração válida, responde 503.
- Validar depois o gateway Edge hospedado, login e contas sintéticas autorizadas,
  separação dos clientes, entrega e revogação no portal hospedado.

## Interrupção e recuperação

Uma falha no bundle SQL desfaz a transação. Após instalação, primeiro interromper
o acesso à nova aplicação/Edge. Antes de remover o schema da Capital, removê-lo
da lista exposta e recarregar/verificar PostgREST: apagar um schema ainda exposto
pode impedir o serviço de montar seu cache. Não executar DROP CASCADE automático.
Qualquer remoção exige revisão de dependências e preservação dos dados que já
existirem. As cinco policies e o bucket da Capital são removidos somente junto
da desativação revisada; não tocar em policies/buckets de outras aplicações.

## Evidência e pendências

A fundação foi implantada no projeto escolhido, que permaneceu `ACTIVE_HEALTHY`
e no plano Free. Migração `capital_web3_free_staging_foundation`, versão
`20261011193554`. Foram verificadas 13 tabelas da aplicação + 1 privada, todas
com RLS habilitada/forçada; cinco RPCs; cinco policies Storage e bucket privado.
Nenhuma conta real ou fictícia persistente foi criada na nuvem.

O fingerprint dos objetos anteriores permaneceu igual. Isso verifica estruturas,
grants, policies e configuração de exposição observados, não é backup dos dados
nem auditoria integral das outras aplicações. Smoke SQL transacional confirmou
negação de escrita privilegiada direta, ausência de execução RPC anônima e
negação de recibo para uma identidade sem vínculo. As claims desse smoke são
sintéticas; não demonstram login Auth real na nuvem.

A CI [38161317031](https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/38161317031)
passou nos três jobs para o commit `4f1efd3e3438b8df938ef888f9fb72bc8476930c`.
Inclui os testes SQL de aplicação vizinha, Auth/PostgREST/Storage reais locais,
Chromium da demonstração e portal autenticado. O commit seguinte só registra
esta evidência. [Manifesto](evidence/free-shared-staging-2026-10-11.json).

Advisors: nenhum WARN/ERROR novo atribuído aos schemas da Capital. O INFO da
tabela privada sem policy é esperado: privilégios de clientes estão revogados
para a tabela de idempotência, acessada apenas pelos helpers controlados.
Um aviso de proteção de senhas vazadas já existia no Auth compartilhado; não foi
alterado. Isso não equivale a declaração de segurança total.

Ainda falta adicionar `capital_web3` às configurações de schemas expostos da
Data API, preservando os existentes. O conector Supabase conectado não oferece
essa configuração; a alternativa de gestão encontrada não tem conexão ativa.
Não foi feito override global por SQL. A Edge e o portal privado também não
foram implantados, e não houve login real na nuvem. O piloto com clientes reais
permanece bloqueado.

Referências oficiais consultadas em 11/10/2026:

- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/api/using-custom-schemas
- https://supabase.com/docs/guides/troubleshooting/postgrest-error-pgrst002-could-not-query-the-database-for-the-schema-cache-c396e9
