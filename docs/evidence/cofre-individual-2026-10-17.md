# COFRE Individual — evidências da homologação sintética

## Escopo e rastreabilidade

Jornada autorizada com dados fictícios: abertura de caso, consentimentos,
objetivos, controles/evidências, inventário categórico, rascunho determinístico,
revisão independente, publicação por destinatário, leitura e impressão.

- Correção de projeção da Data API: [PR #13](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/13), dependente de #12.
- Jornada COFRE: [PR #14](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/14), dependente de #13.
- Nenhum merge ou aprovação humana foi simulado. O `main` ainda depende da revisão da stack descrita no [estado do projeto](../current-state-2026-10-17.md).

## Validação já concluída

- `make check`: 83 testes Python, 16 DOM legados, 34 contratos HTTP legados,
  12 testes de transporte e 34 testes COFRE (13 motor, 10 HTTP, 11 interface).
- PR #13: [CI 39067524582](https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/39067524582) aprovada nos três jobs.
- Na PR #14, as suítes SQL passaram na execução 39067797649: validação estrita,
  escrita direta negada, versões/idempotência, autoaprovação negada, isolamento,
  colunas privadas, sessão revogada, papéis removidos e MFA com papel duplo.
  Essa execução completa falhou no teste de navegação legado, antes de abrir o
  pacote de revisão. A correção abre a aba Diagnósticos após o login da equipe.

### Execução completa aprovada

[CI 39068252716](https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/39068252716),
candidato `2c46388079fd06a99af04e446b70562994ac6ab7`: três jobs aprovados.
As suítes SQL foram executadas em transações revertidas. A integração terminou
na asserção 79; Chromium registrou 13 verificações do portal legado e 15 do COFRE.
O percurso COFRE incluiu oito etapas, gravação real, revisão independente,
destinatário explícito, relatório no celular sem JSON técnico, impressão com
revalidação, recibo, isolamento, revogação e limpeza ao sair.

As imagens/manifestos sintéticos desse run ficam no artifact
`synthetic-staging-39068252716` por sete dias. Não há HAR, JWT ou respostas Auth
nesses arquivos. Foram inspecionados os screenshots móvel e desktop.

## Homologação hospedada em 17/10/2026

- Aplicadas as migrações `capital_web3_client_safe_columns` e
  `capital_web3_cofre_individual_synthetic`, sem reset do projeto compartilhado.
- `advisory-api` v4 ativa, `verify_jwt=true`, com `index.ts` e `cofre.ts`.
- Site v3, source `7cfce2a2b9478f168ada4f0d6db3c8a3e3ad7a17`, implantação
  `appgdep_6ad3e01962e4819195f26c2cc31942a2` concluída. Página pública em
  <https://capital.camaleaoweb3.com.br>; Auth/RLS continuam nos documentos.
- Smoke autenticado na função hospedada: **16 verificações aprovadas**.
  Login real de três contas novas fictícias, roster, criação, intake, hashes,
  autoaprovação negada, hash obsoleto negado, revisão independente, destinatário,
  leitura, download, recibo, revogação e `404` em leitura/download posteriores.
- Caso do smoke: `4504267d-2bdb-461d-8d9d-f2bc0342d96f`; versão
  `382eb9cf-00fb-4ddb-b272-74f076e7c270`; publicação
  `41331d35-7703-427e-8b7d-9a563f4bab5f`, **revogada**.
- No domínio personalizado, um navegador completou login, criação do caso,
  consentimentos, oito etapas, inventário manual e gravação de rascunho. A versão
  `25cfa37a-403d-425b-ae8a-319ed49192c0` permaneceu **não publicada**. O logout
  limpou o relatório e a senha. Não foi simulada aprovação humana de código.
- As três contas fictícias anteriores receberam roster próprio com quatro
  papéis, sem redefinir senha, alterar metadata ou enviar e-mail.
- Data API direta com JWT real e `Accept-Profile: capital_web3`: **sete verificações
  aprovadas**. Projeção explícita segura `200 []` (nenhum relatório revogado ou
  rascunho); coluna `created_by` e wildcard `403/42501`; intake `200 []` para o
  cliente; logout `204`. Isso verifica os grants também fora da Edge.
- Os quatro papéis temporários do smoke foram desativados e suas sessões
  encerradas após o ensaio. Usuários referenciados na auditoria foram preservados;
  suas senhas não foram escritas em arquivo, commit ou evidência pública.

Uma captura visual confirmou o rascunho salvo no portal hospedado. A imagem
fictícia acompanha a entrega ao titular; fica fora da árvore de código, cuja
verificação pública exige arquivos de texto. Os screenshots reproduzíveis da
CI continuam no artifact indicado acima.

### Preservação e avisos do Supabase

Fingerprint de tabelas/grants/policies dos namespaces vizinhos antes/depois:
`2bdc710e7dd5bf06e53de8408f5039fa`, inalterado. Isso cobre o catálogo observado,
não substitui uma auditoria de todos os dados ou da aplicação vizinha. Auth
global, DNS, origens permitidas e funções vizinhas não foram alterados.

O advisor continua sinalizando tabelas privadas sem policies e RPCs DEFINER
chamáveis por autenticados. Na Capital são, respectivamente, cinco tabelas
deliberadamente sem grants de runtime e oito RPCs de entrada com guards de
sessão/papel/caso. Os negativos SQL/HTTP exercitaram esses guards; o aviso não
foi ocultado nem resolvido com policy permissiva. Referências de revisão:
[RLS sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
e [RPC DEFINER autenticada](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
A proteção global de senhas vazadas segue desabilitada no Auth compartilhado;
não foi mudada nesta entrega. Avaliar com o dono do projeto antes de contas
reais: [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Limites que permanecem

O relatório descreve respostas e lacunas; não certifica segurança nem calcula
um score financeiro. A revisão/publicação são registros do servidor; o conteúdo
do rascunho não se autoaprova. A opção PDF abre a impressão do navegador após
revalidar acesso/hash; não é um PDF assinado ou gerado por serviço remoto.

O banco de teste da CI usa Auth/PostgREST/Storage reais e Chromium; o transporte
Edge no teste de navegador é uma ponte para o handler Node. Isso não comprova,
por si, a função Edge hospedada. O smoke separado acima verificou a Edge
hospedada; não executou todo o percurso móvel no domínio público.

Convites/recuperação e MFA reais, política de dados e descarte, pipeline de
anexos, limites/carga/restauração e revisão jurídica/comercial continuam gates
antes de clientes reais. OpenAI paga, n8n operacional, fontes financeiras ao
vivo e MCP remoto permanecem desligados.
