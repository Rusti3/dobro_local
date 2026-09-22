import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));

export const annotationConfig = readJson("config/event-annotation.config.json");
export const annotationSchema = readJson(annotationConfig.structuredOutput.schemaFile);
export const annotationPrompt = fs.readFileSync(path.join(root, annotationConfig.promptFile), "utf8").trim();

export const nonLlmChecks = Object.freeze([
  "expired",
  "duplicate",
  "broken_link",
  "calendar_weekend",
  "distance_from_user",
]);

export const dobroCategoryMap = Object.freeze({
  "Животные и приюты": "animal_welfare",
  "Социальная поддержка": "social_support",
  "Образование и наставничество": "education_mentoring",
  "Медицина и здоровье": "health_medicine",
  "Культура и искусство": "culture_arts",
  "Спорт": "sports_wellbeing",
  "Экология": "environment",
  "Городская среда": "urban_improvement",
  "Гражданские инициативы": "civic_initiatives",
  "Интеллектуальная помощь": "intellectual_pro_bono",
  "Ветераны и Историческая память": "veterans_historical_memory",
  "СВО": "military_support",
  "ЧС": "emergency_response",
  "#МыВместе": "mutual_aid",
  "Дети и молодежь": "children_youth",
});

const cleanText = (value) => String(value ?? "")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, " ")
  .trim();

const taxonomyItems = (value, label = "title") => {
  const items = Array.isArray(value)
    ? value
    : Array.isArray(value?.data)
      ? value.data
      : value && typeof value === "object"
        ? [value]
        : [];
  return items.map((item) => ({
    id: item?.id === undefined || item?.id === null ? null : String(item.id),
    title: cleanText(item?.[label] ?? item?.title ?? item?.name),
  })).filter((item) => item.title);
};

const locationInput = (location, fallback = {}) => ({
  city: location?.settlement ?? location?.shortName ?? fallback.city ?? null,
  address: location?.title ?? fallback.address ?? null,
  latitude: Number.isFinite(location?.y) ? location.y : Number.isFinite(fallback.lat) ? fallback.lat : null,
  longitude: Number.isFinite(location?.x) ? location.x : Number.isFinite(fallback.lng) ? fallback.lng : null,
  timezone: location?.timezone ?? fallback.timezone ?? null,
});

const periodInput = (period, fallback = {}) => ({
  startsAt: period?.startDate ?? fallback.startsAt ?? null,
  endsAt: period?.endDate ?? fallback.endsAt ?? null,
  sourceLabel: cleanText(period?.shortTitle) || null,
});

export function annotationSubjectsFromActivity(activity) {
  const event = activity?.event ?? activity?.data ?? activity;
  const vacancies = Array.isArray(activity?.vacancies) ? activity.vacancies : [];
  const shared = {
    event,
    sourceUrl: activity?.sourceUrl ?? null,
    matchedCities: activity?.matchedCities ?? [],
    completeness: activity?.completeness ?? "unknown",
  };
  return vacancies.length
    ? vacancies.map((vacancy) => ({ ...shared, vacancy }))
    : [{ ...shared, vacancy: null }];
}

