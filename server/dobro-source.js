import { createHash } from "node:crypto";

const statuses = [300, 500];
const eventWith = [
  "organizer", "contact", "category", "tag", "project", "image", "photo",
  "video", "document", "social_media",
].join(",");
const vacancyWith = [
  "event", "category", "tag", "condition", "course", "request_button_type",
  "requests_info", "edit_info", "task", "bookmark",
].join(",");

const themeRules = [
  ["animals", /животн|приют|кошк|собак|питомц|ветеринар/i],
  ["ecology", /эколо|окружающ|чистот|уборк|мусор|отход/i],
  ["elderly", /пожил|пенсион|ветеран|бабуш|дедуш|пансионат/i],
  ["children", /дет(?:и|ей|ям|ский)|реб[её]н|подрост|школьник|сирот/i],
  ["nature", /природ|парк|лес|берег|ре[кч]|дерев|растен|заповед/i],
  ["recycling", /переработ|вторсыр|раздельн|макулат|пластик|утилиз/i],
  ["education", /обуч|образован|наставни|урок|школ|лекци|знани/i],
  ["creativity", /творч|мастер(?:-класс|ск)|театр|концерт|музык|рисов|фото|медиа|танц|искусств|выставк/i],
  ["activity", /спорт|забег|марафон|трениров|поход|дайвинг|велосипед/i],
  ["events", /мероприяти|фестивал|форум|конференц|акци[яи]|волонт[её]р на/i],
  ["online_help", /онлайн|дистанцион|удал[её]н|социальн.{0,10}сет|smm|дизайн|it\b/i],
  ["donation", /донор|кров/i],
  ["city", /город|район|общественн|транспорт|благоустр/i],
  ["charity", /помощ|поддерж|благотвор|гуманитар|социальн|сво/i],
];
const gardenTheme = {
  animals: "animals", ecology: "ecology", elderly: "elderly", children: "education",
  education: "education", donation: "donation", recycling: "ecology", nature: "ecology",
  city: "neighborhood", events: "neighborhood", creativity: "people", activity: "people",
  online_help: "people", charity: "people",
};

export const hashJson = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const unique = (values) => [...new Set(values.filter(Boolean))];
const asArray = (value) => Array.isArray(value)
  ? value
  : Array.isArray(value?.data)
    ? value.data
    : value && typeof value === "object"
      ? [value]
      : [];
const clean = (value = "") => String(value)
  .replace(/<br\s*\/?>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, " ")
  .trim();

const firstSentence = (value) => {
  const text = clean(value);
  const sentence = text.match(/^.{45,190}?[.!?](?:\s|$)/)?.[0] || text.slice(0, 180);
  return sentence ? sentence.trim().replace(/[.!?]+$/, "") + "." : "Описание задачи уточнит организатор.";
};
const collection = (value) => Array.isArray(value) ? value
  : Array.isArray(value?.data) ? value.data
    : Array.isArray(value?.["hydra:member"]) ? value["hydra:member"] : [];
const eventIdFromSearch = (row) => String(row?.event?.id ?? row?.event?.match?.(/\/events\/(\d+)/)?.[1] ?? row?.url?.match(/\/event\/(\d+)/)?.[1] ?? "");
const period = (value) => ({
  start: value?.startDate || value?.fromDate || null,
  end: value?.endDate || value?.toDate || null,
});
const ageFromVacancy = (vacancy) => {
  const ages = [...asArray(vacancy?.requirements), ...asArray(vacancy?.previewRequirements)]
    .map((item) => String(item?.title || "").match(/^\s*(\d{1,2})\+\s*$/)?.[1])
    .filter(Boolean)
    .map(Number);
  return ages.length ? Math.max(...ages) : null;
};

const optionalCoordinate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const coordinatesFromLocation = (location = {}) => {
  const lat = optionalCoordinate(location.y);
  const lng = optionalCoordinate(location.x);
  const valid = lat !== null
    && lng !== null
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180
    && !(lat === 0 && lng === 0);
  return valid ? { lat, lng } : { lat: null, lng: null };
};

function themesFor(event, vacancies) {
  const categoryText = [...asArray(event.categories), ...vacancies.flatMap((vacancy) => asArray(vacancy.categories))]
    .map((item) => item?.title).join(" ");
  const text = `${clean(event.name)} ${clean(event.description)} ${categoryText}`;
  const found = themeRules.filter(([, rule]) => rule.test(text)).map(([id]) => id);
  return unique(found.length ? found : ["charity"]).slice(0, 4);
}

function traitsFor(event, vacancies, startsAt) {
  const text = `${clean(event.name)} ${clean(event.description)} ${vacancies.map((item) => clean(item.description)).join(" ")}`;
  const online = event.online === true || vacancies.some((item) => item.online === true) || /онлайн|дистанцион|удал[её]н/i.test(text);
  const physical = /уборк|достав|погруз|перенос|выгул|спорт|забег|поход|ремонт|строит/i.test(text);
  const group = /команд|вместе|групп|мероприяти|фестивал|форум|акци[яи]/i.test(text);
  const short = /1 час|один час|часа? времени|60 минут|коротк/i.test(text);
  const long = /регуляр|системн|еженедель|постоянн|долгосроч/i.test(text);
  const far = /выезд|друг(?:ой|ие) регион|командиров/i.test(text);
  const parsedStart = startsAt ? new Date(startsAt) : null;
  const weekend = /выходн|суббот|воскресен/i.test(text) || (parsedStart && [0, 6].includes(parsedStart.getUTCDay()));
  return { format: online ? "online" : "offline", social: group ? "group" : "solo", activity: physical ? "physical" : "communication", duration: short ? "short" : long ? "long" : "medium", distance: far ? "far" : "nearby", weekend: Boolean(weekend) };
}

