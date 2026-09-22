import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  annotationConfig,
  annotationInput,
  annotationPrompt,
  annotationSchema,
  annotationSubjectsFromActivity,
  buildAnnotationRequest,
  validateAnnotation,
} from "../scripts/lib/annotation-contract.js";
import {
  buildSemanticRequest,
  calculateOverallComplexity,
  deterministicSourceFacts,
  normalizeSemanticComplexity,
  semanticSchema,
} from "../scripts/lib/semantic-annotation-contract.js";
import { sourceToCatalog } from "../server/dobro-source.js";

const catalog = JSON.parse(fs.readFileSync(new URL("../data/catalog.json", import.meta.url), "utf8"));
const gold = JSON.parse(fs.readFileSync(new URL("../data/annotation-gold.json", import.meta.url), "utf8"));

function assertClosedStrictObject(schema, at = "$") {
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false, `${at} must reject additional properties`);
    assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)), `${at} must require every property`);
    for (const [key, child] of Object.entries(schema.properties)) assertClosedStrictObject(child, `${at}.${key}`);
  }
  if (schema.type === "array") assertClosedStrictObject(schema.items, `${at}[]`);
}

test("annotation schema is closed and requires every field", () => {
  assertClosedStrictObject(annotationSchema);
});

test("compact semantic schema is closed and excludes deterministic source facts", () => {
  assertClosedStrictObject(semanticSchema);
  assert.equal(semanticSchema.properties.eventId, undefined);
  assert.equal(semanticSchema.properties.vacancyId, undefined);
  assert.equal(semanticSchema.properties.formats, undefined);
  assert.equal(semanticSchema.properties.minimumAge, undefined);
});

test("overall complexity is deterministically normalized to 0-100", () => {
  const complexity = {
    physicalLoad: "light",
    emotionalLoad: "low",
    skillRequirement: "briefing",
    socialLoad: "moderate",
    responsibility: "supervised_simple",
    entryBarrier: "registration",
    timeCommitment: "up_to_2h",
  };
  assert.equal(calculateOverallComplexity(complexity), 21);
  const semantic = { schemaVersion: "semantic-1.0.0", complexity: { ...complexity, overall: 5 } };
  normalizeSemanticComplexity(semantic);
  assert.equal(semantic.schemaVersion, "semantic-1.1.0");
  assert.equal(semantic.complexity.overall, 21);
  assert.equal(calculateOverallComplexity({ ...complexity, skillRequirement: "unknown", socialLoad: "unknown", responsibility: "unknown", entryBarrier: "unknown" }), null);
});

test("future Responses request is pinned to Terra and strict JSON Schema", () => {
  const event = catalog[0];
  const request = buildAnnotationRequest(event);
  assert.equal(annotationConfig.model, "gpt-5.6-terra");
  assert.equal(request.model, "gpt-5.6-terra");
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema, annotationSchema);
  assert.equal(request.instructions, annotationPrompt);
  assert.match(request.input, /^<untrusted_dobro_record>/);
  assert.match(request.input, /<\/untrusted_dobro_record>$/);
});

test("DOBRO activity becomes one annotation subject per vacancy", () => {
  const activity = {
    sourceUrl: "https://dobro.ru/event/1",
    event: {
      id: 1,
      name: "Помощь центру",
      description: "Поддержка семей.",
      categories: [{ id: 10, title: "Социальная поддержка" }],
      online: false,
      eventPeriod: { startDate: "2026-10-01", endDate: "2026-10-30" },
      location: { settlement: "Москва", title: "ул. Тестовая, 1", x: 37.6, y: 55.7 },
    },
    vacancies: [{
      id: 2,
      description: "Сортировать вещи под руководством координатора.",
      categories: [{ id: 10, title: "Социальная поддержка" }],
      tasks: [{ id: 20, title: "Сортировка гуманитарной помощи" }],
      requirements: [{ id: 30, title: "14+" }],
      conditions: [{ id: 40, title: "Персональное обучение" }],
      online: false,
      maxHours: 160,
      quickVisit: false,
      vacancyPeriod: { startDate: "2026-10-03", endDate: "2026-10-03" },
      location: { settlement: "Москва", title: "ул. Тестовая, 2", x: 37.61, y: 55.71 },
    }],
  };
  const subjects = annotationSubjectsFromActivity(activity);
  assert.equal(subjects.length, 1);
  const input = annotationInput(subjects[0]);
  assert.equal(input.annotationUnit, "vacancy");
  assert.deepEqual(input.deterministicContext.officialCauseAreas, ["social_support"]);
  assert.equal(input.vacancy.tasks[0].title, "Сортировка гуманитарной помощи");
  assert.equal(input.vacancy.requirements[0].title, "14+");
  assert.equal(input.vacancy.location.address, "ул. Тестовая, 2");
  const facts = deterministicSourceFacts(subjects[0]);
  assert.equal(facts.eventId, "1");
  assert.equal(facts.vacancyId, "2");
  assert.equal(facts.minimumAge, 14);
  assert.equal(facts.format, "on_site");
  assert.deepEqual(facts.officialCauseAreas, ["social_support"]);
  const request = buildSemanticRequest(subjects[0]);
  assert.equal(request.reasoning.effort, "medium");
  assert.equal(request.text.format.schema, semanticSchema);
});

