# Contrato preliminar das jornadas sintéticas

Este módulo organiza campos fechados para quatro exercícios de equipe. Há uma
interface e endpoints sintéticos autenticados na branch para revisão. Não há
persistência, integração externa, relatório, nota ou aprovação para essas
jornadas. Dados reais e uso hospedado exigem ainda política, contratos e testes
próprios.

| Jornada | Etapas propostas | Referência dos requisitos |
|---|---|---|
| COFRE-6 Individual | Ameaças, funções de carteira, chaves e recuperação, higiene, evidências, continuidade | Framework COFRE-6, pp. 1–4 |
| Investidor Avançado | Objetivos e liquidez, carteiras, ativos/passivos, fontes, permissões, riscos e plano | Auditoria dos anexos e contrato COFRE atual; detalhe para validar |
| RASTRO | Mandato, universo, maturidade, stack, taxonomia, rituais, plano 90 dias | Framework RASTRO, pp. 89–93 |
| Organização e DAO | Mandato, papéis, política, multisig/módulos, revisão, reconciliação | SOP board/DAO, pp. 3–10; COFRE-6 pp. 1–4 |

Somente a estrutura genérica está aqui. Os anexos e planilhas não foram copiados
para o repositório público. Cada etapa tem um estado fechado (`not_assessed`,
`unknown`, `declared`, `human_reviewed`, `gap`, `not_applicable`) e evidência
(`none`, `declared`, `human_reviewed`), sem texto livre. Uma declaração não é
tratada como verificação. Não avaliado, desconhecido e não aplicável são
contabilizados separadamente; uma lacuna não vira resposta positiva.

O resumo resulta em `needs_input`, `has_gaps` ou `awaits_human_review` e não
faz inferência de segurança. Uma etapa marcada não substitui evidência estruturada,
não certifica adequação e não aprova relatório. Não se coleta chave privada,
frase de recuperação, senha, OTP, endereço, saldo ou outra informação real. A
opção `not_applicable` ainda exige a definição de política por etapa no produto;
nenhum resultado pode ser publicado a partir deste resumo.

A fórmula e a metodologia de score seguem não aprovadas; modelos divergentes dos
anexos não são mesclados nem calculados aqui. Nenhuma integração de dados,
monitoramento, movimentação, assinatura, autorização ou operação financeira é
ativada. A expressão “human_reviewed” representa um atributo fornecido no teste,
não comprova a existência de revisão nem concede privilégios. O serviço deve ser
a fonte de identidade, evidências, revisão e autorização numa futura integração.

Para verificar: `node --test tests/test_journeys.mjs` e `make check`. Os testes
cobrem estados, lacunas, duplicação, isolamento de objetos e rejeição de campos
extras; não comprovam comportamento hospedado, UX, políticas ou banco.

## Exercícios no portal de homologação

As quatro estruturas podem ser exploradas como exercícios de equipe por meio da
API autenticada. Investidor avançado e empresa/DAO exibem orientações por etapa,
sem solicitar valores, endereços ou detalhes de clientes. A lista separa lacunas
de etapas desconhecidas ou não avaliadas. A API rejeita afirmações de revisão
humana enviadas pelo cliente. Nada é gravado; não há diagnóstico ou entrega por
caso nestes exercícios. As jornadas de cliente exigem contratos, persistência e
revisão próprios antes de serem disponibilizadas.
