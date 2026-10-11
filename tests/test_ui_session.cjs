// Behavioral regression harness for session transitions. No browser rendering.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element {
  constructor(tag = 'div') { this.tagName=tag;this.children=[];this.handlers={};this.dataset={};this.hidden=false;this.value='';this._text='';this.classList={toggle:()=>{}}; }
  set textContent(value) { this._text=String(value);this.children=[]; }
  get textContent() { return this._text+this.children.map(c=>c.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text='';this.children=[...nodes]; }
  addEventListener(name, callback) { this.handlers[name]=callback; }
  setAttribute() {}
  querySelector(selector) { for(const child of this.children){if(selector==='.'+child.className)return child;const found=child.querySelector(selector);if(found)return found;}return null; }
}

async function harness({deferInitialSession=false}={}) {
  const nodes={},pending=[];
  const personas=Object.fromEntries(['ana','rui','client-a','client-b'].map(persona=>{const button=new Element('button');button.dataset.persona=persona;return [persona,button];}));
  const document={getElementById:id=>nodes[id]??(nodes[id]=new Element()),createElement:tag=>new Element(tag),querySelectorAll:selector=>selector==='[data-persona]'?Object.values(personas):[]};
  const context=vm.createContext({document,console,URL,setTimeout,clearTimeout,fetch:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps/web/app.js'),'utf8'),context);
  const resolve=(request,body,status=200)=>request.resolve({ok:status<400,json:async()=>body});
  const initialSession=pending.shift();
  if(!deferInitialSession)resolve(initialSession,{error:'no session'},401);
  await new Promise(setImmediate);
  return {nodes,pending,context,personas,initialSession,resolve,run:code=>vm.runInContext(code,context)};
}

(async()=>{
  // Start an authorized staff request, switch personas, then deliver its late response.
  const h=await harness();
  h.run("session={subject:'ana',role:'consultant',csrf_token:'local'};sessionGeneration=1;$('detail').append(text('p','PRIVATE DRAFT'));$('risk-output').textContent='PRIVATE RISK';");
  const oldRefresh=h.run('refresh()');
  const oldReports=h.pending.shift(),oldCases=h.pending.shift();
  const logout=h.nodes.logout.handlers.click();
  assert.equal(h.nodes.detail.textContent,'');
  assert.equal(h.nodes['risk-output'].textContent,'');
  assert.equal(h.nodes['report-list'].textContent,'');
  assert.equal(h.nodes.workspace.hidden,true);
  h.resolve(h.pending.shift(),{ok:true});await logout;
  const enter=h.run("enterSession({subject:'client-a',role:'client',csrf_token:'client'})");
  h.resolve(h.pending.shift(),[]);h.resolve(h.pending.shift(),[{id:'case-a'}]);await enter;
  const clientView=h.nodes.detail.textContent;
  h.resolve(oldReports,[{id:'private-draft',state:'draft',title:'PRIVATE DRAFT',version:1}]);
  h.resolve(oldCases,[{id:'case-a'}]);await oldRefresh;
  assert.equal(h.nodes.detail.textContent,clientView);
  assert.equal(h.nodes['report-list'].textContent.includes('PRIVATE DRAFT'),false);
  assert.equal(h.run('reports.length'),0);
  console.log('PASS: logout clears private data; late refresh cannot cross sessions');

  // An already requested private report must also be discarded after session change.
  const d=await harness();
  d.run("session={subject:'ana',role:'consultant',csrf_token:'local'};sessionGeneration=1;");
  const lateDetail=d.run("showReport('private-draft')");
  const request=d.pending.shift();
  const out=d.nodes.logout.handlers.click();d.resolve(d.pending.shift(),{ok:true});await out;
  d.resolve(request,{id:'private-draft',title:'PRIVATE DRAFT',payload:{summary:'PRIVATE'},permissions:{}});await lateDetail;
  assert.equal(d.nodes.detail.textContent,'');
  assert.equal(d.run('selected'),null);
  console.log('PASS: late detail cannot repopulate a logged-out workspace');

  // A reload's old session cannot interrupt a user-selected login still in flight.
  const s=await harness({deferInitialSession:true});
  const signingIn=s.personas['client-b'].handlers.click();
  const loginRequest=s.pending.shift();
  assert.equal(loginRequest.url,'/api/demo/session');
  s.resolve(s.initialSession,{subject:'rui',role:'reviewer',csrf_token:'old-local'});
  await new Promise(setImmediate);
  assert.equal(s.run('session'),null);
  assert.notEqual(s.nodes['identity-name']?.textContent,'Rui · revisor');
  assert.equal(s.pending.length,0,'A stale restored identity started private-data requests');
  s.resolve(loginRequest,{subject:'client-b',role:'client',csrf_token:'new-local'});
  await new Promise(setImmediate);
  s.resolve(s.pending.shift(),[{id:'report-b-v1',title:'Synthetic B',state:'published',version:1,case_id:'case-b'}]);
  s.resolve(s.pending.shift(),[{id:'case-b'}]);await signingIn;
  assert.equal(s.run('session.subject'),'client-b');
  assert.equal(s.nodes['identity-name'].textContent,'Cliente B');
  assert.equal(s.nodes['risk-tab'].hidden,true);
  assert.equal(s.nodes.draft.hidden,true);
  console.log('PASS: late initial restore cannot interrupt a new login');

  // The same stale restoration must remain ignored after the new login completes.
  const c=await harness({deferInitialSession:true});
  const newLogin=c.personas['client-b'].handlers.click();
  c.resolve(c.pending.shift(),{subject:'client-b',role:'client',csrf_token:'new-local'});
  await new Promise(setImmediate);
  c.resolve(c.pending.shift(),[]);c.resolve(c.pending.shift(),[{id:'case-b'}]);await newLogin;
  const clientWorkspace=c.nodes.detail.textContent;
  c.resolve(c.initialSession,{subject:'rui',role:'reviewer',csrf_token:'old-local'});
  await new Promise(setImmediate);
  assert.equal(c.run('session.subject'),'client-b');
  assert.equal(c.run('session.csrf_token'),'new-local');
  assert.equal(c.nodes['identity-role'].textContent,'Portal do cliente');
  assert.equal(c.nodes.detail.textContent,clientWorkspace);
  assert.equal(c.pending.length,0,'Stale restoration started a second refresh');
  console.log('PASS: late initial restore cannot replace a completed login');

  // Preserve a question typed while the receipt's report refresh is in flight.
  const q=await harness();
  q.run("session={subject:'client-a',role:'client',csrf_token:'local'};sessionGeneration=1;");
  const report={id:'report-a-v1',title:'Synthetic A',version:1,case_id:'case-a',state:'published',payload:{},permissions:{clarify:true,acknowledge:true}};
  const open=q.run("showReport('report-a-v1')");q.resolve(q.pending.shift(),report);await open;
  const receiptButton=q.nodes.detail.children.find(node=>node.className==='actions').children.find(node=>node.textContent==='Confirmar recebimento');
  const receipt=receiptButton.handlers.click();q.resolve(q.pending.shift(),{is_approval:false});
  await new Promise(setImmediate);
  q.resolve(q.pending.shift(),[report]);q.resolve(q.pending.shift(),[{id:'case-a'}]);
  await new Promise(setImmediate);
  const freshReport=q.pending.shift();
  q.nodes.detail.querySelector('.clarification').value='Question entered during refresh';
  q.resolve(freshReport,{...report,receipt:{status:'acknowledged'}});await receipt;
  assert.equal(q.nodes.detail.querySelector('.clarification').value,'Question entered during refresh');
  assert.equal(q.nodes.detail.textContent.includes('Recebimento confirmado para esta versão.'),true);
  const sendButton=q.nodes.detail.children.find(node=>node.textContent==='Enviar dúvida');
  const sent=sendButton.handlers.click();const sendRequest=q.pending.shift();
  assert.equal(JSON.parse(sendRequest.options.body).message,'Question entered during refresh');
  q.resolve(sendRequest,{status:'received'});await new Promise(setImmediate);
  q.resolve(q.pending.shift(),[report]);q.resolve(q.pending.shift(),[{id:'case-a'}]);
  await new Promise(setImmediate);q.resolve(q.pending.shift(),report);await sent;
  assert.equal(q.nodes.detail.querySelector('.clarification').value,'');
  console.log('PASS: receipt refresh preserves question; successful send clears it');

  // A newly typed draft during a successful send is different from that send.
  q.nodes.detail.querySelector('.clarification').value='Submitted second question';
  const sending=q.nodes.detail.children.find(node=>node.textContent==='Enviar dúvida').handlers.click();
  const secondSend=q.pending.shift();
  assert.equal(JSON.parse(secondSend.options.body).message,'Submitted second question');
  q.nodes.detail.querySelector('.clarification').value='New draft typed while sending';
  q.resolve(secondSend,{status:'received'});await new Promise(setImmediate);
  q.resolve(q.pending.shift(),[report]);q.resolve(q.pending.shift(),[{id:'case-a'}]);
  await new Promise(setImmediate);q.resolve(q.pending.shift(),report);await sending;
  assert.equal(q.nodes.detail.querySelector('.clarification').value,'New draft typed while sending');
  console.log('PASS: completing a send preserves a newer unsent question');

  // Switching report or logging out cannot carry an unsent question across contexts.
  q.nodes.detail.querySelector('.clarification').value='Unsent private question';
  const other=q.run("showReport('report-a-v2')");
  q.resolve(q.pending.shift(),{...report,id:'report-a-v2',version:2});await other;
  assert.equal(q.nodes.detail.querySelector('.clarification').value,'');
  q.nodes.detail.querySelector('.clarification').value='Another private question';
  const leave=q.nodes.logout.handlers.click();q.resolve(q.pending.shift(),{ok:true});await leave;
  assert.equal(q.nodes.detail.querySelector('.clarification'),null);
  const next=q.run("enterSession({subject:'client-b',role:'client',csrf_token:'next-local'})");
  q.resolve(q.pending.shift(),[]);q.resolve(q.pending.shift(),[{id:'case-b'}]);await next;
  assert.equal(q.nodes.detail.querySelector('.clarification'),null);
  console.log('PASS: unsent question is cleared across report and session transitions');
  q.run('clearTimeout(noticeTimer)');
})().catch(error=>{console.error(error);process.exitCode=1;});