test("DOBRO source normalizes object-shaped taxonomy fields", () => {
  const event = {
    id: "source-test-event",
    name: "Помощь",
    description: "Описание",
    categories: { title: "Экология" },
    eventPeriod: { startDate: "2030-01-01T09:00:00Z", endDate: "2030-01-01T12:00:00Z" },
    location: { settlement: "Москва", title: "Онлайн" },
  };
  const vacancy = {
    id: "source-test-vacancy",
    description: "Задача",
    categories: { title: "Экология" },
    requirements: { title: "14+" },
    previewRequirements: { title: "14+" },
    vacancyPeriod: event.eventPeriod,
    location: event.location,
  };
  const result = sourceToCatalog(event, [vacancy], ["Москва"]);
  assert.equal(result.id, "source-test-event");
  assert.equal(result.age, "14");
  assert.equal(result.city, "Москва");
  assert.equal(result.lat, null);
  assert.equal(result.lng, null);
  const input = annotationInput({ event, vacancy, sourceUrl: "https://dobro.ru/event/source-test-event", matchedCities: ["Москва"] });
  assert.equal(input.vacancy.requirements[0].title, "14+");
  assert.equal(deterministicSourceFacts({ event, vacancy, sourceUrl: "https://dobro.ru/event/source-test-event", matchedCities: ["Москва"] }).minimumAge, 14);
});

test("DOBRO source rejects missing, zero and out-of-range map coordinates", () => {
  const baseEvent = {
    id: "coordinates-test-event",
    name: "Помощь",
    description: "Описание",
    eventPeriod: { startDate: "2030-01-01T09:00:00Z", endDate: "2030-01-01T12:00:00Z" },
  };
  const catalogAt = (location) => sourceToCatalog({ ...baseEvent, location }, [], ["Москва"]);
  assert.deepEqual([catalogAt({ title: "Онлайн", x: null, y: null }).lat, catalogAt({ title: "Онлайн", x: null, y: null }).lng], [null, null]);
  assert.deepEqual([catalogAt({ x: 0, y: 0 }).lat, catalogAt({ x: 0, y: 0 }).lng], [null, null]);
  assert.deepEqual([catalogAt({ x: 37.617, y: 55.759 }).lat, catalogAt({ x: 37.617, y: 55.759 }).lng], [55.759, 37.617]);
  assert.deepEqual([catalogAt({ x: 200, y: 95 }).lat, catalogAt({ x: 200, y: 95 }).lng], [null, null]);
});

test("unknown future DOBRO category is locked as other for dictionary review", () => {
  const input = annotationInput({
    event: { id: 1, name: "Тест", categories: [{ id: 999, title: "Новая категория" }] },
    vacancy: null,
  });
  assert.deepEqual(input.deterministicContext.officialCauseAreas, ["other"]);
  assert.deepEqual(input.deterministicContext.unmappedOfficialCategoryTitles, ["Новая категория"]);
});

test("manual gold set validates against current 56-card catalog", () => {
  assert.equal(gold.catalogSize, catalog.length);
  assert.equal(gold.sampleSize, gold.items.length);
  assert.ok(gold.items.length >= 12);
  const statuses = new Set();
  for (const item of gold.items) {
    const event = catalog.find((candidate) => candidate.id === item.eventId);
    assert.ok(event, `missing source event ${item.eventId}`);
    assert.deepEqual(validateAnnotation(item.expected, event), [], item.eventId);
    statuses.add(item.expected.quality.status);
  }
  assert.deepEqual(statuses, new Set(["suitable", "clarification_required", "hidden", "human_review"]));
});

test("semantic validator rejects invented evidence", () => {
  const item = structuredClone(gold.items[0]);
  const event = catalog.find((candidate) => candidate.id === item.eventId);
  item.expected.evidence[0].quote = "Этой фразы в карточке нет";
  assert.ok(validateAnnotation(item.expected, event).some((error) => error.includes("not found verbatim")));
});
