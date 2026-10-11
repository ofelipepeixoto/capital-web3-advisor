'use strict';
const $ = id => document.getElementById(id);
const names = {'ana':'Ana · consultora','rui':'Rui · revisor','client-a':'Cliente A','client-b':'Cliente B'};
const states = {draft:'Rascunho',approved:'Aprovado',published:'Publicado',revoked:'Revogado'};
let session = null, reports = [], selected = null, cases = [];
let sessionGeneration = 0, detailGeneration = 0, signingIn = false;
let noticeTimer;
function clearWorkspace() { reports=[];cases=[];selected=null;detailGeneration++;for(const id of ['report-list','detail','summary','risk-output'])$(id).replaceChildren();$('count').textContent='0'; }
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
  if(selected&&reports.some(r=>r.id===selected))await showReport(selected); else {selected=null;$('detail').replaceChildren(text('h2',reports.length?'Selecione um diagnóstico':'A entrega aparecerá aqui'),text('p','O acesso depende de revisão, publicação e autorização.','caption'));}
}
async function action(path, body, message) { const generation=sessionGeneration;await api(path,body);if(generation!==sessionGeneration||!session)return;notify(message);await refresh(); }
async function showReport(id) {
  const generation=sessionGeneration,request=++detailGeneration;
  const r=await api('/api/reports/'+encodeURIComponent(id));
  if(generation!==sessionGeneration||request!==detailGeneration||!session)return;
  selected=id;
  document.querySelectorAll('.report-row').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));
  const panel=$('detail'),payload=r.payload||r.content||{},state=r.state||r.status;panel.replaceChildren(text('span',states[state]||state,'badge '+state),text('h2',r.title||'Diagnóstico de portfólio','detail-title'));
  const meta=text('div','','meta');meta.append(text('span',`VERSÃO ${r.version}`),text('span',r.case_id),text('span',r.review?.approved_by?`REVISOR: ${r.review.approved_by}`:'REVISÃO PENDENTE'));panel.append(meta);
  const findings=payload.findings||[];panel.append(text('h3','Pontos da análise'));
  if(!findings.length)panel.append(text('p',payload.summary||'Documento fictício para testar o ciclo de entrega.'));
  for(const f of findings){const div=text('div','','finding');div.append(text('strong',f.title||f.id||'Observação'),text('p',typeof f.evidence==='string'?f.evidence:JSON.stringify(f.evidence||f.description||'')));panel.append(div);}
  for(const [key,label]of [['alternatives','Alternativas para discussão'],['limitations','Limites da análise'],['next_steps','Próximos passos']])if(payload[key]?.length){panel.append(text('h3',label));const ul=document.createElement('ul');payload[key].forEach(v=>ul.append(text('li',typeof v==='string'?v:JSON.stringify(v))));panel.append(ul);}
  panel.append(text('p','Dados de teste. A análise não executa operações financeiras.','caption'));
  const actions=text('div','','actions'),p=r.permissions||{},base='/api/reports/'+encodeURIComponent(id);
  if(p.approve)actions.append(button('Aprovar esta versão',()=>action(base+'/approve',{},'Versão aprovada pelo revisor desta sessão.')));
  if(p.publish)actions.append(button('Publicar para cliente A',()=>action(base+'/publish',{recipients:['client-a']},'Versão entregue ao destinatário autorizado.'),'primary'));
  if(p.revoke)actions.append(button('Revogar acesso',()=>action(base+'/revoke',{},'Publicação revogada. Novas leituras e downloads são bloqueados.'),'secondary danger'));
  actions.append(button('Baixar diagnóstico',async()=>{const generation=sessionGeneration;const response=await fetch(base+'/download',{credentials:'same-origin'});if(!response.ok)throw new Error((await response.json()).error);const blob=await response.blob();if(generation!==sessionGeneration||!session)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
  if(p.acknowledge)actions.append(button('Confirmar recebimento',()=>action(base+'/receipt',{},'Recebimento registrado. Isso não aprova uma estratégia ou transação.')));
  panel.append(actions);
  if(p.clarify){panel.append(text('h3','Pedir esclarecimento'));const input=document.createElement('textarea');input.className='clarification';input.placeholder='Escreva sua dúvida sobre este diagnóstico';input.maxLength=2000;input.setAttribute('aria-label','Dúvida sobre o diagnóstico');panel.append(input,button('Enviar dúvida',()=>action(base+'/clarify',{message:input.value},'Dúvida registrada no atendimento.')));}
  if(r.receipt)panel.append(text('p','Recebimento confirmado para esta versão.','caption'));
  if(r.clarifications?.length){panel.append(text('h3','Esclarecimentos do atendimento'));for(const note of r.clarifications){const div=text('div','','finding');div.append(text('strong',note.created_by),text('p',note.message));panel.append(div);}}
}
document.querySelectorAll('[data-persona]').forEach(b=>b.addEventListener('click',async()=>{if(signingIn)return;signingIn=true;document.querySelectorAll('[data-persona]').forEach(el=>el.disabled=true);try{const response=await fetch('/api/demo/session',{method:'POST',headers:{'Content-Type':'application/json','X-Demo-Intent':'local-testing'},body:JSON.stringify({persona:b.dataset.persona})});const result=await response.json();if(!response.ok)throw new Error(result.error);await enterSession(result);}catch(e){notify(e.message,true);}finally{signingIn=false;document.querySelectorAll('[data-persona]').forEach(el=>el.disabled=false);}}));
$('logout').addEventListener('click',async()=>{const pending=api('/api/logout',{});++sessionGeneration;clearWorkspace();session=null;$('workspace').hidden=true;$('risk-view').hidden=true;$('login-view').hidden=false;$('logout').hidden=true;$('risk-tab').hidden=true;$('identity-name').textContent='Sem sessão';$('identity-role').textContent='Dados fictícios';try{await pending;}catch(e){notify(e.message,true);}});
$('draft').addEventListener('click',async()=>{const generation=sessionGeneration;try{const c=cases.find(c=>(c.id||c.case_id)==='case-a');if(!c)throw new Error('Nenhum caso atribuído.');const r=await api('/api/cases/case-a/draft',{});if(generation!==sessionGeneration||!session)return;selected=r.id;notify('Novo rascunho preparado. Revisão humana pendente.');await refresh();}catch(e){notify(e.message,true);}});
$('reports-tab').addEventListener('click',()=>session&&switchView('reports'));
$('risk-tab').addEventListener('click',async()=>{const generation=sessionGeneration;try{const result=await api('/api/risk');if(generation!==sessionGeneration||!session)return;switchView('risk');$('risk-output').textContent=JSON.stringify(result,null,2);}catch(e){notify(e.message,true);}});
api('/api/session').then(enterSession).catch(()=>{});
