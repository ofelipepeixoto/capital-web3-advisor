# Evidências de testes

Validação local realizada em **2026-10-11**, Python **3.12.14**, Node **24.19.0**.
As camadas locais foram testadas antes de publicar para revisão.
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
| Budget | 8 aprovados | Zero default, concorrência, quotas, idempotência e reconciliação |
| Jobs/webhook | 7 aprovados | Leases, retries, restart, scopes e replay HMAC |
| UI session | 7 cenários aprovados | JS real em harness DOM: logout, respostas atrasadas, restauração e texto de esclarecimento |
| API autenticada | 31 aprovados | Handler real, upstream mock; Auth, JWT preservado, closed inputs e deadline |
| Public files | Aprovado | Parse JSON e inspeção limitada de arquivos |

**Total Python: 83 testes, zero falhas e zero skips.**
A camada do portal (PR2) contém 60 desses testes e os 2 cenários JS;
MCP/n8n (PR3) acrescentam 8. O teste HTTP abriu servidor efêmero somente em
127.0.0.1, com fixtures e sem chamadas externas. A execução inicial em sandbox
impediu sockets; a execução autorizada de loopback passou integralmente.

Correções verificadas: persistência do schema de relatório; negação de POST
download; limpeza de dados e descarte de respostas antigas na troca de persona.
Revisão independente encontrou e corrigiu o vínculo de aprovação ao hash
do manifesto dos arquivos, INSERT direto de recibos que contornava locks,
deadline do corpo HTTP e restauração tardia de sessão. O logout permanece
visível em mobile. Esses controles ainda exigem execução real por camada.

## Executar sem serviços externos

```sh
make check
make demo
```

Testes usam dados sintéticos. Python stdlib não exige pacotes de terceiros.
As suites abrangem cálculo, autorização por objeto/versão, HTTP local,
contratos de relatório e ferramentas MCP locais quando cada camada é adicionada.

## Não comprovado pela suite local

OpenAI API, cliente MCP de terceiros, n8n, Sites, VPS, backups e operação
de produção. Supabase/RLS/Storage/Auth e Chromium são verificados por jobs
separados; veja [o registro de execução e gates](homologation.md).
Parse do JSON n8n não é execução na instância.
O verificador de arquivos é uma inspeção limitada, não uma auditoria completa.
A validação DOM é um harness, separado da suite Chromium. A execução Chromium
local não encontrou o binário; a CI instala e exercita o navegador real.
PNGs permitem revisão de layout, sem equivaler a certificação de acessibilidade.

## Revisão

PRs terão objetivo, ordem de leitura, comando, resultado, dependências e
reversão. CI e revisão do agente não substituem revisão humana. Não foi possível
consultar branch protection pela conexão GitHub (HTTP403); nenhum controle foi
alterado ou afirmado como habilitado.
