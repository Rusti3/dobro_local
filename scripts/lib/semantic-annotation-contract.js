import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  annotationInput,
  validateAgainstSchema,
} from "./annotation-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));

export const semanticConfig = readJson("config/event-semantic.config.json");
export const semanticSchema = readJson(semanticConfig.structuredOutput.schemaFile);
export const semanticPrompt = fs.readFileSync(path.join(root, semanticConfig.promptFile), "utf8").trim();

const COMPLEXITY_SCORE_SPEC = {
  physicalLoad: { weight: 0.15, values: { minimal: 5, light: 25, moderate: 60, heavy: 100 } },
  emotionalLoad: { weight: 0.15, values: { low: 10, moderate: 55, high: 100 } },
  skillRequirement: { weight: 0.20, values: { none: 0, briefing: 25, specialized: 70, licensed: 100 } },
  socialLoad: { weight: 0.10, values: { solitary: 5, low: 15, moderate: 50, high: 85 } },
  responsibility: { weight: 0.20, values: { supervised_simple: 15, independent_routine: 45, high: 75, safety_critical: 100 } },
  entryBarrier: { weight: 0.10, values: { walk_in: 0, registration: 20, application: 50, training: 65, selection: 85 } },
  timeCommitment: { weight: 0.10, values: { up_to_2h: 10, half_day: 35, full_day: 55, multi_day: 75, regular: 80 } },
};

export function calculateOverallComplexity(complexity) {
  let weightedTotal = 0;
  let knownWeight = 0;
  let knownDimensions = 0;
  for (const [field, spec] of Object.entries(COMPLEXITY_SCORE_SPEC)) {
    const value = spec.values[complexity?.[field]];
    if (value === undefined) continue;
    weightedTotal += value * spec.weight;
    knownWeight += spec.weight;
    knownDimensions += 1;
  }
  if (knownDimensions < 4 || knownWeight < 0.5) return null;
  return Math.round(weightedTotal / knownWeight);
}

export function normalizeSemanticComplexity(annotation) {
  if (!annotation?.complexity) return annotation;
  annotation.complexity.overall = calculateOverallComplexity(annotation.complexity);
  annotation.schemaVersion = semanticConfig.schemaVersion;
  return annotation;
}

const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("ru-RU");
const normalizeEvidence = (value) => normalize(value)
  .replaceAll("ё", "е")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();
const unique = (values) => [...new Set(values)];

const prerequisiteMap = [
  [/госуслуг|подтвержденн.*аккаунт/i, "verified_identity_account"],
  [/гражданств/i, "citizenship"],
  [/медицинск.*книж/i, "medical_book"],
  [/биометр/i, "biometric_data_consent"],
  [/водительск.*прав|водительск.*удостовер/i, "driving_license"],
];

const periodFacts = (period) => {
  const startsAt = period?.startsAt ?? null;
  const endsAt = period?.endsAt ?? null;
  let exactDurationMinutes = null;
  let exactWeekendDate = null;
  if (startsAt && endsAt && startsAt.slice(0, 10) === endsAt.slice(0, 10)) {
    const duration = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
    if (duration > 0 && duration <= 24 * 60) exactDurationMinutes = duration;
    const day = new Date(`${startsAt.slice(0, 10)}T12:00:00Z`).getUTCDay();
    exactWeekendDate = day === 0 || day === 6;
  }
  return { startsAt, endsAt, exactDurationMinutes, exactWeekendDate };
};

export function deterministicSourceFacts(subject) {
  const input = annotationInput(subject);
  const requirements = input.vacancy?.requirements?.length
    ? input.vacancy.requirements
    : input.vacancy?.previewRequirements ?? [];
  const ages = requirements
    .map((item) => item.title.match(/^\s*(\d{1,2})\+\s*$/)?.[1])
    .filter(Boolean)
    .map(Number);
  const prerequisites = unique(requirements.flatMap((item) => prerequisiteMap
    .filter(([pattern]) => pattern.test(item.title))
    .map(([, value]) => value)));
  const period = input.vacancy?.period?.startsAt || input.vacancy?.period?.endsAt
    ? input.vacancy.period
    : input.event.period;
  const location = input.vacancy?.location?.address || input.vacancy?.location?.city
    ? input.vacancy.location
    : input.event.location;
  const online = input.vacancy?.online ?? input.event.online;
  return {
    eventId: input.event.id,
    vacancyId: input.vacancy?.id ?? null,
    sourceUrl: input.sourceUrl,
    officialCauseAreas: input.deterministicContext.officialCauseAreas,
    unmappedOfficialCategoryTitles: input.deterministicContext.unmappedOfficialCategoryTitles,
    officialCategoryTitles: (input.vacancy?.categories?.length ? input.vacancy.categories : input.event.categories).map((item) => item.title),
    structuredTasks: input.vacancy?.tasks ?? [],
    structuredRequirements: requirements,
    organizerConditions: input.vacancy?.conditions ?? [],
    format: online === true ? "online" : online === false ? "on_site" : "unknown",
    location,
    period: periodFacts(period),
    minimumAge: ages.length ? Math.max(...ages) : null,
    prerequisites,
    matchedCities: input.matchedCities,
  };
}

