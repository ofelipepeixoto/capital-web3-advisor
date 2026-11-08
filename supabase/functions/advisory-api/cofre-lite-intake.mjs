import { SIGNAL_IDS, assessSignals } from './cofre-lite-signals.mjs';

export const LITE_CONTROL_IDS = Object.freeze(['backup','vault','apps','spending','testing','watch','recovery','secret_exposure','source','permissions','payload','routine']);
function objectKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_lite_intake');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error('invalid_lite_intake');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) throw new Error('invalid_lite_intake');
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !('value' in d) || !d.enumerable) throw new Error('invalid_lite_intake'); }
}
export function validateLiteIntake(intake) {
  objectKeys(intake, ['schema_version','synthetic','consents','profile','controls','signals']);
  if (intake.schema_version !== 'cofre-lite-intake-0.2' || intake.synthetic !== true) throw new Error('invalid_lite_intake');
  objectKeys(intake.consents, ['assessment','storage']);
  if (intake.consents.assessment !== true || intake.consents.storage !== true) throw new Error('invalid_lite_intake');
  objectKeys(intake.profile,['experience']);
  if (!['beginner','some','unknown'].includes(intake.profile.experience)) throw new Error('invalid_lite_intake');
  objectKeys(intake.controls,LITE_CONTROL_IDS);
  for (const key of LITE_CONTROL_IDS) {
    const permitted = key === 'secret_exposure' ? ['yes','no','unknown'] : ['yes','no','unknown','not_applicable'];
    if (!permitted.includes(intake.controls[key])) throw new Error('invalid_lite_intake');
  }
  objectKeys(intake.signals,SIGNAL_IDS); assessSignals(intake.signals);
  return structuredClone(intake);
}
