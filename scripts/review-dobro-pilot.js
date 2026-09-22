import fs from "node:fs";
import path from "node:path";
import { loadDobroSubjects, opportunityKey } from "./lib/dobro-dataset.js";
import { evidenceQuoteInSource } from "./lib/semantic-annotation-contract.js";

const datasetRoot = path.resolve(process.argv[2] ?? "D:/des/afisha");
const pilotDir = path.join(datasetRoot, "razmetka", "pilot");
const rawFile = path.join(pilotDir, "annotations.jsonl");
const reviewedFile = path.join(pilotDir, "annotations.reviewed.jsonl");
const correctionsFile = path.join(pilotDir, "review-corrections.jsonl");
const allowedSupplementalAreas = new Set([
  "elderly_support",
  "disability_inclusion",
  "donor_movement",
  "humanitarian_aid",
  "poverty_crisis_support",
  "homelessness_support",
  "refugee_displaced_support",
  "nonprofit_support",
]);
const manuallyDowngradedHumanReviews = new Set([
  "11509295:11847805",
  "11045315:11292693",
  "11723070:12092359",
]);

const { subjects } = loadDobroSubjects(datasetRoot);
const subjectByKey = new Map(subjects.map((subject) => [opportunityKey(subject), subject]));
const records = fs.readFileSync(rawFile, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
const corrections = [];

const hasVerifiedEvidence = (semantic, subject, target, value) => semantic.evidence.some((item) => (
  item.target === target
  && item.value === value
  && ["source_quote", "structured_source"].includes(item.basis)
  && evidenceQuoteInSource(item, subject)
));

for (const record of records) {
  const subject = subjectByKey.get(record.key);
  const semantic = structuredClone(record.semantic);
  const remove = (field, values, reason) => {
    for (const value of values) corrections.push({ key: record.key, field, removedValue: value, reason });
  };

  const oldAreas = semantic.supplementalClassification.supplementalCauseAreas;
  const keptAreas = oldAreas.filter((area) => allowedSupplementalAreas.has(area)
    && hasVerifiedEvidence(semantic, subject, "cause_area", area));
  remove("supplementalCauseAreas", oldAreas.filter((area) => !keptAreas.includes(area)), "not in narrow allowlist or lacks verified source evidence");
  semantic.supplementalClassification.supplementalCauseAreas = keptAreas;

  const oldRequirements = semantic.inferredRequirements.additionalPrerequisites;
  const keptRequirements = oldRequirements.filter((value) => hasVerifiedEvidence(semantic, subject, "requirement", value));
  remove("additionalPrerequisites", oldRequirements.filter((value) => !keptRequirements.includes(value)), "lacks verified source evidence");
  semantic.inferredRequirements.additionalPrerequisites = keptRequirements;

  const oldResources = semantic.inferredRequirements.ownResources;
  const keptResources = oldResources.filter((value) => hasVerifiedEvidence(semantic, subject, "resource", value));
  remove("ownResources", oldResources.filter((value) => !keptResources.includes(value)), "lacks verified source evidence");
  semantic.inferredRequirements.ownResources = keptResources;

  const oldPositives = semantic.firstTimeFit.positives;
  const keptPositives = oldPositives.filter((value) => hasVerifiedEvidence(semantic, subject, "first_time_fit", value));
  remove("firstTimeFit.positives", oldPositives.filter((value) => !keptPositives.includes(value)), "lacks verified source evidence");
  semantic.firstTimeFit.positives = keptPositives;

  for (const evidence of semantic.evidence) {
    if (evidenceQuoteInSource(evidence, subject)) continue;
    corrections.push({
      key: record.key,
      field: "evidence",
      removedValue: evidence.quote,
      reason: "quote is absent from source; converted to explicit assumption",
    });
    evidence.basis = "assumption";
    evidence.quote = "";
    evidence.interpretation = `Предположение без подтверждённой дословной цитаты. ${evidence.interpretation}`;
  }

  if (manuallyDowngradedHumanReviews.has(record.key) && semantic.quality.status === "human_review") {
    corrections.push({
      key: record.key,
      field: "quality.status",
      removedValue: "human_review",
      reason: "manual pilot review: missing supervision is a clarification issue, not a concrete safety conflict",
    });
    semantic.quality.status = "clarification_required";
    semantic.quality.explanation = `Требуется уточнить сопровождение, но оснований для обязательной ручной проверки не найдено. ${semantic.quality.explanation}`;
  }

  record.semantic = semantic;
  record.reviewedAt = new Date().toISOString();
  record.reviewCorrectionCount = corrections.filter((item) => item.key === record.key).length;
}

fs.writeFileSync(reviewedFile, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
fs.writeFileSync(correctionsFile, corrections.map((item) => JSON.stringify(item)).join("\n") + (corrections.length ? "\n" : ""));
const summary = {
  reviewedAt: new Date().toISOString(),
  records: records.length,
  corrections: corrections.length,
  byField: Object.fromEntries([...new Set(corrections.map((item) => item.field))].sort().map((field) => [
    field,
    corrections.filter((item) => item.field === field).length,
  ])),
  rawFile,
  reviewedFile,
  correctionsFile,
};
fs.writeFileSync(path.join(pilotDir, "review-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
