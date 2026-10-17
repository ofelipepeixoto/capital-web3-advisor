# Operação e dados — preparação em 17/10/2026

## Decisão executável desta camada

O portal no domínio oficial continua em homologação **exclusivamente sintética**.
Este pacote acrescenta um ensaio real de restauração das filas/orçamentos locais,
uma consulta somente de leitura para revisar retenção e decisões concretas para
operação, anexos e revisão comercial. Não afirma restauração do Supabase hospedado,
não faz descarte, não cria assinatura/convite nem envia mensagens a clientes.

Código público, página pública e dados privados são controles diferentes. A
implementação atual do COFRE exige login, sessão ativa, vínculo e publicação;
`synthetic_only=true` continua obrigatório. A revisão humana para merge/produção
permanece no `AGENTS.md`. Preparar esta camada não libera dados reais.

## Registro de execução

| Entrega | Evidência | Limite |
|---|---|---|
| Restauração SQLite | `python3 scripts/rehearse_local_restore.py`: 11 verificações aprovadas | Stores reais de budget/jobs com fixture; nenhum dado do Supabase |
| Retenção | `scripts/retention_preview.sql`, executado no projeto autorizado em `READ ONLY` e `ROLLBACK`; zero candidatos com mais de 30 dias | Prévia somente; sem exportação/descarte ou agendamento |
| n8n | Inventário de ferramentas sem operação n8n; pesquisa de plugins `n8n` retornou lista vazia | Nenhuma conexão/importação/execução/ativação comprovada |
| Anexos | COFRE permanece com uploads/manifestos de assets negados no servidor | Pipeline de bytes ainda não implementado |
| Jurídico/comercial | Minuta de decisões e aceite abaixo | Titular e profissional habilitado ainda precisam revisar |

### Reproduzir o ensaio local

```sh
python3 scripts/rehearse_local_restore.py
```

O script usa somente a biblioteca padrão e os módulos reais `BudgetLedger`,
`DurableJobQueue` e `SignedWebhookVerifier`. Não aceita caminhos, URLs ou
credenciais. Cria e remove seu diretório temporário, copia SQLite pela API de
backup consistente e verifica integridade/FKs. Não copia somente o arquivo
principal enquanto ignora o WAL.

As 11 verificações cobrem integridade, totais, reserva pendente, uso já despachado
que deve permanecer reservado, exclusão de escritas posteriores ao snapshot,
idempotência de job, nonce de webhook persistido, recuperação de lease, bloqueio
do worker antigo, arquivo adulterado e recusa a sobrescrever destino existente.
Não há chamada externa ou worker conectado ao provedor. Um SHA-256 detecta
alteração contra um manifesto confiável; não autentica sozinho um backup
comprometido junto com seu manifesto. Os arquivos temporários não são backup
persistente, criptografado, externo ou de produção.

## Retenção e descarte: minuta com parâmetros explícitos

Valores **propostos para decisão**, sem prazo legal presumido e sem cron/purge
automático. A aplicação ainda não tem `closed_at`, registro de impedimento de
descarte ou exportação administrativa completa; portanto idade sozinha nunca
autoriza exclusão. Exclusão de conta Auth não é exclusão do caso e pode afetar
outras aplicações no projeto compartilhado.

| Classe | Proposta de produto | Condição antes de descarte |
|---|---|---|
| Fixtures COFRE | Revisar após 30 dias sem atividade; excluir somente após encerramento confirmado | Responsável confirma ausência de teste/revisão em andamento; ensaio de descarte aprovado |
| Dados de caso real | Revisar 90 dias após encerramento, prazo definitivo a aprovar | Finalidade, obrigações contratuais, pedidos pendentes e impedimentos conferidos |
| Metadados mínimos de segurança | Proposta: 180 dias, sem corpo de relatório, tokens, OTP ou anexo | Acesso restrito e prazo aprovado pelo responsável; não confundir com prova contratual |
| Registros de entrega/revisão | Prazo definitivo em aberto | Avaliação comercial/jurídica da evidência necessária e minimização de identificadores |
| Backup de aplicação | Proposta: 7 cópias diárias + 4 semanais, criptografadas fora do provedor | Destino/custo/responsáveis aprovados; expiração inclui cópias e réplica |
| Evidência pública de CI | Manter só fixture/manifesto; artifact atual de 7 dias | Revisão de ausência de credencial, e-mail real, HAR, token ou diagnóstico real |

