# Capital Web3 — avaliação de segurança antes de clientes reais

Data: 17/10/2026. Escopo: revisão de código, documentos, catálogo mínimo do
Supabase e higiene do repositório público/histórico. Não é aprovação humana de
merge, parecer jurídico ou autorização para inserir dados reais. Esta revisão
não alterou cloud, contas, políticas ou arquivos de implementação.

## Conclusão

O percurso **sintético** COFRE tem evidência suficiente para continuar a
homologação no domínio oficial. Há controles relevantes no banco: identidade
verificada, roster e atribuição, sessão corrente, revisão independente por hash,
destinatário explícito, revogação e proteção de colunas internas. Isso não
conclui a preparação operacional de um serviço com clientes reais.

A próxima fatia técnica adequada é **acesso com MFA, recuperação e aceitação de
convite no mesmo portal**, mantendo casos exclusivamente sintéticos e anexos
desativados. Em paralelo, preparar restauração com fixtures e o procedimento de
dados/retenção. A habilitação de clientes reais precisa de decisões concretas
do titular e revisão do escopo jurídico/comercial; não se resolve retirando o
aviso de homologação ou trocando um booleano no navegador.

## 1. Estado observado e limites da evidência

### Hospedado e documentado antes da nova camada Auth

Referência: [evidência COFRE](evidence/cofre-individual-2026-10-17.md),
[estado do projeto](current-state-2026-10-17.md) e código da PR #14.

- Site v3 no domínio `https://capital.camaleaoweb3.com.br`, página pública;
  documentos dependem de Auth/RLS/RPC. Edge v4 com verificação de JWT.
- CI `39068252716`, candidato `2c46388079fd06a99af04e446b70562994ac6ab7`,
  registra banco/Auth/Storage reais descartáveis e Chromium. Smoke hospedado
  separado: 16 verificações de API e sete da Data API direta.
- O catálogo cloud consultado nesta revisão continha **dois workspaces, ambos
  `synthetic_only=true`, nenhum com `staff_mfa_required=true`**. Esse é um
  snapshot anterior à eventual implantação da nova camada Auth.
- Intake exige `synthetic:true`, opções fechadas e consentimentos de teste;
  não há suporte aprovado a dados reais, endereços/saldos ou anexos COFRE.
- Os acessos temporários de smoke foram encerrados conforme o manifesto. As
  contas antigas foram preservadas. Esta revisão não leu senhas ou tokens.

### Candidato em implementação durante esta revisão

Foram inspecionados `apps/staging/auth-controls.mjs`,
`auth-controls-ui.mjs`, transporte `client.mjs`, a migração
`20261017211950_cofre_auth_controls.sql` e
`tests/integration/auth_controls_e2e.mjs`. Esses arquivos adicionam a capacidade
de Auth; sua presença não comprova integração final, execução dos novos testes,
headers do host ou implantação.

O candidato prepara enrollment/challenge TOTP, upgrade AAL2, senha por link de
convite/recuperação, remoção imediata do fragmento da URL, respostas genéricas de
recuperação e requisito de acesso sem revelar roster. A migração prepara MFA
obrigatório para staff, sem mudar a configuração global de Auth do projeto.
Após a conclusão, registrar novo SHA, CI, versão Edge/Sites e smoke em evidência
própria; não atribuir esses resultados à CI COFRE anterior.

## 2. Higiene do GitHub público e histórico

Metadado GitHub confirmou `visibility=public`, branch padrão `main`. Foram
buscadas todas as heads remotas sem reset/rebase/alteração da árvore de trabalho.
O clone inicial usava `blob:none`; o fetch completo terminou com **zero objetos
ausentes** antes da inspeção.

| Item | Cobertura desta verificação |
|---|---:|
| Refs locais/remotas | 18 |
| Commits alcançáveis | 42 |
| Objetos alcançáveis | 417 |
| Blobs históricos examinados | 190 |
| Arquivos atuais examinados no snapshot do scan | 96 |
| Candidatos de segredo com os marcadores examinados | 0 |
| Nomes históricos de `.env` privado, chave ou banco local | 0 |

