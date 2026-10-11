# Homologação técnica e liberação do piloto

Escopo: console interno Capital Web3 e entrega privada de diagnósticos revisados.
Esta etapa usa somente fixtures sintéticas. Não inclui execução financeira.
O prompt privado de referência não foi copiado para este repositório.

## Camadas entregues

| Camada | Execução e limite |
|---|---|
| Domínio e cálculos | Python; NAV/dívida, concentração, stress, IL e CLAMM |
| Revisão/publicação SQL | Auth.uid e atribuições DB; separação de autor; conteúdo e manifesto congelados; transações e idempotência |
| API autenticada | Handler de Edge Function; getUser no Auth; mesmo JWT no PostgREST/RPC, sem service role |
| Orçamento e jobs | SQLite persistente, default zero, reservas, leases, retries e nonce HMAC; integração externa pendente |
| Portal | Chromium contra servidor loopback sintético; isolamento, download, revogação e transições de sessão |
| Supabase descartável | CLI 2.120.0, migrations geradas pela CLI, suites SQL rollback e logins/Storage reais no runner |

As suites SQL testam políticas com claims sintéticas dentro da transação.
O runner HTTP adicional faz login no Auth real e usa JWT real em PostgREST e
Storage. O handler Node usa o mesmo código da Edge Function; isso ainda não
comprova deploy no gateway Deno, MFA, convites ou sessão de produção.

## Executar e revisar

`make check` usa Python 3.11+ e Node 24 e não chama serviços externos.
Os jobs `browser-homologation` e `supabase-homologation` da CI executam serviços
descartáveis. A instalação Chromium é dependência de teste; nunca usa um perfil
assinado do consultor. As origens da aplicação são restringidas ao loopback.

O status privado da CLI e as credenciais dos usuários de teste ficam somente
no runner, fora de Git e artifacts. Artifacts do navegador contêm PNG e
manifestos sintéticos; não incluem JWT, HAR ou traces de autenticação.
A CI encerra o stack e remove status e logs privados, inclusive se falhar.

## Registro de execução

Regressão local em 2026-10-11: 83 testes Python, 7 cenários DOM e 31 contratos
HTTP aprovados, sem skips. Revisão independente corrigiu exclusividade do RPC
de recibo, deadline de corpo HTTP e restauração tardia da sessão.

Primeira execução real do commit `3c5dba3cf65cdd24825b3e33770266dcbad3a0bf`:
[CI](https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/38108155076).
As duas migrações foram aplicadas no Supabase descartável. A suíte SQL parou
no GRANT do alias `pg_temp`; ambas as suites passaram a usar o nome real do
schema temporário. O Chromium executou 4/5 cenários; o helper aguardava apenas
HTTP, antes de terminar o refresh da UI. Foi corrigido para aguardar a ação.
Essas falhas não foram contabilizadas como homologação aprovada.

Resultados finais, commit e links da execução após correções serão registrados
após a CI.
Uma suite preparada ou um teste com mock não satisfaz o gate de execução real.

## Gates restantes antes de clientes reais

| Gate | Dependência |
|---|---|
| Revisão humana | PRs em ordem; nenhum merge automático |
| Staging privado na nuvem | Projeto dedicado; consulta de custo/provisionamento indisponível no conector desta sessão; projetos existentes preservados |
| Identidade de produção | Edge gateway deployed, issuer/audience/expiry, MFA, convites, invalidacão de sessões e ACL sob testes |
| Portal conectado ao backend | Frontend com Auth real, sem personas; testes E2E atravessando Edge+Auth+Storage |
| Arquivos e revogação | Pipeline de objetos imutáveis/endereço por conteúdo; verificar bytes no download; política para arquivos já baixados e signed URLs/TTL |
| Evidências financeiras | Consentimento, fontes permitidas, timestamps, validação semântica e retenção/exclusão |
| OpenAI paga | Projeto/chave no cofre, modelo/custo verificados e orçamento aprovado; adapter permanece bloqueado |
| n8n | Instância/versão, integração de credenciais, webhook/queue e cinco fluxos reais testados; templates inativos |
| MCP remoto | OAuth, audience/scopes, TLS, proteção SSRF e interoperabilidade com cliente real |
| Operação | Backups/restauração, métricas sem dados sensíveis, incidentes e reversão ensaiados |

Homologação técnica descartável não libera produção nem equivale a certificação
de segurança ou adequação financeira. Revogação bloqueia novos acessos; arquivos
já baixados e signed URLs dentro de seu TTL exigem política específica.
