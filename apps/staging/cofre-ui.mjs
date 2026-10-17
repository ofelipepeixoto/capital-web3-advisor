/** Synthetic COFRE workflow. Browser state never grants access or computes findings. */
export const CONTROL_QUESTIONS = Object.freeze([
  ['secret_exposure', 'Uma frase de recuperação, chave privada ou senha foi exposta?', 'Considere exposição qualquer compartilhamento, foto, envio por mensagem ou digitação em site suspeito.'],
  ['backup_offline', 'Existe backup offline da recuperação?', 'Responda sem mostrar nem registrar palavras, senhas ou a localização do backup.'],
  ['recovery_tested', 'A recuperação já foi testada com segurança?', 'Não realize testes ou transferências durante este diagnóstico.'],
  ['wallet_separation', 'As reservas estão separadas do uso em aplicativos?', 'Separe mentalmente reserva, aplicativos e pequenos gastos. Não conecte carteiras.'],
  ['device_updates', 'Os dispositivos usados estão atualizados?', 'Considere sistema operacional, navegador e aplicativo de carteira.'],
  ['domain_checks', 'O endereço do site é conferido antes do acesso?', 'Considere o domínio completo, sem depender de links recebidos ou anúncios.'],
  ['permissions_review', 'As permissões concedidas são revisadas?', 'Declare a prática. Este ambiente não consulta nem revoga permissões.'],
]);
const TEXT = Object.freeze({
  organize: 'Organizar meu patrimônio', learn_defi: 'Entender DeFi', protect_family: 'Proteger a família',
  beginner: 'Iniciante', intermediate: 'Intermediário', advanced: 'Avançado',
  short_term: 'Posso precisar em até 12 meses', long_term: 'Horizonte acima de 12 meses', unknown: 'Não sei / não informado',
  essential: 'Comprometeria despesas essenciais', limited: 'Afetaria meus planos', discretionary: 'Valor destinado a risco',
  exchange: 'Corretora', vault: 'Reserva', apps: 'Aplicativos DeFi', spending: 'Pequenos gastos', watch: 'Somente observação',
  bitcoin: 'Bitcoin', evm: 'Redes EVM', other: 'Outra rede', self: 'Autocustódia', third_party: 'Custódia de terceiro',
  yes: 'Sim', no: 'Não', declared: 'Declarado pela pessoa', observed: 'Revisado por uma pessoa da equipe',
  critical: 'Crítico', high: 'Alta prioridade', medium: 'Atenção', info: 'Informação',
  reported: 'Controle declarado', gap: 'Lacuna declarada', blocked: 'Diagnóstico bloqueado', needs_input: 'Faltam informações',
  ok: 'Respostas completas, sem pendências declaradas',
});
const labelFor = value => Object.hasOwn(TEXT, value) ? TEXT[value] : 'Não informado';
const clone = value => JSON.parse(JSON.stringify(value));
export function emptyCofreIntake() {
  return { schema_version: 'cofre-intake-0.1', synthetic: true,
    profile: { objective: '', experience: '', liquidity: 'unknown', loss_capacity: 'unknown' },
    consents: { assessment: false, storage: false, external_sources: false, notifications: false },
    controls: Object.fromEntries(CONTROL_QUESTIONS.map(([id]) => [id, { answer: 'unknown', evidence: 'unknown' }])), inventory: [] };
}
export function setControl(intake, id, answer) {
  if (!CONTROL_QUESTIONS.some(([name]) => name === id) || !['yes', 'no', 'unknown'].includes(answer)) return;
  const prior = intake.controls[id];
  intake.controls[id] = { answer, evidence: answer === 'unknown' ? 'unknown' : prior.evidence === 'observed' ? 'observed' : 'declared' };
}
function node(tag, value = '', cls = '') {
  const result = document.createElement(tag); result.textContent = value; result.className = cls; return result;
}
function textList(title, values) {
  const section = node('section'); section.append(node('h3', title));
  const items = Array.isArray(values) ? values.filter(v => typeof v === 'string') : [];
  if (!items.length) section.append(node('p', 'Não informado neste documento.', 'muted'));
  else { const list = node('ul'); for (const value of items) list.append(node('li', value)); section.append(list); }
  return section;
}
function datum(label, value) {
  const p = node('p'); p.append(node('strong', label + ': '), document.createTextNode(typeof value === 'string' ? value : 'Não informado')); return p;
}
function publicationDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return 'data não informada';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
}
/** Publication context comes only from the authorized server envelope, never document text. */
export function renderPublicationContext(publications) {
  const section = node('section', '', 'publication-context'); section.append(node('h3', 'Entrega desta versão'));
  if (!Array.isArray(publications) || !publications.length) section.append(node('p', 'Os detalhes da publicação não estão disponíveis nesta consulta. Atualize o acesso para conferir.'));
  for (const publication of Array.isArray(publications) ? publications : []) {
    const expires = publication.expires_at === null ? 'sem data de expiração informada' : 'até ' + publicationDate(publication.expires_at);
    section.append(node('p', 'Versão publicada para você em ' + publicationDate(publication.published_at) + ' · acesso ' + expires + '.'));
  }
  section.append(node('p', 'Datas no horário de Brasília. Este registro vem do serviço de entrega; o texto do diagnóstico não define aprovação ou publicação.', 'muted'));
  return section;
}
export function renderCofreReport(content, { staff = false } = {}) {
  const box = node('section', '', 'cofre-report');
  box.append(node('p', 'COFRE Individual · cenário inteiramente fictício', 'notice'),
    node('h3', labelFor(content.status)), node('p', typeof content.summary === 'string' ? content.summary : 'Resumo não informado.'));
  if (typeof content.as_of === 'string') box.append(datum('Data de corte', content.as_of));
  box.append(node('p', 'Não há nota ou selo de segurança. Respostas desconhecidas continuam sendo lacunas; uma declaração não comprova o controle.', 'muted'));
  const quality = content.data_quality;
  if (quality && typeof quality === 'object') {
    const context = node('section'); context.append(node('h3', 'O que sustenta esta análise'));
    for (const key of ['coverage_explanation', 'observed_explanation']) if (typeof quality[key] === 'string') context.append(node('p', quality[key]));
    box.append(context);
  }
  const profile = content.profile || {};
  const scope = node('section'); scope.append(node('h3', 'Objetivo e contexto'),
    datum('Objetivo', labelFor(profile.objective)), datum('Experiência', labelFor(profile.experience)),
    datum('Necessidade de liquidez', labelFor(profile.liquidity)), datum('Efeito de uma perda', labelFor(profile.loss_capacity)));
  box.append(scope);
  const inventory = node('section'); inventory.append(node('h3', 'Inventário por função'));
  if (!Array.isArray(content.inventory) || !content.inventory.length) inventory.append(node('p', 'Nenhuma categoria de inventário informada. Isso não comprova ausência de patrimônio.'));
  else {
    const list = node('ul'); for (const item of content.inventory) list.append(node('li',
      [item.category_label || labelFor(item.category), item.network_label || labelFor(item.network), item.custody_label || labelFor(item.custody)].join(' · ')));
    inventory.append(list);
  }
  box.append(inventory);
  const controls = node('section'); controls.append(node('h3', 'Controles e evidências'));
  for (const item of Array.isArray(content.controls) ? content.controls : []) {
    const block = node('section', '', 'finding'); block.append(node('h4', typeof item.title === 'string' ? item.title : 'Controle'),
      datum('Resposta', labelFor(item.answer)), datum('Evidência', item.evidence_label || labelFor(item.evidence)));
    if (typeof item.explanation === 'string') block.append(node('p', item.explanation)); controls.append(block);
  }
  box.append(controls);
  const findings = node('section'); findings.append(node('h3', 'Pontos que precisam de atenção'));
  if (!Array.isArray(content.findings) || !content.findings.length) findings.append(node('p', 'Nenhum ponto foi registrado nesta versão. Isso não certifica segurança.'));
  for (const item of Array.isArray(content.findings) ? content.findings : []) {
    const block = node('section', '', 'finding' + (item.severity === 'critical' ? ' critical' : ''));
    block.append(node('h4', labelFor(item.severity) + ' · ' + (typeof item.title === 'string' ? item.title : 'Ponto da análise')),
      datum('Evidência', item.evidence), datum('Possível impacto', item.impact), datum('Ação proposta', item.action)); findings.append(block);
  }
  box.append(findings);
  const plan = node('section'); plan.append(node('h3', 'Plano de ação para revisão'));
  const ordered = node('ol');
  for (const item of Array.isArray(content.plan) ? content.plan : []) {
    const li = node('li', '', 'plan-item'); li.append(node('h4', typeof item.action === 'string' ? item.action : 'Ação não informada'),
      datum('Prioridade', typeof item.priority === 'string' ? item.priority : 'Não informada'),
      datum('Responsável', item.owner), datum('Prazo proposto', item.deadline), datum('Como conferir', item.verification)); ordered.append(li);
  }
  if (ordered.children.length) plan.append(ordered); else plan.append(node('p', 'Plano não informado nesta versão.'));
  box.append(plan, textList('Alternativas consideradas', content.alternatives), textList('Limites deste diagnóstico', content.limitations), textList('Próximos passos', content.next_steps));
  const sources = node('section'); sources.append(node('h3', 'Fontes registradas'));
  const sourceList = node('ul'); for (const source of Array.isArray(content.sources) ? content.sources : []) {
    if (typeof source === 'string') sourceList.append(node('li', source));
    else if (source && typeof source === 'object') sourceList.append(node('li', [source.label, source.reference, source.as_of].filter(v => typeof v === 'string').join(' · ')));
  }
  sources.append(sourceList.children.length ? sourceList : node('p', 'Nenhuma fonte registrada.')); box.append(sources);
  box.append(node('p', 'A revisão e a publicação desta versão são conferidas pelo serviço. O texto do diagnóstico não aprova nem publica a si próprio.', 'muted'));
  if (staff) { const details = node('details', '', 'technical'); details.append(node('summary', 'Documento técnico (JSON) · somente equipe'), node('pre', JSON.stringify(content, null, 2))); box.append(details); }
  return box;
}

