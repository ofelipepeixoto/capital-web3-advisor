# Estado das branches e integração do Capital Web3

Registro de 08/11/2026 para revisão da base sintética. Este arquivo descreve a situação do código disponível e não aprova mudanças de acesso, infraestrutura, política de dados ou publicação em produção.

## Base atual

- O repositório é público e a branch padrão é `main`. A implementação de homologação se encontra em branches e pull requests ainda não incorporados à `main`.
- A dependência principal é: [#1](../../pull/1) → [#2](../../pull/2) → [#3](../../pull/3) → [#4](../../pull/4) → [#5](../../pull/5) → [#6](../../pull/6) → [#7](../../pull/7) → [#10](../../pull/10) → [#12](../../pull/12) → [#13](../../pull/13) → [#14](../../pull/14) → [#15](../../pull/15) → [#17](../../pull/17) → [#18](../../pull/18).
- [#9](../../pull/9) já foi incorporada à base de #7, e [#11](../../pull/11) à base de #10. A [#16](../../pull/16) é irmã de #15, ambas com base em #14: seu conteúdo não está automaticamente presente em #18.
- A #16 adiciona um documento de preparação operacional, um ensaio local de restauração SQLite e uma consulta de prévia de retenção. Eles não são prova de restauração do banco hospedado nem autorizam remoção de dados.

## Evidências do snapshot

| PR | Head | CI observada | Escopo |
| --- | --- | --- | --- |
| #14 | `28a86e76a7b1d30f7bc057e46b0c23fef6404608` | [aprovada](../../actions/runs/39069765493) | COFRE Individual sintético |
| #15 | `af3d544a2b87741fbcae81900a04665cc1378722` | [aprovada](../../actions/runs/39072425667) | MFA e identidade |
| #16 | `b1560a29aea74cfeb1c3da069315bad74908c0ac` | [aprovada](../../actions/runs/39070955369) | Evidências e ensaios operacionais |
| #17 | `8368ebf9254875f6166a3b0d46354ae495cbfe54` | [aprovada](../../actions/runs/39074555222) | Navegação |
| #18 | `80d8ea7e3c482fade1c824b696c3509b515f91d3` | [aprovada](../../actions/runs/42499158895) | Proteção de saída sem salvar |

Estes resultados se aplicam aos respectivos commits e ambientes de teste; não são prova de integração de outras branches, aprovação humana, migração hospedada ou uso por clientes reais. Reconsultar heads, CI e estado das PRs antes de qualquer decisão.

## Roteiro de reconciliação

1. Preservar heads, histórico, migrations e configurações existentes; criar uma branch de integração a partir de um commit explicitamente identificado de #18. Não reescrever branches compartilhadas.
2. Integrar alterações paralelas por commits ou PRs revisáveis, em ordem de dependência. Acompanhar o estado de cada nova PR em relação a #18 e detectar conflitos antes de atualizar a base. A #16 deve ser avaliada separadamente, porque sua base é #14.
3. Fazer uma única revisão do conjunto, incluindo eventuais arquivos alterados pelas várias frentes, migrations, autorização no servidor, contratos da API, tratamento de respostas não avaliadas e separação entre rascunhos e resultados publicados.
4. Executar `make check`, as suítes de autorização e armazenamento em Supabase descartável e os testes de navegador com identidades fictícias. Verificar isolamento entre casos, retomada após interrupção, concorrência, saída, revisão e publicação. Evidência passada de cada branch não substitui o teste do conjunto.
5. Submeter a revisão humana o conjunto integrado e seguir a ordem de dependência das PRs, ou preparar uma mudança consolidada que preserve histórico e seja revisável. Não promover a `main` enquanto a revisão humana exigida em `AGENTS.md` não estiver concluída.
6. Antes de publicar, conferir correspondência entre commit, configuração pública, migrações, versão do site e versão da API, com plano de retorno. A homologação de dados reais depende também dos controles operacionais, revisão jurídica e comercial e dos testes pertinentes.

## Limites do escopo

O produto em homologação usa dados fictícios. A existência de arquivos, contratos ou propostas para jornadas adicionais não prova sua implantação nem autoriza transações, coleta de segredos, consultas externas ou integrações pagas. Documentos de referência privados e dados de pessoas não devem ser copiados para este repositório público. Divergências metodológicas ficam registradas como pendentes até decisão específica.
