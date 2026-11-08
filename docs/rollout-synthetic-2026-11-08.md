# Capital Web3: roteiro técnico de implantação e reversão

Preparado em 08/11/2026. Leitura e planejamento; não foi efetuada qualquer alteração no banco, na Edge ou no Site.

## Referências de estado observadas anteriormente

As informações abaixo foram registradas em 08/11/2026 e devem ser verificadas novamente imediatamente antes de qualquer intervenção; não são prova de backup ou homologação.

- Projeto compartilhado `jgdebcmiklqajhbeniri`, plano Free, `ACTIVE_HEALTHY`, Postgres 17.6.1.166, coexistindo com outros serviços.
- Site público no domínio oficial, versão 6, fonte `b86f2dbc55c52300b066e83b4126a3d7e132b146`. A versão salva é `appgprj_6ad3cccfaacc8191aed9f65accad685c~appgver_587e2fd903088191bc8eaece3c88c7d5`.
- `advisory-api` versão 5, `verify_jwt=true`, SHA256 `0c5676bb503511d4c676508a1b4a0e6895feca8ecfb57a9beb531fa5806cc189`. Arquivos fonte v5 são recuperáveis pelo conector de Edge. O corpo `buildCofreReport` da v5 comparado com PR36 é idêntico. Isso não comprova compatibilidade de toda a implantação.
- Consulta read-only de catálogo constatou ausência das tabelas `capital_web3_private.cofre_partial_intakes`, `capital_web3_private.cofre_lite_signals` e da função `capital_web3_private.cofre_canonical_report(jsonb,text)`.
- `capital_web3.advisory_save_cofre_intake` continua executável por `authenticated`. O comportamento de gerar conteúdo adulterado foi reproduzido anteriormente em banco descartável; não implica aprovação indevida ou vazamento entre clientes e não comprova exploração hospedada.
- Não há branch de desenvolvimento Supabase registrada. O projeto é compartilhado: nenhum reset ou restore global pode ser tratado como reversão restrita ao Capital.

## Pacote candidato da PR #44

