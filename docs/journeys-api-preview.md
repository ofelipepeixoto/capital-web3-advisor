# Exercício sintético de jornadas na API e no portal

Baseado no catálogo de `journeys-synthetic.md`, inclui uma visão para explorar
COFRE-6 Individual e RASTRO com estados categóricos fictícios. Ao abrir a área de
jornadas, a página busca o catálogo pela API. Após escolher uma estrutura, a
pessoa pode informar somente enumerações e pedir um resumo sem nota. O resultado
indica lacunas ou necessidade de revisão, sem afirmar segurança.

As duas rotas `/cofre/journeys` e `/cofre/journeys/preview` exigem Supabase Auth
não anônimo e consultam o roster via RPC que exige participação ativa de equipe
e MFA conforme a política do workspace. Sem membro ativo ou sem o nível exigido,
o serviço nega acesso de forma opaca. O POST valida exclusivamente o envelope
sintético fechado e não executa escrita ou vinculação a caso. Sem texto livre,
endereços, valores, arquivos ou segredos. Dados do roster não retornam na resposta.

Tudo fica em memória da página e é descartado ao sair. Há aviso de perda ao
encerrar a sessão com escolhas modificadas. Nenhum acompanhamento, relatório,
revisão real, publicação, integração on-chain ou score é implementado. O
atributo `human_reviewed` do motor é interno ao contrato e o endpoint externo
rejeita qualquer alegação desse tipo, inclusive em evidências de lacunas. Somente
um registro controlado pelo servidor poderá comprovar revisão futura. As jornadas completas permanecem pendentes de persistência autorizada,
evidências, telas específicas, regras validadas e revisão por caso.

Testes Node exercitam escopo staff/cliente, payload fechado, ausência de escrita,
estado incompleto e limpeza da sessão. O teste Chromium foi acrescentado à suíte
real descartável, sujeita à CI. Não houve implantação nem teste hospedado.
