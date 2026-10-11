# Backlog e critérios de aceite

Cada etapa termina em uma evidência de funcionamento. Prazos do plano são
sequência de trabalho, não compromisso de implantação automática.

| Fase | Resultado | Critério de aceite |
|---|---|---|
| Fundação | Repo, contratos, fixtures e testes locais | `make check` sem rede/segredos |
| Motor | NAV, IL, CLAMM, concentração e stress | Casos conhecidos, dupla contagem/dívida/stale rejeitados |
| Atendimento | Rascunho, revisão, publicação, receipt, revogação | Matriz de acesso positiva e negativa por versão |
| Staging privado | Identidade real, Postgres/Storage, interface | Isolamento/TTL/revogação testados em ambiente separado |
| Piloto | 3–5 atendimentos consentidos e revisados | Qualidade, tempo de entrega e dúvidas medidos |
| Operação | Jobs duráveis, monitoramento, recuperação | Retry/idempotência/orçamento/restauração comprovados |

## Próximas implementações

1. Auth real para equipe/cliente, MFA de staff, convites/expiração e membership.
2. Aplicar a persistência dos objetos, aprovação imutável e auditoria RLS em
   staging privado; configurar retenção. SQL/RPCs e API já preparados na etapa
   técnica; execução CI fica em `docs/homologation.md`.
3. Importação CSV validada; consentimento e catálogo de fontes de leitura.
4. Uma rede EVM e BTC somente observação; verificar finality/reorg/RPC/staleness.
5. Dois protocolos após validação de adapters, endereços/chain IDs e evidências.
6. RPC, DEX quotes, pools, allowances e simulação sem calldata de execução.
7. OpenAI Responses: schema validado, refusals/incomplete/errors tratados;
   integrar as reservas SQLite ou equivalentes transacionais e limites de
   tokens/custo antes de ligar consumo. Reservas locais já são testadas.
8. MCP remoto com autenticação e políticas por ferramenta/objeto.
9. n8n cinco fluxos: importar, gerar draft, monitorar escopo, entregar após
   confirmação do backend e revisar falhas. Idempotency, dead-letter, timeouts.
10. Portar download autorizado, TTL, revogação e Storage do ensaio descartável
    para o portal com Auth real e validar o fluxo completo em staging privado.

## Escopo futuro especializado

Bitcoin L2, risco de bridges/wrapped assets, stablecoins, segurança de protocolos,
estratégias LP/IL e consultoria Web3 empresarial são trilhas de conhecimento e
adapters futuros. Registrar arquitetura de confiança, disponibilidade dos dados,
risco de custódia/peg e dependências; não presumir que toda rede chamada L2 herda
as garantias do Bitcoin. Evitar rankings ou APRs sem fontes atuais verificadas.

## Métricas

Tempo por diagnóstico, completude/freshness das fontes, correções após revisão,
violações de acesso (meta zero), sucesso de entrega, dúvidas dos clientes,
disponibilidade/recuperação, custo por relatório aprovado. Medir baseline do
serviço antes de afirmar retorno ou automatizar mais etapas.
