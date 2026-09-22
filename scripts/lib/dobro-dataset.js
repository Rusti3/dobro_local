import fs from "node:fs";
import path from "node:path";
import { annotationSubjectsFromActivity } from "./annotation-contract.js";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export const opportunityKey = (subject) => {
  const eventId = String(subject?.event?.id ?? subject?.eventId ?? "");
  const vacancyId = subject?.vacancy?.id === undefined || subject?.vacancy?.id === null
    ? "event"
    : String(subject.vacancy.id);
  return `${eventId}:${vacancyId}`;
};

export function loadDobroSubjects(datasetRoot) {
  const dataDir = path.join(datasetRoot, "data");
  const rawEventsDir = path.join(dataDir, "raw", "events");
  const rawVacanciesDir = path.join(dataDir, "raw", "event-vacancies");
  const cityByEvent = new Map();

  for (const name of ["moscow", "saint-petersburg", "kazan", "rybinsk"]) {
    const indexFile = path.join(dataDir, `${name}-index.json`);
    if (!fs.existsSync(indexFile)) continue;
    const index = readJson(indexFile);
    for (const eventId of index.eventIds ?? []) {
      const key = String(eventId);
      if (!cityByEvent.has(key)) cityByEvent.set(key, []);
      cityByEvent.get(key).push(index.name);
    }
  }

  const issues = [];
  const subjects = [];
  const files = fs.readdirSync(rawVacanciesDir)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

  for (const fileName of files) {
    const eventId = path.basename(fileName, ".json");
    try {
      const vacancies = readJson(path.join(rawVacanciesDir, fileName));
      const eventFile = path.join(rawEventsDir, fileName);
      const event = fs.existsSync(eventFile)
        ? readJson(eventFile)
        : vacancies?.[0]?.event ?? { id: eventId, name: "", categories: [] };
      const activity = {
        event,
        vacancies: Array.isArray(vacancies) ? vacancies : [],
        sourceUrl: `https://dobro.ru/event/${eventId}`,
        matchedCities: cityByEvent.get(eventId) ?? [],
        completeness: fs.existsSync(eventFile) ? "complete" : "partial",
      };
      subjects.push(...annotationSubjectsFromActivity(activity));
    } catch (error) {
      issues.push({ eventId, fileName, error: error.message });
    }
  }

  return { subjects, issues, source: "raw-json" };
}