export function sourceToCatalog(event, vacancies, matchedCities = []) {
  const activeVacancies = vacancies.filter((item) => !item.deleted && !item.hidden && !item.archive);
  const periods = activeVacancies.map((item) => period(item.vacancyPeriod)).filter((item) => item.start || item.end);
  const eventPeriod = period(event.eventPeriod);
  const startsAt = periods.map((item) => item.start).filter(Boolean).sort()[0] || eventPeriod.start;
  const endsAt = periods.map((item) => item.end).filter(Boolean).sort().at(-1) || eventPeriod.end;
  const location = activeVacancies.find((item) => item.location)?.location || event.location || {};
  const coordinates = coordinatesFromLocation(location);
  const themes = themesFor(event, activeVacancies);
  const primary = themes[0];
  const ages = activeVacancies.map(ageFromVacancy).filter((value) => value !== null);
  const sourceUrl = `https://dobro.ru/event/${event.id}`;
  return {
    id: String(event.id),
    title: clean(event.name || activeVacancies[0]?.name || "Доброе дело"),
    category: primary === "animals" ? "animals" : "people",
    theme: primary,
    themes,
    traits: traitsFor(event, activeVacancies, startsAt),
    gardenCategory: gardenTheme[primary] || "people",
    short: clean(event.name || "Доброе дело").slice(0, 78),
    intro: firstSentence(event.description || activeVacancies[0]?.description),
    support: event.online || activeVacancies.some((item) => item.online) ? "Можно помогать онлайн" : "Условия уточнит координатор",
    why: "Формат и доступные задачи указаны организатором в исходной карточке.",
    first: "Открыть карточку ДОБРО и уточнить у организатора ближайшую задачу для новичка.",
    city: location.settlement || location.shortName || matchedCities[0] || "Москва",
    address: location.title || null,
    lat: coordinates.lat,
    lng: coordinates.lng,
    startsAt,
    endsAt,
    description: clean(event.description || activeVacancies.map((item) => item.description).join(" ")),
    url: sourceUrl,
    image: event.imageFile?.url || event.photos?.[0]?.url || null,
    source: "ДОБРО",
    snapshot: new Date().toISOString().slice(0, 10),
    timezone: location.timezone || "Europe/Moscow",
    age: ages.length ? String(Math.min(...ages)) : null,
    annotation: null,
  };
}

export function dobroCities(value = process.env.CATALOG_CITIES || "Москва") {
  return unique(String(value).split(",").map((item) => item.trim())).map((name) => ({ name, settlement: name }));
}

export function createDobroClient(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = (options.baseUrl || process.env.DOBRO_API_URL || "https://dobro.ru/api/v2").replace(/\/$/, "");
  const pageSize = Number.parseInt(options.pageSize || process.env.DOBRO_PAGE_SIZE || "100", 10);

  async function fetchJson(url) {
    let lastError;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          headers: { Accept: "application/vnd.meta+json, application/json", "User-Agent": "dobrie-dela-max/2.0 catalog sync" },
          redirect: "follow",
          signal: AbortSignal.timeout(40_000),
        });
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get("retry-after"));
          await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(15_000, 700 * 2 ** (attempt - 1)));
          continue;
        }
        if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} ${response.statusText}`), { status: response.status });
        return await response.json();
      } catch (error) {
        lastError = error;
        if (error.status >= 400 && error.status < 500 && error.status !== 429) break;
        if (attempt < 6) await wait(Math.min(12_000, 500 * 2 ** (attempt - 1)));
      }
    }
    throw new Error(`${url}: ${lastError?.message || "download failed"}`);
  }

  return {
    async searchCity(city) {
      const rows = [];
      let lastPage = 1;
      for (let page = 1; page <= lastPage; page += 1) {
        const url = new URL(`${baseUrl}/vacancies/search`);
        url.searchParams.set("location[settlement]", city.settlement);
        url.searchParams.set("limit", String(pageSize));
        url.searchParams.set("page", String(page));
        for (const status of statuses) url.searchParams.append("status[]", String(status));
        const response = await fetchJson(url);
        if (!response?.meta || !Array.isArray(response.data)) throw new Error(`Unexpected search response for ${city.name}`);
        lastPage = Number(response.meta.lastPage || 1);
        rows.push(...response.data);
      }
      return { city, rows, eventIds: unique(rows.map(eventIdFromSearch)), vacancyIds: unique(rows.map((row) => String(row.id || ""))) };
    },

    async event(eventId) {
      const url = new URL(`${baseUrl}/events/${eventId}`);
      url.searchParams.set("with", eventWith);
      return fetchJson(url);
    },

    async vacancies(eventId) {
      const url = new URL(`${baseUrl}/vacancies`);
      url.searchParams.set("event", String(eventId));
      url.searchParams.set("with", vacancyWith);
      return collection(await fetchJson(url));
    },
  };
}