`retention_preview.sql` seleciona somente casos de workspaces explicitamente
sintéticos, considerando a última atividade de coleta, revisão, publicação,
revogação, recibo e conversa. Retorna IDs e datas, sem conteúdo ou identidade.
Um resultado significa **revisar**, não significa que a linha pode ser apagada.
Prazos definitivos precisam entrar em configuração versionada aprovada antes
da implementação de qualquer descarte.

A execução somente de leitura em 17/10/2026 retornou `[]`, sem candidatos no
prazo proposto. Isso comprova a consulta e seu resultado atual; não comprova
que o descarte já existe, que um prazo foi aprovado ou que haverá execução futura.

### Procedimento a implementar antes de dados reais

1. Abrir solicitação com identidade verificada e escopo de **um** workspace/caso;
   registrar finalidade, responsável e identificador de atendimento, sem copiar
   dados para issue pública.
2. Suspender novos trabalhos e publicações do caso; registrar impedimentos de
   descarte. Revogar entrega pelo fluxo de domínio quando apropriado.
3. Gerar prévia de dependências/contagens e exportação íntegra de coleta,
   versões, decisões e comprovantes permitidos. Proteger destino e manifesto;
   conferir quem pode receber a exportação.
4. Ensaio em cópia isolada: ordem por FKs, triggers append-only, relatório de
   resíduos e negativos de acesso. Não remover triggers, desabilitar RLS ou
   fazer `db reset` no projeto compartilhado para facilitar exclusão.
5. O responsável aprova o manifesto exato. Um executor administrativo limitado
   aplica somente a operação aprovada, com idempotência e prova sem payload.
6. Verificar aplicação, Storage, caches e backups; manter registro mínimo do
   descarte e impedimentos, com seu próprio prazo aprovado. Na restauração,
   reaplicar a lista de exclusões/revogações **antes** de reabrir acesso.

Não há comando de DELETE remoto neste pacote. Um executor de descarte exige
revisão separada porque remove dados e enfrenta histórico append-only.

## Restauração do COFRE hospedado: gate ainda aberto

