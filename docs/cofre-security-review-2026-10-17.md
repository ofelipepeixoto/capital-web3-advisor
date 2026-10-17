# COFRE Individual — revisão de segurança e integração

Data: 17/10/2026. Escopo: implementação sintética autorizada, revisão de código
e leitura de metadados/reviews do GitHub. Não é autorização para clientes reais.
Não foram alterados Auth global, DNS, dados vizinhos ou recursos remotos nesta
revisão. Não houve merge, aprovação humana simulada ou chamada paga.

## Decisão proporcional

Prosseguir com a jornada sintética e sua verificação. A página pública pode
apresentar o produto e o login; cada caso e versão continuam privados sob
Auth/RLS/RPC. Publicar a página não publica um relatório. Os critérios abaixo
para dados reais não são uma nova exigência de aprovação para o ensaio fictício
já autorizado. Revisão humana antes de merge continua sendo regra do AGENTS.md.

O contrato `cofre-intake-0.1` é deliberadamente fechado: somente opções e até
12 categorias de inventário, sem endereço, nome de carteira, saldo ou texto
livre. O relatório registra controles informados, evidência declarada e lacunas;
não fornece selo de segurança, score financeiro ou operação de carteira.

## Fronteiras verificadas

| Fronteira | Controle esperado | Limite |
|---|---|---|
| Navegador → Edge | Auth verificado, origens exatas, corpo limitado, erro sem eco de entrada | CORS não autoriza objetos e não impede cliente HTTP direto |
| JWT → PostgREST | RLS e grants por linha/coluna | Interface/Edge não são a única entrada para um JWT válido |
| Staff → caso | Roster administrativo + atribuição ativa; ator por `auth.uid()` | Metadata de Auth e parâmetros de usuário não criam papéis |
| Intake → rascunho | Opções fechadas e regras versionadas, revalidadas no banco | Rascunho não equivale a aprovação |
| Rascunho → entrega | Revisão independente, hashes exatos, destinatários explícitos | Confirmação de recebimento não é autorização financeira |
| Sessão → conteúdo | Memória local, expiração, rechecagem no servidor | Logout local sozinho não revoga todo JWT já emitido |

## Achados e correções desta fatia

### SEC-01 — Projeção Edge não ocultava identidades internas na Data API

**Estado:** correção aplicada; suíte SQL aprovada na CI 39068252716. Implantação
e verificações cloud estão nas [evidências COFRE](evidence/cofre-individual-2026-10-17.md).
**Severidade:** média; destinatário autenticado podia correlacionar UUIDs de
autores/publicadores em linhas publicadas. Não é evidência de vazamento público
ou acesso ao diagnóstico de outro cliente.

`0001_advisory.sql` concede SELECT da tabela inteira a `authenticated`, enquanto
RLS permite ao destinatário ler suas linhas de `advisory_cases`,
`advisory_reports`, `advisory_report_versions` e `advisory_publications`.
Um request PostgREST direto pode escolher `created_by`, `publisher_user_id` e
`human_review_id`, mesmo que a Edge omita esses campos. A conversa também pode
expor `advisory_clarifications.author_user_id` de respostas da equipe.

Preparada `supabase/migrations/20261017202946_client_safe_columns.sql`: retirar SELECT global e
conceder as colunas client-safe dessas cinco tabelas. As projeções Edge atuais
continuam compatíveis; o RPC de revisão mantém acesso pelo dono controlado.
`SELECT *` passa a falhar de propósito. Não mudam permissões de escrita nem
RLS. Teste: `supabase/tests/authorization_client_columns.sql`, transacional,
com cliente autorizado/externo, colunas negadas e pacote de revisão do staff.

**Risco residual:** aplicar só a Edge não corrige a Data API; a migração precisa
ser efetivamente aplicada e testada. Novas colunas sensíveis não devem ganhar
SELECT amplo por conveniência.

### SEC-02 — Regras do intake precisam existir também no SQL

**Estado:** correção implementada e verificada em SQL/HTTP/Chromium na CI; implantada na homologação.
**Severidade:** alta para integridade do diagnóstico se só a UI/Edge validar.

O papel autenticado pode executar RPCs diretamente. As grants legadas também
permitem ao analista criar/editar conteúdo de rascunho por PostgREST. A nova
fatia precisa bloquear essa escrita direta em casos COFRE e revalidar o intake
na RPC. Guard de trigger deve distinguir a chamada direta `authenticated` do
contexto do RPC controlado, sem confiar em flags fornecidas pelo navegador.

Na revisão da migração em construção foram apontados: comparações SQL que
aceitavam JSON null por lógica de três valores; diferença entre o objeto de
controles do intake e a lista legível do relatório; e necessidade de rejeitar
anexos no banco. O candidato recebeu correções e guard de escrita direta.
`supabase/tests/cofre_authorization.sql` cobre essas entradas e o percurso
autorizado; aprovação dos testes reais deve preceder uma alegação de eficácia.

