import fs from "node:fs";
import path from "node:path";
import { loadDobroSubjects, opportunityKey } from "./lib/dobro-dataset.js";
import { evidenceQuoteInSource, validateSemanticAnnotation } from "./lib/semantic-annotation-contract.js";

const datasetRoot = path.resolve(process.argv[2] ?? "D:/des/afisha");
const pilotDir = path.join(datasetRoot, "razmetka", "pilot");
const reviewedFile = path.join(pilotDir, "annotations.reviewed.jsonl");
const annotationsFile = fs.existsSync(reviewedFile) ? reviewedFile : path.join(pilotDir, "annotations.jsonl");
if (!fs.existsSync(annotationsFile)) throw new Error("Pilot annotations are missing");

const { subjects } = loadDobroSubjects(datasetRoot);
const subjectByKey = new Map(subjects.map((subject) => [opportunityKey(subject), subject]));
const records = fs.readFileSync(annotationsFile, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
const findings = [];
const statusCounts = {};
const add = (record, type, severity, detail) => findings.push({
  key: record.key,
  eventTitle: record.eventTitle,
  sourceUrl: record.sourceUrl,
  type,
  severity,
  detail,
});

for (const record of records) {
  const subject = subjectByKey.get(record.key);
  if (!subject) {
    add(record, "missing_source", "error", "Вакансия отсутствует в текущем датасете");
    continue;
  }
  const annotation = record.semantic;
  statusCounts[annotation.quality.status] = (statusCounts[annotation.quality.status] ?? 0) + 1;
  for (const error of validateSemanticAnnotation(annotation, subject, { evidenceMode: "full" }))
    add(record, "contract_violation", "error", error);

  for (const evidence of annotation.evidence) {
    if (!evidenceQuoteInSource(evidence, subject)) {
      const type = ["source_quote", "structured_source"].includes(evidence.basis)
        ? "invented_quote"
        : "misclassified_evidence";
      add(record, type, "error", `${evidence.target}:${evidence.value ?? "null"} — цитата не подтверждается источником или не должна быть заполнена`);
    }
  }
  for (const target of ["quality_status", "beneficiary_group", "first_time_fit"])
    if (!annotation.evidence.some((item) => item.target === target))
      add(record, "missing_evidence", "warning", `Нет доказательства для ${target}`);

  for (const area of annotation.supplementalClassification.supplementalCauseAreas) {
    const evidence = annotation.evidence.find((item) => item.target === "cause_area" && item.value === area);
    if (!evidence) add(record, "unsupported_category", "error", `Нет отдельного доказательства для ${area}`);
    else if (evidence.basis === "assumption") add(record, "assumed_category", "warning", `${area} помечена только как предположение`);
  }

  for (const requirement of annotation.inferredRequirements.additionalPrerequisites) {
    const evidence = annotation.evidence.find((item) => item.target === "requirement" && item.value === requirement);
    if (!evidence) add(record, "unsupported_requirement", "warning", `Нет отдельного доказательства для ${requirement}`);
    else if (evidence.basis === "assumption") add(record, "invented_condition_risk", "error", `${requirement} указано только как предположение`);
  }
  for (const resource of annotation.inferredRequirements.ownResources) {
    const evidence = annotation.evidence.find((item) => item.target === "resource" && item.value === resource);
    if (!evidence) add(record, "unsupported_resource", "warning", `Нет отдельного доказательства для ${resource}`);
  }

  const tasksExist = record.sourceFacts.structuredTasks.length > 0;
  const status = annotation.quality.status;
  if (status === "hidden" && (tasksExist || annotation.quality.taskClarity !== "missing"))
    add(record, "possible_false_rejection", "error", "Карточка скрыта, хотя задача выглядит содержательной");
  if (status === "hidden" && tasksExist)
    add(record, "likely_false_rejection", "error", "Карточка скрыта при наличии структурированных задач ДОБРО");
  if (status === "human_review") {
    const hasStrongReason = annotation.quality.reasons.some((reason) => [
      "contradictory_conditions", "potential_safety_risk", "specialized_work_without_requirements",
      "vulnerable_people_without_safeguards",
    ].includes(reason));
    if (!hasStrongReason)
      add(record, "possible_excessive_human_review", "warning", "Ручная проверка назначена без конфликта, риска или специализированной работы");
  }
  if (["hidden", "human_review"].includes(status) && !record.reasoning.reviewRequired)
    add(record, "missing_high_review", "error", "Рискованное решение не прошло обязательный high-проход");

  for (const positive of annotation.firstTimeFit.positives) {
    const evidence = annotation.evidence.find((item) => item.target === "first_time_fit" && item.value === positive);
    if (!evidence) add(record, "unsupported_first_time_positive", "warning", `Нет отдельного доказательства для ${positive}`);
  }
}

const summary = {
  auditedAt: new Date().toISOString(),
  records: records.length,
  statusCounts,
  highReviews: records.filter((record) => record.reasoning.reviewRequired).length,
  findings: findings.length,
  errors: findings.filter((item) => item.severity === "error").length,
  warnings: findings.filter((item) => item.severity === "warning").length,
  findingTypes: Object.fromEntries([...new Set(findings.map((item) => item.type))].sort().map((type) => [
    type,
    findings.filter((item) => item.type === type).length,
  ])),
};
fs.writeFileSync(path.join(pilotDir, "audit-findings.jsonl"), findings.map((item) => JSON.stringify(item)).join("\n") + (findings.length ? "\n" : ""));
fs.writeFileSync(path.join(pilotDir, "audit-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
