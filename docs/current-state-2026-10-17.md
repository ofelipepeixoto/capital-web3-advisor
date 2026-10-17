# Estado do Capital Web3 em 17/10/2026

## Comprovado antes da jornada COFRE

- Supabase Free compartilhado autorizado, namespaces Capital próprios, RLS e RPCs humanos.
- Data API expõe `public`, `graphql_public`, `api`, `capital_web3`. O namespace privado não é exposto.
- Edge `advisory-api` v2 hospedada; Auth real sintético, revisão independente, versão/hash, publicação, download JSON, recibo e revogação testados.
- Site v2 em <https://capital.camaleaoweb3.com.br>, domínio/TLS ativos. Página pública por solicitação do titular; documentos exigem login e vínculo/publicação no banco. CORS preserva origem Sites e adiciona domínio novo.
- Nenhum cliente real, conexão financeira, IA paga, workflow n8n ativo ou MCP remoto.

## Revisão e integração

PRs #1 → #2 → #3 → #4 → #5 → #6 → #7 → #10 → #12 → #13 → #14 são camadas dependentes. #9 foi integrada à base de #7; #11 foi integrada à base de #10. #12 e #14 saíram de rascunho após a homologação; #13 também está pronta para revisão. O `main` ainda não contém a implementação completa. Checks automáticos e revisão de agente não são revisão humana. Nenhum merge foi feito nesta atualização.

## COFRE Individual implementado e homologado com dados fictícios

Roster administrativo → caso → consentimentos separados → objetivos/experiência/liquidez → inventário categórico → sete controles/evidências → rascunho determinístico → revisão independente → publicação ao cliente → leitura legível e impressão.

O [contrato](cofre-contract-working.md) define o que a implementação aceita. A [revisão de segurança](cofre-security-review-2026-10-17.md) distingue controles implementados e gates pendentes. As [evidências COFRE](evidence/cofre-individual-2026-10-17.md) registram CI aprovada, migrações aplicadas, Edge v4 e Site v3 publicados, 16 verificações autenticadas na API hospedada e questionário salvo pela interface no domínio personalizado. A entrega continua fora do `main`, em #13 e #14, aguardando revisão humana da stack.

## Depois de COFRE

1. **Investidor Avançado:** PortfolioSnapshot versionado, CSV validado, reconciliação de exposições/dívidas/LP, ligação do motor Decimal ao backend, fontes e datas, EVM/BTC somente observação e até dois protocolos homologados.
2. **Empresa Web3:** entidades/representantes verificados, papéis, políticas e RACI, controles de tesouraria e diagnóstico empresarial próprios.
3. **OpenAI:** adapter real, política de dados/consentimento, orçamento transacional conectado, recusa/timeout/incomplete e avaliação de qualidade. Consumo segue desativado.
4. **n8n:** importar snapshots → gerar proposta → monitorar escopo consentido → notificar após confirmação de publicação → tratar falhas. Templates atuais não implementam essa operação. Nenhum envio é autorizado por este arquivo.
5. **MCP remoto:** OAuth, escopos/objetos, quotas e cliente real homologado, após estabilizar a API de produto.

## Gates de clientes reais

Cadastro público do Auth compartilhado não concede acesso Capital; um roster/vínculo explícito continua necessário. Não mudar a configuração global das outras aplicações. Antes de clientes reais: convite/recuperação e MFA da equipe, sessões, política de retenção/exportação/exclusão, uploads/bytes e anexos, isolamento de organizações, headers, limites/carga, restauração e revisão jurídica/comercial do serviço. O modo sintético e consentimentos de teste não substituem essas validações.
