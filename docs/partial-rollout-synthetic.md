# COFRE: lançamento e reversão do progresso parcial sintético

Este recurso não está implantado. A interface o oferece somente quando o backend retorna `partial_intake_enabled: true`. A Edge exige `COFRE_PARTIAL_ENABLED=true` e o switch privado `partial_enabled` no banco, ambos desligados por padrão. As RPCs autenticadas também consultam o switch do banco, inclusive chamadas diretas pela Data API. Backends anteriores que não devolvem o atributo são tratados como indisponíveis: a leitura do atendimento continua e a interface explica que o progresso fica na sessão. Com o recurso ligado, erro de autorização ou indisponibilidade não são convertidos em caso vazio.

## Pré-condição de instalação

O SQL pendente desta PR é para banco descartável limpo, onde o modelo parcial anterior ainda não foi instalado. Se outro ambiente já recebeu a versão anterior, a mudança de receipts para hashes e o novo switch exigem migração aditiva e backfill revisados, sem apagar registros. Não presumir o estado do banco hospedado nem executar este SQL sobre ele sem verificação. A migração parcial precede a migração do relatório canônico, que também contém a proteção de finalização; ambas devem ser validadas como conjunto.

## Ordem proposta antes de implantar

1. Revisar código, SQL e o isolamento de autorização; testar os fluxos em um ambiente Supabase descartável, nunca com dados reais. A CI gera o nome da migração pela CLI e executa as suítes; o SQL desta PR está em `supabase/pending` e ainda não constitui uma migração registrada de produção.
2. Preparar backup e procedimento de restauração isolada. Gerar migração pela CLI, aplicar no ambiente permitido e conferir integridade, RLS/FORCE RLS e ausência de privilégios diretos. Não ativar a flag se qualquer validação falhar.
3. Implantar a Edge compatível com `COFRE_PARTIAL_ENABLED` ausente. Confirmar sessões existentes, atendimento e relatório sem chamar `/partial`.
4. Implantar o frontend que interpreta a capability. Com a flag desligada, confirmar caso existente e o aviso de que respostas permanecem na sessão.
5. Somente após aplicar e testar ambas as migrações, habilitar primeiro o switch privado no banco e depois a flag da Edge no ambiente de homologação. Testar acesso, salvamento parcial, revogação, concorrência e retomada com identidades inteiramente fictícias.

## Reversão

Desabilitar primeiro o switch no banco e depois a flag da Edge; confirmar que a Edge anuncia `partial_intake_enabled: false`. O novo frontend oculta salvamento parcial. Se um caso tiver progresso parcial preservado, a geração final no servidor é bloqueada enquanto o switch estiver desligado, inclusive por RPC direta. Reativar o conjunto controladamente para comparar e reconciliar antes de gerar outra versão. Depois, se necessário, reverter frontend e Edge para versões conhecidas. Desativar a flag não exclui dados nem desfaz requisições já aceitas. Preservar registros e fazer backup antes de qualquer eventual mudança de banco. Uma versão antiga do frontend que pressupõe `/partial` não deve ser publicada com a flag desligada: primeiro usar este frontend compatível.

## Dados e limites

Receipts mantêm hash SHA-256 do pedido e resultado mínimo, não o JSON completo. O hash não é criptografia, e respostas de vocabulário pequeno podem ser adivinhadas por tentativa por quem obtiver acesso aos registros. Receipts não expiram nem são apagados automaticamente. Existe teto privado, configurável pelo proprietário, com padrão de 1.000 operações por ator neste ambiente sintético; quando atingido, novas operações falham e repetições idênticas continuam disponíveis. O teto não é uma política de retenção. Não usar dados reais antes de decidir prazo, descarte e proteção, e de validar capacidade, suporte e privacidade.

O progresso obsoleto pode ser comparado com a última versão salva e retomado explicitamente como progresso separado. A retomada preserva as respostas antigas e não modifica o relatório publicado; uma nova versão exige geração e revisão. Caso a versão ou o progresso mude durante a operação, o servidor responde conflito e mantém os dados. Respostas não salvas na tela não são descartadas silenciosamente.

O servidor revê sessão e atribuições após adquirir o bloqueio de caso e após aguardar a trava de cota. A configuração no banco é bloqueada em leitura durante a operação. A interface impede saída enquanto a gravação estiver em andamento, com orientação para falha ou timeout. Isso não prova cancelamento de uma transação já autorizada e iniciada: o resultado pode ser incerto até a consulta posterior. Testes de revogação anteriores ao pedido e resposta tardia no navegador não simulam todos os entrelaçamentos de transações.