export function annotationInput(record) {
  const isDobroSubject = Boolean(record?.event || record?.vacancy);
  if (isDobroSubject) {
    const event = record.event ?? {};
    const vacancy = record.vacancy ?? null;
    const sourceCategories = taxonomyItems(vacancy?.categories?.length ? vacancy.categories : event.categories);
    const mappedOfficialCauseAreas = [...new Set(sourceCategories.map((item) => dobroCategoryMap[item.title]).filter(Boolean))];
    const unmappedOfficialCategoryTitles = sourceCategories
      .filter((item) => !dobroCategoryMap[item.title])
      .map((item) => item.title);
    const officialCauseAreas = mappedOfficialCauseAreas.length
      ? [...mappedOfficialCauseAreas, ...(unmappedOfficialCategoryTitles.length ? ["other"] : [])]
      : [unmappedOfficialCategoryTitles.length ? "other" : "unclear"];
    return {
      inputVersion: "dobro-opportunity-v2",
      annotationUnit: vacancy ? "vacancy" : "event",
      source: "ДОБРО",
      sourceUrl: record.sourceUrl ?? null,
      completeness: record.completeness ?? "unknown",
      matchedCities: Array.isArray(record.matchedCities) ? record.matchedCities : [],
      event: {
        id: String(event.id ?? record.eventId ?? ""),
        title: cleanText(event.name ?? event.title),
        description: cleanText(event.description),
        categories: taxonomyItems(event.categories),
        tags: taxonomyItems(event.tags, "name"),
        online: typeof event.online === "boolean" ? event.online : null,
        hasInternationalSignLanguage: typeof event.hasInternationalSignLanguage === "boolean"
          ? event.hasInternationalSignLanguage : null,
        period: periodInput(event.eventPeriod, event),
        location: locationInput(event.location, event),
      },
      vacancy: vacancy ? {
        id: String(vacancy.id ?? ""),
        description: cleanText(vacancy.description),
        categories: taxonomyItems(vacancy.categories),
        tasks: taxonomyItems(vacancy.tasks),
        requirements: taxonomyItems(vacancy.requirements),
        previewRequirements: taxonomyItems(vacancy.previewRequirements),
        conditions: taxonomyItems(vacancy.conditions),
        tags: taxonomyItems(vacancy.tags, "name"),
        online: typeof vacancy.online === "boolean" ? vacancy.online : null,
        maxHours: Number.isFinite(vacancy.maxHours) ? vacancy.maxHours : null,
        quickVisit: typeof vacancy.quickVisit === "boolean" ? vacancy.quickVisit : null,
        functionality: typeof vacancy.functionality === "string" ? vacancy.functionality : null,
        type: vacancy.type ?? null,
        period: periodInput(vacancy.vacancyPeriod),
        selectionPeriod: periodInput(vacancy.selectionPeriod),
        location: locationInput(vacancy.location),
      } : null,
      deterministicContext: {
        categorySource: vacancy?.categories?.length ? "vacancy.categories" : "event.categories",
        officialCauseAreas,
        unmappedOfficialCategoryTitles,
        checksHandledOutsideModel: nonLlmChecks,
      },
    };
  }

  const event = record;
  return {
    inputVersion: "legacy-event-v1",
    annotationUnit: "event",
    source: event.source ?? null,
    sourceUrl: event.url ?? null,
    completeness: "legacy",
    matchedCities: event.city ? [event.city] : [],
    event: {
      id: String(event.id),
      title: cleanText(event.title),
      description: cleanText(event.description),
      categories: [],
      tags: [],
      online: event.traits?.format === "online" ? true : null,
      hasInternationalSignLanguage: null,
      period: periodInput(null, event),
      location: locationInput(null, event),
      ageRestriction: event.age ?? null,
    },
    vacancy: null,
    deterministicContext: {
      categorySource: "legacy_inference",
      officialCauseAreas: [],
      unmappedOfficialCategoryTitles: [],
      checksHandledOutsideModel: nonLlmChecks,
    },
  };
}

export function annotationInputHash(event) {
  const payload = JSON.stringify(annotationInput(event));
  return createHash("sha256").update(payload).digest("hex");
}

export function buildAnnotationRequest(event, options = {}) {
  const payload = annotationInput(event);
  const evidenceMode = options.evidenceMode ?? "full";
  const instructions = evidenceMode === "none"
    ? `${annotationPrompt}\n\n# Режим без доказательств\nНе создавай цитаты и обоснования по отдельным выводам. Верни \`evidence\` строго как пустой массив \`[]\`. Остальные поля заполни по тем же правилам.`
    : annotationPrompt;
  return {
    model: annotationConfig.model,
    store: annotationConfig.store,
    reasoning: annotationConfig.reasoning,
    instructions,
    input: `<untrusted_dobro_record>\n${JSON.stringify(payload)}\n</untrusted_dobro_record>`,
    text: {
      format: {
        type: annotationConfig.structuredOutput.type,
        name: annotationConfig.structuredOutput.name,
        strict: annotationConfig.structuredOutput.strict,
        schema: annotationSchema,
      },
    },
  };
}

const typeMatches = (value, type) => {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
};

