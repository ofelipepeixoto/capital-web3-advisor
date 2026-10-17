import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthControlsUI, OFFICIAL_PORTAL_ORIGIN } from '../apps/staging/auth-controls-ui.mjs';
import { MAX_TOTP_QR_IMAGE_LENGTH } from '../apps/staging/auth-controls.mjs';

// Interaction and lifecycle checks with a minimal DOM, not visual browser validation.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.handlers = {}; this._text = ''; this.value = ''; this.disabled = false; this.hidden = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(' '); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.handlers[name] = callback; }
  focus() { focused = this; }
  all() { return [this, ...this.children.flatMap(child => child.all())]; }
  querySelectorAll(selectors) { return this.all().slice(1).filter(item => selectors.split(',').some(selector => item.tagName === selector.trim())); }
  click() { return this.disabled ? undefined : this.handlers.click?.({ preventDefault() {} }); }
}
let focused;
globalThis.document = { createElement: tag => new Element(tag), createTextNode: text => { const element = new Element('#text'); element.textContent = text; return element; } };
const button = (root, title) => root.all().find(element => element.tagName === 'button' && element.textContent === title);
const field = (root, id) => root.all().find(element => element.id === id);
const enrollment = { id: 'factor-a', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg"><text>synthetic</text></svg>', secret: 'SYNTHETIC_ONLY_SECRET', uri: 'otpauth://totp/synthetic' } };
function harness(authOverrides = {}, callbacks = {}) {
  const root = new Element('section'), calls = [], completed = [];
  const auth = { listFactors: async () => ({ totp: [] }), enrollTOTP: async () => enrollment,
    cancelPendingTOTP: async factorId => { calls.push(['cancel-pending', factorId]); return { cancelled: true, factor_id: factorId }; },
    verifyTOTP: async (...args) => { calls.push(['verify', ...args]); return { aal: 'aal2' }; },
    updatePassword: async (...args) => { calls.push(['password', ...args]); return { updated: true }; },
    recover: async (...args) => { calls.push(['recover', ...args]); return { message: 'neutral' }; }, ...authOverrides };
  const ui = new AuthControlsUI({ root, auth, onAuthenticated: async () => { completed.push('mfa'); }, onPasswordUpdated: async () => { completed.push('password'); }, onCancel: async () => { completed.push('cancel'); }, ...callbacks });
  return { root, ui, calls, completed };
}

test('enrollment requires an explicit choice, QR stays an image and secret disappears before callback', async () => {
  const h = harness({}, { onAuthenticated: async () => { assert.ok(!h.root.textContent.includes(enrollment.totp.secret)); assert.equal(h.ui.enrollment, null); h.completed.push('mfa'); } });
  await h.ui.startMfa(); assert.equal(h.root.querySelectorAll('img').length, 0); assert.ok(h.root.textContent.includes('somente contas e dados fictícios'));
  assert.ok(h.root.textContent.includes(OFFICIAL_PORTAL_ORIGIN));
  await button(h.root, 'Configurar autenticador').click();
  const qr = h.root.querySelectorAll('img')[0]; assert.ok(qr.src.startsWith('data:image/svg+xml;')); assert.equal(h.root.querySelectorAll('svg').length, 0);
  assert.ok(h.root.textContent.includes(enrollment.totp.secret));
  const code = field(h.root, 'auth-totp-code'); assert.equal(code.autocomplete, 'one-time-code'); assert.equal(code.inputMode, 'numeric');
  code.value = '12345'; await button(h.root, 'Confirmar código').click(); assert.equal(h.calls.length, 0); assert.ok(h.root.textContent.includes('exatamente os 6 dígitos')); assert.equal(focused.attributes.role, 'alert');
  code.value = '123456'; await button(h.root, 'Confirmar código').click(); assert.deepEqual(h.calls, [['verify', 'factor-a', '123456']]); assert.deepEqual(h.completed, ['mfa']);
  assert.equal(h.root.hidden, true); assert.equal(h.root.textContent, ''); assert.equal(code.value, '');
});

test('a valid canonical QR larger than 150k remains an image within the shared bound', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">' + '<rect width="1" height="1"/>'.repeat(9000) + '</svg>';
  const qr = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  assert.ok(qr.length > 150000); assert.ok(qr.length < MAX_TOTP_QR_IMAGE_LENGTH);
  const h = harness({ enrollTOTP: async () => ({ ...enrollment, totp: { ...enrollment.totp, qr_code: qr } }) });
  await h.ui.startMfa(); await button(h.root, 'Configurar autenticador').click();
  assert.equal(h.root.querySelectorAll('img')[0].src, qr); assert.equal(h.root.querySelectorAll('svg').length, 0);
});