const STEPS = ['Consentimento', 'Objetivos', 'Horizonte e perdas', 'Recuperação', 'Uso e dispositivos', 'Sites e permissões', 'Inventário', 'Revisar e gerar'];
export class CofreWorkspace {
  constructor({ root, api, currentSession, notice, onSaved, onCreated = async () => {} }) {
    Object.assign(this, { root, api, currentSession, notice, onSaved, onCreated }); this.clear();
  }
  clear() {
    this.epoch = (this.epoch || 0) + 1; this.caseEpoch = (this.caseEpoch || 0) + 1;
    this.roster = []; this.cases = []; this.active = null; this.intake = null; this.revision = 0;
    this.step = 0; this.inventoryIndex = 0; this.pending = false; this.dirty = false; this.keys = new Map(); this.root.replaceChildren();
    this.root.setAttribute('aria-busy', 'false');
  }
  suspend() {
    ++this.epoch; ++this.caseEpoch; this.pending = false;
    this.root.replaceChildren(node('p', 'Conferindo acesso aos atendimentos…'));
  }
  async load(roster) {
    const epoch = this.epoch; this.roster = Array.isArray(roster) ? roster : [];
    this.root.replaceChildren(node('p', 'Carregando atendimentos…'));
    try {
      const result = await this.api('/cases'); if (epoch !== this.epoch || !this.currentSession()) return;
      if (!Array.isArray(result.data)) throw new Error('Resposta inválida ao listar atendimentos.');
      this.cases = result.data;
      if (this.active && !this.cases.some(row => row.id === this.active.id)) { this.active = null; this.intake = null; this.dirty = false; }
      this.render();
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.root.replaceChildren(node('p', error.message), this.action('Tentar novamente', () => this.load(this.roster)));
    }
  }
  action(label, run, cls = '') {
    const result = node('button', label, cls); result.type = 'button';
    result.addEventListener('click', async () => {
      if (this.pending) return; const epoch = this.epoch;
      this.pending = true; result.disabled = true; this.root.setAttribute('aria-busy', 'true');
      try { await run(); } catch (error) { if (epoch === this.epoch) this.error(error.message); }
      finally { if (epoch === this.epoch) { this.pending = false; result.disabled = false; this.root.setAttribute('aria-busy', 'false'); } }
    }); return result;
  }
  error(message) {
    const target = this.root.querySelector('.cofre-error');
    if (target) { target.textContent = message; target.hidden = false; target.focus(); }
    else this.notice(message);
  }
  key(path, body) {
    const fingerprint = path + JSON.stringify(body);
    if (!this.keys.has(fingerprint)) this.keys.set(fingerprint, crypto.randomUUID());
    return this.keys.get(fingerprint);
  }
  render() {
    const layout = node('div', '', 'layout cofre-layout'), aside = node('aside', '', 'card'), detail = node('section', '', 'card cofre-editor');
    const error = node('p', '', 'cofre-error'); error.tabIndex = -1; error.setAttribute('role', 'alert'); error.hidden = true;
    aside.append(node('h3', 'Atendimentos atribuídos'));
    if (!this.cases.length) aside.append(node('p', 'Você ainda não tem atendimentos atribuídos. Crie um caso fictício ou peça a atribuição à equipe.'));
    for (const entry of this.cases) {
      const btn = this.action(entry.client_safe_title || 'Atendimento fictício', () => this.open(entry));
      btn.setAttribute('aria-pressed', String(this.active?.id === entry.id)); aside.append(btn);
    }
    layout.append(aside, detail); this.root.replaceChildren(error, layout);
    this.detail = detail;
    if (this.active && this.intake) this.renderEditor(); else this.renderCreate();
  }
  select(label, id, choices, value, change, required = false) {
    const wrap = node('div', '', 'field'), caption = node('label', label), input = node('select');
    caption.htmlFor = id; input.id = id; input.required = required;
    for (const [key, title] of choices) { const option = node('option', title); option.value = key; input.append(option); }
    input.value = value; input.addEventListener('change', () => { change(input.value); if (this.intake) this.dirty = true; });
    wrap.append(caption, input); return wrap;
  }
  renderCreate() {
    const panel = this.detail, user = this.currentSession();
    panel.append(node('h3', 'Abrir um caso fictício'), node('p', 'COFRE Individual organiza objetivos, práticas de segurança e inventário por categoria. Não informe nomes reais, valores, endereços ou segredos.'));
    const own = this.roster.filter(row => row.user_id === user?.user_id && row.member_role === 'analyst');
    const workspaces = [...new Map(own.map(row => [row.workspace_id, row])).values()];
    if (!workspaces.length) { panel.append(node('p', 'Seu papel permite acompanhar os casos atribuídos. A abertura é feita por analista autorizado.')); return; }
    const form = node('form'); let workspace = workspaces.length === 1 ? workspaces[0].workspace_id : '', recipient = '';
    const targetBox = node('div');
    const target = () => {
      recipient = ''; targetBox.replaceChildren(this.select('Pessoa fictícia que receberá o diagnóstico', 'cofre-recipient',
        [['', 'Escolha uma conta fictícia'], ...this.roster.filter(row => row.workspace_id === workspace && row.member_role === 'client').map(row => [row.user_id, row.display_name])], '', value => { recipient = value; }, true));
    };
    form.append(this.select('Espaço de trabalho', 'cofre-workspace-select', [['', 'Escolha um espaço'], ...workspaces.map(row => [row.workspace_id, row.workspace_label])], workspace,
      value => { workspace = value; target(); }, true)); target(); form.append(targetBox);
    const create = this.action('Criar atendimento fictício', async () => {
      if (!form.reportValidity()) return;
      const path = '/cofre/cases', body = { workspace_id: workspace, client_user_id: recipient }, epoch = this.epoch;
      const result = await this.api(path, { ...body, idempotency_key: this.key(path, body) });
      if (epoch !== this.epoch || !this.currentSession()) return;
      const id = result.data?.case_id;
      if (typeof id !== 'string') throw new Error('O serviço não confirmou a abertura. Atualize os atendimentos antes de tentar novamente.');
      await this.onCreated(); if (epoch !== this.epoch) return;
      this.notice('Atendimento fictício criado. Preencha o consentimento e as próximas etapas.');
      const updated = await this.api('/cases'); if (epoch !== this.epoch) return;
      this.cases = updated.data; await this.open(this.cases.find(entry => entry.id === id) || { id, client_safe_title: 'COFRE Individual · fictício' });
    }, 'primary');
    form.addEventListener('submit', event => { event.preventDefault(); create.click(); }); form.append(create); panel.append(form);
  }
  async open(entry, { discard = false } = {}) {
    if (!discard && this.dirty && this.active?.id === entry.id && this.intake) { this.renderEditor(); this.focusHeading(); return; }
    if (this.dirty && this.active && this.active.id !== entry.id && !discard) {
      const caution = node('section', '', 'boundary'); caution.append(node('p', 'Há respostas ainda não salvas neste caso. Volte às etapas para concluir ou descarte estas alterações antes de trocar.'),
        this.action('Descartar alterações e abrir outro caso', () => this.open(entry, { discard: true }), 'danger'));
      this.detail.append(caution); caution.tabIndex = -1; caution.focus(); return;
    }
    const epoch = this.epoch, caseEpoch = ++this.caseEpoch;
    this.active = entry; this.intake = null; this.dirty = false; this.detail?.replaceChildren(node('p', 'Carregando respostas salvas…'));
    try {
      const result = await this.api('/cofre/cases/' + entry.id + '/intake');
      if (epoch !== this.epoch || caseEpoch !== this.caseEpoch || !this.currentSession()) return;
      const row = result.data;
      if (row && (!Number.isInteger(row.revision) || row.revision < 1 || row.intake?.schema_version !== 'cofre-intake-0.1')) throw new Error('As respostas salvas não estão no formato esperado. Peça à equipe para conferir.');
      this.revision = row?.revision || 0; this.intake = row ? clone(row.intake) : emptyCofreIntake(); this.step = 0; this.render(); this.focusHeading();
    } catch (error) {
      if (epoch !== this.epoch || caseEpoch !== this.caseEpoch) return;
      this.detail.replaceChildren(node('h3', 'Não foi possível abrir este atendimento'), node('p', error.message), this.action('Tentar abrir novamente', () => this.open(entry, { discard: true })));
    }
  }
  focusHeading() { const heading = this.root.querySelector('.step-heading'); if (heading) heading.focus(); }
  choice(label, id, options, value, update, help = '') {
    const fieldset = node('fieldset'), legend = node('legend', label); fieldset.append(legend);
    if (help) { const hint = node('p', help, 'muted'); hint.id = id + '-hint'; fieldset.append(hint); }
    for (const [key, title] of options) {
      const caption = node('label', '', 'choice'), radio = node('input'); radio.type = 'radio'; radio.name = id; radio.value = key; radio.checked = value === key;
      if (help) radio.setAttribute('aria-describedby', id + '-hint');
      radio.addEventListener('change', () => { if (radio.checked) { update(key); this.dirty = true; } });
      caption.append(radio, document.createTextNode(title)); fieldset.append(caption);
    } return fieldset;
  }
  renderEditor() {
    const panel = this.detail; panel.replaceChildren();
    const title = node('h3', this.active.client_safe_title || 'COFRE Individual'), heading = node('h4', `Etapa ${this.step + 1} de ${STEPS.length} · ${STEPS[this.step]}`, 'step-heading'); heading.tabIndex = -1;
    panel.append(title, node('p', this.revision ? `Respostas salvas · revisão ${this.revision}. Alterações geram uma nova versão para revisão humana.` : 'Novo atendimento · as respostas ficam somente nesta sessão até gerar o rascunho.', 'muted'), heading);
    const progress = node('progress'); progress.max = STEPS.length; progress.value = this.step + 1; progress.setAttribute('aria-label', 'Progresso do questionário'); panel.append(progress);
    const form = node('form'), intake = this.intake, profile = intake.profile;
    const user = this.currentSession(), canEdit = this.roster.some(row => row.user_id === user?.user_id && row.member_role === 'analyst') &&
      user?.assignments?.some(row => row.case_id === this.active.id && ['analyst', 'admin'].includes(row.staff_role));
    if (!canEdit) panel.append(node('p', 'Leitura das respostas salvas. Somente o analista atribuído pode gerar uma nova versão.', 'notice'));
    form.addEventListener('submit', event => { event.preventDefault(); });
    if (this.step === 0) {
      form.append(node('p', 'Este ensaio usa somente uma pessoa e situações fictícias. As respostas geram um rascunho de diagnóstico para revisão humana. Não conectamos carteiras nem consultamos serviços externos.'));
      for (const [key, title] of [['assessment', 'Autorizo a avaliação das respostas fictícias para este diagnóstico.'], ['storage', 'Autorizo salvar as respostas fictícias e o histórico de versões neste ambiente de homologação.']]) {
        const caption = node('label', '', 'choice'), input = node('input'); input.type = 'checkbox'; input.checked = intake.consents[key] === true;
        input.addEventListener('change', () => { intake.consents[key] = input.checked; this.dirty = true; }); caption.append(input, document.createTextNode(title)); form.append(caption);
      }
      form.append(node('p', 'As duas autorizações são necessárias para salvar. Não há autorização de notificações ou consulta externa. A exclusão automática ainda não foi implementada neste ensaio: use apenas respostas fictícias.', 'muted'));
    } else if (this.step === 1) {
      form.append(this.select('Qual é o principal objetivo?', 'cofre-objective', [['', 'Escolha um objetivo'], ...['organize', 'learn_defi', 'protect_family'].map(v => [v, labelFor(v)])], profile.objective, v => { profile.objective = v; }, true),
        this.select('Qual é sua experiência com Web3?', 'cofre-experience', [['', 'Escolha uma opção'], ...['beginner', 'intermediate', 'advanced'].map(v => [v, labelFor(v)])], profile.experience, v => { profile.experience = v; }, true));
    } else if (this.step === 2) {
      form.append(this.choice('Quando poderia precisar destes recursos?', 'cofre-liquidity', ['unknown', 'short_term', 'long_term'].map(v => [v, labelFor(v)]), profile.liquidity, v => { profile.liquidity = v; }),
        this.choice('O que uma perda representaria?', 'cofre-loss', ['unknown', 'essential', 'limited', 'discretionary'].map(v => [v, labelFor(v)]), profile.loss_capacity, v => { profile.loss_capacity = v; }));
    } else if (this.step >= 3 && this.step <= 5) {
      const questions = this.step === 3 ? CONTROL_QUESTIONS.slice(0, 3) : this.step === 4 ? CONTROL_QUESTIONS.slice(3, 5) : CONTROL_QUESTIONS.slice(5);
      for (const [id, title, help] of questions) {
        const wrapper = node('section');
        const evidence = this.select('Como esta resposta foi obtida?', 'evidence-' + id, [['declared', 'Declaração da pessoa'], ['observed', 'Revisão humana realizada']], intake.controls[id].evidence === 'observed' ? 'observed' : 'declared', value => { intake.controls[id].evidence = value; });
        evidence.hidden = intake.controls[id].answer === 'unknown';
        wrapper.append(this.choice(title, 'control-' + id, ['unknown', 'yes', 'no'].map(v => [v, labelFor(v)]), intake.controls[id].answer,
          value => { setControl(intake, id, value); evidence.hidden = value === 'unknown'; evidence.querySelector('select').value = intake.controls[id].evidence === 'observed' ? 'observed' : 'declared'; }, help), evidence);
        wrapper.append(node('p', '“Revisão humana” só deve ser escolhida se a equipe já conferiu a prática; não significa verificação automática ou coleta de segredos.', 'muted')); form.append(wrapper);
      }
    } else if (this.step === 6) {
      form.append(node('p', 'Inclua apenas categorias. Não informe valores, nomes de contas, endereços de carteira ou credenciais. Até 12 itens.'));
      const items = node('div', '', 'inventory-items');
      intake.inventory.forEach((item, index) => {
        const choice = this.action(`Item ${index + 1} · ${labelFor(item.category)}`, () => { this.inventoryIndex = index; this.renderEditor(); this.focusHeading(); });
        choice.setAttribute('aria-pressed', String(index === this.inventoryIndex)); items.append(choice);
      });
      form.append(items);
      if (intake.inventory.length) {
        this.inventoryIndex = Math.min(this.inventoryIndex, intake.inventory.length - 1);
        const index = this.inventoryIndex, item = intake.inventory[index];
        const block = node('fieldset'); block.append(node('legend', 'Item ' + (index + 1)),
          this.select('Função', `inventory-category-${index}`, [['', 'Escolha uma função'], ...['exchange', 'vault', 'apps', 'spending', 'watch'].map(v => [v, labelFor(v)])], item.category, v => { item.category = v; }, true),
          this.select('Rede', `inventory-network-${index}`, ['unknown', 'bitcoin', 'evm', 'other'].map(v => [v, labelFor(v)]), item.network, v => { item.network = v; }),
          this.select('Quem mantém a custódia?', `inventory-custody-${index}`, ['unknown', 'self', 'third_party'].map(v => [v, labelFor(v)]), item.custody, v => { item.custody = v; }));
        if (canEdit) block.append(this.action('Remover item ' + (index + 1), () => { intake.inventory.splice(index, 1); this.dirty = true; this.renderEditor(); this.focusHeading(); })); form.append(block);
      }
      if (!intake.inventory.length) form.append(node('p', 'Nenhum item informado. Você pode continuar; essa ausência será registrada como limitação.'));
      if (canEdit && intake.inventory.length < 12) form.append(this.action('Adicionar categoria', () => {
        if (!form.reportValidity()) return;
        this.inventoryIndex = intake.inventory.length; intake.inventory.push({ category: '', network: 'unknown', custody: 'unknown' }); this.dirty = true; this.renderEditor(); this.focusHeading();
      }));
    } else {
      form.append(node('p', 'Confira as respostas antes de gerar o diagnóstico. Salvar cria uma nova versão de rascunho; uma pessoa diferente precisa revisá-la antes da entrega.'));
      for (const [key, title] of [['objective', 'Objetivo'], ['experience', 'Experiência'], ['liquidity', 'Liquidez'], ['loss_capacity', 'Efeito de uma perda']]) form.append(datum(title, labelFor(profile[key])));
      const list = node('ul'); for (const [id, title] of CONTROL_QUESTIONS) list.append(node('li', `${title} ${labelFor(intake.controls[id].answer)} · ${labelFor(intake.controls[id].evidence)}`));
      form.append(list, node('p', `Inventário: ${intake.inventory.length} categorias. Nenhum saldo foi coletado.`));
      if (intake.controls.secret_exposure.answer === 'yes') form.append(node('p', 'Exposição declarada: o diagnóstico será bloqueado e apontará o fluxo de incidente. Não registre nem reutilize segredos aqui.', 'notice'));
      form.append(node('p', 'As regras são determinísticas no serviço; nenhuma IA paga ou fonte externa participa deste rascunho.', 'muted'));
    }
    panel.append(form);
    if (!canEdit) for (const input of form.querySelectorAll('input, select')) input.disabled = true;
    const actions = node('div', '', 'actions');
    if (this.step > 0) actions.append(this.action('Voltar', () => { this.step--; this.renderEditor(); this.focusHeading(); }));
    if (this.step < STEPS.length - 1 || canEdit) actions.append(this.action(this.step === STEPS.length - 1 ? 'Salvar respostas e gerar rascunho' : 'Continuar', async () => {
      if (this.step === 0 && (!intake.consents.assessment || !intake.consents.storage)) { this.error('Marque as duas autorizações para continuar ou saia sem salvar.'); return; }
      if (!form.reportValidity()) return;
      if (this.step === 6) {
        const missing = intake.inventory.findIndex(item => !item.category);
        if (missing >= 0) { this.inventoryIndex = missing; this.renderEditor(); this.error('Escolha a função do item ' + (missing + 1) + ' antes de continuar.'); return; }
      }
      if (this.step < STEPS.length - 1) { this.step++; this.renderEditor(); this.focusHeading(); return; }
      await this.save();
    }, 'primary'));
    panel.append(actions);
  }
  async save() {
    if (!this.intake.consents.assessment || !this.intake.consents.storage || !this.intake.profile.objective || !this.intake.profile.experience) throw new Error('Confira os consentimentos, o objetivo e a experiência antes de salvar.');
    const epoch = this.epoch, caseEpoch = this.caseEpoch, caseId = this.active.id;
    const path = '/cofre/cases/' + caseId + '/intake', body = { intake: clone(this.intake), expected_revision: this.revision };
    const inputs = [...this.root.querySelectorAll('input, select')].map(input => ({ input, disabled: input.disabled }));
    for (const { input } of inputs) input.disabled = true;
    this.notice('Salvando respostas e gerando rascunho…');
    try {
      const result = await this.api(path, { ...body, idempotency_key: this.key(path, body) });
      if (epoch !== this.epoch || caseEpoch !== this.caseEpoch || !this.currentSession()) return;
      if (!Number.isInteger(result.data?.revision) || typeof result.data?.report_version_id !== 'string') throw new Error('O serviço não confirmou a versão. Atualize para conferir antes de tentar novamente.');
      this.revision = result.data.revision; this.dirty = false;
      this.notice('Respostas salvas. O novo diagnóstico é um rascunho pendente de revisão humana.');
      this.renderEditor();
      try { await this.onSaved(result.data.report_version_id); }
      catch { if (this.currentSession() && this.active?.id === caseId) this.notice('Respostas salvas e rascunho criado. Não foi possível carregar a lista agora; use Atualizar acesso para conferir, sem gerar outra versão.'); }
    } catch (error) {
      if (epoch !== this.epoch || caseEpoch !== this.caseEpoch) return;
      this.notice('As respostas continuam nesta sessão. Não feche a página antes de conferir o resultado.');
      if (error.status === 409) {
        const block = node('section', '', 'boundary'); block.append(node('p', 'Outra gravação mudou este atendimento. Suas respostas não foram substituídas automaticamente. Confira a versão salva antes de retomar.'),
          this.action('Descartar minhas alterações e carregar a revisão salva', () => this.open(this.active, { discard: true }), 'danger'));
        this.detail.append(block);
      }
      throw error;
    } finally {
      if (epoch === this.epoch && caseEpoch === this.caseEpoch) for (const { input, disabled } of inputs) input.disabled = disabled;
    }
  }
}
