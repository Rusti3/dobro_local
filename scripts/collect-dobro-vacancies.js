import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const catalogPath = path.join(root, "data", "catalog.json");
const outputPath = path.join(root, "data", "dobro-vacancies.json");

function readLimit() {
  const raw = process.argv.find((value) => value.startsWith("--limit="))?.split("=")[1];
  const limit = raw === undefined ? 10 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Параметр --limit должен быть целым числом от 1 до 100.");
  }
  return limit;
}

const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();
const asArray = (value) => Array.isArray(value) ? value : [];

function textFromHtml(value = "") {
  const entities = {
    amp: "&", apos: "'", gt: ">", hellip: "…", laquo: "«", lt: "<",
    mdash: "—", nbsp: " ", ndash: "–", quot: '"', raquo: "»",
  };
  return clean(
    String(value)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match),
  );
}

function parseNextData(html, url) {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error(`На странице ${url} не найден __NEXT_DATA__.`);
  return JSON.parse(match[1]);
}

async function fetchPage(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "dobrie-dela-max/1.0 catalog collector (public DOBRO pages)",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`Не удалось загрузить ${url}: ${lastError?.message || "неизвестная ошибка"}`);
}

function simpleCategory(category) {
  return category && typeof category === "object"
    ? { id: category.id ?? null, title: category.title ?? null }
    : category;
}

function simpleTag(tag) {
  return tag && typeof tag === "object"
    ? { id: tag.id ?? null, name: tag.name ?? tag.title ?? null, description: tag.description ?? "" }
    : tag;
}

function conditionDirectory(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([title, id]) => ({ id, title }));
}

function simpleImage(image) {
  if (!image || typeof image !== "object") return image ?? null;
  return {
    id: image.id ?? null,
    name: image.name ?? null,
    url: image.url ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
  };
}

function simpleOrganizer(organizer) {
  if (!organizer || typeof organizer !== "object") return organizer ?? null;
  return {
    id: organizer.id ?? null,
    remoteId: organizer.remoteId ?? null,
    name: organizer.name ?? null,
    fullName: organizer.fullName ?? null,
    type: organizer.type ?? null,
    verified: organizer.verified ?? false,
    verifiedByEsia: organizer.verifiedByEsia ?? false,
    accordingToStandard: organizer.accordingToStandard ?? false,
    url: organizer.url ?? null,
    baseUrl: organizer.baseUrl ?? null,
    iconFile: simpleImage(organizer.iconFile),
    statistic: organizer.statistic ?? null,
  };
}

function normalizeVacancy(vacancy) {
  return {
    id: vacancy.id,
    type: vacancy.type ?? null,
    slug: vacancy.slug ?? null,
    status: vacancy.status ?? null,
    description: { html: vacancy.description ?? "", text: textFromHtml(vacancy.description) },
    online: Boolean(vacancy.online),
    format: vacancy.online ? "online" : "offline",
    location: vacancy.location ?? null,
    vacancyPeriod: vacancy.vacancyPeriod ?? null,
    selectionPeriod: vacancy.selectionPeriod ?? null,
    categories: asArray(vacancy.categories).map(simpleCategory),
    tags: asArray(vacancy.tags).map(simpleTag),
    requirements: asArray(vacancy.requirements),
    previewRequirements: vacancy.previewRequirements ?? [],
    conditions: asArray(vacancy.conditions),
    tasks: asArray(vacancy.tasks),
    requestFields: asArray(vacancy.requestFields).map(({ id, title }) => ({ id, title })),
    imageFile: vacancy.imageFile ?? null,
    acceptedCount: vacancy.acceptedCount ?? null,
    requestSubmittedCount: vacancy.requestSubmittedCount ?? null,
    volunteerCount: vacancy.volunteerCount ?? null,
    openCount: vacancy.openCount ?? null,
    acceptedPercent: vacancy.acceptedPercent ?? null,
    maxHours: vacancy.maxHours ?? null,
    recruitmentInProgress: vacancy.recruitmentInProgress ?? false,
    started: vacancy.started ?? false,
    archive: vacancy.archive ?? false,
    hidden: vacancy.hidden ?? false,
    deleted: vacancy.deleted ?? false,
    quickVisit: vacancy.quickVisit ?? false,
    createdAt: vacancy.createdAt ?? null,
    updatedAt: vacancy.updatedAt ?? null,
  };
}

function normalizeEvent(event, vacancies, sourceUrl) {
  return {
    id: String(event.id),
    sourceUrl,
    name: event.name,
    slug: event.slug ?? null,
    status: event.status ?? null,
    statusTitle: event.statusTitle ?? null,
    statusClass: event.statusClass ?? null,
    description: { html: event.description ?? "", text: textFromHtml(event.description) },
    online: Boolean(event.online),
    format: event.online ? "online" : "offline",
    categories: asArray(event.categories).map(simpleCategory),
    tags: asArray(event.tags).map(simpleTag),
    eventPeriod: event.eventPeriod ?? null,
    selectionPeriod: event.selectionPeriod ?? null,
    location: event.location ?? null,
    howToGetTo: event.howToGetTo ?? null,
    organizer: simpleOrganizer(event.organizer),
    imageFile: simpleImage(event.imageFile),
    photos: asArray(event.photos).map(simpleImage),
    videos: asArray(event.videos),
    embedVideos: asArray(event.embedVideos),
    socialMedia: event.socialMedia ?? null,
    project: event.project ?? null,
    languages: asArray(event.languages),
    hasInternationalSignLanguage: event.hasInternationalSignLanguage ?? false,
    large: event.large ?? false,
    federal: event.federal ?? false,
    myVmeste: event.myVmeste ?? false,
    privateSelection: event.privateSelection ?? false,
    recruitmentInProgress: event.recruitmentInProgress ?? false,
    hasVacancies: event.hasVacancies ?? false,
    hasParticipants: event.hasParticipants ?? false,
    totalVacanciesCount: event.totalVacanciesCount ?? vacancies.length,
    acceptedVacanciesCount: event.acceptedVacanciesCount ?? null,
    createdAt: event.createdAt ?? null,
    updatedAt: event.updatedAt ?? null,
    vacancies: vacancies.map(normalizeVacancy),
  };
}

