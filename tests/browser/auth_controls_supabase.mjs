/** Real Chromium TOTP enrollment using actual local Auth and application modules.
 * Edge transport alone is bridged. No mock Auth/database, traces or QR screenshots.
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { totpCode } from '../integration/auth_controls_e2e.mjs';

export async function runAuthControlsBrowser({ status, user, workspaceId, handler, origin }) {
  if (status.API_URL !== 'http://127.0.0.1:54321') throw new Error('Auth browser requires disposable local stack');
  const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
    '/app.mjs': ['app.mjs', 'text/javascript'], '/client.mjs': ['client.mjs', 'text/javascript'],
    '/cofre-ui.mjs': ['cofre-ui.mjs', 'text/javascript'], '/auth-controls.mjs': ['auth-controls.mjs', 'text/javascript'],
    '/auth-controls-ui.mjs': ['auth-controls-ui.mjs', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.url === '/config.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ supabaseUrl: status.API_URL, publishableKey: status.ANON_KEY })); return;
      }
      const file = files[req.url]; if (!file) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', file[1]); res.end(await readFile(new URL('../../apps/staging/' + file[0], import.meta.url)));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const localOrigin = 'http://127.0.0.1:' + server.address().port;
  let browser, context, page, gate = 'launch';
  const checks = [], network = [], errors = [];
  const expect = (condition, label) => { if (!condition) throw new Error('browser_gate'); checks.push(label); };
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('http://127.0.0.1:54321/functions/v1/advisory-api/**', async route => {
      const req = route.request();
      const response = await handler(new Request(req.url(), { method: req.method(), headers: { ...req.headers(), origin },
        ...(req.postData() ? { body: req.postData() } : {}) }));
      await route.fulfill({ status: response.status, headers: { ...Object.fromEntries(response.headers),
        'access-control-allow-origin': localOrigin }, body: await response.text() });
    });
    page = await context.newPage();
    page.on('response', response => network.push({ path: new URL(response.url()).pathname, status: response.status() }));
    page.on('pageerror', error => errors.push(error.name));
    gate = 'real password login';
    await page.goto(localOrigin);
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.locator('#login').click();
    await page.getByRole('heading', { name: 'Proteja o acesso da equipe', exact: true }).waitFor();
    expect(await page.locator('#workspace').isHidden(), 'AAL1 browser login keeps the product workspace hidden');
    expect(!network.some(row => /\/advisory-api\/(?:reports|publications|cases|cofre\/workspaces)/.test(row.path)),
      'AAL1 browser requests no roster, cases or report data before MFA');
    gate = 'real browser TOTP enrollment';
    await page.getByRole('button', { name: 'Configurar autenticador', exact: true }).click();
    await page.locator('.auth-enrollment-qr').waitFor();
    const manual = page.getByText('Não consigo ler o QR: digitar a chave manualmente', { exact: true }).locator('..');
    const secret = (await manual.locator('code').textContent()).trim();
    expect(/^[A-Z2-7]{16,128}$/.test(secret), 'browser receives an actual Auth TOTP enrollment secret only in memory');
    const storageBefore = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length,
      overflow: document.documentElement.scrollWidth > innerWidth }));
    expect(storageBefore.local === 0 && storageBefore.session === 0 && !storageBefore.overflow,
      'mobile enrollment fits viewport without persisting secret or credentials');
    gate = 'wrong browser TOTP';
    const forbidden = new Set([-30000, 0, 30000].map(offset => totpCode(secret, Date.now() + offset)));
    let wrong = '000000'; while (forbidden.has(wrong)) wrong = String(Number(wrong) + 1).padStart(6, '0');
    await page.locator('#auth-totp-code').fill(wrong);
    await page.getByRole('button', { name: 'Confirmar código', exact: true }).click();
    await page.getByText('Não foi possível concluir. Confira os dados e tente novamente. Se continuar, peça apoio à equipe por um canal conhecido.', { exact: true }).waitFor();
    expect(await page.locator('#workspace').isHidden() && await page.locator('#auth-totp-code').inputValue() === '',
      'incorrect real TOTP leaves the workspace closed and clears the entered code');
    gate = 'valid browser TOTP';
    await page.locator('#auth-totp-code').fill(totpCode(secret));
    await page.getByRole('button', { name: 'Confirmar código', exact: true }).click();
    await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.locator('#cofre-workspace-select').waitFor();
    expect(await page.locator('#cofre-workspace-select').inputValue() === workspaceId,
      'actual upgraded browser bearer opens only the enrolled MFA workspace');
    expect(await page.locator('.auth-enrollment-qr').count() === 0 && !(await page.locator('body').innerText()).includes(secret),
      'successful verification removes QR and manual secret before private navigation');
    const verifiedIndex = network.findIndex(row => /\/factors\/[^/]+\/verify$/.test(row.path) && row.status === 200);
    const privateIndex = network.findIndex(row => /\/advisory-api\/(?:reports|publications|cases|cofre\/workspaces)/.test(row.path));
    expect(verifiedIndex >= 0 && privateIndex > verifiedIndex,
      'private browser data requests start only after successful Auth verification');
    expect(errors.length === 0, 'MFA journey has no uncaught browser errors');
    const artifact = process.env.CAPITAL_BROWSER_ARTIFACT_DIR;
    if (artifact) {
      await mkdir(artifact, { recursive: true });
      // Enrollment has been removed and no passwords/OTP/QR are visible here.
      await page.screenshot({ path: artifact + '/auth-mfa-completed-mobile.png', fullPage: true });
      await writeFile(artifact + '/auth-controls-manifest.json', JSON.stringify({ checks, browser: browser.version(),
        transport: 'real disposable Auth; actual application modules; actual Node Edge handler bridged',
        excludes: ['email delivery', 'cloud MFA', 'factor recovery', 'hosted Edge runtime'] }, null, 2));
    }
    gate = 'MFA browser logout';
    await page.locator('#logout').click();
    await page.locator('#login-panel').waitFor({ state: 'visible' });
    expect(await page.locator('#workspace').isHidden() && await page.locator('.auth-enrollment-qr').count() === 0,
      'browser logout removes private workspace and authenticator enrollment');
    console.log('AUTH CONTROLS CHROMIUM: ' + checks.length + ' assertions passed; real TOTP/Auth and MFA RLS. Edge transport bridged.');
  } catch {
    console.log('AUTH BROWSER DIAGNOSTIC ' + JSON.stringify({ gate, network, errors }));
    // Never forward Playwright call logs, which may include filled credentials.
    throw new Error('Auth browser gate failed: ' + gate);
  } finally {
    await context?.close().catch(() => {}); await browser?.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
