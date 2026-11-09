import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JourneyExercise } from '../apps/staging/journey-exercise.mjs';
import { listSyntheticJourneys, summarizeJourney } from '../supabase/functions/advisory-api/journeys.mjs';
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.attributes={};this._text='';this.value='';this.disabled=false;}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(x=>x.textContent).join(' ');}
  append(...items){this.children.push(...items);} replaceChildren(...items){this._text='';this.children=items;}
  setAttribute(k,v){this.attributes[k]=v;} addEventListener(k,v){this.handlers[k]=v;}
  all(){return [this,...this.children.flatMap(x=>x.all())];} click(){return this.handlers.click?.();}
}
globalThis.document={createElement:t=>new Element(t)};
globalThis.window={confirm:()=>false};
const byText=(root,text)=>root.all().find(x=>x.tagName==='button'&&x.textContent===text);
test('synthetic exercise sends fixed categorical answers and reports gaps honestly',async()=>{
  const root=new Element('section'),calls=[];
  const ui=new JourneyExercise({root,api:async(path,body)=>{calls.push({path,body});return {data:body?summarizeJourney(body):listSyntheticJourneys()};}});
  await ui.load();byText(root,'RASTRO').click();assert.match(root.textContent,/não salva/);
  const form=root.all().find(x=>x.tagName==='form'); await form.handlers.submit({preventDefault(){}});
  assert.equal(calls[1].path,'/cofre/journeys/preview');assert.equal(calls[1].body.synthetic,true);
  assert.match(root.textContent,/Exercício incompleto/);assert.match(root.textContent,/Nada foi salvo/);
  const select=root.all().find(x=>x.tagName==='select');select.value='gap';select.handlers.change();assert.equal(ui.dirty,true);
  byText(root,'Escolher outro exercício').click();assert.ok(root.textContent.includes('Plano de 90 dias'));
  ui.clear();assert.equal(ui.dirty,false);assert.equal(root.textContent,'');
});
test('a late result cannot recreate exercise content after session cleanup',async()=>{
  const root=new Element('section');let resolve;
  const ui=new JourneyExercise({root,api:()=>new Promise(r=>{resolve=r;})});
  const pending=ui.load();ui.clear();resolve({data:listSyntheticJourneys()});await pending;
  assert.equal(root.textContent,'');assert.equal(ui.dirty,false);
});

test('failed catalog loads can be retried from the visible UI without logging out',async()=>{
  const root=new Element('section');let calls=0,finish;
  const ui=new JourneyExercise({root,api:async path=>{
    assert.equal(path,'/cofre/journeys');calls++;
    if(calls===1)throw Error('offline');
    if(calls===2)return {data:[]};
    return new Promise(resolve=>{finish=resolve;});
  }});
  await ui.load();assert.match(root.textContent,/Não foi possível carregar/);
  await byText(root,'Tentar novamente').click();assert.equal(calls,2);
  const retry=byText(root,'Tentar novamente');assert.ok(retry);
  const pending=retry.click();assert.equal(calls,3);assert.match(root.textContent,/Carregando/);
  await retry.click();assert.equal(calls,3,'a repeated click must not start another load');
  finish({data:listSyntheticJourneys()});await pending;
  for(const title of ['COFRE-6 Individual','RASTRO','Investidor avançado','Empresa ou DAO'])assert.ok(byText(root,title));
  assert.equal(byText(root,'Tentar novamente'),undefined);
  byText(root,'RASTRO').click();assert.match(root.textContent,/Plano de 90 dias/);
});

test('retry responses and detached controls cannot restore a cleared session',async()=>{
  for(const outcome of ['resolve','reject']){
    const root=new Element('section');let calls=0,finish;
    const ui=new JourneyExercise({root,api:async()=>{
      if(++calls===1)throw Error('offline');
      return new Promise((resolve,reject)=>{finish=outcome==='resolve'?()=>resolve({data:listSyntheticJourneys()}):()=>reject(Error('offline'));});
    }});
    await ui.load();const retry=byText(root,'Tentar novamente');assert.ok(retry);
    const pending=retry.click();ui.clear();finish();await pending;
    assert.equal(root.textContent,'');assert.equal(ui.dirty,false);
    await retry.click();assert.equal(calls,2);assert.equal(root.textContent,'');
  }
});

test('editing during an in-flight check suppresses the stale result and permits retry', async()=>{
  const root=new Element('section');let resolve, calls=0;
  const ui=new JourneyExercise({root,api:(path,body)=>{if(!body)return Promise.resolve({data:listSyntheticJourneys()});calls++;return new Promise(r=>{resolve=r;});}});
  await ui.load();byText(root,'RASTRO').click();
  const form=root.all().find(x=>x.tagName==='form'),run=byText(root,'Conferir situação do exemplo');
  const pending=form.handlers.submit({preventDefault(){}});assert.equal(run.disabled,true);
  const select=root.all().find(x=>x.tagName==='select');select.value='gap';select.handlers.change();
  assert.equal(run.disabled,false);resolve({data:{status:'awaits_human_review',counts:{}}});await pending;
  assert.ok(!root.textContent.includes('Etapas preenchidas no exemplo'));assert.equal(calls,1);
  const retry=form.handlers.submit({preventDefault(){}});assert.equal(calls,2);resolve({data:{status:'needs_input',counts:{}}});await retry;
  assert.ok(root.textContent.includes('Exercício incompleto'));
});

test('advanced investor and organization use authorized stateless preview without claiming a report',async()=>{
  for (const [title, expected, field] of [['Investidor avançado','advanced_investor','Ativos e passivos'],['Empresa ou DAO','organization_dao','Multisig e módulos']]) {
    const root=new Element('section'),calls=[];
    const ui=new JourneyExercise({root,api:async(path,body)=>{calls.push({path,body});return {data:body?summarizeJourney(body):listSyntheticJourneys()};}});
    await ui.load();byText(root,title).click();assert.ok(root.textContent.includes(field));
    const selects=root.all().filter(x=>x.tagName==='select');selects[0].value='gap';selects[0].handlers.change();
    await root.all().find(x=>x.tagName==='form').handlers.submit({preventDefault(){}});
    assert.equal(calls[1].body.journey,expected);assert.equal(calls[1].body.synthetic,true);
    assert.match(root.textContent,/Exercício incompleto/);assert.match(root.textContent,/Lacuna declarada/);assert.match(root.textContent,/Nada foi salvo/);
  }
});
