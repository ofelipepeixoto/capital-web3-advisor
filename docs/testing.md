# Evidências de testes

Validação local realizada em **2026-10-11**, Python **3.12.14**, Node **24.19.0**.
O ambiente completo foi testado antes de publicar as camadas para revisão.
Na branch `main` inicial há apenas a estrutura e documentação.

## Resultados observados

| Suite | Resultado | Escopo |
|---|---|---|
| Risk | 19 aprovados | NAV, dívida, duplicidade, staleness, IL e CLAMM |
| Service | 21 aprovados | Isolamento, versão/hash, revisão, recipients, revogação, receipt |
| HTTP | 13 aprovados | Requisições reais loopback, fluxo completo, CSRF/Host/Origin |
| Adapter | 7 aprovados | Contrato, flags/injection, consumo pago desativado |
| MCP | 7 aprovados | Handshake local, tools read-only, inputs rejeitados |
| n8n | 1 aprovado | Cinco JSONs inativos, sem credentials/transporte |
| UI session | 2 cenários aprovados | JS real em harness DOM: logout e respostas atrasadas |
| Public files | Aprovado | Parse dos 6 JSONs e inspeção limitada de arquivos |

**Total Python: 68 testes, zero falhas e zero skips.**
A camada do portal (PR2) contém 60 desses testes e os 2 cenários JS;
MCP/n8n (PR3) acrescentam 8. O teste HTTP abriu servidor efêmero somente em
127.0.0.1, com fixtures e sem chamadas externas. A execução inicial em sandbox
impediu sockets; a execução autorizada de loopback passou integralmente.

Correções verificadas: persistência do schema de relatório; negação de POST
download; limpeza de dados e descarte de respostas antigas na troca de persona.
Revisão independente SQL encontrou e corrigiu o vínculo de aprovação ao hash
do manifesto dos arquivos, além do conteúdo; essa correção foi inspecionada.

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
O fluxo visual/layout em navegador ainda não foi validado: Playwright estava
disponível sem binário Chromium e o download falhou. A validação JS é um harness,
não uma execução visual ou teste de acessibilidade.

## Revisão

PRs terão objetivo, ordem de leitura, comando, resultado, dependências e
reversão. CI e revisão do agente não substituem revisão humana. Não foi possível
consultar branch protection pela conexão GitHub (HTTP403); nenhum controle foi
alterado ou afirmado como habilitado.
