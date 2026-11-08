# Regras candidatas de COFRE Lite para homologação sintética

Este módulo é um componente puro de regras, sem endpoint, banco, tela ou implantação.
Não usa informações de cliente, não aprova a metodologia e não substitui a análise
humana. Não reproduz os arquivos privados enviados pelo titular. As referências são
à planilha COFRE Lite abas 01, 03 e 06 e ao documento COFRE Lite, seção 10.

- Anti-golpe: os dez sinais têm IDs fixos; quatro sinais da planilha são críticos.
  Sinal crítico bloqueia, três sinais exigem pausa; qualquer outro sinal exige revisão;
  resposta não avaliada nunca equivale a negativo. Nenhum resultado significa que
  uma interação é segura. A severidade é uma proposta sujeita a validação.
- Rotina: cobertura sobre tarefas aplicáveis e vencidas, incluindo não avaliadas.
  Aplicabilidade ou vencimento desconhecido impedem apresentar a razão como completa.
  Quem chama precisa determinar os vencimentos mensais, trimestrais ou de incidente;
  o módulo não agenda ou observa ações externas.
- Duas metodologias: `lite_sheet_10_v1`, dez itens binários de 10 pontos, e
  `lite_document_6_v1`, seis dimensões de pesos 20,20,15,15,15,15 com níveis
  intermediários de 10 e 8. São versões candidatas separadas, exigem escolha explícita,
  não emitem classificação, pontos parciais ou score enquanto não houver aprovação
  metodológica implementada no servidor. São autorrelatos, sem garantia de segurança.
- As duas classificações e faixas da origem divergem e continuam aguardando decisão
  do titular. Integração em fluxo real exige aprovação metodológica, modelagem de
  evidências, autorização no serviço, revisão humana e testes de isolamento.
- O cálculo não aceita um indicador de risco do chamador para liberar nota. A futura
  implementação deve derivar sinais críticos e exposição do caso autorizado no servidor
  e verificar aprovação metodológica auditável e vinculada à versão antes de calcular.
  A presença de todos os campos permite apenas informar cobertura, nunca segurança.
- Nunca solicitar seed, chave privada, OTP, senha de carteira ou passphrase.