Este roteiro é uma proposta para o head `08e63da25d19db6ef476f049ee4f59d1b29c0123` da [PR #44](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/44). Em 08/11/2026 ela estava em rascunho e sem revisão humana registrada. A [CI desse commit](https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/42512810182) passou em três trabalhos. Isso não prova implantação ou compatibilidade em produção. Se o head mudar, refazer hashes, testes e revisão. Não confundir este roteiro com o pacote anterior da PR #36.

Os seis arquivos abaixo estão em `supabase/pending`, não são migrations registradas. A ordem abaixo é a ordem executada pela CI verde deste head em banco descartável; não demonstra que o banco compartilhado esteja pronto para recebê-los. SHA256 dos conteúdos nesse commit:

1. `cofre_partial_intake.sql`: `3d46186abccd83e250885f1ca6abc39e1d57f86517cbf61a17d6266c95733005`.
2. `cofre_canonical_report.sql`: `c11d8251b8145359f238e9e27628f342f9ad6d943e168f2a75bb33a6316be415`.
3. `cofre_lite_signals.sql`: `bd182bcaf7a39e703652c41efb3d62e3434116f200a465e878bbd5a038465a41`.
4. `cofre_lite_intake_v02.sql`: `3f620c623e3438e8092cb3e68199f40044eef94114f5656e71c195cf6a66f7b7`.
5. `cofre_lite_report_v02.sql`: `ceac893399d74aac3bc8ee68ebbd7688fd1165e8991dbc4b45cd6d5a047b7950`.
6. `cofre_lite_eligibility.sql`: `0082dfa6e72b756cd93cbf99c7e8cce5e85cd27bdb027e0d197fede57f37f91c`.

Antes de qualquer aplicação, verificar estado efetivo e dependências no destino, revisar cada SQL e criar migrações rastreáveis com timestamps únicos, conteúdo e hashes conferidos. Ensaiar a sequência e sua reversão ou contenção em cópia isolada representativa. Não prosseguir com divergência ou objeto pré-existente sem revisão de migração aditiva e backfill. O teste CI usou bridge para a Edge: publicar a Edge real e sua comunicação permanecem sem homologação.

## Condições para iniciar alteração hospedada

1. Registrar revisão humana do conjunto exato, incluindo segurança, permissões, migrações, escopo sintético e rollback. O `AGENTS.md` exige revisão humana antes de merge ou produção. Autorização de execução do titular já existe; uma autorização genérica não comprova revisão técnica feita.
2. Conferir head e CI integrada verde, status, URLs/capabilities, histórico de migrações e comparar novamente o catálogo do banco. Se qualquer objeto dos seis arquivos já existir, parar e preparar migração aditiva com backfill; não reaplicar CREATE como se fosse instalação limpa.
3. Guardar cópias de source/manifest do Site v6 e da Edge v5, seus hashes, configuração pública e flags. Confirmar capacidade real de redeploy. Nunca registrar chaves ou tokens em Git ou mensagens.
4. Fazer backup consistente do banco compartilhado e verificar restauração em ambiente isolado, além dos dados de Storage que devam ser preservados. A documentação do Supabase informa que backups automáticos diários são para planos Pro/Team/Enterprise e recomenda exportação própria no Free. O restore integral no projeto original substituiria dados de outras aplicações. O usuário não autorizou gastos adicionais; cotar novos serviços ou branches antes de contratá-los.
5. Executar testes de migração e reversão no mesmo estado de banco que será alvo, com identidades fictícias. A CI usa uma Edge transportada por bridge e não prova deploy Edge real.
6. Checar security advisor e comparar itens dos schemas Capital antes e depois. Cinco tabelas privadas sem políticas aparecem como INFO intencional em padrão de acesso somente via funções; nove funções SECURITY DEFINER aparecem como WARN e devem ser revistas individualmente. Não criar políticas genéricas como resposta automática.

## Sequência proposta em homologação sintética

1. Usar CLI oficial descoberta via `--help` para gerar migrations sequenciais com timestamps únicos a partir dos SQLs aprovados; validar conteúdo/hash, transações, lock/timeout e histórico. CI fixa Supabase CLI 2.120.0; v3 introduziu mudanças no alvo padrão. Não atualizar ferramentas silenciosamente.
2. Aplicar somente em ambiente autorizado, seguindo a ordem dos seis arquivos registrada acima e após validar compatibilidade e dependências no estado de destino. Os controles parcial e Lite nascem desligados. Não ativar nenhum caso a validação falhe. Verificar presença dos objetos, `RLS` e `FORCE RLS`, grants diretos ausentes para tabelas privadas, privilégios mínimos e switch off via chamada direta de RPC. Repetir testes de isolamento das funções e comparação do estado dos demais schemas.
3. Aplicar a proteção canônica mantendo a revisão/publicação independente. Testar que um analista atribuído não possa adulterar o relatório chamando a Data API; testar requisição legítima, idempotência/replay, timestamps, MFA, cliente, equipe e outro caso. A Edge v5 tem gerador com corpo idêntico, mas testar efetivamente comunicação com a RPC e relógio antes de confiar na compatibilidade.
4. Implantar Edge nova com `verify_jwt=true`, sem ativar `COFRE_PARTIAL_ENABLED`, e sem alterar os demais serviços. Testar sessão, caso existente, geração normal e CORS nos dois endereços previstos. A ausência do atributo de capability na Edge antiga deve ser tratada pelo frontend novo como desabilitada.
5. Empacotar o Site a partir do source exato submetido, salvar versão e implantar preservando público/domínios. Com o progresso parcial desligado, conferir que casos continuam abrindo e mensagem não promete salvamento; testar exercícios sintéticos no papel adequado, além de login, logout e relatório. Não usar dados de pessoas reais.
6. Habilitar progresso parcial primeiro no DB e depois na Edge apenas após as verificações. Ativar Lite por workspace sintético explicitamente selecionado; não habilitar para todos por padrão. Validar também o ciclo do intake v0.2, elegibilidade do relatório, versão antiga e prevenção de regressão para o fluxo legado; as decisões de retenção e limite dos recibos são pré-condições para dados reais. Testar post/get via Edge e chamada direta com flag off/on, recusas para cliente/analista externo, consentimentos, CAS 200/409, replay, logout, revogação, timeout, rascunho obsoleto e retomada em nova sessão.
7. Atualizar evidências com versão real implantada, hora, hashes e resultado sanitizado. Conferir que despesas, Auth compartilhado, RLS e demais funções não foram alterados; não chamar provedores pagos nem enviar e-mail sem destinatário autorizado.

## Reversão sem apagar informações

1. Desabilitar Lite no workspace sintético; o lock na tabela de flags permite aguardar operações já aceitas. Novas leituras/escritas diretas devem ser negadas após o commit do desligamento. A operação em voo já autorizada pode terminar antes de a desativação ser confirmada.
2. Desabilitar `partial_enabled` no banco e depois remover/desligar `COFRE_PARTIAL_ENABLED` da Edge; verificar capability false e RPC direta bloqueada. Preservar parciais. Se houver parcial salva, o canônico bloqueia nova finalização até a reconciliação; explicar que as respostas continuam preservadas. Evitar reverter para frontend anterior que apresente conteúdo antigo como finalizado.
3. Caso necessário, republicar Site v6 e redeploy dos arquivos originais da Edge v5, com `verify_jwt=true`, somente após testar compatibilidade. O Site/Edge anteriores não devem ser apresentados como correção canônica. A correção de integridade no DB deve permanecer aplicada; retornar à RPC anterior de forma rotineira reabre o vetor de adulteração.
4. Se não for possível manter canônico seguro, há contenção separada que revoga EXECUTE, mas ela também paralisa criação de todos os relatórios COFRE. Adotar somente como plano de incidente deliberado, comunicando indisponibilidade; ela não apaga relatórios.
5. Não reverter isoladamente o intake v0.2, os relatórios ou a verificação de elegibilidade sem estudar dependências, revisões, snapshots e bloqueios de versão; preservar tabelas, receipts e migrations. Evitar remover dados. Hash de receipt não é criptografia; a retenção e a capacidade de 1.000 recibos parciais / 128 Lite por pessoa exigem política antes de dados reais. Restore global exige plano próprio para todas as aplicações e pode causar perda de alterações posteriores.

## Fontes

- https://github.com/ofelipepeixoto/capital-web3-advisor/pull/44
- https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/42512810182
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/changelog?types=breaking-change
- https://supabase.com/changelog/cbc-tls-ciphers-deprecated