**Validação:** JSON null em cada enum/version, chaves extras, segredo como campo,
`synthetic:false`, inventário acima de 12, consentimento ausente e escrita direta
de versão devem falhar sem persistência parcial. Nova revisão cria nova versão
e não reutiliza aprovação da anterior. Conteúdo continua proposta do autor.

### SEC-03 — Sessão e MFA exigem cobertura das rotas que contornam a Edge

**Estado:** guards COFRE implantados, com negativos de sessão/papel/MFA aprovados na CI. **Severidade:** alta
antes de dados sensíveis reais; risco limitado pelo uso exclusivamente fictício.

O transporte guarda access token em memória, descarta refresh token e limpa
documentos em logout/expiração. A Edge verifica `/auth/v1/user`. Isso não prova
revogação imediata do JWT em todas as entradas. A verificação COFRE de
`session_id` precisa alcançar leitura, revisão, publicação e RPCs DEFINER;
policies restritivas de quatro tabelas não cobrem sozinhas
`advisory_get_review_package` nem notas/recipients/auditoria de tabelas auxiliares.

O candidato agora centraliza o check COFRE nos helpers de staff/recebimento e
acrescenta policies restritivas nas tabelas vinculadas ao caso. O gate opcional
`staff_mfa_required` deve negar ações de equipe com `aal1`.
Uma conta que também tenha membership `client` não pode usar esse papel para
dispensar MFA da ação de reviewer/publisher. O candidato foi ajustado para que
staff com papel duplo também precise de MFA. Não foi homologado um fluxo visual
de enrollment, challenge, recuperação ou convites reais nesta revisão.

O helper de staff COFRE também exige papel ativo correspondente no roster e
atribuição ativa do caso. Desativar apenas `reviewer` deve impedir novo review e
seu replay mesmo se a pessoa continuar publisher/client; membership de cliente
não preserva atribuições de equipe retiradas do roster. A suíte inclui esses
dois casos além da remoção completa do membro.

**Validação:** JWT após remoção da sessão deve falhar tanto na Edge quanto em
PostgREST/RPC direto para conteúdo COFRE. Testar `aal1`, `aal2`, papel duplo,
roster inativo e atribuição de caso removida. Usar sessões fictícias.

### SEC-04 — Anexos permanecem desativados no COFRE

**Estado:** limitação confirmada. **Severidade:** alta se anexo real fosse
considerado conferido apenas pelo manifesto; sem exposição de anexo demonstrada.

A tela legada bloqueia pacotes com anexos, mas a RPC anterior aceita o manifesto.
Nesta fatia COFRE, rejeitar assets e decisões de pacotes com assets também no
banco. Não adicionar upload até haver limites de tamanho/tipo, inspeção dos
bytes e hash, escrita única, autorização de download e teste de revogação.
URLs assinadas e arquivos já baixados têm limites diferentes de uma leitura
autenticada atual; revogação não recupera cópias existentes.

## Auth compartilhado e contas

`capital_web3`/`capital_web3_private` segregam objetos da aplicação, mas não
criam um segundo serviço Auth. Cadastro, e-mail, chaves administrativas, cotas
e recursos continuam compartilhados com outras aplicações do projeto.

- Manter cadastro público global e configurações de vizinhos sem alteração
  automática. O roster fechado do COFRE deve negar por padrão qualquer conta
  Auth que não tenha vínculo administrativo ativo.
- Provisionar apenas nomes e contas fictícios para este ensaio; a abertura
  de caso seleciona um cliente já vinculado e não cria convites por conta própria.
- Antes de clientes reais: validar convite de uso único, confirmação da conta,
  expiração, recuperação e retirada de acesso; o convite não concede papel
  administrativo por texto ou metadata.
- MFA de staff deve ser aplicado no servidor às decisões e aos dados internos,
  com recuperação humana documentada. Não depender de um checkbox visual.

## Política de dados e retenção — proposta para implementação

Esta seção define decisões de produto a implementar; não declara conformidade
jurídica nem um mecanismo de descarte que ainda não existe.

| Dado | Proposta para o ensaio | Antes de cliente real |
|---|---|---|
| Intake/inventário | Opções fictícias e mínimo necessário; sem texto livre | Definir finalidade, campos necessários e informação ao titular |
| Consentimentos | Versão e respostas imutáveis no intake | Registrar texto/versão, finalidade e fluxo de retirada; checkbox não é política completa |
| Relatórios | Versões exatas para destinatários explícitos | Definir prazo e tratamento de cópias/downloads |
| Auditoria | IDs/eventos necessários; sem corpo de diagnóstico, tokens ou senhas | Definir responsável, acesso e prazo compatível com a operação |
| Evidências de teste | PNG/manifesto sintético sem JWT/HAR/Auth response | Revisar artefatos antes de torná-los públicos |
| Descarte | Dono revisa fixtures ao fim da homologação; sem purge automático nesta entrega | Procedimento testado de exportação, retenção e descarte, respeitando dependências e backups |

