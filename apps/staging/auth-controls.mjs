/** Supabase Auth helpers; the injected PortalClient owns transport and bearer memory.
 * Docs checked 2026-10-17: /docs/guides/auth/auth-mfa/totp,
 * /docs/guides/auth/passwords and supabase/auth REST API reference.
 * No storage, logging, admin key, role assignment or automatic factor removal.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CANONICAL = 'https://capital.camaleaoweb3.com.br/';
const GENERIC = 'Não foi possível concluir esta etapa. Confira os dados ou solicite um novo link.';
const RECOVERY = 'Se houver uma conta elegível para esse e-mail, você receberá as instruções de recuperação.';
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function invalid(message = GENERIC) { throw new Error(message); }
function factorId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value.toLowerCase();
}
function bearer(value) {
  if (typeof value !== 'string' || value.length > 8192 || !JWT.test(value)) invalid();
  return value;
}
function claims(value) {
  bearer(value);
  try {
    const segment = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(segment), (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!plain(parsed)) invalid();
    return parsed;
  } catch { return invalid(); }
}
function tokenExpiry(token, now) {
  const payload = claims(token);
  if (!Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= now ||
      payload.role !== 'authenticated' || !UUID.test(payload.sub || '')) invalid();
  return Math.floor((payload.exp * 1000 - now) / 1000);
}

/** Remove the fragment before rendering, fetching config or examining its contents.
 * JWT parsing here is format/expiry validation only. Supabase verifies it on use.
 * The refresh token is discarded. The caller must not log or persist the return.
 */
export function consumeAuthFragment(value, replaceUrl, clock = Date.now) {
  let url;
  try { url = new URL(value); } catch { return invalid(); }
  if (!url.hash) return null;
  if (typeof replaceUrl !== 'function') invalid();
  const fragment = url.hash.slice(1);
  url.hash = '';
  // URL is derived from this page, never from redirect parameters in the fragment.
  try { replaceUrl(url.href); } catch { return invalid(); }
  const params = new URLSearchParams(fragment);
  const recognized = ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type'];
  if (![...params.keys()].some((key) => recognized.includes(key) || key.startsWith('error'))) return null;
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) ||
      url.username || url.password || [...params.keys()].some((key) => !recognized.includes(key)) ||
      [...params.keys()].some((key) => params.getAll(key).length !== 1)) invalid();
  const type = params.get('type');
  if (!['recovery', 'invite'].includes(type) || params.get('token_type') !== 'bearer') invalid();
  const token = bearer(params.get('access_token'));
  const seconds = params.get('expires_in');
  if (!seconds || !/^\d{1,6}$/.test(seconds) || Number(seconds) < 1 || Number(seconds) > 86400) invalid();
  const expiresAt = params.get('expires_at');
  if (expiresAt !== null && (!/^\d{1,12}$/.test(expiresAt) || Number(expiresAt) * 1000 <= clock())) invalid();
  const expiresIn = Math.min(Number(seconds), tokenExpiry(token, clock()), 3600);
  if (expiresIn < 1) invalid();
  return { type, accessToken: token, expiresIn };
}

/** request uses the same bounded fixed-host transport as PortalClient.
 * token: null explicitly disables the current bearer on the public recover call.
 * onSession must adopt only the access token in memory, never refresh tokens.
 */
