# Estado do Capital Web3 em 17/10/2026

## Publicação e domínio oficial

O [repositório](https://github.com/ofelipepeixoto/capital-web3-advisor) já é público.
O portal em <https://capital.camaleaoweb3.com.br> usa o **mesmo projeto Sites da
homologação**, com domínio/TLS ativos; não há um segundo portal a migrar.
A página é pública; casos e relatórios continuam sujeitos a Auth, sessão ativa,
vínculo e publicação. O ambiente permanece **exclusivamente sintético**.

- Supabase Free compartilhado autorizado, namespaces Capital próprios, RLS e RPCs humanos. O fingerprint dos catálogos vizinhos permaneceu igual após a atualização.
- Data API expõe `public`, `graphql_public`, `api`, `capital_web3`. O namespace privado não é exposto.
- Implantação atual: migração MFA aplicada, Edge `advisory-api` **v5** e Site **v4**, source commit `c84e2b65428f80597627316cd52091dbb742801f`. CORS preserva a origem Sites e o domínio oficial.
- Nenhum cliente real, conexão financeira, IA paga, workflow n8n ativo ou MCP remoto.

## Revisão e integração

PRs #1 → #2 → #3 → #4 → #5 → #6 → #7 → #10 → #12 → #13 → #14 são camadas dependentes. #9 foi integrada à base de #7; #11 foi integrada à base de #10. #12 e #14 saíram de rascunho após a homologação; #13 também está pronta para revisão. As novas [PR #15, identidade](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/15) e [PR #16, operação](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/16) têm suas próprias evidências abaixo. O `main` ainda não contém a implementação completa. Checks automáticos e revisão de agente não são revisão humana; o `AGENTS.md` exige revisão humana antes de merge ou produção. Nenhum merge foi feito nesta atualização.

## COFRE Individual implementado e homologado com dados fictícios

Roster administrativo → caso → consentimentos separados → objetivos/experiência/liquidez → inventário categórico → sete controles/evidências → rascunho determinístico → revisão independente → publicação ao cliente → leitura legível e impressão.

O [contrato](cofre-contract-working.md) define o que a implementação aceita. A [revisão de segurança](cofre-security-review-2026-10-17.md) distingue controles implementados e gates pendentes. As [evidências COFRE](evidence/cofre-individual-2026-10-17.md) registram a homologação anterior, migrações, Edge v4/Site v3 e questionário salvo pela interface no domínio personalizado. A atualização de identidade abaixo evolui essa mesma implantação para Edge v5/Site v4. A entrega continua fora do `main`, aguardando revisão humana da stack.

## Identidade publicada e verificada com fixtures — PR #15

O candidato `72acd94` passou nos três jobs da [CI 39071947350](https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/39071947350):
110 verificações de integração e, no Chromium, 13 do fluxo legado, 15 COFRE e
dez de identidade. A migração MFA, a Edge v5 e o Site v4 foram publicados no
domínio oficial. As [evidências de identidade](evidence/auth-official-2026-10-17.md)
registram **18 verificações MFA autenticadas na implantação hospedada** aprovadas,
sem envio de e-mail. A fixture nova de quatro papéis foi desativada e ficou sem
sessões ativas ao final do ensaio.

Isso comprova o comportamento técnico com identidades fictícias, não a adesão
da equipe real. Cada integrante ainda precisa receber o acesso correto, cadastrar
seu fator e validar recuperação. O botão de recuperação de conta permanece
**desabilitado**: ainda faltam salvar a Redirect URL exata no Auth e comprovar o
envio/recebimento por SMTP. Não declarar convite ou recuperação por e-mail
homologados a partir dos testes sem envio.

## Operação preparada e ensaio local aprovado — PR #16

A [PR #16](https://github.com/ofelipepeixoto/capital-web3-advisor/pull/16), commit
`b1560a29`, passou na [CI 39070955369](https://github.com/ofelipepeixoto/capital-web3-advisor/actions/runs/39070955369).
O [pacote operacional](https://github.com/ofelipepeixoto/capital-web3-advisor/blob/feat/cofre-operational-readiness/docs/operations-readiness-2026-10-17.md) inclui **11 verificações
aprovadas de backup/restauração SQLite** dos stores reais de orçamento, fila e
proteção contra replay, com dados fictícios. A prévia de retenção foi executada
no Supabase somente em leitura e retornou zero candidatos.

**Restauração do COFRE hospedado permanece pendente.** O ensaio SQLite não
restaura Postgres, Auth ou Storage. Os 30 dias propostos são um prazo para
**revisar fixtures**, sem política jurídica aprovada, exclusão automática ou
agendamento. Metas RPO/RTO e demais prazos são propostas ainda não medidas ou
aprovadas. Anexos continuam bloqueados até existir validação operacional dos bytes.

## Depois de COFRE

1. **Investidor Avançado:** PortfolioSnapshot versionado, CSV validado, reconciliação de exposições/dívidas/LP, ligação do motor Decimal ao backend, fontes e datas, EVM/BTC somente observação e até dois protocolos homologados.
2. **Empresa Web3:** entidades/representantes verificados, papéis, políticas e RACI, controles de tesouraria e diagnóstico empresarial próprios.
3. **OpenAI:** adapter real, política de dados/consentimento, orçamento transacional conectado, recusa/timeout/incomplete e avaliação de qualidade. Consumo segue desativado.
4. **n8n:** importar snapshots → gerar proposta → monitorar escopo consentido → notificar após confirmação de publicação → tratar falhas. Templates atuais não implementam essa operação. Nenhum envio é autorizado por este arquivo.
5. **MCP remoto:** OAuth, escopos/objetos, quotas e cliente real homologado, após estabilizar a API de produto.

## Gates de clientes reais

Cadastro público do Auth compartilhado não concede acesso Capital; um roster/vínculo explícito continua necessário. Não mudar a configuração global das outras aplicações. Antes de clientes reais:

- Concluir convite/recuperação por e-mail e adesão MFA da equipe real, com retirada de acesso e recuperação operacional de conta/sessão.
- Definir responsáveis e canal de privacidade, aprovar finalidade, política de retenção/exportação/exclusão e revisão jurídica/comercial do serviço.
- Ensaiar exportação/descarte e restauração isolada do COFRE hospedado, considerando Auth compartilhado, revogações e Storage.
- Implementar e homologar uploads/bytes antes de liberar anexos; verificar isolamento entre organizações, headers e limites/carga.

O modo sintético, a página/código públicos e os consentimentos de teste não substituem essas validações. As evidências da PR #16 não devem ser atribuídas à PR #15 ou apresentadas como restauração Supabase concluída.