export function buildSemanticRequest(subject, options = {}) {
  const evidenceMode = options.evidenceMode ?? "full";
  const reasoningEffort = options.reasoningEffort ?? semanticConfig.primaryReasoningEffort;
  const reviewReason = options.reviewReason ?? null;
  let instructions = semanticPrompt;
  if (evidenceMode === "none") {
    instructions += "\n\n# Режим без доказательств\nВерни `evidence` строго как пустой массив `[]`. Не создавай цитаты и отдельные доказательства.";
  }
  if (reviewReason) {
    instructions += `\n\n# Повторная строгая проверка\nПричина повторной проверки: ${reviewReason}. Перепроверь решение консервативно по исходным данным. Не цитируй эту строку как источник.`;
  }
  return {
    model: process.env.LLM_MODEL ?? semanticConfig.model,
    store: semanticConfig.store,
    reasoning: { effort: reasoningEffort },
    instructions,
    input: `<untrusted_dobro_record>\n${JSON.stringify(annotationInput(subject))}\n</untrusted_dobro_record>`,
    max_output_tokens: 5_000,
    text: {
      format: {
        type: semanticConfig.structuredOutput.type,
        name: semanticConfig.structuredOutput.name,
        strict: semanticConfig.structuredOutput.strict,
        schema: semanticSchema,
      },
    },
  };
}

export function validateSemanticAnnotation(annotation, subject, options = {}) {
  const errors = validateAgainstSchema(annotation, semanticSchema);
  if (errors.length) return errors;
  const input = annotationInput(subject);
  const locked = new Set(input.deterministicContext.officialCauseAreas);
  for (const area of annotation.supplementalClassification.supplementalCauseAreas)
    if (locked.has(area)) errors.push(`$.supplementalClassification.supplementalCauseAreas: duplicates locked ${area}`);

  const { verdict, score } = annotation.firstTimeFit;
  const scoreOk = verdict === "unknown" ? score === null
    : verdict === "suitable" ? Number.isInteger(score) && score >= 70 && score <= 100
      : verdict === "conditional" ? Number.isInteger(score) && score >= 40 && score <= 69
        : Number.isInteger(score) && score >= 0 && score <= 39;
  if (!scoreOk) errors.push("$.firstTimeFit.score: inconsistent with verdict");
  const candidateByVerdict = { suitable: "yes", conditional: "conditional", not_suitable: "no", unknown: "unknown" };
  if (annotation.feedSignals.firstTimeCandidate !== candidateByVerdict[verdict])
    errors.push("$.feedSignals.firstTimeCandidate: inconsistent with firstTimeFit.verdict");
  if (annotation.feedSignals.calmTask === "yes"
    && (!['minimal', 'light'].includes(annotation.complexity.physicalLoad)
      || !['solitary', 'low'].includes(annotation.complexity.socialLoad)))
    errors.push("$.feedSignals.calmTask: yes requires low physical and social load");
  if (annotation.quality.status === "suitable" && annotation.quality.taskClarity !== "clear")
    errors.push("$.quality: suitable requires clear task");
  if (annotation.quality.status === "hidden" && !annotation.quality.reasons.some((reason) => [
    "missing_task", "promotional_without_task", "meaningless_text", "suspected_spam",
  ].includes(reason))) errors.push("$.quality: hidden requires a hide reason");
  if (annotation.quality.status === "human_review" && !annotation.quality.reasons.some((reason) => [
    "contradictory_conditions", "potential_safety_risk", "vulnerable_people_without_safeguards",
    "specialized_work_without_requirements",
  ].includes(reason))) errors.push("$.quality: human_review requires a review reason");

  const evidenceMode = options.evidenceMode ?? "full";
  if (evidenceMode === "none") {
    if (annotation.evidence.length) errors.push("$.evidence: must be empty in no-evidence mode");
  }
  if (annotation.confidence < 0 || annotation.confidence > 1) errors.push("$.confidence: expected 0..1");
  return errors;
}

export function evidenceQuoteInSource(evidence, subject) {
  const quote = normalizeEvidence(evidence?.quote);
  if (!["source_quote", "structured_source"].includes(evidence?.basis)) return quote.length === 0;
  if (quote.length < 3) return false;
  return normalizeEvidence(JSON.stringify(annotationInput(subject))).includes(quote);
}

export function highReviewReason(annotation) {
  const reasons = [];
  if (["hidden", "human_review"].includes(annotation.quality.status)) reasons.push(`quality=${annotation.quality.status}`);
  if (annotation.quality.reasons.includes("contradictory_conditions")) reasons.push("reason=contradictory_conditions");
  return unique(reasons).join("; ") || null;
}