Foram procurados marcadores de chaves privadas, tokens GitHub/OpenAI/Supabase,
Stripe live, identificadores AWS e JWTs com papel `service_role`, sem imprimir
valores encontrados. Nenhum candidato de alta confiança apareceu. Essa busca
por padrões **não prova ausência universal de segredos**, não verifica seed
phrases por todos os dicionários e não substitui análise de artefatos externos,
logs, forks ou credenciais que estejam fora do Git.

Existe um JPEG histórico, removido do head, em
`docs/evidence/images/cofre-live-draft-2026-10-17.jpg` (59.247 bytes). O OCR
identificou relatório fictício, sem e-mail, marcador de token ou sequência
detectada de seed. Não há evidência de segredo que justifique reescrever o
histórico. Evitar futuros screenshots de enrollment MFA, OTP, senha ou
fragmentos Auth; QR TOTP contém um segredo mesmo numa conta de teste.

O checker atual `scripts/check_repository.py` é explícito sobre seu limite:
verifica estrutura, tipos de arquivo, JSON e workflows inativos, mas não cobre
o histórico nem todos os formatos de token. Recomenda-se acrescentar ao CI
verificação de segredos com saída mascarada e fixtures negativas. Exceções
devem reconhecer valores sintéticos específicos, sem ignorar toda a pasta de
testes. Nenhum segredo deve ser posto em issues, PRs ou mensagens de falha.

## 3. Achados e critérios de liberação

### REL-01 — MFA precisa ser concluído no servidor e pelo titular do fator

**Estado:** lacuna confirmada no snapshot hospedado; candidato técnico em
implementação. **Prioridade:** alta antes de acesso da equipe a dados reais.

O guard SQL COFRE suporta AAL2, mas os workspaces hospedados observados ainda não
o exigiam. A nova UI precisa primeiro completar TOTP e verificar novamente a
sessão no servidor antes de carregar dados. O código não deve remover fatores
verificados, converter recovery de senha em recuperação de MFA ou guardar QR,
segredo TOTP e refresh token em storage do navegador.

**Aceitação técnica:** login AAL1 não lê casos/roster da equipe; código inválido
não emite sessão; verificação real TOTP produz AAL2; o JWT AAL1 antigo continua
negado; logout e retirada do papel bloqueiam Edge e Data API/RPC direta. Os
negativos de papel duplo continuam necessários.

**Ação humana necessária:** cada pessoa da equipe cadastra o próprio autenticador
e mantém a posse do fator. O agente não cadastra seu próprio fator em nome de
outra pessoa. Definir responsável e procedimento de recuperação de MFA antes
de usar contas reais.

**Rollout:** a migração exige MFA nos workspaces existentes. Site antigo sem
challenge fica incompatível durante a transição; publicar SQL/Edge/UI no mesmo
procedimento e testar com fixture. Rollback deve preservar uma UI capaz de MFA:
voltar apenas ao Site v3 pode bloquear contas que já tenham fator verificado.

### REL-02 — Convite, recuperação e vínculo de cliente são controles distintos

**Estado:** fluxo visual/contratos candidatos; envio e jornada no domínio ainda
exigem homologação própria. **Prioridade:** alta antes do onboarding real.

O transporte prepara recuperação para o endereço canônico exato, sem redirects
arbitrários e sem revelar existência de conta pela mensagem do portal. O link
fica apenas em memória após ser removido da URL. Aceitar um convite ou definir
uma senha não pode conceder papel, workspace ou acesso a um caso.

**Aceitação:** convite/recuperação de conta fictícia, token de uso único,
token errado/consumido recusado, conta do token consistente, senha antiga
recusada após troca, e conta recém-convidada sem roster continua sem casos.
Verificar callback e links no domínio oficial. Demonstrar recuperação de senha
não demonstra revogação de todo JWT previamente emitido nem recuperação de MFA;
tratar essas verificações separadamente.

**Decisões do titular:** pessoas que serão convidadas e seus papéis, responsável
por aprovar convites e canal de suporte. Envios reais a terceiros precisam de
destinatários e autorização explícitos. Não foi autorizado envio por este
relatório. O Auth é compartilhado: não desligar signup, trocar SMTP/site URL ou
apagar identidades dos outros produtos para adequar a Capital.

### REL-03 — Sessão COFRE está melhor protegida; legado e recuperação exigem recorte

**Estado:** controles COFRE verificados nas evidências existentes; garantia
universal de sessão não demonstrada. **Prioridade:** alta para dados reais.

