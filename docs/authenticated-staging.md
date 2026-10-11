# Portal autenticado para homologação sintética

`apps/staging` conecta uma interface separada ao Auth Supabase e à API existente.
Não hospedar `apps/web` nem o servidor Python de demonstração como portal privado.
A tela de staging não contém seletor de personas, IA paga ou operação financeira.

## Fluxo implementado

1. Conta previamente cadastrada entra por e-mail/senha no Auth do projeto.
2. A API verifica Auth e resolve atribuições no banco sob o JWT do usuário.
3. Cliente lista versões autorizadas, lê, baixa JSON mediante nova autorização
   e confirma recebimento pela RPC com bloqueio transacional.
4. Equipe abre o pacote exato, confere o documento e confirma sua leitura antes
   de aprovar/rejeitar. O servidor exige revisor independente do autor.
5. Publicação exige seleção explícita de destinatários ativos daquele caso e
   validade futura. Nenhum destinatário é pré-selecionado.
6. Equipe revoga indicando motivo. Atualizar acesso limpa o documento anterior
   antes de consultar novamente suas permissões.

A aprovação vem da RPC, nunca do texto do relatório. `/cases/{id}/recipients`
usa o JWT sob RLS; clientes não recebem a lista de outros membros. A tela exibe
IDs de conta; nomes amigáveis permanecem melhoria de UX. Limites atuais: 100
versões/publicações e 50 destinatários; paginação fica pendente antes de escala.

**Anexos:** esta tela bloqueia aprovação/publicação de pacotes com anexos até
existir conferência dos bytes/hashes de todos os arquivos. A RPC mantém seu
contrato anterior; bloqueio visual não é uma política de servidor. Revogação
continua disponível. Não interpretar manifesto como arquivo efetivamente lido.

## Sessão e navegador

- Access token somente em memória; refresh token não é mantido. Sem cookies de
  login, localStorage, sessionStorage ou restauração automática de sessão.
- Recarga/saída/expiração limpa documentos. Prazo é o menor entre `expires_in`
  e uma hora; a API continua verificando todas as requisições.
- Respostas atrasadas não atravessam troca de conta. HTTP 401 encerra acesso local.
- Logout limpa memória antes de chamar Auth. Falha do provedor não é anunciada
  como revogação confirmada no servidor.
- Sair do Auth não invalida necessariamente um JWT emitido antes de expirar.
  Validação de `session_id`, revogação estrita, MFA/AAL2, convites, recuperação
  de conta e limites de login são gates ainda pendentes antes do piloto.
- Conteúdo usa `textContent`, sem HTML executável ou URLs carregadas pelo documento.
- Download verifica autorização novamente. Revogação não apaga arquivos baixados
  nem atualiza automaticamente a tela já aberta; use Atualizar acesso.

## Configuração e bundle

Pré-requisitos: Supabase dedicado, Auth, migrações revisadas, API Edge implantada
e origem HTTPS final. Definir no ambiente de build:

- `CAPITAL_PORTAL_ORIGIN`: origem HTTPS exata da interface.
- `CAPITAL_SUPABASE_URL`: URL HTTPS do projeto dedicado.
- `CAPITAL_SUPABASE_PUBLIC_KEY`: chave publishable ou anon legado.

Executar `node scripts/build_staging.mjs`. Gera `dist/staging/public/` e
`dist/staging/Caddyfile`; **não implanta**. Rejeita placeholders, service-role,
chaves secretas e destinos arbitrários. Somente configuração pública vai para
`config.json`. `config.example.json` é um modelo desativado.

Servir somente a pasta `public`. Configurar `ADVISORY_ALLOWED_ORIGINS` na Edge
com a origem HTTPS exata. Aplicar os headers do Caddyfile no runtime escolhido:
CSP restritiva, no-store, no-referrer e bloqueio de framing. Caddy é uma opção
de configuração; instalação/versão e compatibilidade Sites/Hostinger não foram
validadas. O hosting deve oferecer acesso privado adequado; este bundle não
configura SSO ou proteção da página estática por conta própria.

Desabilitar cadastro público no Auth para homologação; usar identidades fictícias.
Não apontar para bancos de outros projetos. HTTP local só é aceito quando a página
está em 127.0.0.1 e Auth na porta fixa 54321. O builder aceita apenas HTTPS.

## Verificação

- `make check`: regressões Python/DOM/API e testes de sessão do novo transporte.
- CI `supabase-homologation`: SQL/HTTP existentes mais Chromium com login real,
  revisão/publicação por RPC, cliente A/B, download, recebimento e revogação.
- `tests/browser/staging_supabase.mjs` substitui somente o transporte Edge ainda
  não implantado por uma ponte ao handler real em Node. Auth/PostgREST/SQL são
  reais, locais e descartáveis. Não testa runtime Deno, gateway Edge na nuvem,
  TLS/CSP do hosting, MFA ou configuração de produção.
- Não registrar HAR, traces ou respostas Auth. Evidências incluem apenas dados
  fictícios, screenshot sem sessão e manifesto resumido.

## Dependências em 11/10/2026

`get_cost` continua retornando UNAVAILABLE no conector Supabase. Não há projeto
dedicado na conta consultada. Provisionamento depende de cotação/confirmação
válida no provedor; os bancos existentes não foram alterados. OpenAI paga, n8n,
MCP remoto, Sites e Hostinger dependem de configuração e homologação próprias.
Não há liberação para clientes reais.

Fontes oficiais consultadas em 11/10/2026:

- https://supabase.com/changelog (a versão `.md` não foi recuperada pela pesquisa).
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword

Mudanças de PAT/adapters do changelog não mudam este transporte sem SDK.
Upgrades de Postgres devem ser revisados na implantação.

## Revisão e reversão

Base: `feat/homologation-evidence`, incluindo PR #9 de contexto do diagnóstico.
Ordem: transporte/testes → tela → endpoint de destinatários → teste integrado
→ builder. Reverter remove a tela e endpoint auxiliar; nenhuma migração nova,
recurso remoto ou dado real é criado. Revisão humana antes de merge/implantação.
