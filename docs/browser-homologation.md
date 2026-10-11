# Homologação do console e portal no navegador

O runner em `tests/browser/advisory.test.cjs` usa Chromium real contra um
processo novo da API Python em uma porta efêmera de `127.0.0.1`. Todos os
casos, relatórios e identidades são fictícios. Não publica Sites, não usa
carteiras, Supabase, OpenAI paga ou credenciais de clientes.

## Casos de aceite automatizados

| Caso | Evidência de comportamento |
|---|---|
| Revisão e entrega | Ana prepara versão; cliente A não lê o rascunho; Rui aprova e publica; cliente A baixa essa versão, confirma recebimento e pede esclarecimento; uma dúvida digitada enquanto a confirmação atualiza o relatório mantém texto e foco |
| Isolamento e revogação | Cliente B recebe somente B; URL e download de A retornam o mesmo 404 de recurso ausente; Rui revoga; cliente A perde novas leituras e downloads |
| Resposta atrasada | Resposta verdadeira autorizada do caso A é atrasada no transporte; logout e entrada como B ocorrem antes da liberação; nenhum dado A reaparece |
| Download atrasado | Resposta verdadeira de download A é atrasada; após logout e entrada como B nenhum arquivo é gerado |
| Restauração atrasada | Resposta de sessão Rui na recarga é atrasada; login cliente B ocorre antes; o retorno antigo não substitui a identidade e os controles do cliente |
| Interface responsiva | Login e relatório em 1440×1000 e 390×844; controles visíveis e ausência de rolagem horizontal; PNGs para inspeção humana |

O runner também falha se a aplicação tentar acessar uma origem externa ou
produzir erro de JavaScript. As rotas, cookies e respostas são do servidor
real; apenas os dois casos de corrida atrasam o transporte de respostas.
Instrumentação exclusiva do teste observa a conclusão dos leitores nativos
JSON/blob e a criação de URLs blob, mantendo os valores e retornos originais.
Os casos de corrida aguardam consumo completo do corpo e a continuação do
JavaScript antes de avaliar vazamento; não dependem de um sleep arbitrário.
Screenshots não são comparação visual contra uma imagem de referência nem
certificação de acessibilidade. O aceite humano deve avaliar o layout, a
clareza dos textos e o roteiro com identidades reais no staging futuro.

## Execução

Python 3.11+, Node 20+ e dependências de sistema compatíveis com Chromium.
Instalações usam o pacote oficial Microsoft `playwright-core` na versão
fixa 1.62.1. Os binários são obtidos pelo instalador oficial Playwright.

```sh
npm ci --prefix tests/browser --ignore-scripts
cd tests/browser
npx playwright-core install --with-deps chromium
cd ../..
CAPITAL_BROWSER_ARTIFACT_DIR=/tmp/capital-web3-browser \
  npm test --prefix tests/browser
```

Para listar sem navegador ou dependências:

```sh
npm run list --prefix tests/browser
```

Em CI, usar runner Ubuntu, permissões somente `contents: read`, Python e
Node provisionados, timeout do job de dez minutos. Instalar a dependência
fixa e Chromium antes de executar. Salvar stdout/TAP e o diretório definido
por `CAPITAL_BROWSER_ARTIFACT_DIR` como artifacts de curta retenção. O runner
encerra cada processo local e contexto de navegador ao terminar. Não usar
secrets ou um servidor demo público para esses testes.

## Estado da evidência

Em 2026-10-11, a preparação local verificou sintaxe e listagem dos cinco
testes. O runtime tem Playwright 1.62.1, mas não contém Chromium; a instalação
anterior de navegador falhou. Essa preparação **não comprova execução de E2E**
ou inspeção visual. Ausência de navegador causa falha, sem marcar o gate como
aprovado ou skip. A execução real em CI foi iniciada separadamente.

### Primeira execução Chromium em CI

