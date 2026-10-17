/** Account controls only. Auth/RLS decide identity, assurance and all product access. */
import { MAX_TOTP_QR_IMAGE_LENGTH } from './auth-controls.mjs';
export const OFFICIAL_PORTAL_ORIGIN = 'https://capital.camaleaoweb3.com.br';
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
function element(tag, text = '', cls = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = cls; return node;
}
function field(label, id, type, options = {}) {
  const wrapper = element('div', '', 'field'), caption = element('label', label), input = element('input');
  caption.htmlFor = id; input.id = id; input.type = type; input.required = true;
  Object.assign(input, options); wrapper.append(caption, input); return { wrapper, input };
}
function enrollmentQr(value) {
  if (typeof value !== 'string' || value.length > MAX_TOTP_QR_IMAGE_LENGTH) return null;
  // SVG is loaded only as an image, never inserted into the DOM as markup.
  if (value.startsWith('data:image/svg+xml;')) return value;
  if (/^\s*<svg[\s>]/i.test(value)) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(value);
  return null;
}

/**
 * Integration: auth = createAuthControls({request,onSession}).
 * onAuthenticated must re-read the server session after MFA before opening workspace.
 * onPasswordUpdated must end the temporary flow and return to a normal login.
 */
export class AuthControlsUI {
  constructor({ root, auth, onAuthenticated = async () => {}, onPasswordUpdated = async () => {}, onCancel = async () => {},
    officialOrigin = OFFICIAL_PORTAL_ORIGIN, environmentLabel = 'Homologação · somente contas e dados fictícios' }) {
    if (officialOrigin !== OFFICIAL_PORTAL_ORIGIN) throw new Error('Endereço oficial inválido.');
    Object.assign(this, { root, auth, onAuthenticated, onPasswordUpdated, onCancel, officialOrigin, environmentLabel }); this.clear();
  }
  clear() {
    ++this.epoch; if (!Number.isFinite(this.epoch)) this.epoch = 1;
    this.pending = false; this.enrollment = null; this.accessLink = null; this.factorId = null;
    for (const input of this.root.querySelectorAll('input')) input.value = '';
    this.root.replaceChildren(); this.root.hidden = true; this.root.setAttribute('aria-busy', 'false');
  }
  begin(title, intro) {
    this.root.hidden = false;
    const heading = element('h2', title); heading.tabIndex = -1;
    const official = element('p'); official.append(element('strong', 'Portal oficial: '), document.createTextNode(this.officialOrigin));
    const alert = element('p', '', 'auth-error'); alert.hidden = true; alert.tabIndex = -1; alert.setAttribute('role', 'alert');
    const status = element('p', '', 'auth-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    this.root.replaceChildren(element('p', this.environmentLabel, 'notice'), heading, official, element('p', intro), alert, status);
    this.alert = alert; this.status = status; heading.focus();
  }
  error(text) { this.alert.textContent = text; this.alert.hidden = false; this.alert.focus(); }
  action(label, run, cls = '') {
    const button = element('button', label, cls); button.type = 'button';
    button.addEventListener('click', () => this.perform(run)); return button;
  }
  async perform(run) {
    if (this.pending) return; const epoch = this.epoch;
    this.pending = true; this.root.setAttribute('aria-busy', 'true');
    const controls = [...this.root.querySelectorAll('input,button,select')].map(input => ({ input, disabled: input.disabled }));
    for (const { input } of controls) input.disabled = true;
    if (this.alert) { this.alert.hidden = true; this.alert.textContent = ''; }
    try { await run(epoch); }
    catch { if (epoch === this.epoch) { if (this.status) this.status.textContent = ''; this.error('Não foi possível concluir. Confira os dados e tente novamente. Se continuar, peça apoio à equipe por um canal conhecido.'); } }
    finally {
      if (epoch === this.epoch) {
        this.pending = false; this.root.setAttribute('aria-busy', 'false');
        for (const { input, disabled } of controls) input.disabled = disabled;
      }
    }
  }
  cancelButton() {
    if (this.enrollment) {
      const factorId = this.enrollment.id;
      return this.action('Cancelar configuração e voltar', () => this.cancelEnrollment(factorId));
    }
    return this.action('Voltar para a entrada', async () => { this.clear(); await this.onCancel(); });
  }
  async cancelEnrollment(factorId) {
    const epoch = this.epoch;
    // Remove the QR/key immediately. Only the factor identifier remains for an explicit retry.
    this.enrollment = null; this.factorId = null;
    for (const input of this.root.querySelectorAll('input')) input.value = '';
    this.begin('Cancelar configuração incompleta', 'A remoção só alcança esta configuração ainda não confirmada. Autenticadores já verificados não serão excluídos por esta ação.');
    this.status.textContent = 'Solicitando a remoção da configuração incompleta…';
    try {
      await this.auth.cancelPendingTOTP(factorId);
      if (epoch !== this.epoch) return;
      this.clear(); await this.onCancel();
    } catch {
      if (epoch !== this.epoch) return;
      this.status.textContent = '';
      this.error('Não foi possível confirmar a remoção. A chave e o QR foram apagados desta tela; a configuração pode continuar na conta. Tente novamente ou saia e confira os fatores na próxima entrada.');
      this.root.append(this.action('Tentar remover configuração incompleta novamente', () => this.cancelEnrollment(factorId)),
        this.action('Sair sem remover configuração incompleta', async () => { this.clear(); await this.onCancel(); }));
    }
  }
  async startMfa() {
    this.clear(); const epoch = this.epoch;
    this.begin('Proteja o acesso da equipe', 'A área da equipe exige um segundo fator. Seus dados do portal só serão carregados após a confirmação no serviço.');
    this.status.textContent = 'Conferindo os fatores desta conta…';
    try {
      const factors = await this.auth.listFactors();
      if (epoch !== this.epoch) return;
      if (!Array.isArray(factors?.totp)) throw new Error();
      const verified = factors.totp.filter(item => item && typeof item.id === 'string' && item.status === 'verified');
      const pending = (Array.isArray(factors.all) ? factors.all : factors.totp).filter(item => item && typeof item.id === 'string' && item.status === 'unverified');
      this.status.textContent = '';
      if (verified.length) {
        this.factorId = verified[0].id;
        if (verified.length > 1) {
          const factor = field('Qual autenticador você quer usar?', 'auth-factor', 'text');
          const select = element('select'); select.id = 'auth-factor';
          for (const [index, entry] of verified.entries()) { const option = element('option', typeof entry.friendly_name === 'string' ? entry.friendly_name : 'Autenticador ' + (index + 1)); option.value = entry.id; select.append(option); }
          select.value = this.factorId; select.addEventListener('change', () => { this.factorId = select.value; });
          factor.wrapper.replaceChildren(factor.wrapper.children[0], select); this.root.append(factor.wrapper);
        }
        this.root.append(element('p', 'Abra o aplicativo autenticador cadastrado e informe o código atual. Não é um código enviado por mensagem.'));
        this.renderOtp();
      } else if (pending.length) {
        this.root.append(element('p', 'Existe uma configuração de autenticador que ainda não foi confirmada. Se você não concluiu essa configuração, remova-a antes de iniciar outra. Nenhuma remoção acontece automaticamente.'));
        for (const [index, factor] of pending.entries()) {
          const section = element('section', '', 'boundary');
          section.append(element('h3', typeof factor.friendly_name === 'string' && factor.friendly_name ? factor.friendly_name : 'Configuração incompleta ' + (index + 1)),
            this.action('Remover configuração incompleta', async taskEpoch => {
              this.status.textContent = 'Conferindo e removendo somente a configuração incompleta…';
              await this.auth.cancelPendingTOTP(factor.id); if (taskEpoch !== this.epoch) return;
              await this.startMfa();
            })); this.root.append(section);
        }
        this.root.append(element('p', 'Se você já confirmou o autenticador em outra janela, use Conferir novamente. O serviço não remove um fator verificado.', 'muted'),
          this.action('Conferir novamente', () => this.startMfa()), this.cancelButton());
      } else {
        this.root.append(element('p', 'Use um aplicativo autenticador que gere códigos temporários. A configuração mostrará uma chave exclusiva desta conta, somente nesta tela.'),
          this.action('Configurar autenticador', async taskEpoch => {
            this.status.textContent = 'Preparando a configuração…';
            const value = await this.auth.enrollTOTP();
            if (taskEpoch !== this.epoch) return;
            if (typeof value?.id !== 'string' || typeof value?.totp?.secret !== 'string' || value.totp.secret.length > 256) throw new Error();
            this.enrollment = value; this.factorId = value.id; this.renderEnrollment();
          }, 'primary'), this.cancelButton());
      }
    } catch {
      if (epoch !== this.epoch) return;
      this.status.textContent = ''; this.error('Não foi possível conferir os fatores. Tente novamente antes de abrir a área da equipe.');
      this.root.append(this.action('Conferir novamente', () => this.startMfa()), this.cancelButton());
    }
  }
  renderEnrollment() {
    const value = this.enrollment;
    this.begin('Configure seu autenticador', 'No aplicativo autenticador, adicione uma conta e leia este QR. Não compartilhe a chave, não envie capturas e confira o domínio antes de continuar.');
    const src = enrollmentQr(value.totp.qr_code);
    if (src) {
      const image = element('img'); image.src = src; image.alt = 'QR exclusivo para cadastrar este autenticador'; image.width = 240; image.height = 240; image.className = 'auth-enrollment-qr';
      this.root.append(image);
    }
    const manual = element('details'); manual.append(element('summary', src ? 'Não consigo ler o QR: digitar a chave manualmente' : 'Mostrar chave para configurar manualmente'),
      element('p', 'No aplicativo, escolha uma conta baseada em tempo (TOTP). A chave desaparece desta tela ao confirmar ou sair.'), element('code', value.totp.secret)); this.root.append(manual);
    this.root.append(element('p', 'Esta chave serve apenas ao autenticador da conta do portal. Nunca digite a frase de recuperação ou chave de uma carteira Web3 aqui.', 'muted'));
    this.renderOtp();
  }
  renderOtp() {
    const form = element('form'), { wrapper, input } = field('Código de 6 dígitos do aplicativo', 'auth-totp-code', 'text',
      { inputMode: 'numeric', autocomplete: 'one-time-code', minLength: 6, maxLength: 6, pattern: '[0-9]{6}' });
    const help = element('p', 'Use o código atual. Se ele acabou de mudar, digite o novo código.', 'muted'); help.id = 'auth-code-help'; input.setAttribute('aria-describedby', help.id);
    const submit = this.action('Confirmar código', async epoch => {
      const code = input.value.trim(); input.value = '';
      if (!/^[0-9]{6}$/.test(code)) { this.error('Digite exatamente os 6 dígitos do aplicativo autenticador.'); return; }
      this.status.textContent = 'Verificando o código…';
      await this.auth.verifyTOTP(this.factorId, code); if (epoch !== this.epoch) return;
      // Remove the enrollment secret before any private-data transition.
      this.enrollment = null; this.factorId = null; this.root.replaceChildren(); this.root.hidden = true;
      try { await this.onAuthenticated(); }
      catch { if (epoch === this.epoch) { this.begin('Confirme o acesso novamente', 'O segundo fator foi enviado, mas não foi possível conferir a sessão da equipe. Nenhum dado foi aberto por esta tela.'); this.root.append(this.action('Conferir sessão', async () => { await this.onAuthenticated(); }), this.cancelButton()); } }
    }, 'primary');
    form.addEventListener('submit', event => { event.preventDefault(); submit.click(); }); form.append(wrapper, help, submit); this.root.append(form, this.cancelButton());
  }
  showRecoveryRequest() {
    this.clear(); this.begin('Recuperar acesso', 'Solicite o link pelo seu próprio e-mail. O envio não cria vínculo com a Capital Web3 nem autoriza acesso a diagnósticos.');
    const form = element('form'), { wrapper, input } = field('Seu e-mail', 'auth-recovery-email', 'email', { autocomplete: 'username', maxLength: 254 });
    const submit = this.action('Solicitar link de recuperação', async epoch => {
      const email = input.value.trim();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) { this.error('Informe seu e-mail para solicitar o link.'); return; }
      input.value = ''; this.status.textContent = 'Solicitando o link…';
      await this.auth.recover(email, this.officialOrigin + '/'); if (epoch !== this.epoch) return;
      this.begin('Confira seu e-mail', 'Se a solicitação puder ser atendida, você receberá as próximas instruções no e-mail informado. Confira também a pasta de spam. A resposta não confirma se existe uma conta.');
      this.root.append(this.cancelButton());
    }, 'primary');
    form.addEventListener('submit', event => { event.preventDefault(); submit.click(); }); form.append(wrapper, submit); this.root.append(form, this.cancelButton());
  }
  startAccessLink(link) {
    this.clear();
    if (!link || !['invite', 'recovery'].includes(link.type) || typeof link.accessToken !== 'string' || !link.accessToken || !Number.isFinite(link.expiresIn) || link.expiresIn <= 0) {
      this.begin('Link indisponível', 'Não foi possível usar este link. Solicite outro por um canal conhecido da equipe ou use a recuperação de acesso.'); this.root.append(this.cancelButton()); return;
    }
    this.accessLink = { type: link.type, accessToken: link.accessToken, expiresIn: link.expiresIn }; const title = link.type === 'invite' ? 'Defina sua senha de acesso' : 'Escolha uma nova senha';
    this.begin(title, 'Digite você mesmo uma senha exclusiva para a conta do portal. O link foi retirado da barra de endereço; esta tela não cria papéis ou vínculos de cliente.');
    const form = element('form'), first = field('Nova senha (mínimo de 12 caracteres)', 'auth-new-password', 'password', { autocomplete: 'new-password', minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH }),
      second = field('Repita a nova senha', 'auth-confirm-password', 'password', { autocomplete: 'new-password', minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH });
    form.append(first.wrapper, second.wrapper, element('p', 'Não use senha de outro serviço, frase de recuperação ou chave privada de carteira. Você pode colar uma senha criada pelo seu gerenciador.', 'muted'));
    const submit = this.action('Salvar minha senha', async epoch => {
      const password = first.input.value, confirmation = second.input.value;
      if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH || /[\r\n]/.test(password)) { this.error('Use uma senha exclusiva com 12 a 128 caracteres, sem quebras de linha.'); return; }
      if (password !== confirmation) { this.error('As senhas precisam ser iguais. Confira e tente novamente.'); return; }
      first.input.value = ''; second.input.value = ''; this.status.textContent = 'Salvando a senha…';
      const result = await this.auth.updatePassword(this.accessLink.accessToken, password); if (epoch !== this.epoch) return;
      this.accessLink = null;
      this.begin('Senha salva', 'Entre novamente com seu e-mail e a nova senha. A equipe ainda precisa manter seu vínculo autorizado; o segundo fator será solicitado quando necessário.');
      if (result?.session_ended === false) this.root.append(element('p', 'A saída remota da sessão temporária não foi confirmada. O link será descartado deste navegador; entre novamente e peça apoio à equipe se precisar conferir outros acessos.', 'notice'));
      await this.onPasswordUpdated(result); if (epoch !== this.epoch) return;
      this.root.append(this.cancelButton());
    }, 'primary');
    form.addEventListener('submit', event => { event.preventDefault(); submit.click(); }); form.append(submit); this.root.append(form, this.cancelButton());
  }
}
