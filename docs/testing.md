# Evidências de testes

Este documento é atualizado na branch de implementação após a execução.
Na branch `main` inicial há apenas a estrutura e documentação; as camadas
executáveis são entregues em PRs para revisão humana.

## Executar sem serviços externos

```sh
make check
make demo
```

Testes usam dados sintéticos. Python stdlib não exige pacotes de terceiros.
As suites abrangem cálculo, autorização por objeto/versão, HTTP local,
contratos de relatório e ferramentas MCP locais quando cada camada é adicionada.

## Não comprovado pela suite local

Supabase/RLS/Storage/Auth reais, OpenAI API, cliente MCP de terceiros, n8n,
Sites, VPS, backups e operação persistente. Os testes SQL são preparados para
ambiente Supabase descartável. Parse do JSON n8n não é execução na instância.
O verificador de arquivos é uma inspeção limitada, não uma auditoria completa.

## Revisão

PRs terão objetivo, ordem de leitura, comando, resultado, dependências e
reversão. CI e revisão do agente não substituem revisão humana. Não foi possível
consultar branch protection pela conexão GitHub (HTTP403); nenhum controle foi
alterado ou afirmado como habilitado.