test('an existing factor uses verification without displaying enrollment material and errors stay generic', async () => {
  let enrolls = 0;
  const h = harness({ listFactors: async () => ({ totp: [{ id: 'verified-a', status: 'verified', friendly_name: '<img onerror=attack>' }] }),
    enrollTOTP: async () => { enrolls++; return enrollment; }, verifyTOTP: async () => { throw new Error('PRIVATE_PROVIDER_TOKEN'); } });
  await h.ui.startMfa(); assert.equal(enrolls, 0); assert.equal(h.root.querySelectorAll('img').length, 0); assert.ok(!h.root.textContent.includes(enrollment.totp.secret));
  const code = field(h.root, 'auth-totp-code'); code.value = '654321'; await button(h.root, 'Confirmar código').click();
  assert.ok(h.root.textContent.includes('Não foi possível concluir')); assert.ok(!h.root.textContent.includes('PRIVATE_PROVIDER_TOKEN')); assert.equal(code.value, ''); assert.equal(h.completed.length, 0);
});

test('an existing incomplete factor requires explicit removal before another enrollment', async () => {
  let removed = false, enrolled = 0;
  const h = harness({ listFactors: async () => ({ totp: [], all: removed ? [] : [{ id: 'pending-a', status: 'unverified', friendly_name: 'Teste incompleto' }] }),
    cancelPendingTOTP: async id => { h.calls.push(['cancel-pending', id]); removed = true; }, enrollTOTP: async () => { enrolled++; return enrollment; } });
  await h.ui.startMfa(); assert.equal(enrolled, 0); assert.equal(h.calls.length, 0);
  assert.equal(button(h.root, 'Configurar autenticador'), undefined); assert.ok(button(h.root, 'Remover configuração incompleta'));
  await button(h.root, 'Remover configuração incompleta').click();
  assert.deepEqual(h.calls, [['cancel-pending', 'pending-a']]); assert.equal(enrolled, 0); assert.ok(button(h.root, 'Configurar autenticador'));
});

test('a verified factor offers verification and never the incomplete-factor removal action', async () => {
  const verified = { id: 'verified-a', status: 'verified' }, h = harness({ listFactors: async () => ({ totp: [verified], all: [verified] }) });
  await h.ui.startMfa(); assert.ok(button(h.root, 'Confirmar código')); assert.equal(button(h.root, 'Remover configuração incompleta'), undefined);
  await button(h.root, 'Voltar para a entrada').click(); assert.equal(h.calls.length, 0); assert.deepEqual(h.completed, ['cancel']);
});

test('canceling enrollment clears secrets before cleanup and failed cleanup permits local exit', async () => {
  let attempts = 0;
  const h = harness({ cancelPendingTOTP: async id => { attempts++; h.calls.push(['cancel-pending', id]); assert.ok(!h.root.textContent.includes(enrollment.totp.secret)); throw new Error('PRIVATE_FAILURE'); } });
  await h.ui.startMfa(); await button(h.root, 'Configurar autenticador').click(); const code = field(h.root, 'auth-totp-code'); code.value = '123456';
  await button(h.root, 'Cancelar configuração e voltar').click(); assert.equal(attempts, 1); assert.equal(code.value, ''); assert.equal(h.ui.enrollment, null);
  assert.equal(h.root.querySelectorAll('img').length, 0); assert.ok(h.root.textContent.includes('pode continuar na conta')); assert.ok(!h.root.textContent.includes('PRIVATE_FAILURE'));
  assert.ok(button(h.root, 'Tentar remover configuração incompleta novamente'));
  await button(h.root, 'Sair sem remover configuração incompleta').click(); assert.equal(attempts, 1); assert.equal(h.root.textContent, ''); assert.deepEqual(h.completed, ['cancel']);
});

test('successful explicit enrollment cancellation exits after removing only its pending factor', async () => {
  const h = harness(); await h.ui.startMfa(); await button(h.root, 'Configurar autenticador').click();
  await button(h.root, 'Cancelar configuração e voltar').click();
  assert.deepEqual(h.calls, [['cancel-pending', 'factor-a']]); assert.deepEqual(h.completed, ['cancel']); assert.equal(h.root.textContent, '');
});

