import { PortalClient, validateConfig } from './client.mjs';
import { CofreWorkspace, renderCofreReport, renderPublicationContext } from './cofre-ui.mjs';
import { createAuthControls, consumeAuthFragment } from './auth-controls.mjs';
import { AuthControlsUI } from './auth-controls-ui.mjs';

const $ = id => document.getElementById(id);
let client, session, reports = [], publications = [], generation = 0, detailGeneration = 0;
let busy = false;
let roster = [], activeView = 'diagnostics', cofre, authUI;
let accessLink = null, accessLinkError = false;
// Remove Auth fragments before configuration requests or rendering any account data.
try { accessLink = consumeAuthFragment(location.href, url => history.replaceState(history.state, '', url)); }
catch { accessLinkError = true; }
const requestKeys = new Map();
const message = value => { $('message').textContent = value; };
function element(tag, value = '', cls = '') {
  const node = document.createElement(tag); node.textContent = value; node.className = cls; return node;
}
function clearWorkspace() {
  ++generation; ++detailGeneration; session = null; reports = []; publications = []; requestKeys.clear();
  roster = []; activeView = 'diagnostics'; cofre?.clear();
  authUI?.clear();
  $('workspace').hidden = true; $('login-panel').hidden = false; $('logout').hidden = true;
  $('identity').textContent = ''; $('reports').replaceChildren(); $('detail').replaceChildren();
  $('password').value = '';
  $('workspace-nav').hidden = true; $('cases-panel').hidden = true;
}
function button(label, run, cls = '') {
  const node = element('button', label, cls);
  node.addEventListener('click', async () => {
    if (busy) return;
    busy = true; node.disabled = true; const epoch = generation;
    try { await run(); } catch (error) { if (epoch === generation || !session) message(error.message); }
    finally { busy = false; node.disabled = false; }
  });
  return node;
}
function roles(caseId) {
  return session.assignments.filter(a => a.case_id === caseId).map(a => a.staff_role);
}
async function refresh() {
  const epoch = generation; ++detailGeneration;
  cofre?.suspend();
  // Remove the old document before any authorization recheck, including failures.
  $('detail').replaceChildren(element('h2', 'Selecione um diagnóstico'));
  $('reports').replaceChildren(); reports = []; publications = [];
  const access = await client.api('/access-requirements');
  if (epoch !== generation || !session) return;
  if (access.mfa_required && access.assurance_level !== 'aal2') {
    $('workspace').hidden = true; $('login-panel').hidden = true;
    await authUI.startMfa(); return;
  }
  const [versions, deliveries, people, current] = await Promise.all([
    client.api('/reports'), client.api('/publications'), client.api('/cofre/workspaces'), client.api('/session')]);
  if (epoch !== generation || !session) return;
  reports = versions.data; publications = deliveries.data; roster = people.data;
  if (!Array.isArray(reports) || !Array.isArray(publications) || !Array.isArray(roster) || !Array.isArray(current.assignments) || current.user_id !== session.user_id) throw new Error('Resposta inválida do serviço.');
  session = current;
  const staff = session.assignments.length > 0 || roster.length > 0;
  $('identity').textContent = staff ? 'Console da equipe · atendimentos fictícios e revisão por caso' : 'Portal do cliente · somente versões publicadas para você';
  $('workspace-nav').hidden = !staff;
  if (staff) await cofre.load(roster); else { cofre.clear(); activeView = 'diagnostics'; }
  if (epoch !== generation || !session) return;
  showView(activeView);
  if (!reports.length) $('reports').append(element('p', staff
    ? 'Nenhum rascunho atribuído. Abra Atendimentos para preparar um COFRE Individual fictício.'
    : 'Nenhum diagnóstico foi publicado para você. A equipe precisa revisar e liberar uma versão para esta conta.'));
  for (const report of reports) {
    const node = button('Diagnóstico · versão ' + report.version_number, () => openReport(report));
    node.dataset.version = report.id; $('reports').append(node);
  }
}
function facts(content, staff) {
  if (content.report_kind === 'cofre_individual') return renderCofreReport(content, { staff });
  const box = element('section');
  box.append(element('h3', 'Contexto da análise'));
  box.append(element('p', typeof content.summary === 'string' ? content.summary : 'Confira o conteúdo e as limitações registrados no documento.'));
  const quality = content.data_quality;
  if (quality && typeof quality === 'object') box.append(element('p',
    'Qualidade declarada no documento: ' + String(quality.mode || 'não informada') + ' · ' + String(quality.freshness || 'atualidade não informada'), 'muted'));
  if (typeof content.as_of === 'string') box.append(element('p', 'Data de corte declarada: ' + content.as_of, 'muted'));
  for (const [key, title] of [['findings', 'Pontos da análise'], ['limitations', 'Limites'], ['next_steps', 'Próximos passos']]) {
    if (!Array.isArray(content[key])) continue;
    box.append(element('h3', title)); const list = element('ul');
    for (const item of content[key]) list.append(element('li', typeof item === 'string' ? item :
      [item?.title, item?.evidence, item?.impact, item?.action].filter(value => typeof value === 'string').join(' · ') || 'Item sem descrição legível. Peça esclarecimento à equipe.'));
    box.append(list);
  }
  if (staff) { const full = element('details', '', 'technical'); full.append(element('summary', 'Documento técnico (JSON) · somente equipe'), element('pre', JSON.stringify(content, null, 2))); box.append(full); }
  return box;
}
function digestFields(pkg) {
  return { expected_content_sha256: pkg.content_sha256, expected_manifest_sha256: pkg.manifest_sha256 };
}
async function mutate(path, body, success, report, readGeneration) {
  if (readGeneration !== detailGeneration) throw new Error('Reabra a versão antes de continuar.');
  // Keep the same key for an uncertain retry of the exact payload in this session.
  const fingerprint = path + JSON.stringify(body);
  if (!requestKeys.has(fingerprint)) requestKeys.set(fingerprint, crypto.randomUUID());
  const epoch = generation;
  await client.api(path, { ...body, idempotency_key: requestKeys.get(fingerprint) });
  if (epoch !== generation || !session) return;
  message(success); await refresh();
  if (epoch === generation && reports.some(r => r.id === report.id)) await openReport(report);
}
async function openReport(report) {
  const epoch = generation, readGeneration = ++detailGeneration;
  const panel = $('detail'); panel.replaceChildren(element('p', 'Verificando acesso…'));
  const base = '/reports/' + report.id;
  const staffRoles = roles(report.case_id), staff = staffRoles.length > 0;
  let pkg, row, recipients = [];
  try {
    if (staff) {
      const [result, members] = await Promise.all([client.api(base + '/review-package'), client.api('/cases/' + report.case_id + '/recipients')]);
      pkg = result.data; recipients = members.data; row = { content: pkg.content, content_sha256: pkg.content_sha256 };
    } else row = (await client.api(base)).data;
  } catch (error) {
    if (epoch === generation && readGeneration === detailGeneration) panel.replaceChildren(element('h2', 'Diagnóstico indisponível'));
    throw error;
  }
  if (epoch !== generation || readGeneration !== detailGeneration || !session) return;
  const content = row.content && typeof row.content === 'object' ? row.content : {};
  panel.replaceChildren(element('h2', typeof content.title === 'string' ? content.title : 'Diagnóstico'),
    element('p', 'Versão ' + report.version_number + ' · documento ' + report.id, 'muted'), facts(content, staff));
  if (!staff) panel.append(renderPublicationContext(publications.filter(row => row.report_version_id === report.id)));
  const proof = element('details'); proof.append(element('summary', 'Identificador desta versão'), element('code', row.content_sha256));
  if (pkg) proof.append(element('p', 'Identificador dos anexos'), element('code', pkg.manifest_sha256));
  panel.append(proof);
  const actions = element('div', '', 'actions no-print');
  actions.append(button('Salvar / imprimir PDF', async () => {
    try {
      const fresh = await client.api(staff ? base + '/review-package' : base);
      if (epoch !== generation || readGeneration !== detailGeneration) return;
      if (fresh.data?.content_sha256 !== row.content_sha256) throw new Error('A versão mudou. Reabra o diagnóstico antes de imprimir.');
      window.print();
    } catch (error) { if (epoch === generation && readGeneration === detailGeneration) panel.replaceChildren(element('h2', 'Confira o acesso novamente'), element('p', error.message)); throw error; }
  }, 'primary'));
  if (staff) actions.append(button('Baixar JSON técnico', async () => {
    const value = await client.api(base + '/download');
    if (epoch !== generation || readGeneration !== detailGeneration) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(value.data, null, 2)], { type: 'application/json' }));
    const link = element('a'); link.href = url; link.download = 'diagnostico-' + report.id + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  if (!staff) {
    for (const publication of publications.filter(p => p.report_version_id === report.id)) {
      actions.append(button('Confirmar recebimento', async () => {
        await client.api('/publications/' + publication.id + '/receipt', {});
        if (epoch === generation) message('Recebimento registrado. Isso não aprova uma estratégia ou transação.');
      }));
    }
  }
  panel.append(actions);
  if (!pkg) return;
  const review = element('section', '', 'boundary no-print'); review.append(element('h3', 'Revisão humana'));
  const reviewState = pkg.human_review?.decision;
  review.append(element('p', reviewState === 'approved' ? 'Revisão registrada: aprovada.' : reviewState === 'rejected' ? 'Revisão registrada: rejeitada.' : 'Revisão pendente.'));
  const hasAssets = Array.isArray(pkg.assets) && pkg.assets.length > 0;
  if (hasAssets) {
    review.append(element('p', 'Esta versão possui anexos. A revisão e a publicação pelo portal aguardam a validação dos bytes de todos os anexos.'));
    const manifest = element('details'); manifest.append(element('summary', 'Conferir manifesto dos anexos'), element('pre', JSON.stringify(pkg.assets, null, 2))); review.append(manifest);
  }
  const acknowledgement = element('label'); const observed = document.createElement('input'); observed.type = 'checkbox'; observed.id = 'observed';
  acknowledgement.append(observed, document.createTextNode('Li o documento completo e conferi esta versão.')); review.append(acknowledgement);
  const insist = () => { if (!observed.checked) throw new Error('Confirme a leitura desta versão antes de continuar.'); };
  const controls = element('div', '', 'actions');
  if (!reviewState && !hasAssets && staffRoles.some(r => ['reviewer', 'admin'].includes(r))) {
    for (const [decision, label] of [['approved', 'Aprovar esta versão'], ['rejected', 'Rejeitar esta versão']]) {
      controls.append(button(label, async () => { insist(); await mutate(base + '/review', {
        decision, ...digestFields(pkg), private_notes: '',
      }, 'Revisão registrada para esta versão.', report, readGeneration); }));
    }
  }
  review.append(controls);
  if (reviewState === 'approved' && !hasAssets && staffRoles.some(r => ['publisher', 'admin'].includes(r))) {
    review.append(element('h3', 'Publicar para destinatários'));
    const selected = [];
    for (const recipient of recipients) {
      const label = element('label', '', 'recipient'), check = document.createElement('input'); check.type = 'checkbox'; check.value = recipient.user_id;
      const person = roster.find(person => person.user_id === recipient.user_id);
      label.append(check, document.createTextNode(person?.display_name || 'Conta autorizada: ' + recipient.user_id)); review.append(label); selected.push(check);
    }
    if (!recipients.length) review.append(element('p', 'Nenhum destinatário ativo cadastrado neste caso.'));
    const expiresLabel = element('label', 'Acesso até (seu horário local)'); expiresLabel.htmlFor = 'expires';
    const expires = document.createElement('input'); expires.id = 'expires'; expires.type = 'datetime-local'; review.append(expiresLabel, expires);
    review.append(button('Publicar diagnóstico', async () => {
      insist(); const date = new Date(expires.value);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error('Informe uma validade futura para o acesso.');
      const targets = selected.filter(c => c.checked).map(c => c.value);
      if (!targets.length) throw new Error('Selecione pelo menos um destinatário.');
      await mutate(base + '/publish', { recipient_user_ids: targets, ...digestFields(pkg), expires_at: date.toISOString() },
        'Diagnóstico publicado para os destinatários selecionados.', report, readGeneration);
    }, 'primary'));
  }
  if (staffRoles.some(r => ['publisher', 'admin'].includes(r))) {
    for (const publication of publications.filter(p => p.report_version_id === report.id)) {
      const block = element('section', '', 'boundary'); block.append(element('p', 'Registro de entrega: ' + publication.id),
        element('p', 'Este registro não informa se houve revogação. Consulte o estado no servidor antes de repetir uma ação.', 'muted'));
      const reasonLabel = element('label', 'Motivo da revogação'), reason = document.createElement('input');
      reason.id = 'reason-' + publication.id; reason.maxLength = 1000; reasonLabel.htmlFor = reason.id; block.append(reasonLabel, reason);
      block.append(button('Revogar esta entrega', async () => {
        insist(); if (!reason.value.trim()) throw new Error('Informe o motivo da revogação.');
        await mutate('/publications/' + publication.id + '/revoke', { recipient_user_id: null, reason: reason.value, ...digestFields(pkg) },
          'Entrega revogada. Novos acessos serão negados; arquivos já baixados não são recuperados.', report, readGeneration);
      }, 'danger')); review.append(block);
    }
  }
  panel.append(review);
}