export function createAuthControls({ request, onSession = () => {} } = {}) {
  if (typeof request !== 'function' || typeof onSession !== 'function') invalid('Configuração de acesso indisponível.');
  const call = async (path, options) => {
    try { return await request(path, options); }
    catch (failure) {
      const messages = { 401: 'Sessão inválida. Entre novamente ou solicite um novo link.',
        403: 'Esta etapa não está autorizada para a sessão atual.',
        429: 'Limite de tentativas. Aguarde antes de tentar novamente.' };
      const error = new Error(messages[failure?.status] || GENERIC);
      if (Number.isInteger(failure?.status)) error.status = failure.status;
      throw error;
    }
  };
  const listFactors = async () => {
    const user = await call('/auth/v1/user', { method: 'GET' });
    if (!plain(user) || !UUID.test(user.id || '') || user.is_anonymous !== false ||
        (user.factors !== undefined && (!Array.isArray(user.factors) || user.factors.length > 20))) invalid();
    const all = (user.factors || []).filter((item) => item?.factor_type === 'totp').map((item) => {
      if (!plain(item) || !['verified', 'unverified'].includes(item.status)) invalid();
      // A factor name is metadata, never HTML or an authorization decision.
      const name = typeof item.friendly_name === 'string' && item.friendly_name.length <= 100
        ? item.friendly_name : 'Aplicativo autenticador';
      return { id: factorId(item.id), status: item.status, friendly_name: name };
    });
    return { all, totp: all.filter((item) => item.status === 'verified') };
  };
  return Object.freeze({
    listFactors,
    async cancelPendingTOTP(id) {
      const factor = factorId(id);
      // A deliberate UI cancellation is checked against the current user's fresh Auth record.
      // Verified factors have no removal flow in this portal. Auth authorizes the DELETE too.
      const current = await listFactors();
      const pending = current.all.find((item) => item.id === factor && item.status === 'unverified');
      if (!pending) invalid('Somente uma configuração de autenticador ainda não confirmada pode ser cancelada.');
      await call(`/auth/v1/factors/${factor}`, { method: 'DELETE' });
      return { cancelled: true, factor_id: factor };
    },
    async enrollTOTP() {
      const response = await call('/auth/v1/factors', { method: 'POST',
        body: { factor_type: 'totp', friendly_name: 'Capital Web3' } });
      if (!plain(response) || !plain(response.totp) ||
          typeof response.totp.secret !== 'string' || !/^[A-Z2-7]{16,128}$/.test(response.totp.secret) ||
          typeof response.totp.qr_code !== 'string' || response.totp.qr_code.length > 200000 ||
          !/^(?:\s*<svg\b|data:image\/svg\+xml[;,])/.test(response.totp.qr_code)) invalid();
      let uri;
      try { uri = new URL(response.totp.uri); } catch { return invalid(); }
      if (uri.protocol !== 'otpauth:' || uri.hostname !== 'totp' ||
          uri.searchParams.get('secret') !== response.totp.secret) invalid();
      return { id: factorId(response.id), totp: { qr_code: response.totp.qr_code,
        secret: response.totp.secret, uri: response.totp.uri } };
    },
    async verifyTOTP(id, code) {
      const factor = factorId(id);
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) invalid('Digite os seis números exibidos no aplicativo autenticador.');
      const challenge = await call(`/auth/v1/factors/${factor}/challenge`, { method: 'POST', body: {} });
      const challengeId = factorId(challenge?.id);
      const session = await call(`/auth/v1/factors/${factor}/verify`, { method: 'POST',
        body: { challenge_id: challengeId, code } });
      if (!plain(session) || !Number.isFinite(session.expires_in) || session.expires_in <= 0 ||
          claims(session.access_token).aal !== 'aal2') invalid();
      // This callback updates bearer memory; server /session and RLS remain authoritative.
      try { await onSession({ access_token: session.access_token, expires_in: session.expires_in }); }
      catch { return invalid(); }
      return { aal: 'aal2', factor_id: factor };
    },
    async updatePassword(token, password) {
      bearer(token);
      const identity = claims(token);
      if (identity.role !== 'authenticated' || !UUID.test(identity.sub || '')) invalid();
      if (typeof password !== 'string' || password.length < 12 || password.length > 128 || /[\u0000\r\n]/.test(password)) {
        invalid('Use uma senha de 12 a 128 caracteres, sem quebras de linha.');
      }
      const user = await call('/auth/v1/user', { method: 'PUT', body: { password }, token });
      if (!plain(user) || user.id !== identity.sub) invalid();
      // Password setup does not give case/workspace membership or auto-login.
      // End the short-lived link session explicitly; discarding client memory alone
      // would not revoke its Auth session. A failure here must not deny the completed update.
      try {
        await call('/auth/v1/logout?scope=local', { method: 'POST', body: {}, token });
        return { updated: true, session_ended: true };
      } catch { return { updated: true, session_ended: false }; }
    },
    async recover(email, redirect) {
      if (typeof email !== 'string' || email.length > 254 || email !== email.trim() ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('Informe um e-mail válido.');
      // Exact canonical URL avoids an open redirect, wildcard or caller-selected domain.
      if (redirect !== CANONICAL) invalid('Endereço de recuperação indisponível.');
      try { await call('/auth/v1/recover?redirect_to=' + encodeURIComponent(CANONICAL),
        { method: 'POST', body: { email }, token: null }); }
      catch (failure) {
        // Do not disclose whether an account exists. Rate/availability failures remain visible.
        if (![400, 404, 422].includes(failure?.status)) throw failure;
      }
      return { message: RECOVERY };
    },
  });
}
