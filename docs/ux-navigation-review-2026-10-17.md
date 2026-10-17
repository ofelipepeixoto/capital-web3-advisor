# Capital Web3 — relatório de navegação e UX/UI

Data: 17/10/2026. Plugin aplicado: **Sênior UX/UI — Interaction Design — Produtos e Agentes de IA**.
Portal: https://capital.camaleaoweb3.com.br/
Implementação: [PR #17](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/17), sobre #15.

## Objetivo e método

Facilitar a localização de atendimentos, a revisão de respostas e a leitura dos
resultados, sem misturar os papéis de analista, revisor e cliente.

A revisão usou a estrutura real de `apps/staging`, inspeção do portal público em
Chrome desktop e viewport de 390 × 844, testes de interação DOM e regressões
Chromium sobre contas fictícias em Auth/PostgREST descartáveis. A inspeção manual
desta ampliação não usou credenciais de clientes nem alterou seus atendimentos.
A primeira rodada da PR já registrava inspeção de duas versões e entregou Site v5;
a ampliação acrescenta o questionário e a cobertura de regressão descritos abaixo.

**Natureza da evidência:** observação do login público e inspeção de código são
distintas de teste do fluxo autenticado. Não houve estudo com usuários reais,
medição de produtividade ou certificação de acessibilidade.

## Problemas e correções

| Prioridade | Problema e evidência | Correção entregue | Verificação |
|---|---|---|---|
| Alta | Código só renderizava criação quando nenhum caso estava aberto; faltava saída para um novo atendimento | Ação persistente **Novo atendimento**, disponível ao analista provisionado | Teste DOM de retorno à criação e separação da chave de uma nova operação |
| Alta | Uma nova saída do editor poderia perder respostas ainda não gravadas | Aviso com **Continuar preenchendo** ou descarte explícito; nenhuma gravação implícita | DOM e Chromium preservam o objetivo e a etapa ao cancelar a saída |
| Média | Oito etapas exigiam Voltar repetidamente para corrigir uma resposta | Mapa de etapas; atalhos apenas para etapas já alcançadas; etapa atual identificada | Testes de bloqueio de etapa futura, retorno, retomada e foco |
| Média | Mensagem “Respostas salvas” podia continuar visível após edição | Estado **Alterações não salvas** atualizado ao modificar respostas | Teste DOM, sem promessa de autosave |
| Alta | Botões “Diagnóstico · versão 1” eram indistinguíveis entre atendimentos | Título autorizado do caso + versão; fallback numerado quando título não está disponível; seleção marcada | Inspeção de renderização e jornada Chromium por versão |
| Média | Relatório extenso exigia rolagem para encontrar um assunto e voltar à lista | Índice recolhível de seções e botão **Voltar à lista de diagnósticos** | Chromium verifica foco na seção e na versão selecionada em tela de celular |
| Média | Mudanças de painel/detalhe não orientavam o foco de forma consistente | Foco nos títulos ao trocar área e abrir relatório; link **Ir para o conteúdo**; destaque de foco | Código semântico e testes de foco; leitura assistiva completa não realizada |
| Baixa | Login concentrava ajuda secundária, recuperação indisponível e orientações no mesmo nível visual | Explicação curta dos papéis, ajuda recolhível e estado **Entrando…** | Inspeção pública desktop/celular e regressão de login |

A paleta escura, a marca Capital Web3 e o acesso por papéis foram preservados.
As ações de revisão/publicação continuam explícitas e vinculadas à versão.
O relatório não ganhou aprovação automática nem execução financeira.

## Mapa de navegação resultante

| Tela | Papel | Entrada | Próximo passo ou retorno |
|---|---|---|---|
| Acesso | Conta autorizada | URL oficial | Login; ajuda de acesso recolhível |
| Segurança da conta | Equipe quando exigido | Sessão validada pelo serviço | Autenticador → área autorizada; saída |
| Atendimentos | Equipe atribuída | Navegação principal | Selecionar caso; analista pode abrir novo |
| Questionário COFRE | Analista; leitura pela equipe permitida | Caso selecionado | Continuar, Voltar ou etapa já visitada; revisar e gerar |
| Diagnósticos | Equipe e cliente autorizado | Navegação da equipe; entrada do cliente | Escolher versão; retornar à versão selecionada |
| Leitura do diagnóstico | Conforme autorização do serviço | Versão selecionada | Índice de seções, impressão autorizada, recebimento |
| Revisão e entrega | Revisor/publicador autorizado | Versão específica | Revisar, selecionar destinatários, definir validade e publicar |

## Estados críticos

| Estado / ação | Resultado | Recuperação |
|---|---|---|
| Editor alterado → Novo atendimento | Mantém dados até escolha explícita | Continuar preenchendo retorna à mesma etapa |
| Descartar e iniciar novo | Limpa somente o editor; nova criação usa operação distinta | Nenhum caso já salvo é excluído |
| Etapa ainda não alcançada | Atalho indisponível | Continuar valida os campos da etapa |
| Retorno a etapa anterior | Respostas permanecem na sessão | Retomar por etapa já visitada |
| Gravação falha ou conflito | Mantém respostas e mecanismos anteriores de retry/revisão | Não anuncia sucesso sem confirmação do serviço |
| Acesso revogado / sessão encerrada | Serviço e comportamento anterior removem o conteúdo | Reautenticar ou contatar a equipe |

## Validação

- `make check` local aprovado: 83 testes Python, verificações de arquivos públicos,
  testes existentes de sessão/contexto, 34 de API, 14 de transporte, 36 de COFRE
  e 32 de controles Auth. Dois testes COFRE novos nesta ampliação.
- `node --check apps/staging/app.mjs` e `git diff --check` aprovados.
- Build estático com configuração pública validada; CSP restritiva preservada.
- Contraste calculado das novas combinações: links sobre cartão 11,33:1,
  texto auxiliar 8,54:1, foco 10,72:1 e texto da etapa atual 8,32:1.
  Isso verifica essas cores; não certifica a acessibilidade da aplicação.
- [CI 39074153406](https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/39074153406)
  aprovada nos três jobs para o código `4cd29320a9098f5c6627e2641656c5521215bd19`.
  Chromium: 19 verificações COFRE, 13 da entrega anterior e 10 de Auth/MFA;
  suites SQL e integração Auth/PostgREST/Storage também aprovadas.
- **Site v6 publicado** em 17/10/2026 às 22:17 UTC, source
  `b86f2dbc55c52300b066e83b4126a3d7e132b146`, publicação `succeeded`.
- Após publicação, o domínio oficial mostrou a nova tela no desktop e em viewport
  390 × 844 (área útil de 375px com scrollbar), sem overflow horizontal.
  Ajuda abriu/fechou por Enter; o link de salto levou o foco a `main-content`;
  recuperação permaneceu desabilitada; nenhum erro de console capturado nessa visita.
- Capturas de login são prova da apresentação pública, não da sessão protegida.
  O fluxo protegido desta versão foi exercitado na CI descrita acima.

Os novos testes Chromium exercitam atalhos, preservação de respostas, retorno à
lista e foco no índice, dentro da jornada existente de criação, revisão independente,
publicação, leitura móvel, revogação e saída. A API Edge é transportada por uma
ponte de teste local; Auth e PostgREST são reais e descartáveis. Isso não substitui
novo teste autenticado na hospedagem nem estudo de usabilidade com pessoas.

## Limites e próximos passos

1. **Persistência parcial:** respostas intermediárias ainda ficam na memória da
   sessão até gerar o rascunho. Não há autosave; reload exige novo login. O aviso
   e a proteção de saída reduzem o risco, mas não recuperam queda do navegador.
   Evoluir gravação parcial exige contrato próprio e testes de concorrência.
2. **Escala das listas:** a consulta permanece limitada a 100 versões; busca,
   filtros e paginação precisam ser definidos quando houver volume de uso.
3. **Validação humana:** realizar tarefas com consultor e cliente fictício:
   localizar atendimento, corrigir objetivo, encontrar uma lacuna, identificar
   evidência e explicar o próximo passo. Meta proposta: conclusão sem ajuda e
   nenhum erro de versão/destinatário; ainda não medida.
4. **Acessibilidade:** verificar leitor de tela, zoom 200%, reflow 320px e todas
   as combinações de estados autenticados. Não declarar conformidade WCAG.
5. **Acesso:** Redirect URL oficial já salva com as quatro anteriores preservadas;
   recuperação por e-mail continua desligada até validar SMTP e entrega real.
6. **Piloto:** onboarding/MFA da equipe, retenção/descarte, anexos, restauração
   hospedada e revisão jurídica/comercial continuam requisitos anteriores.

A stack continua em PRs dependentes; esta entrega não faz merge nem declara
prontidão para dados reais. O portal público mantém os diagnósticos protegidos
por autenticação e autorização no serviço.
