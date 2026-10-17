# COFRE Individual — contrato da implementação sintética

Escopo: sem clientes reais, campos livres de segredos, carteiras/endereço/saldo ou integrações pagas. Sem score numérico; controles declarados/observados/desconhecidos e falha crítica explícita.

## Intake fechado `cofre-intake-0.1`

`schema_version`, `synthetic:true`, `profile`, `consents`, `controls`, `inventory`.

- profile: objective=`organize|learn_defi|protect_family`; experience=`beginner|intermediate|advanced`; liquidity=`short_term|long_term|unknown`; loss_capacity=`essential|limited|discretionary|unknown`.
- consents: assessment/storage devem ser true; external_sources/notifications devem ser false (não implementados).
- controls: secret_exposure, backup_offline, recovery_tested, wallet_separation, device_updates, domain_checks, permissions_review. Cada controle: answer=`yes|no|unknown`, evidence=`declared|observed|unknown`. answer unknown exige evidence unknown; answer yes/no exige declared/observed. Observed significa revisão humana declarada, não verificação automática.
- inventory: 0–12 itens fechados com category=`exchange|vault|apps|spending|watch`, network=`bitcoin|evm|other|unknown`, custody=`self|third_party|unknown`. Sem nomes, endereços ou saldos.

## Rotas

- GET /cofre/workspaces → {data:[{workspace_id,workspace_label,user_id,display_name,member_role}]}; roster administrativo de pessoas fictícias, visível somente a staff ativo da mesma workspace.
- POST /cofre/cases → body {workspace_id,client_user_id,idempotency_key}; RPC advisory_create_cofre_case retorna {case_id} e atribui analyst (ator) + reviewer/publisher de roster no mesmo workspace e cliente escolhido.
- GET /cofre/cases/:id/intake → {data:row|null}, staff atribuído somente. Row {case_id,revision,intake,...}.
- POST /cofre/cases/:id/intake → body {intake,expected_revision,idempotency_key}; validateCofreIntake() + buildCofreReport(intake,asOf) no backend; RPC advisory_save_cofre_intake(p_case_id,p_intake,p_content,p_expected_revision,p_idempotency_key) cria revisão imutável e rascunho. Retorna {case_id,revision,report_version_id}. O relatório é proposta do autor, nunca aprovação. Casos novos podem ser criados somente por roster preprovisionado.
- Mesmas rotas atuais de revisão/publicação/receipt/revogação.

## Relatório `cofre-report-0.1`

`report_kind:cofre_individual`, `mode:synthetic`, title, summary, as_of, status (`blocked|needs_input|ok`), data_quality, profile, inventory, controls, findings [{id,title,severity,evidence,impact,action}], plan [{priority,action,owner,deadline,verification}], limitations, alternatives, next_steps, sources, human_review. Sem selo/nota de segurança. rule_version versiona regras. critical exposure sempre bloqueia e orienta fluxo de incidente. Unknown não é controle atendido. Retorno legível e imprimível; JSON técnico somente disclosure de staff.

## Separação de arquivos

Agente engine: supabase/functions/advisory-api/cofre.ts e tests/test_cofre.mjs. Agente UI: apps/staging/* e testes UI próprios. Root: handler API, migration SQL, SQL tests, CI/build. Agente revisão: leitura de segurança e documentação de gates; não editar arquivos compartilhados sem combinar.