test('late factor list and enrollment cannot restore a cleared flow', async () => {
  let release;
  const h = harness({ listFactors: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.ui.startMfa(); h.ui.clear(); release({ totp: [] }); await pending; assert.equal(h.root.textContent, ''); assert.equal(h.root.hidden, true);
  const e = harness({ enrollTOTP: () => new Promise(resolve => { release = resolve; }) });
  await e.ui.startMfa(); const enrolling = button(e.root, 'Configurar autenticador').click(); e.ui.clear(); release(enrollment); await enrolling;
  assert.equal(e.root.textContent, ''); assert.equal(e.ui.enrollment, null); assert.equal(e.root.querySelectorAll('img').length, 0);
});

test('logout during MFA verification suppresses any authenticated transition', async () => {
  let release;
  const h = harness({ verifyTOTP: () => new Promise(resolve => { release = resolve; }) });
  await h.ui.startMfa(); await button(h.root, 'Configurar autenticador').click(); field(h.root, 'auth-totp-code').value = '123456';
  const pending = button(h.root, 'Confirmar código').click(); h.ui.clear(); release({ aal: 'aal2' }); await pending;
  assert.equal(h.completed.length, 0); assert.equal(h.ui.enrollment, null); assert.equal(h.root.textContent, '');
});

test('recovery validates email, uses canonical redirect and never confirms account existence', async () => {
  const h = harness(); h.ui.showRecoveryRequest();
  field(h.root, 'auth-recovery-email').value = 'invalid'; await button(h.root, 'Solicitar link de recuperação').click(); assert.equal(h.calls.length, 0);
  field(h.root, 'auth-recovery-email').value = 'synthetic@example.invalid'; await button(h.root, 'Solicitar link de recuperação').click();
  assert.deepEqual(h.calls, [['recover', 'synthetic@example.invalid', OFFICIAL_PORTAL_ORIGIN + '/']]);
  assert.ok(h.root.textContent.includes('A resposta não confirma se existe uma conta')); assert.equal(h.completed.length, 0);
});

test('invite uses only the user typed password, shows no token and finishes at normal login', async () => {
  const h = harness(); h.ui.startAccessLink({ type: 'invite', accessToken: 'PRIVATE_TEMP_LINK_TOKEN', expiresIn: 600 });
  assert.ok(h.root.textContent.includes('Defina sua senha')); assert.ok(!h.root.textContent.includes('PRIVATE_TEMP_LINK_TOKEN')); assert.ok(h.root.textContent.includes('não cria papéis'));
  const first = field(h.root, 'auth-new-password'), second = field(h.root, 'auth-confirm-password');
  assert.equal(first.autocomplete, 'new-password'); first.value = 'synthetic-password-A'; second.value = 'synthetic-password-B';
  await button(h.root, 'Salvar minha senha').click(); assert.equal(h.calls.length, 0); assert.ok(h.root.textContent.includes('precisam ser iguais'));
  second.value = first.value; await button(h.root, 'Salvar minha senha').click();
  assert.deepEqual(h.calls, [['password', 'PRIVATE_TEMP_LINK_TOKEN', 'synthetic-password-A']]); assert.deepEqual(h.completed, ['password']);
  assert.equal(first.value, ''); assert.equal(second.value, ''); assert.equal(h.ui.accessLink, null); assert.ok(h.root.textContent.includes('Entre novamente'));
});

test('password callback receives failed remote-session termination without claiming a completed logout', async () => {
  const result = { updated: true, session_ended: false }; let received;
  const h = harness({ updatePassword: async () => result }, { onPasswordUpdated: async value => { received = value; } });
  h.ui.startAccessLink({ type: 'recovery', accessToken: 'private-temp-token', expiresIn: 120 });
  field(h.root, 'auth-new-password').value = 'synthetic-password'; field(h.root, 'auth-confirm-password').value = 'synthetic-password';
  await button(h.root, 'Salvar minha senha').click();
  assert.deepEqual(received, result); assert.equal(h.ui.accessLink, null);
  assert.ok(h.root.textContent.includes('saída remota da sessão temporária não foi confirmada'));
  assert.ok(!h.root.textContent.includes('Todas as sessões foram encerradas'));
});

test('invalid or expired link has no password form and arbitrary QR URLs are not loaded', async () => {
  const h = harness(); h.ui.startAccessLink({ type: 'invite', accessToken: 'token', expiresIn: 0 }); assert.equal(h.root.querySelectorAll('input').length, 0); assert.ok(h.root.textContent.includes('Link indisponível'));
  const e = harness({ enrollTOTP: async () => ({ ...enrollment, totp: { ...enrollment.totp, qr_code: 'https://attacker.invalid/collect?secret=private' } }) });
  await e.ui.startMfa(); await button(e.root, 'Configurar autenticador').click(); assert.equal(e.root.querySelectorAll('img').length, 0); assert.ok(e.root.textContent.includes(enrollment.totp.secret));
});

test('clear erases password values and a late password response cannot advance another session', async () => {
  let release;
  const h = harness({ updatePassword: () => new Promise(resolve => { release = resolve; }) });
  h.ui.startAccessLink({ type: 'recovery', accessToken: 'private-token', expiresIn: 120 });
  const first = field(h.root, 'auth-new-password'), second = field(h.root, 'auth-confirm-password'); first.value = 'synthetic-password'; second.value = first.value;
  const pending = button(h.root, 'Salvar minha senha').click(); assert.equal(first.value, ''); h.ui.clear(); release({ updated: true }); await pending;
  assert.equal(h.completed.length, 0); assert.equal(h.ui.accessLink, null); assert.equal(h.root.textContent, '');
  h.ui.startAccessLink({ type: 'invite', accessToken: 'private-token-2', expiresIn: 120 }); const unsent = field(h.root, 'auth-new-password'); unsent.value = 'unsent-private-password';
  h.ui.clear(); assert.equal(unsent.value, ''); assert.equal(h.root.textContent, '');
});

test('official origin cannot be replaced by a caller supplied destination', () => {
  assert.throws(() => new AuthControlsUI({ root: new Element('section'), auth: {}, officialOrigin: 'https://attacker.invalid' }), /Endereço oficial inválido/);
});
