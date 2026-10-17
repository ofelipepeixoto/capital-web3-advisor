/** COFRE Individual: closed synthetic intake and deterministic draft, without network or AI.
 * Evidence is supplied by staff; this engine does not observe wallets or verify controls.
 */
const ANSWERS = ["yes", "no", "unknown"] as const;
const EVIDENCE = ["declared", "observed", "unknown"] as const;
const OBJECTIVES = ["organize", "learn_defi", "protect_family"] as const;
const EXPERIENCE = ["beginner", "intermediate", "advanced"] as const;
const LIQUIDITY = ["short_term", "long_term", "unknown"] as const;
const LOSS_CAPACITY = ["essential", "limited", "discretionary", "unknown"] as const;
const CATEGORIES = ["exchange", "vault", "apps", "spending", "watch"] as const;
const NETWORKS = ["bitcoin", "evm", "other", "unknown"] as const;
const CUSTODY = ["self", "third_party", "unknown"] as const;
export const COFRE_CONTROL_IDS = ["secret_exposure", "backup_offline", "recovery_tested",
  "wallet_separation", "device_updates", "domain_checks", "permissions_review"] as const;
type ControlId = typeof COFRE_CONTROL_IDS[number];
type Answer = typeof ANSWERS[number];
type Evidence = typeof EVIDENCE[number];
type ControlResponse = { answer: Answer; evidence: Evidence };
export type CofreIntake = {
  schema_version: "cofre-intake-0.1";
  synthetic: true;
  profile: {
    objective: typeof OBJECTIVES[number]; experience: typeof EXPERIENCE[number];
    liquidity: typeof LIQUIDITY[number]; loss_capacity: typeof LOSS_CAPACITY[number];
  };
  consents: { assessment: true; storage: true; external_sources: false; notifications: false };
  controls: Record<ControlId, ControlResponse>;
  inventory: { category: typeof CATEGORIES[number]; network: typeof NETWORKS[number];
    custody: typeof CUSTODY[number] }[];
};

export class CofreValidationError extends Error {
  code = "invalid_cofre_intake";
  constructor() { super("invalid_cofre_intake"); this.name = "CofreValidationError"; }
}

/** Errors never interpolate caller input, which could contain private content. */
function invalid(): never { throw new CofreValidationError(); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key))) {
    return invalid();
  }
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !("value" in property) || !property.enumerable) return invalid();
  }
  return value as Record<string, unknown>;
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) return invalid();
  return value as T;
}

/** Reject unknown fields: no free text, addresses, balances, secrets or caller-made findings. */
export function validateCofreIntake(value: unknown): CofreIntake {
  const body = record(value, ["schema_version", "synthetic", "profile", "consents", "controls", "inventory"]);
  if (body.schema_version !== "cofre-intake-0.1" || body.synthetic !== true) return invalid();
  const profile = record(body.profile, ["objective", "experience", "liquidity", "loss_capacity"]);
  const consents = record(body.consents, ["assessment", "storage", "external_sources", "notifications"]);
  if (consents.assessment !== true || consents.storage !== true ||
      consents.external_sources !== false || consents.notifications !== false) return invalid();
  const controls = record(body.controls, COFRE_CONTROL_IDS);
  const cleanControls = {} as Record<ControlId, ControlResponse>;
  for (const id of COFRE_CONTROL_IDS) {
    const item = record(controls[id], ["answer", "evidence"]);
    const answer = choice(item.answer, ANSWERS);
    const evidence = choice(item.evidence, EVIDENCE);
    if ((answer === "unknown") !== (evidence === "unknown")) return invalid();
    cleanControls[id] = { answer, evidence };
  }
  if (!Array.isArray(body.inventory) || Object.getPrototypeOf(body.inventory) !== Array.prototype ||
      body.inventory.length > 12 || Reflect.ownKeys(body.inventory).length !== body.inventory.length + 1) return invalid();
  const inventory = [] as CofreIntake["inventory"];
  for (let index = 0; index < body.inventory.length; index++) {
    const property = Object.getOwnPropertyDescriptor(body.inventory, String(index));
    if (!property || !("value" in property) || !property.enumerable) return invalid();
    const item = record(property.value, ["category", "network", "custody"]);
    inventory.push({ category: choice(item.category, CATEGORIES), network: choice(item.network, NETWORKS),
      custody: choice(item.custody, CUSTODY) });
  }
  return { schema_version: "cofre-intake-0.1", synthetic: true,
    profile: { objective: choice(profile.objective, OBJECTIVES), experience: choice(profile.experience, EXPERIENCE),
      liquidity: choice(profile.liquidity, LIQUIDITY), loss_capacity: choice(profile.loss_capacity, LOSS_CAPACITY) },
    consents: { assessment: true, storage: true, external_sources: false, notifications: false },
    controls: cleanControls, inventory };
}

