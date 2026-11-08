/** Synthetic candidate only: deterministic draft, not an authorization or release API.
 * The persistence boundary must validate/reconstruct independently server-side.
 */
import { SIGNAL_IDS, assessSignals } from './cofre-lite-signals.mjs';

export const LITE_CONTROL_IDS = Object.freeze(['backup', 'vault', 'apps', 'spending', 'testing', 'watch', 'recovery', 'secret_exposure', 'source', 'permissions', 'payload', 'routine']);
const CONTROL_DETAILS = Object.freeze({
  backup: ['Backup', 'Revise a existência e proteção do backup com o titular, sem solicitar seu conteúdo.'],
  vault: ['Função de reserva', 'Revise uma separação proporcional entre reserva e uso.'],
  apps: ['Função para aplicativos', 'Revise uma função apropriada para uso de aplicativos.'],
  spending: ['Função para gastos', 'Revise uma função para gastos conforme a necessidade.'],
  testing: ['Função de teste', 'Considere se uma função separada para teste se aplica.'],
  watch: ['Função de observação', 'Considere se uma função somente de observação se aplica.'],
  recovery: ['Recuperação', 'Planeje revisão da recuperação com o titular em ambiente adequado, sem solicitar segredos.'],
  secret_exposure: ['Exposição de segredo', 'Interrompa novas interações e procure apoio de resposta a incidentes por canal conhecido. Não envie segredos.'],
  source: ['Conferência de origem', 'Confira origem, domínio, rede e destino antes de qualquer interação.'],
  permissions: ['Revisão de permissões', 'Liste as permissões para revisão humana. Este portal não revoga permissões.'],
  payload: ['Compreensão da assinatura', 'Interrompa se o efeito da assinatura não estiver claro e peça revisão.'],
  routine: ['Rotina de revisão', 'Combine uma rotina de revisão e responsáveis. Este portal não monitora automaticamente.'],
});
const SIGNAL_LABELS = Object.freeze({ urgency: 'Pressão de urgência', guaranteed_return: 'Promessa de retorno garantido',
  unsolicited_link: 'Link não solicitado', different_domain: 'Domínio diferente', unverified_contract: 'Contrato não verificado',
  unlimited_approval: 'Permissão ilimitada', secret_request: 'Pedido de segredo', missing_team_docs: 'Documentação insuficiente',
  unclear_tokenomics: 'Regras de token pouco claras', profit_screenshots: 'Prints ou depoimentos de lucro' });
const CRITICAL = new Set(['guaranteed_return', 'unsolicited_link', 'different_domain', 'secret_request']);
const choices = new Set(['yes', 'no', 'unknown', 'not_applicable']);
function fail() { throw new Error('invalid_lite_intake'); }
function exact(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return fail();
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k))) return fail();
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(input, key); if (!d || !('value' in d) || !d.enumerable) return fail(); }
  return input;
}
export function validateLiteReportIntake(input) {
  const row = exact(input, ['schema_version', 'synthetic', 'consents', 'profile', 'controls', 'signals']);
  if (row.schema_version !== 'cofre-lite-intake-0.2' || row.synthetic !== true) return fail();
  const consents = exact(row.consents, ['assessment', 'storage']);
  if (consents.assessment !== true || consents.storage !== true) return fail();
  const profile = exact(row.profile, ['experience']);
  if (!['beginner', 'some', 'unknown'].includes(profile.experience)) return fail();
  const controls = exact(row.controls, LITE_CONTROL_IDS);
  for (const id of LITE_CONTROL_IDS) if (!choices.has(controls[id]) || (id === 'secret_exposure' && controls[id] === 'not_applicable')) return fail();
  try { assessSignals(row.signals); } catch { return fail(); }
  return row;
}
/** Deterministic output only from a closed synthetic input. Unknowns remain gaps.
 * A reviewer must not treat any model field as approval; client presentation must
 * use a separate server-managed publication record for the exact version.
 */
export function buildLiteReport(input) {
  const row = validateLiteReportIntake(input);
  const signals = assessSignals(row.signals);
  const critical = row.controls.secret_exposure === 'yes' || signals.status === 'blocked';
  const gaps = [];
  if (row.profile.experience === 'unknown') gaps.push('profile.experience');
  for (const id of LITE_CONTROL_IDS) if (row.controls[id] === 'unknown') gaps.push('controls.' + id);
  for (const id of SIGNAL_IDS) if (row.signals[id] === 'unknown') gaps.push('signals.' + id);
  if (!signals.applicable) gaps.push('signals.applicability');
  const findings = [];
  if (row.controls.secret_exposure === 'yes') findings.push({ id: 'secret_exposure', severity: 'critical',
    evidence: 'Exposição de segredo informada na simulação.', impact: 'Um segredo exposto pode permitir acesso indevido.', action: CONTROL_DETAILS.secret_exposure[1] });
  for (const id of SIGNAL_IDS) if (row.signals[id] === 'yes') findings.push({ id: 'signal.' + id,
    severity: CRITICAL.has(id) ? 'critical' : 'attention', evidence: SIGNAL_LABELS[id] + ' informado na simulação.',
    impact: 'O sinal exige revisão do contexto e pode indicar risco.', action: 'Pause a interação e peça revisão por um canal conhecido.' });
  for (const id of LITE_CONTROL_IDS) {
    if (['secret_exposure', 'testing', 'watch'].includes(id) || row.controls[id] !== 'no') continue;
    findings.push({ id: 'control.' + id, severity: 'attention', evidence: CONTROL_DETAILS[id][0] + ': resposta negativa declarada.',
      impact: 'O controle precisa de revisão proporcional ao contexto.', action: CONTROL_DETAILS[id][1] });
  }
  const controls = LITE_CONTROL_IDS.map(id => ({ id, label: CONTROL_DETAILS[id][0], answer: row.controls[id],
    evidence: row.controls[id] === 'unknown' ? 'unknown' : row.controls[id] === 'not_applicable' ? 'not_applicable' : 'declared',
    limitation: 'A resposta não é uma verificação independente.' }));
  const plan = [];
  if (critical) plan.push({ priority: 'critical', action: 'Interrompa a interação e procure apoio humano por canal conhecido. Não informe segredos.' });
  if (gaps.length) plan.push({ priority: 'review', action: 'Revise as informações ainda não avaliadas antes de concluir o diagnóstico.' });
  if (findings.some(finding => finding.severity === 'attention')) plan.push({ priority: 'review', action: 'Revise os pontos relatados e confirme as evidências com a equipe.' });
  plan.push({ priority: 'review', action: 'Uma pessoa revisora deve conferir a versão antes de qualquer entrega.' });
  return {
    report_kind: 'cofre_lite', schema_version: 'cofre-lite-report-0.2', mode: 'synthetic',
    status: critical ? 'blocked' : gaps.length ? 'incomplete' : 'requires_review',
    profile: { experience: row.profile.experience }, controls,
    signals: { answers: Object.fromEntries(SIGNAL_IDS.map(id => [id, row.signals[id]])), assessment: signals },
    findings, gaps, plan,
    limitations: ['Somente dados fictícios; sem consulta externa ou verificação automática.',
      'Informações declaradas não comprovam segurança, custódia, controle ou revogação de permissões.',
      'Nenhuma pontuação está disponível enquanto a metodologia não for aprovada.',
      'Este rascunho não realiza movimentação, assinatura ou recomendação de investimento.'],
    score: null, human_review: { status: 'pending', approved: false },
  };
}
