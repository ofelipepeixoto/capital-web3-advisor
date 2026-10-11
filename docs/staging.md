# Preparação de staging: Sites, Supabase, OpenAI, n8n e Hostinger

A fundação Supabase usa o projeto Free existente autorizado, com namespaces
Capital próprios. API e portal na nuvem permanecem pendentes. A homologação usa
um stack Supabase descartável na CI, API com JWT do usuário e Chromium contra
a demonstração local. Consulte [evidências e gates](homologation.md).
Esta sequência descreve os gates restantes, sem contratar serviços.

## Primeiro ambiente privado

1. Usar namespaces próprios no projeto Free compartilhado escolhido pelo titular,
   conforme [roteiro atualizado](free-shared-staging.md). Executar suítes com
   fixtures somente na CI descartável. Validar Auth/convites/MFA separadamente.
2. Substituir o servidor local por backend de produção; verificar assinatura,
   issuer, audience, expiração e revogação de sessão. Derivar subject/roles/case
   no servidor. Nunca usar headers de identidade enviados pelo navegador.
3. Aplicar e verificar RPCs de revisão/publicação persistentes por versão/hash;
   clients não escrevem reviews. O SQL está em `0002_human_workflow.sql`.
4. Sites: criar projeto privado com runtime/segredos reais verificados; portar
   interface e configurar origem/API. Autenticação do site não substitui ACL de
   objetos do backend. Nenhum segredo OpenAI/service-role no frontend.
5. Validar portal com duas organizações, consultor não atribuído, versão
   rascunho, destinatário diferente, convite expirado e download revogado.

## Integrações em sequência

- **OpenAI:** projeto/key protegida, modelo configurável verificado, consentimento
  e política de dados. Antes de ativar: budget persistente com reserva atômica,
  limites de saída/chamadas, timeout, retomada e semântica/schema validados.
  O adapter atual recusa qualquer ativação live, mesmo com key no ambiente.
- **MCP:** iniciar por stdio local; remoto somente com TLS, OAuth, audience,
  scopes, version negotiation, isolamento, quotas e testes de cliente.
- **n8n:** importar JSON inativo em versão compatível; configurar credenciais
  pelo cofre da instância. O backend autoriza o job e confirma publicação antes
  de qualquer notificação. HMAC/replay/idempotência devem ser testes de staging.
- **Hostinger:** inventariar VPS, backups, versão/capacidade/rede antes de instalar.
  Isolar projeto de serviços existentes; TLS, firewall, volumes e recovery.
  Nunca hospedar a demonstração com seletor de personas na internet.

## Gates antes de piloto com clientes

| Gate | Evidência necessária |
|---|---|
| Identidade | MFA, login/convite/expiry e identidade assinada no servidor |
| Isolamento | API + RLS + Storage + cache testados com organizações distintas |
| Dados | Consentimento, retenção/exclusão e fontes com timestamps/qualidade |
| IA | Budget persistente; refusal/incomplete/injection sem publicação |
| Automação | Webhook auth, replay, quotas, retry, idempotency e jobs duráveis |
| Operação | Backups/restauração, incidente, métricas e reversão demonstrados |
| Consultoria | Escopo comercial/jurídico revisado para o serviço efetivo |

Essa lista é um gate do projeto, não uma declaração de conformidade ou auditoria
de produção. Execução de investimentos não será habilitada por este staging.

## Reversão

Desligar adapters/jobs, revogar publicação e credenciais afetadas, retornar à
versão aprovada do serviço e restaurar dados por procedimento ensaiado. Migração
SQL inicial deve ser testada num projeto descartável; não apagar tabelas ou
desativar RLS de um ambiente existente como mecanismo de reversão.
