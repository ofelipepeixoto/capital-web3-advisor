# Revisão de navegação do portal Capital Web3 — 17/10/2026

## Escopo observado

Portal de homologação sintética em `https://capital.camaleaoweb3.com.br/`, com sessão de equipe já aberta, telas **Atendimentos** e **Diagnósticos** e um COFRE Individual fictício. A versão hospedada antes da alteração era Sites v4. A API, RLS, identidade, revisão e publicação não foram alteradas.

| Evidência na interface | Impacto | Correção |
|---|---|---|
| Dois botões de lista tinham o mesmo nome “Diagnóstico · versão 1” | Era difícil escolher o caso correto, inclusive por leitor de tela | Mostrar título autorizado do atendimento e número da versão; fallback distinto quando o título não está disponível |
| Documento COFRE extenso não tinha atalhos de seção | Para chegar à revisão era necessário percorrer todo o texto | Índice de seções com links internos, foco visível e adaptação a telas pequenas |
| Lista não indicava qual versão estava aberta | O vínculo entre lista e detalhe ficava implícito | Estado `aria-pressed` e destaque visual no botão selecionado |
| Seleção no telefone podia deixar o detalhe fora da área visível | Usuário permanecia na lista após abrir a versão | Foco no título do detalhe em viewport de até 740px |

## Entrega e limites

- Código da interface em `apps/staging/app.mjs` e `apps/staging/styles.css`, baseado na branch `feat/cofre-auth-controls` (PR #15). A implementação completa continua em PRs encadeados; `main` não contém a aplicação.
- Site v5 publicado com source commit `8285a0ece0972d4f05214a84c4b913382e75ea4a`. O acesso público do contêiner do Site permaneceu igual; dados de caso exigem Auth e autorização do serviço.
- `make check`, `node --check` e `git diff --check` passaram localmente no workspace de desenvolvimento. Esse conjunto inclui alterações de outras camadas ainda não commitadas, portanto não equivale à CI desta PR.
- A publicação retornou `succeeded`. O domínio oficial carregou o formulário de entrada depois do deploy. Como a sessão do portal se perde ao recarregar, a jornada autenticada após v5 ainda requer novo smoke com conta fictícia autorizada; não usar credenciais reais.

## Próximas verificações

1. Reabrir dois diagnósticos fictícios com a conta de equipe e conferir título, seleção, índice e foco no celular.
2. Conferir navegação por teclado e zoom de 200% nas telas autenticadas.
3. Revisar a PR sobre #15 e manter a exigência de revisão humana antes do merge ou uso com clientes reais.
