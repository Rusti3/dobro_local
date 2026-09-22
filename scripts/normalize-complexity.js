import fs from "node:fs";
import path from "node:path";
import {
  normalizeSemanticComplexity,
  semanticConfig,
} from "./lib/semantic-annotation-contract.js";

const datasetRoot = path.resolve(process.argv[2] ?? "D:/des/afisha");
const targets = [
  path.join(datasetRoot, "razmetka", "pilot", "annotations.reviewed.jsonl"),
  path.join(datasetRoot, "razmetka", "remaining", "annotations.jsonl"),
];

const summary = {
  schemaVersion: semanticConfig.schemaVersion,
  formula: "weighted 0-100; null when fewer than four dimensions or known weight below 0.5",
  weights: {
    physicalLoad: 0.15,
    emotionalLoad: 0.15,
    skillRequirement: 0.20,
    socialLoad: 0.10,
    responsibility: 0.20,
    entryBarrier: 0.10,
    timeCommitment: 0.10,
  },
  files: [],
  distribution: { "0-19": 0, "20-39": 0, "40-59": 0, "60-79": 0, "80-100": 0, unknown: 0 },
};

for (const sourceFile of targets) {
  const records = fs.readFileSync(sourceFile, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
  let changed = 0;
  for (const record of records) {
    const before = record.semantic?.complexity?.overall ?? null;
    normalizeSemanticComplexity(record.semantic);
    record.schemaVersion = semanticConfig.schemaVersion;
    const after = record.semantic?.complexity?.overall ?? null;
    if (before !== after) changed += 1;
    const bucket = after === null ? "unknown"
      : after < 20 ? "0-19"
        : after < 40 ? "20-39"
          : after < 60 ? "40-59"
            : after < 80 ? "60-79"
              : "80-100";
    summary.distribution[bucket] += 1;
  }
  const outputFile = path.join(path.dirname(sourceFile), "annotations.normalized.jsonl");
  fs.writeFileSync(outputFile, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  summary.files.push({ sourceFile, outputFile, records: records.length, changed });
}

const summaryFile = path.join(datasetRoot, "razmetka", "complexity-normalization.json");
fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, summaryFile }, null, 2));
