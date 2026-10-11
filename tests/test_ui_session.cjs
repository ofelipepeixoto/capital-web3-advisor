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
}

async function harness() {
  const nodes={},pending=[];
  const document={getElementById:id=>nodes[id]??(nodes[id]=new Element()),createElement:tag=>new Element(tag),querySelectorAll:()=>[]};
  const context=vm.createContext({document,console,URL,setTimeout,clearTimeout,fetch:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps/web/app.js'),'utf8'),context);
  const resolve=(request,body,status=200)=>request.resolve({ok:status<400,json:async()=>body});
  resolve(pending.shift(),{error:'no session'},401);
  await new Promise(setImmediate);
  return {nodes,pending,context,resolve,run:code=>vm.runInContext(code,context)};
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
})().catch(error=>{console.error(error);process.exitCode=1;});
