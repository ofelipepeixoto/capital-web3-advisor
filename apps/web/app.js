'use strict';
const $ = id => document.getElementById(id);
const names = {'ana':'Ana · consultora','rui':'Rui · revisor','client-a':'Cliente A','client-b':'Cliente B'};
const states = {draft:'Rascunho',approved:'Aprovado',published:'Publicado',revoked:'Revogado'};
let session = null, reports = [], selected = null, cases = [], renderedReportId = null;
let sessionGeneration = 0, detailGeneration = 0, signingIn = false;
let noticeTimer;
function clearWorkspace() { reports=[];cases=[];selected=null;renderedReportId=null;detailGeneration++;for(const id of ['report-list','detail','summary','risk-output'])$(id).replaceChildren();$('count').textContent='0'; }
function notify(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 6000); }
async function api(path, data) {
  const headers = {};
  if (data !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = session?.csrf_token || ''; }
  const response = await fetch(path, {method:data === undefined?'GET':'POST',headers,body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin'});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir.');
  return result;
}
function text(tag, value, cls='') { const el = document.createElement(tag); el.textContent = String(value??''); if(cls)el.className=cls; return el; }
function button(label, onClick, cls='secondary') { const b=text('button',label,cls); b.addEventListener('click',async()=>{b.disabled=true;try{await onClick();}catch(e){notify(e.message,true);}finally{b.disabled=false;}}); return b; }

/** Read-only context from the authorized report envelope. Never infer approval
 * from model content, source freshness from today's clock, or missing amounts.
 */
function contextHeading(label, id) {
  const heading = text('h3', label);
  heading.id = id;
  heading.tabIndex = -1;
  return heading;
}
function contextList(entries) {
  const list = document.createElement('dl');
  list.className = 'context-facts';
  for (const [label, value] of entries) {
    const row = document.createElement('div');
    row.append(text('dt', label), text('dd', value));
    list.append(row);
  }
  return list;
}
function reportDate(value) {
  if (value === null || value === undefined || value === '') return 'Não informada';
  // Require a timezone; a local or malformed string must not look authoritative.
  if (typeof value !== 'string' ||
      !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== value.slice(0, 10)) return 'Data inválida — confirmar com o consultor';
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'UTC' }) + ' UTC';
}
function contextLabel(labels, value, fallback = 'Não informada') {
  return typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : fallback;
}
function renderDataContext(payload) {
  const section = text('section', '', 'data-context');
  section.setAttribute('aria-labelledby', 'data-context-title');
  section.append(contextHeading('Qualidade dos dados', 'data-context-title'));
  const quality = payload.data_quality || {};
  const qualityStates = {
    ok: 'Sem pendências declaradas no documento',
    needs_input: 'Faltam dados para concluir',
    degraded: 'Análise com limitações',
    blocked: 'Análise bloqueada',
    error: 'Falha na análise',
  };
  const freshness = {
    not_live: 'Sem consulta ao vivo',
    as_of_snapshot: 'Retrato na data de corte',
    stale: 'Dados desatualizados',
    unknown: 'Atualidade desconhecida',
  };
  const modes = {
    synthetic_mock: 'Dados fictícios',
    reviewed_data: 'Dados descritos como revisados',
    incomplete: 'Dados incompletos',
  };
  section.append(contextList([
    ['Condição da análise', contextLabel(qualityStates, payload.status)],
    ['Origem dos dados', contextLabel(modes, quality.mode)],
    ['Atualidade declarada', contextLabel(freshness, quality.freshness)],
    ['Data de corte do documento', reportDate(payload.as_of)],
  ]));
  const guidance = {
    not_live: 'Este cenário não acompanha o mercado. Confirme as fontes antes de usar seus resultados.',
    as_of_snapshot: 'A data de corte descreve o retrato analisado; ela não comprova que os dados continuam atuais.',
    stale: 'Peça fontes atualizadas ao consultor antes de usar esta análise para uma decisão.',
    unknown: 'Confirme com o consultor quando as fontes foram observadas.',
  };
  section.append(text('p', contextLabel(guidance, quality.freshness,
    'A atualidade das fontes não foi informada. Confirme a data dos dados com o consultor.'), 'context-guidance'));
  if (Array.isArray(quality.notes)) {
    const notes = document.createElement('ul');
    for (const note of quality.notes) if (typeof note === 'string') notes.append(text('li', note));
    if (notes.children.length) section.append(notes);
  }
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  if (!sources.length) {
    section.append(text('p', 'Nenhuma fonte foi registrada neste documento.', 'caption'));
  } else {
    const disclosure = document.createElement('details');
    disclosure.className = 'source-details';
    disclosure.append(text('summary', 'Conferir fontes registradas (' + sources.length + ')'));
    const list = document.createElement('ul');
    const kinds = { synthetic: 'Fictícia', document: 'Documento', onchain: 'On-chain', offchain: 'Off-chain' };
    for (const source of sources) {
      const item = document.createElement('li');
      const data = source && typeof source === 'object' ? source : {};
      item.append(text('strong', data.id || 'Fonte sem identificador'),
        text('p', contextLabel(kinds, data.kind, 'Tipo não informado') + ' · Observada em: ' + reportDate(data.as_of)));
      list.append(item);
    }
    disclosure.append(list);
    section.append(disclosure);
  }
  // These fields do not exist in the structured report contract v0.1.0.
  section.append(text('p',
    'Moeda de referência e horizonte não são registrados no contrato deste diagnóstico. Confirme as unidades, o período e as premissas antes de comparar valores ou cenários.',
    'caption'));
  return section;
}
function renderVersionContext(report, isClient) {
  const section = text('section', '', 'version-context');
  section.setAttribute('aria-labelledby', 'version-context-title');
  section.append(contextHeading('Revisão e entrega desta versão', 'version-context-title'));
  const review = report.review || {}, publication = report.publication || {};
  const recipients = Array.isArray(publication.recipients) ? publication.recipients : [];
  const version = report.version === undefined || report.version === null ? 'Não informada' : String(report.version);
  section.append(contextList([
    ['Documento', report.id || 'Não informado'],
    ['Versão aberta', version],
    ['Posição no atendimento', report.is_latest === true
      ? (isClient ? 'Mais recente entre as versões disponíveis para você' : 'Versão atual do atendimento')
      : report.is_latest === false
        ? (isClient ? 'Há uma versão mais recente disponível para você' : 'Versão anterior — consulte a versão atual')
        : 'Não informada'],
    ['Revisor registrado', review.approved_by || 'Revisão pendente'],
    ['Revisão registrada em', reportDate(review.approved_at)],
    ['Destinatários desta publicação', recipients.length
      ? recipients.map(id => names[id] || id).join(', ')
      : 'Nenhum destinatário com acesso nesta publicação'],
    ['Publicada em', reportDate(publication.published_at)],
  ]));
  if (report.content_hash) {
    const details = document.createElement('details');
    details.className = 'source-details';
    details.append(text('summary', 'Identificador do conteúdo desta versão'),
      text('code', report.content_hash, 'content-digest'),
      text('p', 'Identificador informado pelo servidor; não é uma certificação da análise.', 'caption'));
    section.append(details);
  }
  section.append(text('p',
    'A revisão se refere a este documento e versão. Confirmar recebimento registra a entrega; não aprova uma estratégia nem autoriza uma operação.',
    'caption'));
  return section;
}
function renderReadingNav() {
  const nav = text('nav', '', 'reading-nav');
  nav.setAttribute('aria-label', 'Leitura do diagnóstico');
  for (const [label, id] of [
    ['Conferir dados', 'data-context-title'],
    ['Ver limites', 'report-limits-title'],
    ['Conferir versão', 'version-context-title'],
  ]) {
    const link = text('a', label);
    link.href = '#' + id;
    link.addEventListener('click', event => { event.preventDefault(); $(id)?.focus(); });
    nav.append(link);
  }
  return nav;
}

