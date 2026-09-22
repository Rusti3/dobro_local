import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { annotationInputHash } from "./lib/annotation-contract.js";
import { loadDobroSubjects, opportunityKey } from "./lib/dobro-dataset.js";
import { compactUsage, createResponse, responseOutputText } from "./lib/responses-client.js";
import {
  buildSemanticRequest,
  deterministicSourceFacts,
  highReviewReason,
  normalizeSemanticComplexity,
  semanticConfig,
  validateSemanticAnnotation,
} from "./lib/semantic-annotation-contract.js";

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : true];
}));
const datasetRoot = path.resolve(args.dataset ?? "D:/des/afisha");
const outputRoot = path.resolve(args.output ?? path.join(datasetRoot, "razmetka"));
const stage = String(args.stage ?? "pilot");
const evidenceMode = String(args.evidence ?? (stage === "pilot" ? "full" : "none"));
const concurrency = Math.max(1, Math.min(20, Number.parseInt(args.concurrency ?? "5", 10)));
const requestedLimit = args.limit === "all" ? Infinity : Number.parseInt(args.limit ?? (stage === "pilot" ? "200" : "999999"), 10);

if (!process.env.LLM_API_KEY) throw new Error("LLM_API_KEY is missing");
if (!process.env.LLM_BASE_URL) throw new Error("LLM_BASE_URL is missing");

const { subjects, issues, source } = loadDobroSubjects(datasetRoot);
if (issues.length) throw new Error(`Dataset load failed for ${issues.length} event(s): ${JSON.stringify(issues.slice(0, 3))}`);
const hashRank = (subject) => createHash("sha256").update(opportunityKey(subject)).digest("hex");
const ranked = [...subjects].sort((left, right) => hashRank(left).localeCompare(hashRank(right)));
const selectionFile = path.join(outputRoot, "pilot", "selection.json");
let selected;
if (stage === "pilot") {
  selected = ranked.slice(0, Math.min(requestedLimit, ranked.length));
} else {
  if (!fs.existsSync(selectionFile)) throw new Error("Pilot selection is missing; run --stage=pilot first");
  const pilotKeys = new Set(JSON.parse(fs.readFileSync(selectionFile, "utf8")).keys);
  selected = ranked.filter((subject) => !pilotKeys.has(opportunityKey(subject))).slice(0, requestedLimit);
}

const stageDir = path.join(outputRoot, stage);
fs.mkdirSync(stageDir, { recursive: true });
const annotationsFile = path.join(stageDir, "annotations.jsonl");
const errorsFile = path.join(stageDir, "errors.jsonl");
const manifestFile = path.join(stageDir, "manifest.json");
if (stage === "pilot" && !fs.existsSync(selectionFile)) {
  fs.writeFileSync(selectionFile, `${JSON.stringify({
    createdAt: new Date().toISOString(),
    strategy: "sha256(opportunityKey), ascending",
    populationSize: subjects.length,
    sampleSize: selected.length,
    keys: selected.map(opportunityKey),
  }, null, 2)}\n`);
}

const completedKeys = new Set();
if (fs.existsSync(annotationsFile)) {
  for (const line of fs.readFileSync(annotationsFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { completedKeys.add(JSON.parse(line).key); } catch { /* audit will report malformed rows */ }
  }
}
const queue = selected.filter((subject) => !completedKeys.has(opportunityKey(subject)));
const startedAt = new Date().toISOString();
let cursor = 0;
let succeeded = 0;
let failed = 0;
let highReviews = 0;
const totalUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };
const addUsage = (usage) => {
  for (const key of Object.keys(totalUsage)) totalUsage[key] += usage?.[key] ?? 0;
};

async function runPass(subject, reasoningEffort, reviewReason = null) {
  let validationErrors = [];
  let response = null;
  let semantic = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const request = buildSemanticRequest(subject, { evidenceMode, reasoningEffort, reviewReason });
    if (attempt > 1) {
      request.instructions += `\n\n# Исправление формата\nИсправь следующие нарушения: ${validationErrors.join("; ")}. Не используй этот список как источник фактов.`;
    }
    response = await createResponse(request);
    const outputText = responseOutputText(response);
    if (!outputText) throw new Error("Responses API returned no output text");
    try {
      semantic = normalizeSemanticComplexity(JSON.parse(outputText));
    } catch (error) {
      validationErrors = [`invalid JSON: ${error.message}`];
      continue;
    }
    validationErrors = validateSemanticAnnotation(semantic, subject, { evidenceMode });
    if (!validationErrors.length) return { semantic, response, usage: compactUsage(response.usage) };
  }
  const error = new Error(`Semantic validation failed: ${validationErrors.join("; ")}`);
  error.validationErrors = validationErrors;
  error.responseId = response?.id ?? null;
  error.usage = compactUsage(response?.usage);
  throw error;
}

