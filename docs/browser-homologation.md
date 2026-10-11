# Homologação do console e portal no navegador

O runner em `tests/browser/advisory.test.cjs` usa Chromium real contra um
processo novo da API Python em uma porta efêmera de `127.0.0.1`. Todos os
casos, relatórios e identidades são fictícios. Não publica Sites, não usa
carteiras, Supabase, OpenAI paga ou credenciais de clientes.

## Casos de aceite automatizados

| Caso | Evidência de comportamento |
|---|---|
| Revisão e entrega | Ana prepara versão; cliente A não lê o rascunho; Rui aprova e publica; cliente A baixa essa versão, confirma recebimento e pede esclarecimento |
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
npm install --prefix tests/browser --ignore-scripts
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
ou inspeção visual. O resultado real deverá ser registrado pelo job de CI;
ausência de navegador causa falha, sem marcar o gate como aprovado ou skip.

A revisão estática encontrou duas falhas de interface corrigidas nesta etapa:
logout escondido no CSS de telas pequenas e restauração inicial atrasada que
podia substituir a persona escolhida. A correção da restauração passou em
quatro cenários do harness DOM (incluindo os dois cenários originais). Os novos
testes falham contra a versão anterior, reproduzindo a identidade Rui aplicada
enquanto a entrada como cliente B estava em andamento. Essa regressão executada
é evidência de lógica JavaScript, sem equivaler a homologação visual.

A instalação local offline também não conseguiu gerar um lockfile porque
o cache não contém os metadados da versão fixa. Portanto o pacote está
fixado por versão, mas um lockfile com integridade verificável ainda precisa
ser obtido em ambiente com acesso ao registro npm oficial. Não foi criada
uma integridade inventada.

## Fontes técnicas oficiais

- [Playwright — CI](https://playwright.dev/docs/ci): instalação de dependências e navegadores em CI.
- [Playwright — browsers](https://playwright.dev/docs/browsers): compatibilidade entre pacote e binário.
- [Playwright — configuração](https://playwright.dev/docs/test-configuration): limites e artefatos do teste.

Documentação verificada em 2026-10-11. Esta suite usa `node:test` e a API de
biblioteca `playwright-core`; não depende do runner `@playwright/test`.
