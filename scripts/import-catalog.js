import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.resolve(root, "../afisha-2026-09-09-delivery");
const snapshotNow = Date.parse("2026-09-19T00:00:00.000Z");
const limit = 56;

const themeRules = [
  ["animals", /животн|приют|кошк|кото(?:кафе|простран)|собак|питомц|ветеринар/i],
  ["ecology", /эколо|окружающ|чистот|уборк|мусор|отход/i],
  ["elderly", /пожил|пенсион|ветеран|бабуш|дедуш|пансионат/i],
  ["children", /дет(?:и|ей|ям|ский)|реб[её]н|подрост|школьник|сирот/i],
  ["nature", /природ|парк|лес|берег|ре[кч]|дерев|растен|заповед/i],
  ["recycling", /переработ|вторсыр|раздельн|макулат|пластик|утилиз/i],
  ["education", /обуч|образован|наставни|урок|школ|лекци|знани/i],
  ["creativity", /творч|мастер(?:-класс|ск)|театр|концерт|музык|рисов|живопис|фото|медиа|танц|искусств|выставк/i],
  ["activity", /спорт|забег|марафон|трениров|поход|дайвинг|велосипед/i],
  ["events", /мероприяти|фестивал|форум|конференц|акци[яи]|волонт[её]р на/i],
  ["online_help", /онлайн|дистанцион|удал[её]н|социальн.{0,10}сет|smm|дизайн|it\b/i],
  ["donation", /донор|кров/i],
  ["city", /город|район|общественн|транспорт|благоустр/i],
  ["charity", /помощ|поддерж|благотвор|гуманитар/i],
];

const gardenTheme = {
  animals: "animals", ecology: "ecology", elderly: "elderly",
  children: "education", education: "education", donation: "donation",
  recycling: "ecology", nature: "ecology", city: "neighborhood",
  events: "neighborhood", creativity: "people", activity: "people",
  online_help: "people", charity: "people",
};

const curated = {
  "11597695": { theme: "animals", short: "Помочь кошкам найти дом", intro: "Покормить кошек, позаботиться о пространстве и помочь сотрудникам «Котеешной».", support: "Есть вводный инструктаж", why: "В описании указаны инструктаж и сопровождение координатора.", first: "Уточнить у координатора ближайшую смену, её длительность и требования к новичкам." },
  "11521651": { theme: "elderly", short: "В гости с четвероногим другом", intro: "Прийти со своей собакой в пансионат и подарить пожилым людям немного общения.", support: "По договорённости", why: "Можно согласовать удобную площадку и дату.", first: "Написать организатору, выбрать пансионат и отправить фотографию питомца." },
  "11675000": { theme: "creativity", short: "Творить вместе в мастерской", intro: "Керамика, кулинария и другие занятия вместе с людьми с ментальными особенностями.", support: "Сначала вводная встреча", why: "Организатор предлагает вводную встречу и подбор комфортного формата.", first: "Заполнить анкету и договориться о вводной встрече." },
  "11013932": { theme: "animals", short: "Поддержать животных в приюте", intro: "Помочь с кормом, прогулками или рассказать о потребностях приютов.", support: "Можно выбрать формат", why: "В источнике перечислены разные способы помощи.", first: "Уточнить конкретный приют, задачи для новичков и правила посещения." },
  "11780208": { theme: "animals", short: "Счастливый день в приюте", intro: "Прогуляться с собаками, пообщаться с животными или помочь по хозяйству.", support: "Визит нужно согласовать", why: "В источнике можно выбрать удобный день.", first: "Оставить заявку на ДОБРО, выбрать приют и согласовать посещение." },
};