function showView(view) {
  activeView = view;
  $('cases-panel').hidden = view !== 'cases'; $('diagnostics-panel').hidden = view !== 'diagnostics';
  $('cases-tab').setAttribute('aria-current', view === 'cases' ? 'page' : 'false');
  $('reports-tab').setAttribute('aria-current', view === 'diagnostics' ? 'page' : 'false');
}
cofre = new CofreWorkspace({ root: $('cofre-workspace'), api: (path, body) => client.api(path, body),
  currentSession: () => session, notice: message,
  onCreated: async () => { const epoch = generation, current = await client.api('/session'); if (epoch === generation && session && current.user_id === session.user_id) session = current; },
  onSaved: async reportId => { await refresh(); if (!session) return; showView('diagnostics'); const report = reports.find(row => row.id === reportId); if (report) await openReport(report); },
});
$('cases-tab').addEventListener('click', () => { if (session && !$('workspace-nav').hidden) showView('cases'); });
$('reports-tab').addEventListener('click', () => { if (session) showView('diagnostics'); });
window.addEventListener('beforeunload', event => { if (cofre.dirty && session) { event.preventDefault(); event.returnValue = ''; } });

async function continueAccess(current) {
  if (!Array.isArray(current.assignments) || typeof current.user_id !== 'string') throw new Error('Sessão inválida.');
  session = current; ++generation; activeView = 'cases';
  const epoch = generation, access = await client.api('/access-requirements');
  if (epoch !== generation || !session) return;
  if (typeof access.mfa_required !== 'boolean' || !['aal1','aal2'].includes(access.assurance_level)) throw new Error('Sessão inválida.');
  $('login-panel').hidden = true; $('logout').hidden = false;
  if (access.mfa_required && access.assurance_level !== 'aal2') {
    $('workspace').hidden = true; await authUI.startMfa(); return;
  }
  authUI.clear(); $('workspace').hidden = false;
  await refresh();
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !client) return;
  busy = true; $('login').disabled = true; message('');
  const email = $('email').value.trim(), password = $('password').value; $('password').value = '';
  try {
    const current = await client.login(email, password);
    await continueAccess(current);
  } catch (error) { client.clear(); message(error.message); }
  finally { busy = false; $('login').disabled = false; }
});
$('logout').addEventListener('click', async () => {
  try { await client.logout(); message('Sessão encerrada neste navegador.'); }
  catch { message('Acesso local encerrado. O servidor não confirmou a saída; tente novamente ao recuperar a conexão.'); }
});
$('refresh').addEventListener('click', async () => {
  if (cofre.pending) { message('Aguarde a gravação atual antes de conferir o acesso.'); return; }
  if (busy || !session) return; busy = true;
  try { await refresh(); message('Acesso atualizado.'); } catch (error) { message(error.message); }
  finally { busy = false; }
});
window.addEventListener('pagehide', () => client?.clear());
try {
  const response = await fetch('./config.json', { cache: 'no-store', credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('Ambiente ainda não configurado.');
  const config = validateConfig(await response.json(), location.origin);
  client = new PortalClient(config, { onEnd: clearWorkspace });
  const auth = createAuthControls({ request: (path, options) => client.authRequest(path, options),
    onSession: value => client.adoptSession(value) });
  authUI = new AuthControlsUI({ root: $('auth-controls'), auth,
    onAuthenticated: async () => continueAccess(await client.api('/session')),
    onPasswordUpdated: async result => { client.clear(); message(result?.session_ended
      ? 'Senha salva. Entre novamente com seu e-mail e a nova senha.'
      : 'Senha salva, mas o servidor não confirmou o encerramento da sessão temporária. Entre novamente e peça apoio à equipe se o aviso continuar.'); },
    onCancel: async () => { try { await client.logout(); } catch { client.clear(); } },
  });
  $('recover').disabled = false; $('login').disabled = false;
  $('recover').addEventListener('click', () => { if (busy) return; $('login-panel').hidden = true; authUI.showRecoveryRequest(); });
  if (accessLink || accessLinkError) {
    $('login-panel').hidden = true; authUI.startAccessLink(accessLink); accessLink = null;
  }
} catch { message('Ambiente ainda não configurado. A equipe precisa concluir a implantação.'); }
