# Acesso ao portal oficial

Destino único para a interface e links de conta:
<https://capital.camaleaoweb3.com.br/>. O endereço Sites anterior serve a mesma
publicação, com as mesmas regras de dados; não é uma segunda base para migrar.

## Comportamento implementado

1. A senha autentica no Supabase; o portal consulta apenas o requisito de MFA
   da própria conta antes de solicitar roster, casos ou relatórios.
2. Workspaces COFRE novos e existentes exigem segundo fator da equipe. A
   verificação usa TOTP real do Auth; `aal1` não recebe os privilégios de `aal2`.
   Um cliente que já tenha fator verificado também precisa usá-lo para COFRE.
3. O titular cadastra o autenticador no seu próprio dispositivo. QR/chave ficam
   somente na matrícula em memória e são removidos antes da navegação privada.
   Configuração incompleta exige cancelamento explícito; fator verificado não
   pode ser removido por esta interface.
4. Convite/recuperação remove o fragmento da URL antes de buscar configuração.
   A senha é definida pelo próprio titular e o token temporário é encerrado no
   serviço após a alteração. Falha de logout é informada separadamente da senha
   já salva. O portal não concede vínculos ou papéis ao aceitar um link.
5. Bearer permanece em memória por no máximo uma hora, sem refresh token ou
   restauração automática. Logout e expiração limpam a interface; o banco
   revalida a existência da sessão nas entradas COFRE, inclusive RPC/Data API.

O bundle hospedado inclui CSP no HTML, com scripts/estilos locais, conexão ao
projeto Supabase exato e `data:` somente para imagens do QR. A configuração
Caddy opcional também emite headers. Proteção de frame/HSTS e outros controles
do host precisam ser verificados separadamente; a meta CSP não os implementa.

## Convites e e-mail

A interface recebe links de convite e implementa recuperação. O botão de envio
de recuperação permanece desabilitado na publicação até validar a URL e a entrega
real de e-mail; o teste local da capacidade não habilita esse envio. O envio de convites
e o roster continuam administrativos; não há cadastro público de papéis.
Antes de convidar pessoas reais, confirmar no Auth compartilhado:

- Redirect URL `https://capital.camaleaoweb3.com.br/` já salva e conferida após
  autorização; quatro entradas anteriores e Site URL preservadas. Sem wildcard.
- Conferir SMTP/remetente, expiração e limites de envio; testar ida/retorno com
  um e-mail de equipe autorizado. Não foram enviados convites neste ensaio.
- Provisionar o UUID confirmado no roster Capital com papel e caso explícitos;
  verificação de e-mail sozinha não concede acesso a diagnósticos.
- Documentar recuperação de MFA com verificação humana de identidade e retirada
  de sessões; não remover fatores de contas reais por automação genérica.

## Rollout e reversão

Executar CI descartável completa antes de aplicar a migração. Publicar backend
e interface compatíveis no mesmo procedimento. A migração ativa a exigência
nos workspaces existentes; contas da equipe precisarão configurar o seu fator.
Não alterar a exigência global do Auth de outras aplicações.

Uma reversão deve manter uma interface compatível com MFA. Voltar só ao Site v3
pode impedir login da equipe, pois a interface antiga não oferece desafio TOTP.
Não apagar fatores, desligar guards ou editar dados reais para destravar rollback.

O teste local usa Auth/PostgREST reais e Chromium com uma ponte para o handler
Edge. Resultados hospedados e e-mail efetivamente enviado devem ser registrados
separadamente. Esta capacidade não libera dados reais, anexos ou chamadas pagas.