function uniqueBy(items, key) {
  return [...new Map(items.filter(Boolean).map((item) => [key(item), item])).values()];
}

function eventSummary(event) {
  const vacancies = event.vacancies;
  const categories = uniqueBy(
    [...event.categories, ...vacancies.flatMap((vacancy) => vacancy.categories)],
    (item) => String(item.id ?? item.title),
  );
  const tags = uniqueBy(
    [...event.tags, ...vacancies.flatMap((vacancy) => vacancy.tags)],
    (item) => String(item.id ?? item.name),
  );
  const conditions = uniqueBy(
    vacancies.flatMap((vacancy) => vacancy.conditions),
    (item) => String(item?.id ?? item?.title ?? item),
  );
  const requirements = vacancies.flatMap((vacancy) => {
    const preview = Array.isArray(vacancy.previewRequirements)
      ? vacancy.previewRequirements
      : Object.values(vacancy.previewRequirements ?? {});
    return [...(vacancy.requirements ?? []), ...preview];
  });
  const requirementTitles = uniqueBy(
    requirements.map((item) => typeof item === "string" ? item : item?.title).filter(Boolean),
    String,
  );
  return {
    id: event.id,
    name: event.name,
    sourceUrl: event.sourceUrl,
    format: event.format,
    categories: categories.map((item) => item.title),
    systemTags: tags.map((item) => item.name),
    conditions: conditions.map((item) => item?.title ?? item).filter(Boolean),
    requirements: requirementTitles,
    vacancyCount: vacancies.length,
  };
}

function coverage(events) {
  const checks = {
    categories: (event) => event.summary.categories.length > 0,
    systemTags: (event) => event.summary.systemTags.length > 0,
    conditions: (event) => event.summary.conditions.length > 0,
    requirements: (event) => event.summary.requirements.length > 0,
    location: (event) => Boolean(event.location),
    coordinates: (event) => Number.isFinite(event.location?.x) && Number.isFinite(event.location?.y),
    organizer: (event) => Boolean(event.organizer?.name),
    tasks: (event) => event.vacancies.some((vacancy) => vacancy.tasks.length > 0),
  };
  return Object.fromEntries(Object.entries(checks).map(([field, check]) => {
    const present = events.filter(check).length;
    return [field, { present, missing: events.length - present }];
  }));
}

const limit = readLimit();
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const candidates = catalog.filter((event) => /^https:\/\/dobro\.ru\/event\/\d+\/?$/i.test(event.url));
const events = [];
const skipped = [];
let directories = null;

for (const candidate of candidates) {
  if (events.length >= limit) break;
  try {
    const html = await fetchPage(candidate.url);
    const nextData = parseNextData(html, candidate.url);
    const state = nextData?.props?.pageProps?.initialState;
    const event = state?.eventReducer?.event;
    const vacancies = Array.isArray(state?.eventReducer?.eventVacancies)
      ? state.eventReducer.eventVacancies
      : [];
    if (!event || vacancies.length === 0) {
      skipped.push({ id: candidate.id, reason: "Нет события или вакансий на публичной странице" });
      continue;
    }
    if (!directories) {
      directories = {
        systemTags: asArray(state.searchReducer?.systemTags).map(simpleTag),
        standardConditions: conditionDirectory(state.searchReducer?.conditions),
      };
    }
    const normalized = normalizeEvent(event, vacancies, candidate.url);
    normalized.summary = eventSummary(normalized);
    events.push(normalized);
    console.log(`[${events.length}/${limit}] ${normalized.id} — ${normalized.name} (${vacancies.length} вакансий)`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  } catch (error) {
    skipped.push({ id: candidate.id, reason: error.message });
    console.warn(`[пропуск] ${candidate.id}: ${error.message}`);
  }
}

if (events.length < limit) {
  throw new Error(`Удалось собрать только ${events.length} из ${limit} событий с вакансиями.`);
}

const result = {
  schemaVersion: 1,
  source: "https://dobro.ru",
  collectedAt: new Date().toISOString(),
  requestedCount: limit,
  eventCount: events.length,
  vacancyCount: events.reduce((sum, event) => sum + event.vacancies.length, 0),
  privacyNote: "Отдельный блок контактов координатора не копируется; официальный текст описания сохранён без изменений и может содержать указанные организатором контакты.",
  directories: directories ?? { systemTags: [], standardConditions: [] },
  fieldCoverage: coverage(events),
  summaries: events.map((event) => event.summary),
  events,
  skipped,
};

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`Готово: ${events.length} событий, ${result.vacancyCount} вакансий → ${outputPath}`);
