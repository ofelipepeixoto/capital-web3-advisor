# Acesso no domínio oficial — 17/10/2026

## Publicação comprovada

- Repositório `ofelipepeixoto/capital-web3-advisor` já público; histórico completo
  e árvore corrente inspecionados na revisão de segurança. Nenhuma mudança de
  licença foi feita. A publicidade do código não concede acesso aos diagnósticos.
- Portal público: <https://capital.camaleaoweb3.com.br/>. O endereço Sites
  anterior serve a mesma publicação; não houve migração entre bases.
- PR #15, código `72acd94e6e73dcaf0183525e3fa80c4c8127cb83`, sobre #14.
- Migração `20261017211950_cofre_auth_controls.sql` aplicada no projeto Free
  compartilhado, somente em objetos Capital. Workspaces existentes e novos
  exigem MFA da equipe. Configurações globais de Auth não foram alteradas.
- Edge `advisory-api` v5 ativa, `verify_jwt=true`.
- Site v4 publicado; fonte `c84e2b65428f80597627316cd52091dbb742801f`,
  deployment `appgdep_6ad3ec17cd8881919e46394e2e776ef5`, sucesso.
- Interface oficial carregada no navegador, com entrada habilitada e aviso de
  homologação sintética. Recuperação por e-mail explicitamente desabilitada.

## Validação executada

[CI 39071947350](https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/39071947350)
aprovada nos três jobs, para o código acima. Inclui `make check`, suites SQL
com rollback, Auth/PostgREST/Storage reais descartáveis, 110 asserções de
integração e Chromium: 13 da entrega anterior, 15 da jornada COFRE e 10 de MFA.
O transporte Edge no ensaio local usa a ponte para o handler real; não é o
runtime Edge hospedado. Convite e recuperação trocam tokens locais reais,
sem envio de e-mail.

O cadastro TOTP inicialmente falhou por dois motivos corrigidos: a CLI
descartável desabilita TOTP por padrão, e o SVG real de GoTrue possui prólogo
XML/comentário SVGo. O teste configura somente o Auth descartável; o módulo
normaliza SVG limitado para imagem, sem inserir markup no DOM. O limite de
documento é 1 MiB, imagem codificada até 3 MiB + 64; envelope HTTP permanece
2 MiB. HTML, conteúdo ativo e referências externas são recusados.

No Auth hospedado, seis verificações confirmaram matrícula TOTP, leitura do QR,
cancelamento explícito somente do novo fator não confirmado e logout.
Depois da publicação, **18 verificações hospedadas** passaram com uma conta
nova inteiramente fictícia:

1. Senha produz AAL1; requisito MFA é informado sem revelar roster.
2. AAL1 não lê roster nem cria caso da equipe.
3. Cadastro TOTP real; código incorreto recusado, código correto produz AAL2.
4. AAL2 confirma identidade no Auth e recebe somente seu workspace.
5. Caso fictício criado; revisão 1 salva e rascunho não aprovado lido.
6. Token AAL1 antigo não herda autorização após o upgrade.
7. Logout encerra a sessão; API, RPC de acesso e Data API direta recusam o token.

Caso de ensaio: `86c348ca-aeaa-408f-a45b-e04fc5827d74`.
Versão: `9c75ccf7-0570-4e24-8287-7dd6a142a7ec`, não publicada.
Os quatro papéis temporários foram desativados; nenhuma sessão temporária
restante foi encontrada na limpeza. Usuários e fator fictícios são preservados
para auditoria; credenciais foram descartadas, sem publicação em Git/logs.
Nenhum fator das contas já existentes foi cadastrado ou removido pelo agente.

## Preservação e avisos

Fingerprint do catálogo/políticas fora dos schemas Capital antes/depois:
`2bdc710e7dd5bf06e53de8408f5039fa`. É uma verificação do catálogo observado,
não uma prova sobre todo o conteúdo das aplicações vizinhas.

O advisor de segurança continua sinalizando cinco tabelas privadas Capital com
[RLS sem política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
deliberadamente sem grants de runtime, e nove RPCs guardadas
[SECURITY DEFINER autenticadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
As RPCs mantêm autorização, sessão e MFA, search_path fixo e testes negativos.
A [proteção global contra senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
do Auth compartilhado continua desabilitada; não foi alterada nesta entrega.

O HTML inclui CSP com origem Supabase exata e `data:` somente para imagens.
Leitura HTTP pública não encontrou CSP/HSTS/X-Frame-Options/Referrer-Policy
como headers. A meta CSP não implementa proteção contra framing ou HSTS;
esses controles de hospedagem continuam pendentes.

## Atualização após autorização do titular

`Save URLs` foi executado e a lista de cinco entradas foi conferida na interface:
`https://capital.camaleaoweb3.com.br/` acrescentada, quatro URLs anteriores
preservadas e Site URL `https://radardisruptivo.com.br` mantida. Essa ação não
comprova entrega de e-mail.

## O que permanece pendente

- Testar remetente/SMTP, templates, expiração e ida/retorno com e-mail autorizado.
  Helpers implementados e CI local não comprovam entrega hospedada.
- Pessoas reais configuram seus próprios autenticadores e recebem papéis
  administrativos explícitos. Procedimento humano de recuperação de MFA pendente.
- Retenção/descarte e exportação, pipeline de anexos, recuperação isolada do banco
  hospedado, headers/limites/carga e revisão jurídica/comercial antes de dados reais.
  A [PR #16](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/16) acrescenta
  ensaio SQLite e prévia read-only de retenção, sem executar descarte hospedado.
- `main` não contém a stack completa. PRs seguem para revisão humana; CI e
  revisão de agentes não a substituem. Não houve merge nesta entrega.

Continua exclusivamente sintético, sem IA paga, e-mails enviados, automações
n8n ativas, custódia, assinatura ou execução financeira.