A [documentação oficial de backups do Supabase](https://supabase.com/docs/guides/platform/backups),
consultada em 17/10/2026 pela busca nativa, recomenda exportação regular e cópias
externas no Free. Backup de Postgres inclui metadados de Storage; **não inclui
os bytes dos objetos**. Nenhum PITR, plano pago ou backup automático foi
contratado/assumido nesta camada.

**Metas propostas**, ainda não medidas: RPO de 24 horas e RTO de quatro horas
para piloto pequeno. A meta só pode ser aceita após um ensaio que registre
horários, volume, dependências e perda tolerada. O ensaio SQLite não mede essas
metas para Supabase/COFRE.

### Manifesto mínimo de recuperação

| Componente | Incluir | Evitar |
|---|---|---|
| Dados Capital | `capital_web3` e `capital_web3_private`, schema/grants/policies/functions, versões e hashes | Dump indiscriminado de aplicações vizinhas |
| Identidades | Mapeamento dos UUIDs referenciados e procedimento Auth coordenado | Passwords, refresh tokens ou sessões em artifact público; recriar UUID ao acaso |
| Sessões | Revogação e novo login após recuperação | Restaurar sessão antiga como se ainda fosse autorizada |
| Storage | Inventário e bytes somente do bucket Capital, hash e MIME de cada objeto | Presumir que metadados de Postgres restauram o arquivo |
| Código | SHA da Edge, migrações e versão/commit Sites, CORS e flags públicas | Segredos dentro do arquivo de código ou `.env` em Git |
| Configuração protegida | Referências a segredos, responsáveis e cofre externo | Registrar o valor do segredo no manifesto |
| Disposições posteriores | Lista de revogações, exclusões/impedimentos e alterações de papel após a cópia | Reativar destinatários/papéis revogados ao restaurar snapshot antigo |

### Ensaio hospedado/isolado a executar

1. Selecionar destino isolado: Supabase descartável loopback já usado na CI, ou
   outro destino autorizado. **Não restaurar sobre o projeto compartilhado**.
2. Fixar versão das ferramentas e SHA da aplicação; verificar compatibilidade
   de Postgres/CLI. Usar credencial de backup somente por configuração protegida.
3. Exportar exclusivamente o escopo Capital de uma fonte de teste. O contexto
   Auth é dependência separada: preservar os UUIDs necessários sem coletar
   contas/sessões vizinhas. Metadados/grants de Storage devem ser ensaiados
   separadamente. Hashes e contagens ficam em manifesto sem conteúdo.
4. Restaurar em destino vazio, conferir integridade/FKs e igualdade das
   contagens/hashes de versões. Sessões exportadas não devem conceder acesso.
5. Provisionar sessões novas de operadores fictícios e executar os negativos
   de RLS/colunas, ausência de roster, outro workspace, `aal1` com MFA exigido,
   revisão independente, versão/hash, revogação e download.
6. Confirmar que exclusões/revogações posteriores à cópia foram reaplicadas.
   Comparar catálogo de vizinhos na origem antes/depois: nenhuma alteração.
7. Guardar evidência sanitizada, tempos observados e decisão GO/NO-GO. Desligar
   o destino descartável e eliminar credenciais temporárias conforme sua política.

**Falta para executar esse gate:** destino isolado disponível, responsável e
destino criptografado da cópia, acesso de exportação protegido e decisão sobre
recuperação de Auth compartilhado. A sessão local não tem Docker/psql; o script
SQLite não foi apresentado como substituto de um restore COFRE. A simples
existência de uma cópia ou de uma receita não comprova recuperação.

## Anexos: manter bloqueado até a implementação dos bytes

O COFRE atual aceita opções e categorias; anexo não é necessário para validar
essa utilidade. Não liberar o bucket ou a UI somente porque há tabela de
manifestos. O pipeline mínimo para a futura camada é:

1. Autorizar o caso, a finalidade e o papel antes da ingestão; vínculo derivado
   da sessão, nunca do nome de arquivo, URL, modelo ou metadata do cliente.
2. Upload para quarentena privada, com limite **proposto** de 5 MiB por arquivo,
   dez por caso e 20 MiB por caso. Quotas devem ser atômicas no servidor e
   aprovadas conforme o Free compartilhado, sem assumir capacidade reservada.
3. Validar extensão, MIME informado e assinatura real dos bytes. Inicialmente
   PDF, texto UTF-8 e JSON com schema fechado; negar executáveis, HTML/SVG,
   arquivos compactados, PDF cifrado/ativo e formato ambíguo. Verificação de
   malware/conteúdo e sanitização exigem serviço/local operacional comprovado.
4. Não buscar URL arbitrária nem processar OCR/IA automaticamente. Dados do
   arquivo são conteúdo não confiável; não ganham comandos ou autoridade.
5. Depois de validar, calcular hash/quantidade real de bytes e gravar objeto
   imutável com nome opaco. Manifesto e decisão humana vinculam exatamente
   conteúdo, versão e bytes aprovados. Nunca sobrescrever objeto aprovado.
6. Download autenticado revalida sessão, destinatário e publicação; verifica
   bytes/hash e emite como attachment com MIME seguro. Evitar URL assinada
   quando revogação imediata for requisito; se houver, documentar TTL e limite.
7. Testar substituição após review, quota concorrente, tipo falso, arquivo
   malformado/cifrado, acesso cruzado, anexo revogado e descarte/restauração.

Esses números e a allowlist são **especificação proposta**, sem upload liberado
ou malware scanner implantado. Arquivos já baixados não podem ser recolhidos
por revogação no servidor.

## Minuta comercial e informações ao usuário

As decisões abaixo são preparadas para revisão do titular e do profissional
responsável pelo enquadramento do serviço. Não são contrato final nem conclusão
de enquadramento regulatório; não foi criado CNPJ, preço, prazo de resposta,
canal de privacidade ou representante fictício.

| Campo da oferta/política | Texto/decisão proposta | Informação ainda necessária |
|---|---|---|
| Serviço inicial | Diagnóstico assistido COFRE Individual com relatório revisado | Razão social/identificação do prestador e responsável |
| Entrega | Versão identificada, data, evidências declaradas/observadas, lacunas e próximos passos | Prazo de entrega, rodadas de esclarecimento, critérios de aceite |
| Limites | Sem custódia, segredo, assinatura, ordem financeira, promessa de retorno ou certificado de segurança | Revisão do escopo real e das mensagens de venda; eventual registro/enquadramento aplicável |
| Decisão do cliente | Leitura e recebimento não são aprovação de estratégia nem autorização para transação | Termos de aceite do serviço e processo de suporte |
| Dados | Finalidade de diagnóstico e entrega privada, minimização e controles de acesso | Responsável por privacidade, canal, bases/finalidades e terceiros autorizados |
| Consentimentos | Separar avaliação, armazenamento, fonte externa e notificação | Texto definitivo versionado e tratamento de retirada |
| Retenção | Prazos desta minuta são propostas; versões de política precisam acompanhar o caso | Prazos aprovados, impedimentos e procedimento de exercício de direitos |
| Preço/cancelamento | Não definido por código ou diagnóstico | Preço, pagamento, reembolso/cancelamento e obrigações das partes |
| IA/terceiros | IA paga, fontes externas e notificação continuam desligadas | Provedores, custos, contratos de dados e autorização específica |

Antes de dados reais, esses textos aprovados devem aparecer no onboarding e no
contrato correspondente; guardar versão e aceite no servidor. Checkbox genérico
não completa esse trabalho. Não publicar dados pessoais/contatos ainda não
confirmados em issue pública ou no repositório.

## Operadores e rotina proposta

| Papel | Responsabilidade | Situação |
|---|---|---|
| Titular do produto | Aprovar oferta, limites, responsáveis e prazos | Titular existe; aprovação dos campos acima ainda necessária |
| Responsável por privacidade | Solicitações, retenção, impedimentos e descarte | Pessoa/canal ainda não confirmados |
| Operador técnico | Backup, recuperação, logs mínimos, revogação emergencial | Nome e suplente a indicar |
| Revisor independente | Conferir evidências e aprovar versão exata | Roster fictício testado; pessoas reais/convites e MFA dependem da camada de identidade |
| Apoio jurídico/comercial | Revisar serviço, instrumentos e comunicações | Responsável e parecer ainda não informados |

Rotina sugerida para aprovação: revisão diária do status de backup e erros sem
payload; revisão semanal de membros ativos e cópias; ensaio mensal isolado de
restauração e revisão de capacidade. Não há agendamento criado por este
documento. Incidente: bloquear novas publicações/coleta, preservar evidência
mínima, revogar membros/sessões afetados, conferir escopo e acionar responsáveis;
comunicação externa depende de decisão e canal confirmados.

## n8n: pronto para preparar, conexão ainda não comprovada

A skill selecionada foi lida com os módulos de conexões/workflows/operação. Ela
não expõe SSH nem MCP n8n por si. A descoberta desta sessão não encontrou ação
n8n nativa; a pesquisa de plugins retornou `plugins: []`. Não foi usada uma
conexão Hermes de outro projeto e nenhuma VPS compartilhada foi alterada.

Os cinco templates existentes continuam `active=false`, sem credenciais,
scheduler, HTTP, e-mail ou publicação. `tests/test_workflows.py` verifica esse
limite. Para transformar em operação, falta o endereço **exibido pela instância
escolhida** para conexão oficial MCP/API e autorização protegida correspondente;
não pedir chave/senha em chat nem inventar endpoint de memória.

Primeiro fluxo recomendado após conexão: trigger manual → obter status de uma
publicação fictícia por API com escopo → produzir preview interno com chave
idempotente. Conferir versão da instância/nodes e falhas. Nenhum e-mail/WhatsApp
é necessário para provar esse fluxo. Só acrescentar notificação após destinatário,
canal, consentimento e autorização de envio explicitamente confirmados. IA paga
continua bloqueada até orçamento persistente conectado e aprovado.
