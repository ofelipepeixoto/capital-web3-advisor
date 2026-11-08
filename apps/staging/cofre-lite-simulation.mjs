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
  constructor(root) { this.root = root; this.clear(); }
  clear() { this.answers = {}; this.step = 0; this.dirty = false; this.root.replaceChildren(); }
  render({ focus = false } = {}) {
    const section = SECTIONS[this.step], heading = node('h3', `Etapa ${this.step + 1} de ${SECTIONS.length} · ${section.title}`);
    heading.tabIndex = -1;
    const notice = node('p', 'Exercício fictício: respostas ficam somente nesta sessão, sem vínculo com atendimento e sem relatório. Não informe dados reais, endereços, senhas, códigos ou segredos.');
    notice.className = 'notice'; this.root.replaceChildren(notice, heading);
    const progress = node('progress'); progress.max = SECTIONS.length; progress.value = this.step + 1; progress.setAttribute('aria-label', 'Etapa do exercício'); this.root.append(progress);
    const result = node('p'); result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite'); let summaryStatus;
    const updateAlert = () => { const value = liteSummary(this.answers);
      result.textContent = value.critical ? 'Alerta crítico: interrompa a interação e procure atendimento humano adequado. Não informe segredos.' : value.signals.flagged_signals ? 'Há sinais relatados. Pause e peça revisão humana antes de agir.' : '';
      if (summaryStatus) summaryStatus.textContent = value.critical ? 'Alerta crítico. Interrompa a interação e peça orientação humana adequada.' : value.missing ? `Exercício incompleto: ${value.missing} respostas não informadas ou desconhecidas.` : 'Respostas preenchidas. A equipe deve revisar o contexto e as evidências antes de qualquer conclusão.';
    };
    updateAlert(); this.root.append(result);
    for (const [id, label, options] of section.questions) {
      const field = node('fieldset'), legend = node('legend', label); field.append(legend);
      for (const [value, name] of options.filter(([v]) => v)) {
        const caption = node('label'); caption.className = 'choice'; const input = node('input'); input.type = 'radio'; input.name = 'lite-' + id; input.value = value; input.checked = this.answers[id] === value;
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
    const action = (label, run, cls = '') => { const b = node('button', label); b.type = 'button'; b.className = cls; b.addEventListener('click', run); return b; };
    if (this.step > 0) actions.append(action('Voltar', () => { this.step--; this.render({ focus: true }); }));
    if (this.step < SECTIONS.length - 1) actions.append(action('Continuar', () => { this.step++; this.render({ focus: true }); }, 'primary'));
    this.root.append(actions); if (focus) heading.focus();
  }
}