O job [browser-homologation](https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/38108152731/job/114377941072)
executou o commit `3c5dba3cf65cdd24825b3e33770266dcbad3a0bf`, com Node 24.21.0
e Chromium 151.0.7922.34: **quatro testes passaram e um falhou**, sem skips.
Os testes de detalhe/download/restauração atrasados e desktop/mobile passaram.
O fluxo completo chegou à confirmação de recebimento, mas o teste digitou
na textarea enquanto a segunda confirmação ainda atualizava o DOM; a atualização
substituiu o campo e o envio subsequente foi rejeitado como vazio.

O helper foi corrigido para aguardar o `finally` do controle original da ação,
incluindo o refresh, antes da próxima interação. A API continua sendo obrigada
a retornar o status esperado; a correção não aceita o 400 como sucesso.
O fluxo inteiro ainda precisa passar em nova execução para aprovar este gate.

A interface também foi corrigida para preservar texto, foco e posição do cursor
ao atualizar o mesmo relatório na mesma sessão. A dúvida é limpa após envio
bem-sucedido, quando o campo ainda contém a mensagem enviada; texto novo digitado
durante o envio permanece. Troca de relatório, caso ou sessão não reaproveita a
dúvida anterior. O fluxo E2E agora atrasa uma resposta real do refresh de receipt
e digita antes de liberá-la, verificando a preservação no navegador. O harness
DOM tem sete cenários aprovados, incluindo preservação de texto novo durante
envio e limpeza nas transições.

O artifact `synthetic-browser-38108152731` contém 17 PNGs e cinco manifests;
o ZIP baixado foi verificado contra o SHA-256
`0424ddc312a70f359d25967f297d1719ce1911ea4d71a70281e162723aabff81`.
Todos os manifests registram zero erros de JavaScript e zero chamadas externas.
Capturas desktop/mobile foram inspecionadas: logout permanece visível no
mobile, sem rolagem horizontal nos tamanhos testados. Isto é aceite visual
técnico dos fixtures; revisão humana e autenticação persistente seguem pendentes.

A revisão estática encontrou duas falhas de interface corrigidas nesta etapa:
logout escondido no CSS de telas pequenas e restauração inicial atrasada que
podia substituir a persona escolhida. A correção da restauração passou em
quatro cenários do harness DOM (incluindo os dois cenários originais). Os novos
testes falham contra a versão anterior, reproduzindo a identidade Rui aplicada
enquanto a entrada como cliente B estava em andamento. Essa regressão executada
é evidência de lógica JavaScript, sem equivaler a homologação visual.

### Execução final após correções

[CI 38108703715](https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/38108703715/job/114379564104)
executou cinco cenários aprovados, zero falhas/skips, incluindo preservação de
texto/foco durante refresh de receipt. Head `dd0b539de4ef037ee5a3953ec5171bb0f195049f`;
merge de teste `12e530f792efec458d826fdca45580513b7675ae`.
Chromium 151.0.7922.34, Node 24.21.0. Cinco manifests confirmaram zero erros JS
e chamadas externas; 20 PNGs foram produzidos e o layout desktop/mobile revisado.
O [registro central](homologation.md) mantém o digest do artifact verificado.

O lock npm foi obtido nessa CI e validado: único pacote `playwright-core` 1.62.1,
registro oficial npm e integridade SHA-512. Foi incorporado em
`tests/browser/package-lock.json`; usar `npm ci --prefix tests/browser --ignore-scripts`.
A instalação offline inicial não forneceu essa integridade; nenhum valor foi
inventado. O portal com Auth hospedado continua sendo um gate separado.

## Fontes técnicas oficiais

- [Playwright — CI](https://playwright.dev/docs/ci): instalação de dependências e navegadores em CI.
- [Playwright — browsers](https://playwright.dev/docs/browsers): compatibilidade entre pacote e binário.
- [Playwright — configuração](https://playwright.dev/docs/test-configuration): limites e artefatos do teste.

Documentação verificada em 2026-10-11. Esta suite usa `node:test` e a API de
biblioteca `playwright-core`; não depende do runner `@playwright/test`.