const EVIDENCE_LABELS: Record<Evidence, string> = {
  declared: "Autodeclarado na simulação", observed: "Revisão humana declarada na simulação",
  unknown: "Sem resposta ou evidência informada",
};
const RULES: Record<ControlId, { title: string; yes: string; no: string; impact: string;
  action: string; verification: string }> = {
  secret_exposure: {
    title: "Exposição de segredo", yes: "Foi informada exposição de segredo. A avaliação está bloqueada para resposta a incidente.",
    no: "Não foi relatada exposição conhecida. Isso não comprova que um segredo esteja protegido.",
    impact: "Um segredo exposto pode permitir acesso indevido. Revogar permissões não resolve a exposição da chave.",
    action: "Interrompa novas interações e procure apoio de resposta a incidentes por um canal verificado. Não envie segredos ou códigos.",
    verification: "Registrar somente o encaminhamento e a revisão humana; nunca o conteúdo do segredo.",
  },
  backup_offline: {
    title: "Backup fora da nuvem", yes: "Foi informado backup offline. Seu conteúdo e sua proteção física não foram verificados pelo sistema.",
    no: "Não foi informado backup offline disponível.", impact: "Perda de acesso e exposição de cópias digitais podem comprometer a recuperação.",
    action: "Revise com o titular como o backup é protegido fora da nuvem, sem revelar seu conteúdo.",
    verification: "Titular confirma apenas existência e proteção do backup, sem palavras, fotos ou localização exata.",
  },
  recovery_tested: {
    title: "Recuperação testada pelo titular", yes: "O titular informou um teste de recuperação. O sistema não executou nem verificou esse teste.",
    no: "Não foi informado teste de recuperação concluído.", impact: "Um backup existente pode não permitir recuperação quando necessário.",
    action: "Planeje uma revisão de recuperação pelo próprio titular com orientação confiável e ambiente adequado.",
    verification: "Registrar somente conclusão ou pendência declarada; nunca inserir palavras ou códigos neste portal.",
  },
  wallet_separation: {
    title: "Separação de funções", yes: "Foi informada separação de funções. Endereços sob a mesma seed não comprovam independência de chaves.",
    no: "Não foi informada separação entre guarda, aplicativos e gastos.", impact: "Misturar funções pode ampliar o impacto de uma interação indevida.",
    action: "Mapeie as funções de guarda, aplicativos e gastos de forma proporcional à necessidade do titular.",
    verification: "Revisor confere o mapa fictício; uma função de cofre não deve depender de conexão com aplicativos.",
  },
  device_updates: {
    title: "Atualizações do dispositivo", yes: "Foram informadas atualizações em dia. Isso não atesta a integridade do dispositivo.",
    no: "Não foram informadas atualizações em dia.", impact: "Falhas conhecidas no dispositivo podem afetar credenciais e interações.",
    action: "Confira atualizações pelos canais oficiais do dispositivo e registre a pendência sem instalar ferramentas indicadas por desconhecidos.",
    verification: "Titular registra apenas a situação declarada das atualizações.",
  },
  domain_checks: {
    title: "Conferência de domínio e interação", yes: "Foi informada conferência de domínios. Aparência, marca ou assinatura sem gas não comprovam segurança.",
    no: "Não foi informada rotina de conferência de domínio e interação.", impact: "Links falsos e pedidos urgentes podem induzir interações prejudiciais.",
    action: "Antes de interagir, confira fonte, incentivo, urgência, assinatura solicitada e limite de perda. Se houver dúvida, pare.",
    verification: "Revisor pede uma explicação fictícia da conferência, sem abrir link desconhecido ou assinar.",
  },
  permissions_review: {
    title: "Revisão de permissões", yes: "Foi informada revisão de permissões. A análise não comprova revogação nem elimina risco de chave exposta.",
    no: "Não foi informada revisão de permissões.", impact: "Permissões e assinaturas de gasto podem manter poderes diferentes ao longo do tempo.",
    action: "Liste por categoria os tipos de permissão e as dúvidas para revisão humana. O portal não aprova nem revoga permissões.",
    verification: "Registrar situação e lacunas da revisão fictícia, sem conectar carteira ou executar ações.",
  },
};
const CATEGORY_LABELS = { exchange: "Corretora", vault: "Guarda", apps: "Aplicativos", spending: "Gastos", watch: "Observação" };
const NETWORK_LABELS = { bitcoin: "Bitcoin", evm: "EVM", other: "Outra rede", unknown: "Rede não informada" };
const CUSTODY_LABELS = { self: "Autocustódia declarada", third_party: "Custódia de terceiro declarada", unknown: "Custódia não informada" };
type Finding = { id: string; title: string; severity: "critical" | "high" | "medium" | "info";
  evidence: string; impact: string; action: string };
