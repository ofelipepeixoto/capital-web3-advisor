const LABELS = Object.freeze({
  cofre6_individual: 'COFRE-6 Individual', rastro: 'RASTRO', advanced_investor: 'Investidor avançado', organization_dao: 'Empresa ou DAO',
  threat_model: 'Modelo de ameaça', wallet_roles: 'Funções das carteiras', keys_and_recovery: 'Chaves e recuperação', hygiene: 'Higiene e uso', evidence: 'Evidências', continuity: 'Continuidade',
  objectives_and_liquidity: 'Objetivos e liquidez', assets_and_liabilities: 'Ativos e passivos', sources_and_evidence: 'Fontes e evidências', permissions_and_exposure: 'Permissões e exposição', risk_and_action_plan: 'Riscos e plano de ação',
  mandate_and_structure: 'Mandato e estrutura', roles_and_delegation: 'Papéis e delegação', treasury_policy: 'Política de tesouraria', multisig_and_modules: 'Multisig e módulos', review_and_decision: 'Revisão e decisão', reconciliation_and_continuity: 'Conciliação e continuidade',
  mandate: 'Mandato', universe: 'Universo', maturity: 'Maturidade', minimal_stack: 'Ferramentas mínimas', taxonomy_and_owners: 'Taxonomia e responsáveis', rituals_and_alerts: 'Rituais e alertas', plan_90_days: 'Plano de 90 dias',
});
const HELP = Object.freeze({
  objectives_and_liquidity: 'Considere finalidade, horizonte e necessidade de liquidez antes da análise.',
  wallet_roles: 'Organize as funções de guarda, aplicativos, gastos e observação.',
  assets_and_liabilities: 'Identifique categorias e dívidas no exemplo, sem incluir saldos ou endereços.',
  sources_and_evidence: 'Indique se as fontes e a data das informações foram definidas.',
  permissions_and_exposure: 'Considere permissões e riscos de exposição, sem conectar carteiras.',
  risk_and_action_plan: 'Organize lacunas e ações para avaliação humana posterior.',
  mandate_and_structure: 'Considere a finalidade da organização e o escopo da tesouraria.',
  roles_and_delegation: 'Considere separação de responsabilidades e substitutos.',
  treasury_policy: 'Confira se existem regras sobre reserva, uso e limites.',
  multisig_and_modules: 'Considere signatários, limite de assinaturas e módulos; não presuma segurança pelo limite sozinho.',
  review_and_decision: 'Considere como uma pessoa revisa e como a decisão é documentada.',
  reconciliation_and_continuity: 'Considere conciliação, continuidade e recuperação.',
});
const OPTIONS = [['not_assessed','Não avaliado'],['unknown','Não sei'],['declared','Declarado'],['gap','Lacuna declarada'],['not_applicable','Não aplicável no exemplo']];
const el = (tag,text='') => {const n=document.createElement(tag);n.textContent=text;return n;};
export class JourneyExercise {
  constructor({root,api}) {this.root=root;this.api=api;this.epoch=0;this.dirty=false;}
  clear() {this.epoch++;this.dirty=false;this.catalog=[];this.root.replaceChildren();}
  async load() {
    const epoch=++this.epoch;this.root.replaceChildren(el('p','Carregando estruturas…'));
    try {
      const result=await this.api('/cofre/journeys');if(epoch!==this.epoch)return;
      if(!Array.isArray(result.data))throw Error('Não foi possível carregar as estruturas.');
      this.catalog=result.data.filter(x=>['cofre6_individual','rastro','advanced_investor','organization_dao'].includes(x.id) && Array.isArray(x.stages) && x.stages.length>0 && x.stages.every(id=>typeof LABELS[id]==='string'));
      if(this.catalog.length!==4 || new Set(this.catalog.map(x=>x.id)).size!==4)throw Error('Estruturas indisponíveis.');
      this.showPicker();
    } catch {
      if(epoch!==this.epoch)return;
      const retry=el('button','Tentar novamente');retry.type='button';
      retry.addEventListener('click',()=>{if(epoch===this.epoch)return this.load();});
      this.root.replaceChildren(el('p','Não foi possível carregar o exercício. Verifique o acesso e tente novamente.'),retry);
    }
  }
  showPicker() {
    this.epoch++;this.dirty=false;this.root.replaceChildren();
    this.root.append(el('p','As respostas são fictícias e ficam apenas nesta página. Nenhuma avaliação ou revisão é criada.'));
    for(const item of this.catalog){const button=el('button',LABELS[item.id]);button.type='button';button.addEventListener('click',()=>this.start(item));this.root.append(button);}
  }
  start(journey) {
    if(this.dirty && !window.confirm('As respostas deste exercício serão descartadas. Continuar?'))return;
    this.epoch++;this.journey=journey;this.dirty=false;this.root.replaceChildren();
    this.root.append(el('h4',LABELS[journey.id]),el('p','Use somente exemplos. Não informe senhas, chaves, valores ou dados de clientes. O exercício não salva nem comprova revisão.'));
    const form=el('form');this.inputs=[];
    for(const id of journey.stages){
      const label=el('label',LABELS[id]);label.htmlFor='exercise-'+id;
      const select=el('select');select.id=label.htmlFor;
      for(const [value,title] of OPTIONS){const opt=el('option',title);opt.value=value;select.append(opt);}
      select.value='not_assessed';
      select.addEventListener('change',()=>{this.dirty=true;this.epoch++;run.disabled=false;this.output.replaceChildren();});
      form.append(label); if (HELP[id]) { const help=el('p',HELP[id]); help.className='muted'; help.id='exercise-help-'+id; select.setAttribute('aria-describedby',help.id); form.append(help); }
      form.append(select);this.inputs.push({id,select});
    }
    const run=el('button','Conferir situação do exemplo');run.className='primary';run.type='submit';form.append(run);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(run.disabled)return;run.disabled=true;const epoch=this.epoch;
      const responses=Object.fromEntries(this.inputs.map(({id,select})=>[id,{state:select.value,evidence:['declared','gap'].includes(select.value)?'declared':'none'}]));
      this.output.replaceChildren(el('p','Conferindo…'));
      try {const result=await this.api('/cofre/journeys/preview',{schema_version:'journey-intake-0.1',synthetic:true,journey:journey.id,responses});
        if(epoch!==this.epoch)return;const data=result.data;
        if(!data || !data.counts || !['needs_input','has_gaps','awaits_human_review'].includes(data.status))throw Error();
        const message=data.status==='needs_input'?'Exercício incompleto: há etapas não avaliadas ou desconhecidas.':data.status==='has_gaps'?'Há lacunas declaradas neste exemplo.':'Etapas preenchidas no exemplo. Revisão humana ainda necessária.';
        const detail=el('ul');
        for (const stage of Array.isArray(data.stages)?data.stages:[]) {
          if (!['not_assessed','unknown','gap'].includes(stage.state) || !LABELS[stage.id]) continue;
          const state=stage.state==='gap'?'Lacuna declarada':stage.state==='unknown'?'Não sabe':'Não avaliado';
          detail.append(el('li',`${LABELS[stage.id]}: ${state}`));
        }
        this.output.replaceChildren(el('p',message), detail, el('p','Exercício sem pontuação, verificação independente ou publicação. Nada foi salvo.'));
      } catch {if(epoch===this.epoch)this.output.replaceChildren(el('p','Não foi possível conferir. Tente novamente após verificar o acesso.'));}
      finally {if(epoch===this.epoch)run.disabled=false;}
    });
    this.output=el('div');this.output.setAttribute('role','status');
    const back=el('button','Escolher outro exercício');back.type='button';back.addEventListener('click',()=>{if(this.dirty && !window.confirm('As respostas deste exercício serão descartadas. Continuar?'))return;this.showPicker();});
    this.root.append(form,this.output,back);
  }
}
