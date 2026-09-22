import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAnnotation } from "./lib/annotation-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data/catalog.json"), "utf8"));
const gold = JSON.parse(fs.readFileSync(path.join(root, "data/annotation-gold.json"), "utf8"));
const byId = new Map(catalog.map((event) => [String(event.id), event]));
const failures = [];
const seen = new Set();
const statuses = new Map();
const causes = new Map();
const tasks = new Map();

if (gold.catalogSize !== catalog.length)
  failures.push(`catalogSize=${gold.catalogSize}, actual=${catalog.length}`);
if (gold.sampleSize !== gold.items.length)
  failures.push(`sampleSize=${gold.sampleSize}, actual=${gold.items.length}`);

for (const item of gold.items) {
  if (seen.has(item.eventId)) failures.push(`${item.eventId}: duplicate gold item`);
  seen.add(item.eventId);
  const event = byId.get(item.eventId);
  if (!event) {
    failures.push(`${item.eventId}: event is absent from current catalog`);
    continue;
  }
  for (const error of validateAnnotation(item.expected, event)) failures.push(`${item.eventId}: ${error}`);
  statuses.set(item.expected.quality.status, (statuses.get(item.expected.quality.status) || 0) + 1);
  for (const value of item.expected.classification.causeAreas)
    causes.set(value, (causes.get(value) || 0) + 1);
  for (const value of item.expected.classification.volunteerTasks)
    tasks.set(value, (tasks.get(value) || 0) + 1);
}

for (const status of ["suitable", "clarification_required", "hidden", "human_review"])
  if (!statuses.has(status)) failures.push(`gold set does not cover quality status ${status}`);

if (failures.length) {
  console.error(`Gold validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const format = (values) => [...values].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([name, count]) => `${name}=${count}`).join(", ");

console.log(`Gold set is valid: ${gold.items.length}/${catalog.length} events.`);
console.log(`Quality: ${format(statuses)}`);
console.log(`Cause coverage: ${format(causes)}`);
console.log(`Task coverage: ${format(tasks)}`);