type PlanItem = { priority: "P0" | "P1" | "P2"; action: string; owner: string; deadline: string; verification: string };

/** Build a proposed report. No input or answer can set approval or publication state. */
export function buildCofreReport(value: unknown, asOf: string) {
  const intake = validateCofreIntake(value);
  // Canonical UTC timestamp makes the report reproducible and prevents date/free-text injection.
  if (typeof asOf !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf) ||
      !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString() !== asOf) return invalid();
  const findings: Finding[] = [];
  const plan: PlanItem[] = [];
  const controls = COFRE_CONTROL_IDS.map((id) => {
    const response = intake.controls[id];
    const rule = RULES[id];
    const unknown = response.answer === "unknown";
    const critical = id === "secret_exposure" && response.answer === "yes";
    const gap = id !== "secret_exposure" && response.answer === "no";
    const status = critical ? "critical" : unknown ? "unknown" : gap ? "gap" : "reported";
    if (critical || unknown || gap) {
      const action = unknown ? (id === "secret_exposure"
        ? "Confirme com o titular se há suspeita de exposição, sem pedir ou registrar o segredo."
        : `Esclareça com o titular: ${rule.title.toLocaleLowerCase("pt-BR")}. Não preencha a resposta por suposição.`) : rule.action;
      findings.push({ id, title: rule.title, severity: critical ? "critical" : id === "backup_offline" ||
        id === "recovery_tested" || id === "secret_exposure" ? "high" : "medium",
        evidence: EVIDENCE_LABELS[response.evidence],
        impact: unknown ? "Sem resposta, este controle não pode ser considerado atendido. " + rule.impact : rule.impact, action });
      plan.push({ priority: critical ? "P0" : "P1", action,
        owner: critical ? "Titular e apoio humano de resposta a incidentes" : "Titular, com revisão do consultor",
        deadline: critical || id === "secret_exposure" ? "Antes de novas interações" : "Na próxima revisão humana",
        verification: unknown ? "Registrar somente a opção confirmada e a origem declarada da resposta." : rule.verification });
    }
    return { id, title: rule.title, answer: response.answer, evidence: response.evidence,
      evidence_label: EVIDENCE_LABELS[response.evidence], status,
      explanation: unknown ? "Resposta desconhecida. O sistema não inferiu proteção nem ausência de risco."
        : response.answer === "yes" ? rule.yes : rule.no };
  });
  const profileGaps = [
    ...(intake.profile.liquidity === "unknown" ? ["necessidade de liquidez"] : []),
    ...(intake.profile.loss_capacity === "unknown" ? ["capacidade de absorver perda"] : []),
  ];
  if (profileGaps.length) {
    findings.push({ id: "profile_unknown", title: "Contexto incompleto", severity: "medium",
      evidence: "Opções não informadas: " + profileGaps.join(" e "),
      impact: "Faltam dados de contexto; não há base para decisões financeiras individualizadas.",
      action: "Esclareça liquidez e capacidade de perda com opções, sem pedir valores exatos." });
  }
  if (intake.profile.liquidity === "short_term" || intake.profile.loss_capacity === "essential") {
    findings.push({ id: "essential_or_short_term", title: "Recursos essenciais ou necessidade de curto prazo", severity: "high",
      evidence: "Contexto declarado nas opções da simulação",
      impact: "Perdas ou indisponibilidade podem afetar necessidades próximas. Este questionário não autoriza exposição financeira.",
      action: "Priorize esclarecer a necessidade de caixa e a proteção dos recursos essenciais com o responsável humano." });
  }
  const inventoryUnknown = intake.inventory.some((item) => item.network === "unknown" || item.custody === "unknown");
  if (!intake.inventory.length || inventoryUnknown) {
    findings.push({ id: "inventory_incomplete", title: "Inventário com lacunas", severity: "medium",
      evidence: !intake.inventory.length ? "Nenhum item fictício informado" : "Há rede ou custódia não informada",
      impact: "O mapa de funções está incompleto. Não foram consultados saldos, endereços ou posições.",
      action: "Complete apenas as categorias fictícias necessárias; não crie uma carteira para preencher o questionário." });
  }
  // Context findings also become explicit tasks; there is no numeric aggregate risk score.
  for (const finding of findings.filter((item) => !COFRE_CONTROL_IDS.includes(item.id as ControlId))) {
    plan.push({ priority: "P1", action: finding.action, owner: "Titular, com revisão do consultor",
      deadline: "Antes de concluir o diagnóstico", verification: "Revisor confere as opções atualizadas e registra as lacunas remanescentes." });
  }
  const blocked = intake.controls.secret_exposure.answer === "yes";
  const status = blocked ? "blocked" : findings.length ? "needs_input" : "ok";
  const known = controls.filter((item) => item.answer !== "unknown").length;
  const summary = blocked
    ? "Foi informada exposição de segredo. Interrompa a avaliação de prontidão e encaminhe a situação para resposta humana a incidente. Não envie o segredo."
    : status === "needs_input"
      ? "Há respostas ou controles pendentes. O diagnóstico registra as lacunas e propõe próximos passos para revisão humana."
      : "As respostas mínimas estão preenchidas e não há pendência declarada nos itens avaliados. Isso não certifica segurança nem autoriza operações.";
  if (!plan.length) plan.push({ priority: "P2", action: "Revise as respostas e o mapa fictício com outra pessoa antes de entregar o relatório.",
    owner: "Consultor e revisor humano", deadline: "Antes da entrega ao cliente",
    verification: "Aprovação e publicação da versão pelo fluxo humano do servidor." });
  return {
    schema_version: "cofre-report-0.1", rule_version: "cofre-individual-synthetic-0.1.0",
    report_kind: "cofre_individual", mode: "synthetic", title: "Diagnóstico COFRE Individual — simulação",
    summary, as_of: asOf, status,
    data_quality: { total_controls: COFRE_CONTROL_IDS.length, provided_controls: known,
      unknown_controls: controls.length - known,
      declared_controls: controls.filter((item) => item.evidence === "declared").length,
      observed_controls: controls.filter((item) => item.evidence === "observed").length,
      coverage_explanation: `${known} de ${controls.length} controles com resposta informada. Cobertura mede preenchimento, não segurança.`,
      observed_explanation: "Observado significa revisão humana declarada pelo autor. O sistema não verificou a evidência nem executou testes de carteira.",
      profile_gaps: profileGaps, financial_data: "Não coletados; não há saldos, endereços ou reconciliação financeira.",
    },
    profile: intake.profile,
    inventory: intake.inventory.map((item, index) => ({ ...item, title: `Item fictício ${index + 1}`,
      category_label: CATEGORY_LABELS[item.category], network_label: NETWORK_LABELS[item.network], custody_label: CUSTODY_LABELS[item.custody] })),
    controls, findings, plan,
    limitations: ["Simulação declarada pelo autor; o sistema não consegue comprovar se respostas correspondem a dados reais.",
      "Sem acesso a carteiras, consulta externa, integração paga, assinatura ou execução financeira.",
      "Sem nota ou certificação de segurança; respostas positivas são declarações, não testes automáticos.",
      "Não avalia rentabilidade, alocação, adequação de investimento, tributação ou sucessão.",
      "Não envie seed, chave privada, senha, PIN, passphrase, OTP ou códigos de recuperação.",
      "Esta análise nasce como rascunho. A situação de revisão e entrega é informada pelo servidor, fora do conteúdo deste documento."],
    alternatives: ["Manter a atividade pausada enquanto existirem dúvidas ou suspeita de incidente.",
      "Fazer apenas educação e organização com categorias fictícias, sem conectar carteira.",
      "Solicitar apoio humano especializado para lacunas fora deste questionário."],
    next_steps: blocked ? ["Priorizar o encaminhamento humano de incidente sem compartilhar segredos.",
      "Retomar a avaliação somente após nova revisão da situação pelo responsável humano."]
      : ["Revisar cada lacuna e confirmar as respostas com o titular.",
        "Submeter esta versão ao revisor independente; a entrega exige publicação explícita."],
    sources: [{ kind: "synthetic_intake", label: "Respostas estruturadas fictícias fornecidas pelo autor",
      reference: "cofre-intake-0.1", as_of: asOf },
    { kind: "internal_rules", label: "Regras determinísticas COFRE Individual, sem score",
      reference: "cofre-individual-synthetic-0.1.0", as_of: asOf }],
    human_review: { required: true, status: "pending", approved: false,
      note: "Esta proposta não aprova nem publica a versão. Usar o fluxo humano de revisão e entrega." },
  };
}
