# Contenção temporária de integridade COFRE

## Risco comprovado por inspeção; reprodução em CI pendente

A RPC `capital_web3.advisory_save_cofre_intake` é executável por `authenticated` e aceita `p_content`. Ela valida partes do envelope, mas não gera nem compara integralmente findings, plano, resumo e fontes. Um analista devidamente atribuído pode chamar a Data API diretamente e submeter conteúdo fabricado. Isso não é evidência de vazamento entre clientes ou de aprovação sem revisão; é quebra da garantia de cálculo determinístico na geração.

`cofre_authorization.sql` registra uma reprodução sintética dentro de savepoint e desfaz seus efeitos. `report_integrity_guard.sql` aplica o script de contenção numa transação, testa negação da função ao papel `authenticated` e comprova rollback. São testes para Supabase descartável na CI, ainda não executados até resultado do workflow.

## Contenção proposta e impacto

`scripts/security/disable_forged_cofre_reports.sql` revoga EXECUTE de PUBLIC, anon, authenticated e service_role da função exata. Verifica privilégios efetivos e falha se houver grant herdado. A operação preserva relatórios existentes e leituras, mas **suspende a geração de todos os novos relatórios COFRE**, inclusive pela Edge, pois ela usa o JWT do usuário. A mensagem atual do portal poderá ser genérica. O script não está implantado.

Não lançar a contenção como se fosse uma correção sem impacto. O fluxo Edge também precisa de uma mensagem clara, e os operadores precisam saber que a geração está indisponível. Criar rascunho parcial em armazenamento separado não resolve a integridade do laudo.

## Para migrar com segurança

1. Desenvolver uma fronteira confiável: reconstruir/verificar integralmente o relatório em função protegida no banco, ou usar assinatura verificável produzida somente por serviço com segredo protegido. Vincular assinatura a caso, identidade, revisão, chave idempotente e documento; testar replay e expiração. Não confiar em hash fornecido pelo navegador nem em segredo no cliente.
2. Exercitar testes diretos com conteúdo alterado, versões de regra, concorrência, cross-tenant, revogação e envio legítimo; testes de regressão das jornadas e avaliação de segurança independente.
3. Planejar migração transacional e reversão num ambiente descartável, inventariar grants e roles efetivos, testar integridade e disponibilidade do portal e restaurar apenas com nova fronteira segura. Gerar migração com CLI oficial, sem registrar valores secretos no Git.
4. Somente após esses controles e revisão humana, considerar alterar configuração hospedada. Nenhum banco, papel ou configuração hospedada foi modificado nesta entrega.

## Rollback

O teste usa `ROLLBACK`. Em ambiente real, registrar grants antes de qualquer alteração. Não restaurar EXECUTE da função antiga como rollback de rotina: reativa a vulnerabilidade. A reversão segura é encaminhar para implementação confiável testada; se restabelecer acesso anterior for necessário em emergência, explicitar aceitação de risco e limitar o período após revisão humana. A operação não apaga versões ou evidências existentes.
