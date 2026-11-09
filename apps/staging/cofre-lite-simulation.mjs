import { SIGNAL_IDS, assessSignals } from './cofre-lite-signals.mjs';
// Synthetic COFRE Lite intake. Server controls authorization and stores only the closed schema.
const SECTIONS = [
  { title: 'Diagnóstico', questions: [
    ['experience', 'Qual é a experiência fictícia da pessoa?', [['', 'Não informado'], ['beginner', 'Está começando'], ['some', 'Já usou carteira própria'], ['unknown', 'Não sabe informar']]],
    ['backup', 'Existe uma prática de backup?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
  ] },
  { title: 'Mapa de funções', questions: [
    ['vault', 'Existe uma função separada para reserva?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['apps', 'Existe uma função específica para uso de aplicativos?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['spending', 'Existe uma função para gastos?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['testing', 'É necessária uma função de teste ou uso público?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['watch', 'É necessária uma função somente de observação?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
  ] },
  { title: 'Recuperação', questions: [
    ['recovery', 'O procedimento de recuperação foi testado pela própria pessoa?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['secret_exposure', 'Foi informada exposição de um segredo?', [['', 'Não informado'], ['yes', 'Sim'], ['no', 'Não'], ['unknown', 'Não sabe informar']]],
  ] },
  { title: 'Prevenção', questions: [
    ['source', 'A origem e o domínio foram conferidos?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
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
    ['permissions', 'Há uma rotina para revisar permissões?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
    ['payload', 'O efeito de uma assinatura é compreendido antes da ação?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
  ] },
  { title: 'Rotina', questions: [
    ['routine', 'A rotina de revisão está combinada?', [['', 'Não informado'], ['yes', 'Sim, declarado'], ['no', 'Não'], ['unknown', 'Não sabe informar'], ['not_applicable', 'Não se aplica']]],
  ] },
];
const QUESTIONS = SECTIONS.flatMap(section => section.questions);
const CONTROL_IDS = ['backup', 'vault', 'apps', 'spending', 'testing', 'watch', 'recovery', 'secret_exposure', 'source', 'permissions', 'payload', 'routine'];
const ANSWERS = new Set(['yes', 'no', 'unknown', 'not_applicable']);
// Monthly items are a practice aid only; completion is declared, not verified.
export const MONTHLY_TASKS = [
  ['wallet_roles', 'Revisar as funções atribuídas às carteiras.'],
  ['vault_connections', 'Verificar se a carteira de reserva foi conectada a aplicativos.'],
  ['permissions', 'Revisar permissões de uso ainda abertas.'],
  ['unusual_activity', 'Verificar se há movimentações desconhecidas.'],
  ['inventory', 'Atualizar o inventário de carteiras e redes.'],
  ['protocols', 'Atualizar a lista de protocolos e contratos utilizados.'],
  ['offline_backup', 'Confirmar a existência do backup físico, sem informar seu conteúdo.'],
];
export function monthlySummary(answers) {
  const done = MONTHLY_TASKS.filter(([id]) => answers[id] === 'done').length;
  const pending = MONTHLY_TASKS.filter(([id]) => answers[id] === 'pending').length;
  return { done, pending, unassessed: MONTHLY_TASKS.length - done - pending };
}
const validIntake = value => {
  if (!value || value.schema_version !== 'cofre-lite-intake-0.2' || value.synthetic !== true ||
      value.consents?.assessment !== true || value.consents?.storage !== true ||
      !['beginner', 'some', 'unknown'].includes(value.profile?.experience) ||
      !value.controls || Object.keys(value.controls).length !== CONTROL_IDS.length ||
      CONTROL_IDS.some(id => !ANSWERS.has(value.controls[id])) || value.controls.secret_exposure === 'not_applicable') return false;
  try { assessSignals(value.signals); return true; } catch { return false; }
};

const node = (tag, text = '') => { const n = document.createElement(tag); n.textContent = text; return n; };
export function liteSummary(answers) {
  const missing = QUESTIONS.filter(([id]) => !answers[id] || answers[id] === 'unknown').length;
  const input = Object.fromEntries(SIGNAL_IDS.map(id => [id, answers[id] || 'unknown']));
  const signals = assessSignals(input);
  const critical = answers.secret_exposure === 'yes' || signals.status === 'blocked';
  return { critical, missing, signals, state: critical ? 'blocked' : missing ? 'incomplete' : 'review' };
}
export class LiteSimulation {
  constructor(root, { api = null, cases = () => [], confirm = () => false, onGenerated = async () => {} } = {}) {
    Object.assign(this, { root, api, cases, confirm, onGenerated }); this.epoch = 0; this.clear();
  }
  clear() {
    this.epoch++; this.answers = {}; this.routineAnswers = {}; this.routineDirty = false; this.step = 0; this.dirty = false; this.caseId = ''; this.revision = 0;
    this.loaded = false; this.legacyAvailable = false; this.legacyRevision = null; this.pending = false; this.consents = { assessment: false, storage: false };
    this.keys = new Map(); this.notice = ''; this.root.replaceChildren();
  }
  signals() { return Object.fromEntries(SIGNAL_IDS.map(id => [id, this.answers[id] || 'unknown'])); }
  intake() {
    return { schema_version: 'cofre-lite-intake-0.2', synthetic: true, consents: { ...this.consents },
      profile: { experience: this.answers.experience || 'unknown' },
      controls: Object.fromEntries(CONTROL_IDS.map(id => [id, this.answers[id] || 'unknown'])), signals: this.signals() };
  }
  async load() {
    if (!this.api || !this.caseId || this.pending) return;
    if (this.dirty && !this.confirm('Carregar substituirá as respostas deste exercício nesta sessão. Continuar?')) return;
    const epoch = this.epoch, id = this.caseId; this.pending = true; this.notice = 'Conferindo acesso ao atendimento…'; this.render();
    try {
      const result = await this.api('/cofre/cases/' + id + '/lite-intake');
      if (epoch !== this.epoch || id !== this.caseId) return;
      const row = result.data;
      if (row?.legacy_available === true) {
        if (!Number.isInteger(row.legacy_revision) || row.legacy_revision < 1) throw new Error('Resposta inválida.');
        this.legacyRevision = row.legacy_revision; this.loaded = false; this.legacyAvailable = true; this.answers = {}; this.revision = 0; this.dirty = false;
        this.consents = { assessment: false, storage: false };
        this.notice = 'Há sinais anteriores neste atendimento. Escolha carregá-los ou iniciar sem eles; o registro anterior não será excluído.';
        return;
      }
      this.legacyAvailable = false;
      if (row !== null && (!row || !Number.isInteger(row.revision) || row.revision<1 || !validIntake(row.intake))) throw new Error('Resposta inválida.');
      this.legacyRevision = row?.legacy_revision ?? null;
      if (this.legacyRevision !== null && (!Number.isInteger(this.legacyRevision) || this.legacyRevision < 1)) throw new Error('Resposta inválida.');
      this.answers = row ? { ...row.intake.profile, ...row.intake.controls, ...row.intake.signals } : {}; this.revision = row?.revision || 0;
      this.consents = row ? { assessment: true, storage: true } : { assessment: false, storage: false };
      this.loaded = true; this.dirty = false; this.notice = row ? 'Respostas salvas carregadas. Revise as etapas antes de continuar.' : 'Nenhuma resposta salva neste atendimento. Marque os dois consentimentos antes de salvar.';
    } catch { if (epoch === this.epoch && id === this.caseId) { this.loaded = false; this.notice = 'Não foi possível carregar. A função pode estar desabilitada ou o acesso ao atendimento indisponível.'; } }
    finally { if (epoch === this.epoch && id === this.caseId) { this.pending = false; this.render(); } }
  }
  async importLegacy() {
    if (!this.api || !this.caseId || !this.legacyAvailable || this.pending) return;
    const epoch = this.epoch, id = this.caseId;
    this.pending = true; this.notice = 'Carregando sinais anteriores…'; this.render();
    try {
      const result = await this.api('/cofre/cases/' + id + '/lite-signals');
      if (epoch !== this.epoch || id !== this.caseId) return;
      const intake = result.data?.intake;
      if (result.data?.revision !== this.legacyRevision) throw Object.assign(new Error('legacy_changed'), { legacyChanged: true });
      if (!intake || intake.schema_version !== 'cofre-lite-signals-0.1' || intake.synthetic !== true ||
          intake.consents?.assessment !== true || intake.consents?.storage !== true) throw new Error('Resposta inválida.');
      assessSignals(intake.signals);
      // Import only missing answers; choices already made in this session take precedence.
      this.answers = { ...intake.signals, ...this.answers }; this.revision = 0; this.loaded = true; this.legacyAvailable = false;
      this.consents = { assessment: false, storage: false }; this.dirty = true;
      this.notice = 'Sinais anteriores carregados sem substituir respostas desta sessão. Revise as respostas e confirme os consentimentos para salvar a nova versão.';
    } catch (error) { if (epoch === this.epoch && id === this.caseId) this.notice = error.legacyChanged ? 'Os sinais anteriores mudaram. Use Carregar respostas do atendimento para conferir a revisão atual.' : 'Não foi possível carregar os sinais anteriores. Tente novamente ou procure a equipe.'; }
    finally { if (epoch === this.epoch && id === this.caseId) { this.pending = false; this.render(); } }
  }
  startWithoutLegacy() {
    if (!this.legacyAvailable || this.pending) return;
    if (!this.confirm('A nova avaliação começará sem os sinais anteriores. O registro anterior continuará guardado. Continuar?')) return;
    this.answers = {}; this.revision = 0; this.loaded = true; this.legacyAvailable = false; this.dirty = false;
    this.consents = { assessment: false, storage: false };
    this.notice = 'Nova avaliação iniciada sem os sinais anteriores. Confirme os consentimentos antes de salvar.'; this.render();
  }
  async save() {
    if (!this.api || !this.caseId || !this.loaded || this.pending) return;
    if (!this.consents.assessment || !this.consents.storage) { this.notice = 'Marque os dois consentimentos antes de salvar as respostas fictícias.'; this.render(); return; }
    const epoch = this.epoch, id = this.caseId, revision = this.revision, intake = this.intake();
    const fingerprint = JSON.stringify({ id, revision, legacyRevision: this.legacyRevision, intake });
    if (!this.keys.has(fingerprint)) this.keys.set(fingerprint, crypto.randomUUID());
    this.pending = true; this.notice = 'Salvando respostas…'; this.render();
    try {
      const result = await this.api('/cofre/cases/' + id + '/lite-intake', { intake, expected_revision: revision, legacy_revision: this.legacyRevision, idempotency_key: this.keys.get(fingerprint) });
      if (epoch !== this.epoch || id !== this.caseId) return;
      if (!Number.isInteger(result.data?.revision) || result.data.revision !== revision + 1) throw new Error('Resposta inválida.');
      this.revision = result.data.revision; this.legacyRevision = null;
      this.dirty = JSON.stringify(this.intake()) !== JSON.stringify(intake);
      this.notice = this.dirty ? 'Respostas salvas. Alterações posteriores ainda precisam ser salvas.' : 'Respostas salvas neste atendimento. Nenhum relatório foi gerado.';
    } catch (error) {
      if (epoch === this.epoch && id === this.caseId) this.notice = error.status === 409 ? 'Outra revisão alterou as respostas. Suas respostas continuam nesta sessão; confira antes de carregar a versão salva.' : error.status === 429 ? 'Limite de salvamentos atingido. Procure a equipe.' : 'Não foi possível confirmar o salvamento. Suas respostas continuam nesta sessão.';
    } finally { if (epoch === this.epoch && id === this.caseId) { this.pending = false; this.render(); } }
  }
  async generateDraft() {
    if (!this.api || !this.caseId || !this.loaded || this.pending || this.dirty || this.revision < 1 || !this.consents.assessment || !this.consents.storage) return;
    const epoch = this.epoch, id = this.caseId, revision = this.revision;
    const fingerprint = JSON.stringify({ action: 'lite-report', id, revision });
    if (!this.keys.has(fingerprint)) this.keys.set(fingerprint, crypto.randomUUID());
    this.pending = true; this.notice = 'Gerando rascunho a partir das respostas salvas…'; this.render();
    let reportId;
    try {
      const result = await this.api('/cofre/cases/' + id + '/lite-report', { expected_revision: revision, idempotency_key: this.keys.get(fingerprint) });
      if (epoch !== this.epoch || id !== this.caseId) return;
      if (result.data?.case_id !== id || result.data?.intake_revision !== revision || typeof result.data?.report_version_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.data.report_version_id)) throw new Error('Resposta inválida.');
      reportId = result.data.report_version_id;
    } catch (error) {
      if (epoch === this.epoch && id === this.caseId) this.notice = error.status === 409 ? 'As respostas salvas mudaram. Recarregue o atendimento antes de gerar o rascunho.' : error.status === 429 ? 'Limite de geração atingido. Procure a equipe.' : 'Não foi possível confirmar a geração. Tente novamente; o pedido será repetido com a mesma chave.';
    } finally { if (epoch === this.epoch && id === this.caseId) { this.pending = false; this.render(); } }
    if (!reportId || epoch !== this.epoch || id !== this.caseId) return;
    try { await this.onGenerated(reportId); }
    catch { if (epoch === this.epoch && id === this.caseId) { this.notice = 'Rascunho gerado. Não foi possível abri-lo agora; procure-o na lista de diagnósticos.'; this.render(); } }
  }
  reconcile() {
    if (this.caseId && !this.cases().some(item => item.id === this.caseId)) { this.clear(); return false; }
    return true;
  }
  render({ focus = false } = {}) {
    const section = SECTIONS[this.step], heading = node('h3', `Etapa ${this.step + 1} de ${SECTIONS.length} · ${section.title}`);
    heading.tabIndex = -1;
    const notice = node('p', 'Homologação: salve as respostas fictícias em um atendimento autorizado. Não informe dados reais, endereços, senhas, códigos ou segredos.');
    notice.className = 'notice'; this.root.replaceChildren(notice, heading);
    const progress = node('progress'); progress.max = SECTIONS.length; progress.value = this.step + 1; progress.setAttribute('aria-label', 'Etapa do exercício'); this.root.append(progress);
    const result = node('p'); result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite'); let summaryStatus, generate;
    const updateAlert = () => { const value = liteSummary(this.answers);
      result.textContent = value.critical ? 'Alerta crítico: interrompa a interação e procure atendimento humano adequado. Não informe segredos.' : value.signals.flagged_signals ? 'Há sinais relatados. Pause e peça revisão humana antes de agir.' : '';
      if (generate) generate.disabled = this.pending || this.dirty || !this.consents.assessment || !this.consents.storage || this.revision < 1;
      if (summaryStatus) summaryStatus.textContent = value.critical ? 'Alerta crítico. Interrompa a interação e peça orientação humana adequada.' : value.missing ? `Exercício incompleto: ${value.missing} respostas não informadas ou desconhecidas.` : 'Respostas preenchidas. A equipe deve revisar o contexto e as evidências antes de qualquer conclusão.';
    };
    updateAlert(); this.root.append(result);
    if (this.api) {
      const group = node('section'); group.className = 'boundary'; const title = node('h3', 'Respostas no atendimento');
      const hint = node('p', 'Selecione um atendimento atribuído. O servidor verificará seu acesso e a disponibilidade ao carregar. Salvar uma nova revisão suspende entregas Lite anteriores deste atendimento; depois será necessário gerar, revisar e publicar uma nova versão.');
      const label = node('label', 'Atendimento fictício'), picker = node('select'); label.htmlFor = 'lite-case'; picker.id = 'lite-case'; picker.disabled = this.pending;
      const blank = node('option', 'Escolha um atendimento'); blank.value = ''; picker.append(blank);
      for (const item of this.cases()) { const option = node('option', item.client_safe_title || 'Atendimento fictício'); option.value = item.id; picker.append(option); }
      picker.value = this.caseId; picker.addEventListener('change', () => {
        const next = picker.value;
        if (next === this.caseId) return;
        if ((this.dirty || this.routineDirty) && !this.confirm('Trocar de atendimento descartará as respostas deste exercício nesta sessão. Continuar?')) { picker.value = this.caseId; return; }
        this.clear(); this.caseId = next; this.render();
      });
      const load = node('button', 'Carregar respostas do atendimento'); load.type = 'button'; load.disabled = !this.caseId || this.pending; load.addEventListener('click', () => this.load());
      group.append(title, hint, label, picker, load);
      if (this.legacyAvailable) {
        const previous = node('button', 'Carregar sinais anteriores'); previous.type = 'button'; previous.disabled = this.pending; previous.addEventListener('click', () => this.importLegacy());
        const blankStart = node('button', 'Iniciar sem sinais anteriores'); blankStart.type = 'button'; blankStart.disabled = this.pending; blankStart.addEventListener('click', () => this.startWithoutLegacy());
        group.append(previous, blankStart);
      }
      if (this.loaded) {
        group.append(node('p', 'As marcações confirmam este salvamento. Desmarcá-las impede novos salvamentos e não revoga automaticamente dados já armazenados.'));
        for (const [key,text] of [['assessment','Autorizo a avaliação das respostas fictícias.'],['storage','Autorizo salvar as respostas fictícias neste atendimento.']]) {
          const caption = node('label'); caption.className = 'choice'; const input = node('input'); input.type = 'checkbox'; input.checked = this.consents[key]; input.disabled = this.pending;
          input.addEventListener('change', () => { this.consents[key] = input.checked; this.dirty = true; updateAlert(); }); caption.append(input, document.createTextNode(text)); group.append(caption);
        }
        const save = node('button', 'Salvar respostas no atendimento'); save.type = 'button'; save.disabled = this.pending; save.addEventListener('click', () => this.save()); group.append(save);
        generate = node('button', 'Gerar rascunho para revisão'); generate.type = 'button'; generate.disabled = this.pending || this.dirty || !this.consents.assessment || !this.consents.storage || this.revision < 1; generate.addEventListener('click', () => this.generateDraft());
        group.append(generate, node('p', 'O rascunho usa somente a revisão salva. Lacunas e alertas permanecem visíveis; a entrega ao cliente ainda não está disponível.'));
      }
      const status = node('p', this.notice); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); group.append(status); this.root.append(group);
    }
    if (section.title === 'Prevenção') {
      const details = node('details'), summary = node('summary', 'Como usar o filtro SINAL e o checklist de pré-venda');
      details.append(summary, node('p', 'SINAL: confira a fonte, o incentivo, a urgência, o efeito da assinatura e o limite de perda. Na dúvida, interrompa e procure orientação por um canal verificado.'),
        node('p', 'Para pré-venda, examine projeto, risco e estrutura do token, incluindo liquidez e prazos. Informação clara não elimina o risco de perda.'),
        node('p', 'Os checklists detalhados e sua revisão por atendimento ainda estão em preparação.', 'muted'));
      this.root.append(details);
    }
    if (section.title === 'Rotina') {
      const area = node('section'), title = node('h3', 'Ensaio da rotina mensal'); area.className = 'boundary';
      area.append(title, node('p', 'Use somente dados fictícios. Este ensaio fica nesta sessão: não é salvo no atendimento, não entra no relatório e será perdido ao sair.'));
      const status = node('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const refresh = () => { const { done, pending, unassessed } = monthlySummary(this.routineAnswers); status.textContent = `${done} concluídas · ${pending} pendentes · ${unassessed} não avaliadas. Marcação declarada não comprova execução.`; };
      refresh(); area.append(status);
      for (const [id, label] of MONTHLY_TASKS) {
        const field = node('fieldset'); field.append(node('legend', label));
        for (const [value, text] of [['done', 'Concluída'], ['pending', 'Pendente'], ['unassessed', 'Não avaliada']]) {
          const caption = node('label'); caption.className = 'choice'; const input = node('input'); input.type = 'radio'; input.name = 'monthly-' + id; input.value = value; input.checked = (this.routineAnswers[id] || 'unassessed') === value; input.disabled = this.pending;
          input.addEventListener('change', () => { if (input.checked) { this.routineAnswers[id] = value; this.routineDirty = true; refresh(); } });
          caption.append(input, document.createTextNode(text)); field.append(caption);
        }
        area.append(field);
      }
      area.append(node('p', 'O exercício mensal não inclui o teste trimestral de recuperação nem as medidas após incidente. Não digite frases de recuperação, chaves, senhas ou códigos.'));
      this.root.append(area);
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
      summary.append(node('p', 'Respostas declaradas não comprovam controles. O rascunho requer revisão humana e não gera pontuação, aprovação nem monitoramento.'));
      summary.className = 'boundary'; this.root.append(summary);
    }
    const actions = node('div'); actions.className = 'actions';
    const action = (label, run, cls = '') => { const b = node('button', label); b.type = 'button'; b.className = cls; b.disabled = this.pending; b.addEventListener('click', run); return b; };
    if (this.step > 0) actions.append(action('Voltar', () => { this.step--; this.render({ focus: true }); }));
    if (this.step < SECTIONS.length - 1) actions.append(action('Continuar', () => { this.step++; this.render({ focus: true }); }, 'primary'));
    this.root.append(actions); if (focus) heading.focus();
  }
}