function validateNode(value, schema, at, errors) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.some((type) => typeMatches(value, type))) {
    errors.push(`${at}: expected ${types.join("|")}`);
    return;
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value)))
    errors.push(`${at}: value is outside enum`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above maximum`);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1)
      validateNode(value[index], schema.items, `${at}[${index}]`, errors);
    return;
  }
  if (!typeMatches(value, "object")) return;
  const required = new Set(schema.required || []);
  for (const key of required) if (!(key in value)) errors.push(`${at}.${key}: required`);
  if (schema.additionalProperties === false)
    for (const key of Object.keys(value)) if (!schema.properties?.[key]) errors.push(`${at}.${key}: additional property`);
  for (const [key, child] of Object.entries(schema.properties || {}))
    if (key in value) validateNode(value[key], child, `${at}.${key}`, errors);
}

export function validateAgainstSchema(value, schema) {
  const errors = [];
  validateNode(value, schema, "$", errors);
  return errors;
}

const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("ru-RU");
const exclusiveValues = new Set(["unclear", "unknown", "none", "none_stated"]);

export function validateAnnotation(annotation, event, options = {}) {
  const errors = validateAgainstSchema(annotation, annotationSchema);
  if (errors.length) return errors;

  const input = annotationInput(event);
  if (annotation.eventId !== input.event.id) errors.push("$.eventId: does not match source event");
  const expectedVacancyId = input.vacancy?.id ?? null;
  if (annotation.vacancyId !== expectedVacancyId) errors.push("$.vacancyId: does not match source vacancy");
  if (annotation.schemaVersion !== annotationConfig.schemaVersion) errors.push("$.schemaVersion: version mismatch");
  if (annotation.confidence < 0 || annotation.confidence > 1) errors.push("$.confidence: expected 0..1");
  if (annotation.requirements.minimumAge !== null && (annotation.requirements.minimumAge < 0 || annotation.requirements.minimumAge > 100))
    errors.push("$.requirements.minimumAge: expected 0..100 or null");

  if (input.deterministicContext.categorySource !== "legacy_inference") {
    const actualCauseAreas = new Set(annotation.classification.causeAreas);
    for (const lockedCauseArea of input.deterministicContext.officialCauseAreas)
      if (!actualCauseAreas.has(lockedCauseArea))
        errors.push(`$.classification.causeAreas: missing locked source category ${lockedCauseArea}`);
  }

  const arrays = [
    ["causeAreas", annotation.classification.causeAreas],
    ["beneficiaryGroups", annotation.classification.beneficiaryGroups],
    ["volunteerTasks", annotation.classification.volunteerTasks],
    ["formats", annotation.classification.formats],
    ["participationModes", annotation.classification.participationModes],
    ["quality.reasons", annotation.quality.reasons],
    ["ownResources", annotation.requirements.ownResources],
    ["prerequisites", annotation.requirements.prerequisites],
    ["unknownConditions", annotation.requirements.unknownConditions],
    ["firstTimeFit.positives", annotation.firstTimeFit.positives],
    ["firstTimeFit.concerns", annotation.firstTimeFit.concerns],
  ];
  for (const [name, values] of arrays) {
    if (!values.length) errors.push(`$.${name}: must not be empty`);
    if (new Set(values).size !== values.length) errors.push(`$.${name}: duplicate values`);
    if (values.length > 1 && values.some((value) => exclusiveValues.has(value)))
      errors.push(`$.${name}: unknown/none value must be exclusive`);
  }

  const { verdict, score } = annotation.firstTimeFit;
  const scoreOk = verdict === "unknown" ? score === null
    : verdict === "suitable" ? Number.isInteger(score) && score >= 70 && score <= 100
      : verdict === "conditional" ? Number.isInteger(score) && score >= 40 && score <= 69
        : Number.isInteger(score) && score >= 0 && score <= 39;
  if (!scoreOk) errors.push("$.firstTimeFit.score: inconsistent with verdict");

  const { shortDuration, knownDurationMinutes, remoteTask, weekendEvidence } = annotation.feedSignals;
  if (knownDurationMinutes !== null && knownDurationMinutes <= 0)
    errors.push("$.feedSignals.knownDurationMinutes: must be positive or null");
  if (shortDuration === "yes" && !(knownDurationMinutes > 0 && knownDurationMinutes <= 120))
    errors.push("$.feedSignals: shortDuration=yes requires 1..120 knownDurationMinutes");
  if (shortDuration === "unknown" && knownDurationMinutes !== null)
    errors.push("$.feedSignals: unknown short duration requires null minutes");
  if (remoteTask === "yes" && !annotation.classification.formats.some((value) => ["online", "hybrid"].includes(value)))
    errors.push("$.feedSignals.remoteTask: yes requires online or hybrid format");
  if (weekendEvidence === "specific_weekend_date" && !annotation.evidence.some((item) => item.target === "weekend_evidence"))
    errors.push("$.feedSignals.weekendEvidence: specific date requires evidence");
  if (weekendEvidence === "explicit_recurring_weekends" && !annotation.evidence.some((item) => item.target === "weekend_evidence"))
    errors.push("$.feedSignals.weekendEvidence: recurring weekends require evidence");
  if (annotation.feedSignals.friendsAllowed === "yes" && !annotation.evidence.some((item) => item.target === "friends_allowed"))
    errors.push("$.feedSignals.friendsAllowed: yes requires evidence");
  if (shortDuration === "yes" && !annotation.evidence.some((item) => item.target === "short_duration"))
    errors.push("$.feedSignals.shortDuration: yes requires evidence");
  if (remoteTask === "yes" && !annotation.evidence.some((item) => item.target === "remote_task"))
    errors.push("$.feedSignals.remoteTask: yes requires evidence");
  if (annotation.feedSignals.calmTask === "yes") {
    if (!["minimal", "light"].includes(annotation.complexity.physicalLoad) || !["solitary", "low"].includes(annotation.complexity.socialLoad))
      errors.push("$.feedSignals.calmTask: yes requires low physical and social load");
    if (!annotation.evidence.some((item) => item.target === "calm_task"))
      errors.push("$.feedSignals.calmTask: yes requires evidence");
  }
  const candidateByVerdict = { suitable: "yes", conditional: "conditional", not_suitable: "no", unknown: "unknown" };
  if (annotation.feedSignals.firstTimeCandidate !== candidateByVerdict[verdict])
    errors.push("$.feedSignals.firstTimeCandidate: inconsistent with firstTimeFit.verdict");

  const evidenceMode = options.evidenceMode ?? "full";
  if (evidenceMode === "none") {
    if (annotation.evidence.length) errors.push("$.evidence: must be empty in no-evidence mode");
  } else {
    const source = normalize(JSON.stringify(input));
    const legacyFlatSource = normalize(Object.values(event ?? {}).join(" "));
    for (const [index, item] of annotation.evidence.entries()) {
      const quote = normalize(item.quote);
      if (["source_quote", "structured_source"].includes(item.basis)) {
        if (!quote || (!source.includes(quote) && !legacyFlatSource.includes(quote)))
          errors.push(`$.evidence[${index}].quote: not found verbatim in source event`);
      } else if (quote) {
        errors.push(`$.evidence[${index}].quote: inference or assumption must use an empty quote`);
      }
    }
    for (const target of ["quality_status", "volunteer_task", "first_time_fit"])
      if (!annotation.evidence.some((item) => item.target === target)) errors.push(`$.evidence: missing ${target}`);
  }

  if (annotation.quality.status === "suitable" && annotation.quality.taskClarity !== "clear")
    errors.push("$.quality: suitable requires clear task");
  if (annotation.quality.status === "hidden" && !annotation.quality.reasons.some((reason) => [
    "missing_task", "promotional_without_task", "meaningless_text", "suspected_spam",
  ].includes(reason))) errors.push("$.quality: hidden requires a hide reason");
  if (annotation.quality.status === "human_review" && !annotation.quality.reasons.some((reason) => [
    "contradictory_conditions", "potential_safety_risk", "vulnerable_people_without_safeguards",
    "specialized_work_without_requirements",
  ].includes(reason))) errors.push("$.quality: human_review requires a review reason");

  return errors;
}

export function assertAnnotation(annotation, event) {
  const errors = validateAnnotation(annotation, event);
  if (errors.length) throw new Error(`Invalid annotation for ${event.id}:\n- ${errors.join("\n- ")}`);
  return annotation;
}
