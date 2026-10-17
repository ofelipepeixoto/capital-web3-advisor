/** Deterministic static bundle; public configuration only. Does not deploy. */
import { mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../apps/staging/client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = process.env.CAPITAL_PORTAL_ORIGIN || '';
const config = { supabaseUrl: process.env.CAPITAL_SUPABASE_URL || '', publishableKey: process.env.CAPITAL_SUPABASE_PUBLIC_KEY || '' };
try {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password || parsed.port) throw new Error();
  const valid = validateConfig(config, origin);
  if (/REPLACE|PROJECT_REF|synthetic|example/i.test(config.supabaseUrl + config.publishableKey + origin)) throw new Error();
  const output = resolve(root, 'dist/staging');
  await rm(output + '/public', { recursive: true, force: true });
  await mkdir(output + '/public', { recursive: true });
  for (const name of ['index.html', 'styles.css', 'app.mjs', 'client.mjs', 'cofre-ui.mjs', 'auth-controls.mjs', 'auth-controls-ui.mjs']) await copyFile(root + '/apps/staging/' + name, output + '/public/' + name);
  // Static Sites cannot apply the optional Caddyfile. Enforce a precise policy in
  // the generated page as well; frame-ancestors still requires a host header.
  const html = await readFile(output + '/public/index.html', 'utf8');
  if (html.split('<head>').length !== 2) throw new Error('invalid_html');
  const policy = `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${valid.base}; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'`;
  await writeFile(output + '/public/index.html', html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`));
  await writeFile(output + '/public/config.json', JSON.stringify(config, null, 2) + '\n');
  await writeFile(output + '/Caddyfile', `${parsed.hostname} {
  root * /srv/capital-web3-portal/public
  encode zstd gzip
  header {
    Cache-Control "no-store"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
    X-Frame-Options "DENY"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${valid.base}; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  }
  file_server
}
`);
  console.log('Bundle estático criado em dist/staging. Configuração pública validada; implantação não executada.');
} catch {
  console.error('Build bloqueado: configure CAPITAL_PORTAL_ORIGIN (HTTPS), CAPITAL_SUPABASE_URL e CAPITAL_SUPABASE_PUBLIC_KEY. Somente chave pública; sem placeholders.');
  process.exitCode = 1;
}