function switchView(view) { $('workspace').hidden=view!=='reports'; $('risk-view').hidden=view!=='risk'; $('reports-tab').classList.toggle('active',view==='reports'); $('risk-tab').classList.toggle('active',view==='risk'); $('breadcrumb').textContent=view==='risk'?'LABORATÓRIO DE RISCO':'DIAGNÓSTICOS'; }
async function enterSession(current) {
  ++sessionGeneration; clearWorkspace(); session=current; $('login-view').hidden=true; $('logout').hidden=false;
  $('identity-name').textContent=names[session.subject]||session.subject; $('identity-role').textContent=session.role==='client'?'Portal do cliente':'Equipe Capital Web3'; $('avatar').textContent=session.subject==='rui'?'R':'A';
  $('risk-tab').hidden=session.role==='client'; $('draft').hidden=session.role==='client'; $('page-eyebrow').textContent=session.role==='client'?'SUAS ANÁLISES, COM CONTEXTO':'ATENDIMENTO COM EVIDÊNCIAS';
  $('page-description').textContent=session.role==='client'?'Receba seus diagnósticos revisados e esclareça suas dúvidas.':'Prepare, revise e publique cada versão para o destinatário certo.';
  switchView('reports'); await refresh();
}
async function refresh() {
  const generation=sessionGeneration;
  const [newReports,newCases]=await Promise.all([api('/api/reports'),api('/api/cases')]);
  if(generation!==sessionGeneration||!session)return;
  reports=newReports;cases=newCases;
  const published=reports.filter(r=>r.state==='published'||r.status==='published').length;
  $('summary').replaceChildren();
  for(const [label,value,note] of [['Análises acessíveis',reports.length,'Acesso validado no servidor'],['Versões publicadas',published,'Entrega explícita ao destinatário'],['Tipo de atendimento',session.role==='client'?'Cliente':'Equipe','Revisão humana antes da entrega']]){const card=text('div','','metric');card.append(text('span',label),text('strong',value),text('small',note));$('summary').append(card);}
  $('count').textContent=reports.length; $('report-list').replaceChildren();
  if(!reports.length) $('report-list').append(text('p','Nenhum diagnóstico foi publicado para você ainda.','caption'));
  for(const r of reports){const b=document.createElement('button');b.className='report-row';b.dataset.id=r.id;const state=r.state||r.status;b.append(text('span',states[state]||state,'badge '+state),text('strong',r.title||'Diagnóstico de portfólio'),text('small',`Versão ${r.version} · ${r.case_id}`));b.addEventListener('click',()=>showReport(r.id).catch(e=>notify(e.message,true)));$('report-list').append(b);}
  if(selected&&reports.some(r=>r.id===selected))await showReport(selected); else {selected=null;renderedReportId=null;$('detail').replaceChildren(text('h2',reports.length?'Selecione um diagnóstico':'A entrega aparecerá aqui'),text('p','O acesso depende de revisão, publicação e autorização.','caption'));}
}
async function action(path, body, message, onSuccess) { const generation=sessionGeneration;await api(path,body);if(generation!==sessionGeneration||!session)return;onSuccess?.();notify(message);await refresh(); }
async function showReport(id) {
  const generation=sessionGeneration,request=++detailGeneration;
  const r=await api('/api/reports/'+encodeURIComponent(id));
  if(generation!==sessionGeneration||request!==detailGeneration||!session)return;
  const previousInput=renderedReportId===id?$('detail').querySelector('.clarification'):null;
  const question=previousInput?.value||'',refocus=previousInput&&document.activeElement===previousInput;
  const caretStart=previousInput?.selectionStart,caretEnd=previousInput?.selectionEnd;
  selected=id;renderedReportId=id;
  document.querySelectorAll('.report-row').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));
  const panel=$('detail'),payload=r.payload||r.content||{},state=r.state||r.status;panel.replaceChildren(text('span',states[state]||state,'badge '+state),text('h2',r.title||'Diagnóstico de portfólio','detail-title'));
  const meta=text('div','','meta');meta.append(text('span',`VERSÃO ${r.version}`),text('span',r.case_id),text('span',r.review?.approved_by?`REVISOR: ${r.review.approved_by}`:'REVISÃO PENDENTE'));panel.append(meta);
  panel.append(renderReadingNav(), renderDataContext(payload));
  const findings=payload.findings||[];panel.append(text('h3','Pontos da análise'));
  if(typeof payload.summary==='string'&&findings.length)panel.append(text('p',payload.summary));
  if(!findings.length)panel.append(text('p',payload.summary||'Documento fictício para testar o ciclo de entrega.'));
  for(const f of findings){const div=text('div','','finding');div.append(text('strong',f.title||f.id||'Observação'),text('p',typeof f.evidence==='string'?f.evidence:JSON.stringify(f.evidence||f.description||'')));panel.append(div);}
  for(const [key,label]of [['alternatives','Alternativas para discussão'],['limitations','Limites da análise'],['next_steps','Próximos passos']]){
    const items=Array.isArray(payload[key])?payload[key]:[];
    if(!items.length&&key!=='limitations')continue;
    panel.append(key==='limitations'?contextHeading(label,'report-limits-title'):text('h3',label));
    if(items.length){const ul=document.createElement('ul');items.forEach(v=>ul.append(text('li',typeof v==='string'?v:JSON.stringify(v))));panel.append(ul);}
    else panel.append(text('p','Os limites não foram registrados neste documento. Peça ao consultor as premissas e o que ficou fora da análise.'));
  }
  panel.append(renderVersionContext(r,session.role==='client'));
  panel.append(text('p','Dados de teste. A análise não executa operações financeiras.','caption'));
  const actions=text('div','','actions'),p=r.permissions||{},base='/api/reports/'+encodeURIComponent(id);
  if(p.approve)actions.append(button('Aprovar esta versão',()=>action(base+'/approve',{},'Versão aprovada pelo revisor desta sessão.')));
  if(p.publish)actions.append(button('Publicar para cliente A',()=>action(base+'/publish',{recipients:['client-a']},'Versão entregue ao destinatário autorizado.'),'primary'));
  if(p.revoke)actions.append(button('Revogar acesso',()=>action(base+'/revoke',{},'Publicação revogada. Novas leituras e downloads são bloqueados.'),'secondary danger'));
  actions.append(button('Baixar diagnóstico',async()=>{const generation=sessionGeneration;const response=await fetch(base+'/download',{credentials:'same-origin'});if(!response.ok)throw new Error((await response.json()).error);const blob=await response.blob();if(generation!==sessionGeneration||!session)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
  if(p.acknowledge)actions.append(button('Confirmar recebimento',()=>action(base+'/receipt',{},'Recebimento registrado. Isso não aprova uma estratégia ou transação.')));
  panel.append(actions);
  if(p.clarify){panel.append(text('h3','Pedir esclarecimento'));const input=document.createElement('textarea');input.className='clarification';input.value=question;input.placeholder='Escreva sua dúvida sobre este diagnóstico';input.maxLength=2000;input.setAttribute('aria-label','Dúvida sobre o diagnóstico');panel.append(input,button('Enviar dúvida',()=>{const message=input.value;return action(base+'/clarify',{message},'Dúvida registrada no atendimento.',()=>{const current=renderedReportId===id?panel.querySelector('.clarification'):null;if(current?.value===message)current.value='';});}));if(refocus){input.focus({preventScroll:true});input.setSelectionRange(caretStart??question.length,caretEnd??question.length);}}
  if(r.receipt)panel.append(text('p','Recebimento confirmado para esta versão.','caption'));
  if(r.clarifications?.length){panel.append(text('h3','Esclarecimentos do atendimento'));for(const note of r.clarifications){const div=text('div','','finding');div.append(text('strong',note.created_by),text('p',note.message));panel.append(div);}}
}
document.querySelectorAll('[data-persona]').forEach(b=>b.addEventListener('click',async()=>{if(signingIn)return;signingIn=true;const generation=++sessionGeneration;document.querySelectorAll('[data-persona]').forEach(el=>el.disabled=true);try{const response=await fetch('/api/demo/session',{method:'POST',headers:{'Content-Type':'application/json','X-Demo-Intent':'local-testing'},body:JSON.stringify({persona:b.dataset.persona})});const result=await response.json();if(!response.ok)throw new Error(result.error);if(generation!==sessionGeneration)return;await enterSession(result);}catch(e){notify(e.message,true);}finally{signingIn=false;document.querySelectorAll('[data-persona]').forEach(el=>el.disabled=false);}}));
$('logout').addEventListener('click',async()=>{const pending=api('/api/logout',{});++sessionGeneration;clearWorkspace();session=null;$('workspace').hidden=true;$('risk-view').hidden=true;$('login-view').hidden=false;$('logout').hidden=true;$('risk-tab').hidden=true;$('identity-name').textContent='Sem sessão';$('identity-role').textContent='Dados fictícios';try{await pending;}catch(e){notify(e.message,true);}});
$('draft').addEventListener('click',async()=>{const generation=sessionGeneration;try{const c=cases.find(c=>(c.id||c.case_id)==='case-a');if(!c)throw new Error('Nenhum caso atribuído.');const r=await api('/api/cases/case-a/draft',{});if(generation!==sessionGeneration||!session)return;selected=r.id;notify('Novo rascunho preparado. Revisão humana pendente.');await refresh();}catch(e){notify(e.message,true);}});
$('reports-tab').addEventListener('click',()=>session&&switchView('reports'));
$('risk-tab').addEventListener('click',async()=>{const generation=sessionGeneration;try{const result=await api('/api/risk');if(generation!==sessionGeneration||!session)return;switchView('risk');$('risk-output').textContent=JSON.stringify(result,null,2);}catch(e){notify(e.message,true);}});
const restoringGeneration=sessionGeneration;
api('/api/session').then(current=>{if(restoringGeneration!==sessionGeneration||signingIn||session)return;return enterSession(current);}).catch(()=>{});