const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();
const firstSentence = (value) => {
  const text = clean(value);
  const sentence = text.match(/^.{50,190}?[.!?](?:\s|$)/)?.[0] || text.slice(0, 180);
  return sentence.trim().replace(/[.!?]+$/, "") + (sentence ? "." : "");
};
const themesFor = (row) => {
  const title = clean(row.title), description = clean(row.description);
  const found = themeRules.map(([id, rule], index) => ({ id, index, score: (rule.test(title) ? 3 : 0) + (rule.test(description) ? 1 : 0) }))
    .filter((item) => item.score).sort((a, b) => b.score - a.score || a.index - b.index).map((item) => item.id);
  const forced = curated[row.externalId]?.theme;
  if (forced) found.unshift(forced);
  return [...new Set(found.length ? found : ["charity"])].slice(0, 4);
};
const traitsFor = (row) => {
  const text = `${row.title} ${row.description}`.toLowerCase();
  const online = /онлайн|дистанцион|удал[её]н|социальн.{0,10}сет|smm|дизайн|it\b/i.test(text);
  const physical = /уборк|достав|погруз|перенос|выгул|спорт|забег|поход|ремонт|строит/i.test(text);
  const group = /команд|вместе|групп|мероприяти|фестивал|форум|акци[яи]/i.test(text);
  const short = /1 час|один час|часа? времени|60 минут|коротк/i.test(text);
  const long = /регуляр|системн|еженедель|постоянн|долгосроч/i.test(text);
  const far = /выезд|новые территории|друг(?:ой|ие) регион|командиров/i.test(text);
  const weekend = /выходн|суббот|воскресен/i.test(text) || [0, 6].includes(new Date(row.startsAt).getUTCDay());
  return { format: online ? "online" : "offline", social: group ? "group" : "solo", activity: physical ? "physical" : "communication", duration: short ? "short" : long ? "long" : "medium", distance: far ? "far" : "nearby", weekend };
};

const rows = fs.readFileSync(path.join(source, "events.jsonl"), "utf8")
  .trim().split(/\r?\n/).map(JSON.parse)
  .filter((row) => row.source === "dobro" && row.city === "Москва" && Date.parse(row.endsAt) > snapshotNow);
const unique = new Map();
for (const row of rows) {
  const key = clean(row.title).toLocaleLowerCase("ru-RU");
  if (!unique.has(key) || (!unique.get(key).imageFile && row.imageFile)) unique.set(key, row);
}
const buckets = new Map(themeRules.map(([theme]) => [theme, []]));
for (const row of unique.values()) {
  row._themes = themesFor(row);
  row._traits = traitsFor(row);
  buckets.get(row._themes[0])?.push(row);
}
for (const bucket of buckets.values()) bucket.sort((a, b) => Number(!!b.imageFile) - Number(!!a.imageFile) || Date.parse(b.sourceUpdatedAt) - Date.parse(a.sourceUpdatedAt));
const selected = [], selectedIds = new Set();
for (const id of Object.keys(curated)) {
  const row = [...unique.values()].find((item) => item.externalId === id);
  if (row) { selected.push(row); selectedIds.add(row.externalId); }
}
while (selected.length < limit) {
  let added = false;
  for (const bucket of buckets.values()) {
    const row = bucket.find((item) => !selectedIds.has(item.externalId));
    if (row) { selected.push(row); selectedIds.add(row.externalId); added = true; }
    if (selected.length >= limit) break;
  }
  if (!added) break;
}

fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.mkdirSync(path.join(root, "public/images"), { recursive: true });
const events = selected.map((row) => {
  let image = null;
  if (row.imageFile && fs.existsSync(path.join(source, row.imageFile))) {
    const ext = path.extname(row.imageFile);
    image = `/images/${row.externalId}${ext}`;
    fs.copyFileSync(path.join(source, row.imageFile), path.join(root, "public", image));
  }
  const primary = row._themes[0];
  const overrides = curated[row.externalId] || {};
  return {
    id: row.externalId, title: clean(row.title), category: primary === "animals" ? "animals" : "people",
    theme: primary, themes: row._themes, traits: row._traits, gardenCategory: gardenTheme[primary],
    short: overrides.short || clean(row.title).slice(0, 78), intro: overrides.intro || firstSentence(row.description),
    support: overrides.support || (row._traits.format === "online" ? "Можно помогать онлайн" : "Условия уточнит координатор"),
    why: overrides.why || "Формат и доступные задачи указаны организатором в исходной карточке.",
    first: overrides.first || "Открыть карточку ДОБРО и уточнить у организатора ближайшую задачу для новичка.",
    city: row.city, address: row.address, lat: row.lat, lng: row.lng, startsAt: row.startsAt, endsAt: row.endsAt,
    description: clean(row.description), url: row.sourceUrl, image, source: "ДОБРО", snapshot: "2026-09-09",
    timezone: row.timezone || "Europe/Moscow", age: row.ageRestriction || null,
  };
});
fs.writeFileSync(path.join(root, "data/catalog.json"), JSON.stringify(events, null, 2));
console.log(`Imported ${events.length} diverse active ДОБРО records from ${rows.length} Moscow candidates.`);