async function annotate(subject) {
  const primary = await runPass(subject, semanticConfig.primaryReasoningEffort);
  addUsage(primary.usage);
  const reviewReason = highReviewReason(primary.semantic, subject);
  let finalPass = primary;
  let review = null;
  if (reviewReason) {
    highReviews += 1;
    review = await runPass(subject, semanticConfig.reviewReasoningEffort, reviewReason);
    addUsage(review.usage);
    finalPass = review;
  }
  const facts = deterministicSourceFacts(subject);
  return {
    key: opportunityKey(subject),
    eventId: facts.eventId,
    vacancyId: facts.vacancyId,
    eventTitle: subject.event?.name ?? subject.event?.title ?? "",
    sourceUrl: facts.sourceUrl,
    matchedCities: facts.matchedCities,
    inputHash: annotationInputHash(subject),
    schemaVersion: semanticConfig.schemaVersion,
    model: process.env.LLM_MODEL ?? semanticConfig.model,
    evidenceMode,
    reasoning: {
      primaryEffort: semanticConfig.primaryReasoningEffort,
      primaryResponseId: primary.response?.id ?? null,
      reviewRequired: Boolean(reviewReason),
      reviewReason,
      reviewEffort: review ? semanticConfig.reviewReasoningEffort : null,
      reviewResponseId: review?.response?.id ?? null,
    },
    usage: {
      primary: primary.usage,
      review: review?.usage ?? null,
    },
    annotatedAt: new Date().toISOString(),
    sourceFacts: facts,
    semantic: finalPass.semantic,
  };
}

async function worker(workerId) {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= queue.length) return;
    const subject = queue[index];
    const key = opportunityKey(subject);
    const began = Date.now();
    try {
      const record = await annotate(subject);
      fs.appendFileSync(annotationsFile, `${JSON.stringify(record)}\n`);
      succeeded += 1;
      console.log(`[${succeeded + failed}/${queue.length}] ok ${key} ${Math.round((Date.now() - began) / 1000)}s ${record.reasoning.reviewRequired ? "medium+high" : "medium"} w${workerId}`);
    } catch (error) {
      failed += 1;
      addUsage(error.usage);
      fs.appendFileSync(errorsFile, `${JSON.stringify({
        key,
        eventId: String(subject.event?.id ?? ""),
        vacancyId: subject.vacancy?.id === undefined ? null : String(subject.vacancy.id),
        error: error.message,
        validationErrors: error.validationErrors ?? [],
        responseId: error.responseId ?? null,
        usage: error.usage ?? null,
        failedAt: new Date().toISOString(),
      })}\n`);
      console.error(`[${succeeded + failed}/${queue.length}] FAIL ${key}: ${error.message}`);
    }
  }
}

console.log(JSON.stringify({
  stage,
  source,
  population: subjects.length,
  selected: selected.length,
  alreadyCompleted: completedKeys.size,
  queued: queue.length,
  concurrency,
  evidenceMode,
  model: process.env.LLM_MODEL ?? semanticConfig.model,
  primaryReasoningEffort: semanticConfig.primaryReasoningEffort,
  reviewReasoningEffort: semanticConfig.reviewReasoningEffort,
}));
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, (_, index) => worker(index + 1)));

const manifest = {
  stage,
  startedAt,
  finishedAt: new Date().toISOString(),
  datasetRoot,
  source,
  populationSize: subjects.length,
  selectedSize: selected.length,
  previouslyCompleted: completedKeys.size,
  attemptedNow: queue.length,
  succeededNow: succeeded,
  failedNow: failed,
  highReviewsNow: highReviews,
  concurrency,
  evidenceMode,
  model: process.env.LLM_MODEL ?? semanticConfig.model,
  primaryReasoningEffort: semanticConfig.primaryReasoningEffort,
  reviewReasoningEffort: semanticConfig.reviewReasoningEffort,
  usageNow: totalUsage,
  annotationsFile,
  errorsFile,
};
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
if (failed) process.exitCode = 1;
