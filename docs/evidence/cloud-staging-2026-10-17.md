# Homologação sintética na nuvem — 17/10/2026

Escopo: projeto Supabase Free compartilhado `jgdebcmiklqajhbeniri`, somente
`capital_web3` e `capital_web3_private`; portal de homologação sintética, sem
clientes reais, IA paga ou execução financeira. Os dois usuários preexistentes
e os outros namespaces do projeto não receberam atribuições Capital.

## Implantação

- Data API: painel com `api`, `public`, `graphql_public` e `capital_web3`
  expostos; `capital_web3_private` não exposto. Após `NOTIFY pgrst` para recarregar
  configuração e schema, uma requisição anônima a `capital_web3` recebeu
  `401/42501`, e `capital_web3_private` continuou `406/PGRST106`.
- Edge `advisory-api` v2 ativa com `verify_jwt=true`; `GET /health` retornou
  `200` e `mode=synthetic-staging`. O runtime hospedado encaminha o caminho
  `/advisory-api/...`; o handler agora normaliza esse prefixo e o caminho
  completo do gateway. `ADVISORY_ALLOWED_ORIGINS` contém as duas origens
  HTTPS do portal: URL Sites e domínio personalizado, sem alterar os segredos das outras aplicações.
- Site v2 publicado. O domínio
  <https://capital.camaleaoweb3.com.br/> está ativo com SSL e aponta para o
  Site; a URL gerada é
  <https://capital-web3-staging.radarjacarepagua.chatgpt.site>.
  O repositório de origem do Site está em `bce454450956d3211843e69442bf36ed376b599e`.
  A versão empacota a configuração pública em `config.mjs` para carregar no
  ambiente Sites; não contém chave secreta ou token de usuário. A consulta
  atual ao Sites retornou `access_mode=public`. Esse estado
  de acesso não foi parte do fluxo de homologação descrito abaixo; a
  autenticação e autorização de dados continuam responsabilidade do Auth/RLS/API.

## Execução com Auth real

Três contas fictícias auto-confirmadas por administrador, sem envio de e-mail:
analista `f152e644-0005-4a74-92ec-07c4f82fbc24`, revisor/publicador
`45123adf-0718-409e-b24f-f528f9bd3fd9` e cliente
`848540e5-bbe3-4c55-b3ce-94c42a12f1bd`. Senhas aleatórias e JWTs foram
usados somente em memória da sessão de homologação, sem registro neste repo.

- `GET /rest/v1/advisory_cases` com JWT do cliente e
  `Accept-Profile: capital_web3` retornou `200 []` antes da atribuição.
  `GET /functions/v1/advisory-api/session` retornou `200` e o UID correto.
- Caso fictício `6db4c9ed-47d7-4db0-ba7d-c6fba45305b7`, versão
  `ecad4c75-d912-411b-83d8-ed032d47ea5e`, sem anexos. Antes da publicação,
  lista do cliente vazia e acesso ao objeto `404`. A sessão da equipe refletiu
  as atribuições do banco.
- Pacote de revisão retornou hashes de conteúdo/manifesto. Autor recebeu
  `404` ao tentar aprovar a própria versão; hash desatualizado recebeu `409`.
  Revisor independente aprovou e publicou para exatamente o cliente fictício;
  a lista e o download do cliente passaram a retornar `200`. Origem HTTPS
  permitida recebeu `200`; origem estranha recebeu `403`.
- No navegador, o cliente entrou, abriu o documento publicado e confirmou
  recebimento; a UI explicou que isso não aprova investimento. Repetição da
  RPC de recibo retornou `200`. A publicação
  `2a175d18-a0e2-456a-8bab-eb0455470157` foi revogada. Leitura e download
  novos receberam `404`, a lista ficou vazia e “Atualizar acesso” limpou o
  documento aberto.

## Limites antes de piloto com clientes

- A política atual do Sites é `public`; a afirmação anterior de acesso apenas
  pelo proprietário não descreve o estado atual. Uma página
  acessível não prova que contas de clientes estejam habilitadas a consultar
  casos. Acesso de clientes, convites, MFA, revogação estrita de sessões/JWTs
  e recuperação de contas não foram homologados.
- Cadastro público do Auth está **ativado** no projeto compartilhado, com
  confirmação de e-mail. Desativá-lo afetaria as outras aplicações; requer
  decisão de isolamento/autenticação antes de usar contas de clientes.
- O teste cloud não incluiu anexos no Storage, a aparência de relatórios longos,
  headers CSP/no-store do host nem cargas e limites de escala. A interface já
  bloqueia publicar pacotes com anexos, mas isso não substitui política no
  servidor. Não usar este resultado como autorização de piloto externo.
- O advisor de segurança sinaliza cinco RPCs `SECURITY DEFINER` executáveis
  por `authenticated` (intencional: cada RPC verifica papel/caso/identidade) e
  a tabela privada sem política RLS (intencional: sem acesso direto). Revisar
  novamente antes de produção. Referências:
  <https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable>
  e <https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy>.