O token vive em memória, a UI limpa documentos e o SQL verifica `session_id`
contra a sessão corrente. Helpers centrais também consultam roster por papel.
O efeito cobre casos mapeados ao COFRE; não deve ser generalizado aos casos
legados por analogia. O primeiro piloto deve usar somente a nova trilha
explicitamente protegida, com os casos sintéticos/legados reconhecidos como tal.

Antes do piloto, repetir os negativos com JWT real: logout, sessão removida,
papel desativado, cliente de outro caso e RPC DEFINER direta. Revogação não
recupera cópias já baixadas nem apaga a memória de outro dispositivo que já
mostrava o relatório. Uma nova leitura/impressão/download deve revalidar acesso.

### REL-04 — Dados e retenção ainda precisam de política executável

**Estado:** política proposta, sem prova de procedimento de exportação/descarte.
**Prioridade:** alta antes da coleta real.

Opções categóricas reduzem coleta, mas tornam-se dados de uma pessoa quando
vinculadas à sua identidade. Consentimentos do ensaio não substituem o texto e
o registro versionados do serviço real. Roster, intake, relatório, notas e
auditoria precisam de finalidade, responsáveis e tratamento distintos.

**Pode ser preparado agora:** inventário de campos, exportação por caso e
workflow administrativo de solicitação de descarte com registro de decisão,
todos ensaiados com fixtures. Não executar purge automático nem relaxar
triggers append-only para resolver FKs sem política definida.

**Exige titular/jurídico:** entidade responsável e contato, finalidade/escopo,
prazo de retenção de cada classe, tratamento de solicitações, base contratual e
obrigações de preservação. Nenhum prazo legal ou conformidade foi presumido.
Depois dessas decisões, implementar descarte/anonimização seletivos e testar
referências, backups e restauração. Não apagar o usuário Auth compartilhado
como substituto de descarte de um caso.

### REL-05 — Anexos podem continuar excluídos do primeiro piloto

**Estado:** COFRE rejeita assets e decisões com anexos no banco.
**Prioridade:** manter essa proteção; pipeline é gate para habilitar a função.

Um piloto que não oferece anexos pode avançar sem construir upload. Se o escopo
exigir documentos, homologar antes: tamanho/tipo/bytes, nomes seguros, inspeção,
hash, escrita única, bucket privado, autorização corrente e revogação do
download. Manifesto não comprova que bytes tenham sido verificados. Backup de
banco inclui metadados de Storage, não os arquivos em si.

### REL-06 — Recuperação de dados não foi demonstrada por restauração

**Estado:** lacuna confirmada na evidência consultada. **Prioridade:** alta para
uma operação que prometa preservar diagnósticos de clientes.

Há CI descartável e fingerprints de preservação de vizinhos; isso não é backup
restaurável. No Free, preparar exportação lógica delimitada à Capital e cópia
privada protegida, sem criar outro projeto pago. A primeira prova pode ocorrer
em Docker/CI com fixtures: exportar registros, restaurar numa instalação vazia,
conferir versões/hashes/vínculos e repetir autorização/revogação.

O procedimento precisa contemplar FKs de Auth, credenciais e configurações sem
copiar segredos para artefatos públicos. Não usar restore global, `db reset` ou
DROP no projeto compartilhado. RPO/RTO e o destino da cópia são decisões do
responsável; depois devem ser medidos num ensaio.

### REL-07 — Domínio oficial e headers precisam da configuração efetiva do host

**Estado:** domínio/TLS documentados; política completa de headers ainda não
comprovada nesta revisão. **Prioridade:** média antes de dados reais.

O Caddyfile gerado declara CSP/no-store/no-referrer/frame protection, mas gerar
esse arquivo não comprova aplicação pelo Sites. Conferir os headers reais e
todos os bundles/rotas de callback. Scripts e links de produto devem usar o
portal canônico; o host Sites técnico continua um alias do mesmo app.

O QR candidato é exibido como imagem `data:image/svg+xml`, nunca como markup.
A CSP anterior `img-src 'self'` o bloquearia. Permitir `data:` somente para
imagens ou servir uma imagem por rota segura, sem afrouxar `script-src`.
Capturas de aceitação devem ocorrer depois que o segredo de enrollment foi
removido. Não carregar QR por serviço externo.

