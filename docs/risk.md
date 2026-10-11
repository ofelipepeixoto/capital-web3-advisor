# Motor de risco determinístico

Todas as entradas financeiras são **strings decimais**. `Decimal` mantém os
valores fora do arredondamento binário de floats; a precisão é delimitada e os
inputs são limitados. Booleans, NaN, Infinity e magnitudes não suportadas falham.
Saídas são JSON serializáveis com quantidades como strings.

## NAV e dados

`calculate_nav(positions, debts, prices, as_of=...)` calcula ativos brutos menos
dívidas. Cada posição/dívida tem `exposure_id`, `token_id`, `quantity`.
`exposure_id` representa uma reivindicação econômica única: contabilizar receipt
e seus mesmos underlying ativos com o mesmo ID falha. O integrador deve resolver
identidade da exposição antes do cálculo; IDs diferentes inventados não permitem
que este módulo reconheça automaticamente dois registros do mesmo direito.

`prices[token_id] = {value: '...', observed_at: '...Z'}`. Preço ausente, antigo,
futuro ou em moeda divergente bloqueia o cálculo. `as_of` vem do relógio confiável
do backend quando os dados forem reais; o teste fornece um relógio fixo.
Concentração usa ativos brutos, mantendo a dívida separada.

## Stress

`stress_scenario(..., shocks, as_of=...)` aplica retornos fracionários por ativo:
`'-0.5'` significa queda de 50%; `'-1'` significa preço zero no cenário. Ativos
e dívidas do mesmo token recebem o mesmo choque. Não é VaR, previsão ou modelo
completo de liquidação/correlação. O módulo não chama IA ou fontes externas.

## IL e CLAMM

- `classic_il(r)` usa `2√r/(1+r) - 1` somente para pool de produto constante
  50/50, sem fees. Benchmarks dos testes: r=1 →0; r=2 →aprox.−5,719%;
  r=4 →−20%. É comparação com HODL, não prejuízo total em dólares.
- `clamm_inventory(p,lower,upper,L)` calcula inventário de token0/token1,
  com preço token1/token0 e liquidez normalizada L; limita o preço ao range
  para calcular estoque e identifica abaixo/dentro/acima.
- `simulate_clamm(initial,final,lower,upper,L)` compara o valor do estoque
  final com o **mesmo estoque inicial mantido em HODL**, marcado ao preço final.
  Testa dentro e fora do range, inclusive posição inicialmente fora do range.

Essas simulações excluem taxas ganhas, gás, reward tokens, funding, hedge,
slippage, custos de rebalanceamento, unidades/ticks reais do contrato e falhas de
smart contract. Antes de analisar pools reais, adaptar decimais/ticks, referência
de preço, liquidez/ownership e snapshot finalizado com testes próprios.
