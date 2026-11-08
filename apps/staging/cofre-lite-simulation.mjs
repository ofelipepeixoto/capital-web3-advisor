import { SIGNAL_IDS, assessSignals } from './cofre-lite-signals.mjs';
// Local synthetic learning exercise. Not an assessment, report or persistence API.
const SECTIONS = [
  { title: 'Diagnóstico', questions: [
    ['experience', 'Qual é a experiência fictícia da pessoa?', [['', 'Não informado'], ['beginner', 'Está começando'], ['some', 'Já usou carteira própria'], ['unknown', 'Não sabe informar']]],
    ['backup', 'Existe uma prática de backup?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['na', 'Não se aplica']]],
  ] },
  { title: 'Mapa de funções', questions: [
    ['vault', 'Existe uma função separada para reserva?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['na', 'Não se aplica']]],
    ['apps', 'Existe uma função específica para uso de aplicativos?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['na', 'Não se aplica']]],
    ['spending', 'Existe uma função para gastos?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['na', 'Não se aplica']]],
    ['testing', 'É necessária uma função de teste ou uso público?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['na', 'Não se aplica']]],
    ['watch', 'É necessária uma função somente de observação?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['na', 'Não se aplica']]],
  ] },
  { title: 'Recuperação', questions: [
    ['recovery', 'O procedimento de recuperação foi testado pela própria pessoa?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['na', 'Não se aplica']]],
    ['secret_exposure', 'Foi informada exposição de um segredo?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar']]],
  ] },
  { title: 'Prevenção', questions: [
    ['source', 'A origem e o domínio foram conferidos?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['na', 'Não se aplica']]],
    ['urgency', 'A oferta pressiona você a entrar agora?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['guaranteed_return', 'Existe promessa de lucro ou renda garantida?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['unsolicited_link', 'O link veio por mensagem inesperada ou perfil parecido?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['different_domain', 'O domínio difere do oficial ou parece alterado?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['unverified_contract', 'Não foi possível conferir o contrato ou token?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['unlimited_approval', 'Foi solicitada permissão ilimitada sem necessidade clara?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['secret_request', 'Foi solicitado segredo, chave privada ou código de autenticação?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['missing_team_docs', 'Faltam informações verificáveis sobre equipe ou documentação?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['unclear_tokenomics', 'Distribuição, prazos ou desbloqueios estão pouco claros?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['profit_screenshots', 'A oferta depende de prints ou depoimentos de lucro?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
  ] },
  { title: 'Permissões', questions: [
    ['permissions', 'Há uma rotina para revisar permissões?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['na', 'Não se aplica']]],
    ['payload', 'O efeito de uma assinatura é compreendido antes da ação?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['na', 'Não se aplica']]],
  ] },
  { title: 'Rotina', questions: [
    ['routine', 'A rotina de revisão está combinada?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['na', 'Não se aplica']]],
  ] },
];
const QUESTIONS = SECTIONS.flatMap(section => section.questions);

const node = (tag, text = '') => { const n = document.createElement(tag); n.textContent = text; return n; };
export function liteSummary(answers) {
  const missing = QUESTIONS.filter(([id]) => !answers[id] || answers[id] === 'unknown').length;
  const input = Object.fromEntries(SIGNAL_IDS.map(id => [id, answers[id] || 'unknown']));
  const signals = assessSignals(input);
  const critical = answers.secret_exposure === 'yes' || signals.status === 'blocked';
  return { critical, missing, signals, state: critical ? 'blocked' : missing ? 'incomplete' : 'review' };
}
export class LiteSimulation {
  constructor(root, { api = null, cases = () => [], confirm = () => false } = {}) {
    Object.assign(this, { root, api, cases, confirm }); this.epoch = 0; this.clear();
  }
  clear() {
    this.epoch++; this.answers = {}; this.step = 0; this.dirty = false; this.caseId = ''; this.revision = 0;
    this.loaded = false; this.pending = false; this.consents = { assessment: false, storage: false };
    this.keys = new Map(); this.notice = ''; this.root.replaceChildren();
  }
  signals() { return Object.fromEntries(SIGNAL_IDS.map(id => [id, this.answers[id] || 'unknown'])); }
  async load() {
    if (!this.api || !this.caseId || this.pending) return;
    if (this.dirty && !this.confirm('Carregar substituirá as respostas deste exercício nesta sessão. Continuar?')) return;
    const epoch = this.epoch, id = this.caseId; this.pending = true; this.notice = 'Conferindo acesso ao atendimento…'; this.render();
    try {
      const result = await this.api('/cofre/cases/' + id + '/lite-signals');
      if (epoch !== this.epoch || id !== this.caseId) return;
      const row = result.data;
      if (row !== null && (!row || !Number.isInteger(row.revision) || row.revision<1 || row.intake?.schema_version !== 'cofre-lite-signals-0.1')) throw new Error('Resposta inválida.');
      if (row) { assessSignals(row.intake.signals); if (row.intake.synthetic !== true || row.intake.consents?.assessment !== true || row.intake.consents?.storage !== true) throw new Error('Resposta inválida.'); }
      this.answers = row ? { ...row.intake.signals } : {}; this.revision = row?.revision || 0;
      this.consents = row ? { assessment: true, storage: true } : { assessment: false, storage: false };
      this.loaded = true; this.dirty = false; this.notice = row ? 'Sinais salvos carregados. Outras respostas do exercício não são armazenadas.' : 'Nenhum sinal salvo neste atendimento. Marque os dois consentimentos antes de salvar.';
    } catch { if (epoch === this.epoch && id === this.caseId) { this.loaded = false; this.notice = 'Não foi possível carregar. A função pode estar desabilitada ou o acesso ao atendimento indisponível.'; } }
    finally { if (epoch === this.epoch && id === this.caseId) { this.pending = false; this.render(); } }
  }
  async save() {
    if (!this.api || !this.caseId || !this.loaded || this.pending) return;
    if (!this.consents.assessment || !this.consents.storage) { this.notice = 'Marque os dois consentimentos antes de salvar os sinais fictícios.'; this.render(); return; }
    const epoch = this.epoch, id = this.caseId, revision = this.revision, signals = this.signals();
    const intake = { schema_version: 'cofre-lite-signals-0.1', synthetic: true, consents: { ...this.consents }, signals };
    const fingerprint = JSON.stringify({ id, revision, intake });
    if (!this.keys.has(fingerprint)) this.keys.set(fingerprint, crypto.randomUUID());
    this.pending = true; this.notice = 'Salvando sinais…'; this.render();
    try {
      const result = await this.api('/cofre/cases/' + id + '/lite-signals', { intake, expected_revision: revision, idempotency_key: this.keys.get(fingerprint) });
      if (epoch !== this.epoch || id !== this.caseId) return;
      if (!Number.isInteger(result.data?.revision) || result.data.revision !== revision + 1) throw new Error('Resposta inválida.');
      this.revision = result.data.revision;
      this.dirty = JSON.stringify(this.signals()) !== JSON.stringify(signals) || Object.keys(this.answers).some(key => !SIGNAL_IDS.includes(key));
      this.notice = this.dirty ? 'Sinais salvos. Outras respostas ou alterações posteriores continuam apenas nesta sessão.' : 'Sinais salvos neste atendimento. Nenhum relatório foi gerado.';
    } catch (error) {
      if (epoch === this.epoch && id === this.caseId) this.notice = error.status === 409 ? 'Outra revisão alterou os sinais. Suas respostas continuam nesta sessão; confira antes de carregar a versão salva.' : error.status === 429 ? 'Limite de salvamentos atingido. Procure a equipe.' : 'Não foi possível confirmar o salvamento. Suas respostas continuam nesta sessão.';
    } finally { if (epoch === this.epoch && id === this.caseId) { this.pending = false; this.render(); } }
  }
  reconcile() {
    if (this.caseId && !this.cases().some(item => item.id === this.caseId)) { this.clear(); return false; }
    return true;
  }
  render({ focus = false } = {}) {
    const section = SECTIONS[this.step], heading = node('h3', `Etapa ${this.step + 1} de ${SECTIONS.length} · ${section.title}`);
    heading.tabIndex = -1;
    const notice = node('p', 'Exercício fictício: somente os dez sinais podem ser salvos em um atendimento autorizado. As demais respostas ficam nesta sessão. Não informe dados reais, endereços, senhas, códigos ou segredos.');
    notice.className = 'notice'; this.root.replaceChildren(notice, heading);
    const progress = node('progress'); progress.max = SECTIONS.length; progress.value = this.step + 1; progress.setAttribute('aria-label', 'Etapa do exercício'); this.root.append(progress);
    const result = node('p'); result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite'); let summaryStatus;
    const updateAlert = () => { const value = liteSummary(this.answers);
      result.textContent = value.critical ? 'Alerta crítico: interrompa a interação e procure atendimento humano adequado. Não informe segredos.' : value.signals.flagged_signals ? 'Há sinais relatados. Pause e peça revisão humana antes de agir.' : '';
      if (summaryStatus) summaryStatus.textContent = value.critical ? 'Alerta crítico. Interrompa a interação e peça orientação humana adequada.' : value.missing ? `Exercício incompleto: ${value.missing} respostas não informadas ou desconhecidas.` : 'Respostas preenchidas. A equipe deve revisar o contexto e as evidências antes de qualquer conclusão.';
    };
    updateAlert(); this.root.append(result);
    if (this.api) {
      const group = node('section'); group.className = 'boundary'; const title = node('h3', 'Sinais no atendimento');
      const hint = node('p', 'Selecione um atendimento atribuído. O servidor verificará seu acesso e a disponibilidade ao carregar. Apenas os dez sinais da etapa Prevenção são armazenados.');
      const label = node('label', 'Atendimento fictício'), picker = node('select'); label.htmlFor = 'lite-case'; picker.id = 'lite-case'; picker.disabled = this.pending;
      const blank = node('option', 'Escolha um atendimento'); blank.value = ''; picker.append(blank);
      for (const item of this.cases()) { const option = node('option', item.client_safe_title || 'Atendimento fictício'); option.value = item.id; picker.append(option); }
      picker.value = this.caseId; picker.addEventListener('change', () => {
        const next = picker.value;
        if (next === this.caseId) return;
        if (this.dirty && !this.confirm('Trocar de atendimento descartará as respostas deste exercício nesta sessão. Continuar?')) { picker.value = this.caseId; return; }
        this.clear(); this.caseId = next; this.render();
      });
      const load = node('button', 'Carregar sinais do atendimento'); load.type = 'button'; load.disabled = !this.caseId || this.pending; load.addEventListener('click', () => this.load());
      group.append(title, hint, label, picker, load);
      if (this.loaded) {
        group.append(node('p', 'As marcações confirmam este salvamento. Desmarcá-las impede novos salvamentos e não revoga automaticamente dados já armazenados.'));
        for (const [key,text] of [['assessment','Autorizo a avaliação dos sinais fictícios.'],['storage','Autorizo salvar os sinais fictícios neste atendimento.']]) {
          const caption = node('label'); caption.className = 'choice'; const input = node('input'); input.type = 'checkbox'; input.checked = this.consents[key]; input.disabled = this.pending;
          input.addEventListener('change', () => { this.consents[key] = input.checked; }); caption.append(input, document.createTextNode(text)); group.append(caption);
        }
        const save = node('button', 'Salvar sinais no atendimento'); save.type = 'button'; save.disabled = this.pending; save.addEventListener('click', () => this.save()); group.append(save);
      }
      const status = node('p', this.notice); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); group.append(status); this.root.append(group);
    }
    for (const [id, label, options] of section.questions) {
      const field = node('fieldset'), legend = node('legend', label); field.append(legend);
      for (const [value, name] of options.filter(([v]) => v)) {
        const caption = node('label'); caption.className = 'choice'; const input = node('input'); input.type = 'radio'; input.name = 'lite-' + id; input.value = value; input.checked = this.answers[id] === value; input.disabled = this.pending;
        input.addEventListener('change', () => { if (input.checked) { this.answers[id] = value; this.dirty = true; updateAlert(); } });
        caption.append(input, document.createTextNode(name)); field.append(caption);
      }
      this.root.append(field);
    }
    if (this.step === SECTIONS.length - 1) {
      const summary = node('div'), title = node('h3', 'Panorama deste exercício'); summaryStatus = node('p'); summary.append(title, summaryStatus); updateAlert();
      summary.append(node('p', 'Respostas declaradas não comprovam controles. Este exercício não gera pontuação, aprovação, monitoramento ou diagnóstico.'));
      summary.className = 'boundary'; this.root.append(summary);
    }
    const actions = node('div'); actions.className = 'actions';
    const action = (label, run, cls = '') => { const b = node('button', label); b.type = 'button'; b.className = cls; b.disabled = this.pending; b.addEventListener('click', run); return b; };
    if (this.step > 0) actions.append(action('Voltar', () => { this.step--; this.render({ focus: true }); }));
    if (this.step < SECTIONS.length - 1) actions.append(action('Continuar', () => { this.step++; this.render({ focus: true }); }, 'primary'));
    this.root.append(actions); if (focus) heading.focus();
  }
}