### REL-08 — Auth compartilhado e código fora do main pedem operação explícita

**Estado:** fatos confirmados por arquitetura e GitHub. **Prioridade:** alta
antes da liberação real; não bloqueia implementação/teste já autorizados.

Namespaces não separam servidor Auth, chaves administrativas e quotas. É preciso
revisar o efeito de identidades novas sobre políticas das aplicações vizinhas;
os testes de vizinho fictício não auditam todas as policies reais. Um cliente
Auth recém-criado não deve receber privilégios em outro produto por uma policy
genérica `authenticated`.

As PRs #1–#7, #10 e #12–#14 são dependentes e continuam abertas; #9/#11 foram
integradas nas respectivas bases. `main` não contém a stack completa. Publicação
do Site e deploy Edge não equivalem à revisão humana dessa integração.
Consolidar diffs, resolver reviews existentes e conferir CI de cada integração.
AGENTS.md exige revisão humana antes de merge/produção; este parecer de agente
não satisfaz esse requisito. A decisão pode ser tomada sobre PRs concretas,
sem pedir novamente autorização para trabalho técnico já concedido.

## 4. Próxima fatia técnica mínima e critérios de conclusão

| Ordem | Entrega possível agora | Critério verificável |
|---|---|---|
| 1 | Integrar controles Auth no portal oficial | UI não abre dados antes de AAL2; sessão/conta conferidas pelo servidor |
| 2 | Testar TOTP, convite e recuperação fictícios | Auth real descartável + callback/domínio; sem segredo em artifacts |
| 3 | Publicar candidato técnico com rollback compatível | SQL/Edge/Sites identificados por versão; smoke sintético completo |
| 4 | Exibir estado e limitações do ambiente com clareza | Usuário entende que ainda não pode inserir dados reais |
| 5 | Preparar exportação/restauração seletiva | Dados/hashes/ACL recuperados em ambiente vazio e isolado |
| 6 | Preparar política e solicitação de dados | Campos/finalidades/operador/prazos pendentes explicitados para decisão |

Manter OpenAI paga, n8n com envio, MCP remoto, carteiras/endereço/saldo e anexos
desligados nesta fatia. Esses recursos não são necessários para comprovar
acesso e entrega seguros. O plano de Investidor Avançado e Empresa Web3 segue
com seus próprios contratos de dados e riscos.

## 5. O que precisa do titular antes de um piloto real

1. Aprovar escopo comercial e jurídico do serviço e materiais mostrados ao
   cliente; responsáveis e limites devem corresponder ao que o produto faz.
2. Definir pessoas/contas da equipe, destinatários autorizados e processo de
   convite/recuperação; cada staff completa o próprio MFA.
3. Definir política de dados, retenção e atendimento; revisar o texto informado
   ao cliente antes de tornar a trilha capaz de receber dados reais.
4. Escolher destino/responsável de backup e objetivos de recuperação, e avaliar
   o compartilhamento de Auth com os demais produtos do projeto.
5. Fazer a revisão humana exigida para integração/liberação, sobre diffs e
   evidências concretos. Não é necessário refazer a autorização de implementar.

## 6. Limitações e referências

Nesta revisão não foram executados ataques, carga, envio de e-mail, enrollment
MFA cloud, purge ou restore. Os testes novos de Auth estavam sendo integrados;
nunca são apresentados aqui como já aprovados. A busca no Git é por padrões e
o OCR do JPEG é uma inspeção limitada, sem promessa de segurança total.

Documentação oficial consultada em 17/10/2026:

- [MFA TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp).
- [Sessões e logout](https://supabase.com/docs/guides/auth/sessions).
- [Redirects Auth](https://supabase.com/docs/guides/auth/redirect-urls).
- [Privilégios por coluna](https://supabase.com/docs/guides/database/postgres/column-level-security).
- [Backups](https://supabase.com/docs/guides/platform/backups): exportação para
  Free e limites distintos entre banco e bytes de Storage.
- [Admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser):
  capacidade administrativa no servidor, sem chave administrativa no navegador.

O índice Markdown do changelog não foi aceito pelo leitor; a versão
[HTML](https://supabase.com/changelog) foi consultada. Documentação oficial
explica mecanismos; configuração e eficácia continuam dependendo dos testes.
