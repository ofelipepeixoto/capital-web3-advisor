/** Browser transport for synthetic staging. Tokens live only in this instance.
 * Auth verifies credentials; the API and RLS decide every object's authorization.
 */
export function validateConfig(value, pageOrigin) {
  if (!value || Object.keys(value).sort().join(',') !== 'publishableKey,supabaseUrl') throw new Error('Configuração indisponível.');
  const url = new URL(value.supabaseUrl);
  const page = new URL(pageOrigin);
  const local = page.protocol === 'http:' && page.hostname === '127.0.0.1' &&
    url.origin === 'http://127.0.0.1:54321';
  if ((!local && (page.protocol !== 'https:' || url.protocol !== 'https:' ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Configuração indisponível.');
  }
  const key = value.publishableKey;
  if (typeof key !== 'string') throw new Error('Configuração indisponível.');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    try {
      const parts = key.split('.');
      if (parts.length !== 3 || JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role !== 'anon') throw new Error();
    } catch { throw new Error('Use somente a chave pública do projeto.'); }
  }
  return Object.freeze({ base: url.origin, key });
}

export class PortalClient {
  #token = null;
  #epoch = 0;
  #timer;
  #expires = 0;
  constructor(config, { fetcher = fetch, onEnd = () => {}, clock = Date.now } = {}) {
    this.config = config; this.fetcher = fetcher; this.onEnd = onEnd; this.clock = clock;
  }
  clear() {
    ++this.#epoch; this.#token = null; this.#expires = 0;
    clearTimeout(this.#timer); this.onEnd();
  }
  async #request(path, { body, token } = {}) {
    let response;
    try {
      // Browser fetch is a Web API, not a method of PortalClient. Preserve its
      // unbound call semantics; Node's fetch and injected mocks hide this issue.
      const fetchRequest = this.fetcher;
      response = await fetchRequest(this.config.base + path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit',
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000),
        headers: { apikey: this.config.key, ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('Conexão indisponível. Confira o estado antes de tentar novamente.'); }
    if (!response.ok) {
      const messages = { 400: 'Confira os dados informados.', 401: 'Sessão inválida. Entre novamente.',
        403: 'Acesso não autorizado.', 404: 'Diagnóstico indisponível para esta conta.',
        409: 'Esta versão mudou ou a ação já foi concluída. Atualize para conferir.',
        429: 'Limite de tentativas. Aguarde antes de tentar novamente.' };
      const error = new Error(messages[response.status] || 'Serviço indisponível. Tente novamente mais tarde.');
      error.status = response.status; throw error;
    }
    if (response.status === 204) return null;
    // Match the API's bounded report envelope. Do not trust content-length alone.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Resposta indisponível.');
    let size = 0; const chunks = [];
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Resposta excedeu o limite.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error('Resposta inválida do serviço.'); }
  }
  async login(email, password) {
    this.clear(); const epoch = this.#epoch;
    let data;
    try { data = await this.#request('/auth/v1/token?grant_type=password', { body: { email, password } }); }
    catch (error) {
      if ([400, 401, 403, 422].includes(error.status)) throw new Error('Não foi possível entrar. Confira suas credenciais ou o convite.');
      throw error;
    }
    if (epoch !== this.#epoch) throw new Error('Entrada cancelada.');
    if (!data || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.access_token) ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('Sessão inválida.');
    this.#token = data.access_token;
    // No refresh token, localStorage, sessionStorage or automatic login restoration.
    const duration = Math.min(data.expires_in * 1000, 3600000);
    this.#expires = this.clock() + duration;
    this.#timer = setTimeout(() => this.clear(), duration); this.#timer.unref?.();
    try { return await this.api('/session'); }
    catch (error) { if (epoch === this.#epoch) this.clear(); throw error; }
  }
  async api(path, body) {
    if (!/^\/(?:session|cases|reports|publications|cofre)(?:\/[a-zA-Z0-9-]+)*$/.test(path)) throw new Error('Rota inválida.');
    if (!this.#token || this.clock() >= this.#expires) { this.clear(); throw new Error('Sessão encerrada. Entre novamente.'); }
    const epoch = this.#epoch;
    try {
      const result = await this.#request('/functions/v1/advisory-api' + path, { body, token: this.#token });
      if (epoch !== this.#epoch) throw new Error('Sessão alterada.');
      return result;
    } catch (error) {
      if (epoch === this.#epoch && error.status === 401) this.clear();
      throw error;
    }
  }
  async logout() {
    const token = this.#token; this.clear();
    if (token) await this.#request('/auth/v1/logout?scope=local', { body: {}, token });
  }
}