Os triggers append-only preservam decisões e histórico. Remover um usuário Auth
ou uma linha não é um procedimento de retenção e pode violar FKs ou afetar outro
produto. Descarte deve selecionar os objetos da Capital, registrar a operação
necessária e ser ensaiado com fixtures. Não apagar schemas nem usar `db reset`
no projeto compartilhado. Recuperação exige teste de restauração, além da
existência de cópia. Nenhum prazo legal foi presumido nesta revisão.

## Negativos necessários para fechar a jornada

| Cenário | Resultado esperado |
|---|---|
| Anon, Auth sem roster e Auth de aplicação vizinha | Sem criação/leitura de COFRE |
| Cliente alterando workspace/case/user IDs | Nenhum novo vínculo ou acesso cruzado |
| Analista escrevendo conteúdo COFRE direto em PostgREST | Negado; usar RPC de intake |
| Campos extras, enum null, segredo, endereço e conteúdo não sintético | Rejeitados na API e SQL |
| Cliente lendo intake ou private_notes | Negado |
| Cliente solicitando UUID interno por coluna ou wildcard | Negado, conteúdo publicado explícito continua legível |
| Autor aprovando/publicando o próprio rascunho | Negado pelo banco |
| Outro revisor, hash antigo ou nova versão com aprovação anterior | Negado |
| Retry idêntico e mesma chave com payload alterado | Mesmo resultado ou conflito, sem duplicação |
| Revisão concorrente do intake | Conflito de revisão; nenhuma versão parcial |
| Anexo COFRE por caminho direto | Negado no banco |
| JWT pós-logout em RPC DEFINER/PostgREST | Conteúdo COFRE negado |
| `aal1` com MFA obrigatório, inclusive papel duplo | Ação de staff negada |
| Revogação e atualização de acesso | Novas leituras/downloads negados e tela limpa |
| Texto hostil num relatório legado | Texto inerte, sem HTML ou URL executados |

## Sequência das PRs observada no GitHub

Consulta read-only realizada nesta revisão, antes da nova PR COFRE:

| PR | Base | Estado observado |
|---|---|---|
| #1 motor | main | Aberta |
| #2 console | feat/risk-engine | Aberta |
| #3 MCP/n8n | feat/private-advisory-demo | Aberta |
| #4 Supabase | feat/integration-contracts | Aberta |
| #5 RPC/Edge | feat/supabase-foundation | Aberta |
| #6 budget/jobs | feat/authenticated-human-workflow | Aberta |
| #7 evidências | feat/durable-budgets-jobs | Aberta; já contém merge #9 |
| #10 portal Auth | feat/homologation-evidence | Aberta; já contém merge #11 |
| #12 cloud | feat/authenticated-staging-portal | Aberta em rascunho |

#9 e #11 foram mescladas nas respectivas feature branches, não em `main`.
As reviews consultadas não contêm APPROVED humano; comentários do bot e CI
verde não substituem revisão. Há threads marcadas não resolvidas: concentração
com sentinel `unclassified`, overflow UTC, corrida de logout local, metadados
MCP initialized, identidades internas, deadline de cancelamento, entregas
revogadas e diretório de build com arquivos antigos. A coluna interna é tratada
por SEC-01. Algumas observações podem já ter correção parcial no candidato;
revalidar o diff final antes de resolvê-las ou declarar integração concluída.

Ordem segura: revisar e incorporar de #1 até #7, depois #10, #12 e COFRE,
reconferindo bases e CI após cada integração. Evitar squash que elimine
ancestralidade sem retarget/cherry-pick deliberado dos descendentes. Não mesclar
os PRs cegamente por serem mergeable. A alteração sintética já autorizada e a
integração humana em main são decisões distintas.

## Evidência e limites desta revisão

- Inspeção local de AGENTS, arquitetura, contrato, migrations, handler,
  transporte/browser e documentação; leitura remota de PRs/reviews/threads.
- Patch de grants e suítes SQL de colunas/COFRE preparados. Esta estação não dispunha de
  `psql`/Docker na checagem; nenhum teste SQL foi declarado aprovado aqui.
- Regras COFRE e UI estavam em implementação concorrente. O resultado final
  deve registrar o SHA testado e corrigir o estado dos achados conforme evidência.
- Não houve teste de invasão da nuvem, carga, fluxo de convite/MFA, recuperação
  de conta ou restauração. Sem CVE/CVSS atribuído por inferência.

## Referências oficiais consultadas em 17/10/2026

- [Privilégios por coluna](https://supabase.com/docs/guides/database/postgres/column-level-security): RLS controla linhas; revogar coluna não elimina grant global da tabela. Projeções explícitas são necessárias.
- [Sessões](https://supabase.com/docs/guides/auth/sessions): a verificação de `session_id` pode impor logout imediato em ações sensíveis, além da validade do JWT.
- [MFA](https://supabase.com/docs/guides/auth/auth-mfa): assurance no JWT precisa de autorização no servidor; UI de enrollment/challenge é uma parte separada.

Os links documentam mecanismos. Não comprovam a configuração efetiva do projeto
nem substituem os testes negativos acima.
