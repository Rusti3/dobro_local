export const themeIds = [
  "animals", "ecology", "elderly", "children", "city", "creativity", "activity",
  "education", "events", "online_help", "donation", "recycling", "nature", "charity",
];

const traitDimensions = [
  "format_online", "format_offline", "social_solo", "social_group",
  "activity_physical", "activity_communication", "duration_short", "duration_medium",
  "duration_long", "distance_nearby", "distance_far", "schedule_weekend",
];
export const vectorDimensions = [...themeIds.map((id) => `theme_${id}`), ...traitDimensions];
const clamp = (value) => Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
const stableNumber = (value) => [...String(value)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
export const moscowDay = (date = new Date()) => date.toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });

export function eventVector(event) {
  const vector = Object.fromEntries(vectorDimensions.map((dimension) => [dimension, 0]));
  for (const theme of event.themes || [event.theme || event.category]) {
    if (themeIds.includes(theme)) vector[`theme_${theme}`] = theme === event.theme ? 1 : 0.65;
  }
  const annotation = event.annotation;
  const traits = {
    ...(event.traits || {}),
    ...(annotation ? {
      format: annotation.format === "online" ? "online" : "offline",
      social: annotation.feedSignals?.friendsAllowed === "yes"
        ? "group"
        : annotation.participation?.modes?.includes("solo") ? "solo" : event.traits?.social,
      activity: ["moderate", "heavy"].includes(annotation.complexity?.physicalLoad)
        ? "physical" : event.traits?.activity,
      duration: annotation.facts?.exactDurationMinutes !== null && annotation.facts?.exactDurationMinutes <= 120
        ? "short"
        : annotation.complexity?.timeCommitment === "regular" ? "long" : event.traits?.duration,
      weekend: annotation.filterTags?.includes("weekend"),
    } : {}),
  };
  if (traits.format) vector[`format_${traits.format}`] = 1;
  if (traits.social) vector[`social_${traits.social}`] = 1;
  if (traits.activity) vector[`activity_${traits.activity}`] = 1;
  if (traits.duration) vector[`duration_${traits.duration}`] = 1;
  if (traits.distance) vector[`distance_${traits.distance}`] = 1;
  if (traits.weekend) vector.schedule_weekend = 1;
  return vector;
}

export function initialVector(interests = []) {
  const chosen = new Set(interests.filter((id) => themeIds.includes(id)));
  return Object.fromEntries(vectorDimensions.map((dimension) => {
    if (dimension.startsWith("theme_")) return [dimension, chosen.has(dimension.slice(6)) ? 0.6 : 0.12];
    return [dimension, 0.35];
  }));
}

export function applyFeedback(vector, event, action, strength) {
  const result = { ...initialVector(), ...(vector || {}) };
  const direction = strength ?? (action === "like" ? 0.25 : -0.2);
  const embedded = eventVector(event);
  for (const [dimension, weight] of Object.entries(embedded)) {
    if (weight) result[dimension] = clamp((result[dimension] ?? 0.12) + direction * weight);
  }
  return result;
}

export function affinity(vector, event) {
  const embedded = eventVector(event);
  let dot = 0, magnitude = 0;
  for (const dimension of vectorDimensions) {
    dot += (vector?.[dimension] ?? 0) * embedded[dimension];
    magnitude += embedded[dimension];
  }
  return magnitude ? dot / magnitude : 0;
}

const live = (event, now = Date.now()) => Date.parse(event.endsAt) > now;
const recommendable = (event) => !["hidden", "human_review"].includes(event.annotation?.quality?.status);
const editorialScore = (event) => {
  const annotation = event.annotation;
  if (!annotation) return 0;
  const firstTime = (annotation.firstTime?.score ?? 50) / 100;
  const complexity = annotation.complexity?.overall;
  const quality = annotation.quality?.status === "suitable" ? 0.07 : 0.015;
  const ease = complexity === null || complexity === undefined ? 0 : complexity <= 39 ? 0.05 : complexity >= 60 ? -0.05 : 0;
  return quality + firstTime * 0.12 + ease;
};
const ranked = (catalog, vector, seed, excluded = new Set()) => catalog
  .filter((event) => live(event) && recommendable(event) && !excluded.has(event.id))
  .map((event) => ({ event, score: affinity(vector, event) + editorialScore(event) + (stableNumber(`${seed}:${event.id}`) % 1000) / 100000 }))
  .sort((a, b) => b.score - a.score);

function takeDiverse(pool, count, used, output, reason) {
  while (output.length < count) {
    const themes = new Set(output.map((item) => item.theme));
    const next = pool.find(({ event }) => !used.has(event.id) && !themes.has(event.theme))
      || pool.find(({ event }) => !used.has(event.id));
    if (!next) break;
    used.add(next.event.id);
    output.push({ id: next.event.id, reason, theme: next.event.theme });
  }
}

export function calibrationBatch(catalog, vector, interests, userId, target = 12) {
  const selected = new Set(interests);
  const seed = `calibration:${userId}:${interests.join(",")}`;
  const pool = ranked(catalog, vector, seed);
  const used = new Set(), output = [];
  takeDiverse(pool.filter(({ event }) => selected.has(event.theme)), Math.min(5, target), used, output, "По твоим интересам");
  takeDiverse(pool.filter(({ event }) => !selected.has(event.theme) && event.themes?.some((theme) => selected.has(theme))), Math.min(8, target), used, output, "Соседняя тема");
  takeDiverse(pool.filter(({ event }) => event.traits?.format === "online" || event.traits?.duration === "short"), Math.min(10, target), used, output, "Другой формат");
  takeDiverse([...pool].reverse(), Math.min(11, target), used, output, "Неожиданный вариант");
  takeDiverse(pool, target, used, output, "Для точности");
  return output.slice(0, target);
}

export function resetRecommendation(user, catalog, interests) {
  const vector = initialVector(interests);
  user.profile = { ...user.profile, interests };
  user.interestOnboarded = true;
  user.onboarded = false;
  user.recommendation = {
    version: 1,
    vector,
    interactions: [],
    calibration: calibrationBatch(catalog, vector, interests, user.id, 12),
    days: {},
  };
  return user;
}

function ensureModel(user, catalog) {
  const interests = (user.profile?.interests || []).filter((id) => themeIds.includes(id));
  if (!user.recommendation) {
    const vector = initialVector(interests);
    user.recommendation = { version: 1, vector, interactions: [], calibration: calibrationBatch(catalog, vector, interests, user.id, 12), days: {} };
  }
  user.recommendation.interactions ||= [];
  user.recommendation.days ||= {};
  return user.recommendation;
}

function dailyBatch(user, catalog, day) {
  const model = ensureModel(user, catalog);
  if (!model.days[day]) {
    const seen = new Set(model.interactions.slice(-120).map((item) => item.eventId));
    let pool = ranked(catalog, model.vector, `${user.id}:${day}`, seen);
    if (pool.length < 4) pool = ranked(catalog, model.vector, `${user.id}:${day}`);
    const ids = [], themes = new Set();
    for (const { event } of pool) {
      if (ids.length >= 4) break;
      if (themes.has(event.theme) && pool.length > 6) continue;
      ids.push(event.id); themes.add(event.theme);
    }
    for (const { event } of pool) if (ids.length < 4 && !ids.includes(event.id)) ids.push(event.id);
    model.days[day] = { ids, feedback: [] };
    for (const oldDay of Object.keys(model.days).sort().slice(0, -14)) delete model.days[oldDay];
  }
  return model.days[day];
}

function topEvents(catalog, vector, predicate, seed, limit = 6) {
  return ranked(catalog.filter(predicate), vector, seed).slice(0, limit).map(({ event }) => event.id);
}

export function recommendationView(user, catalog, day = moscowDay()) {
  const interests = (user.profile?.interests || []).filter((id) => themeIds.includes(id));
  if (!user.interestOnboarded || interests.length < 5) return { stage: "interests", minimumInterests: 5 };
  const model = ensureModel(user, catalog);
  const calibrationFeedback = model.interactions.filter((item) => item.context === "calibration");
  if (!user.onboarded || calibrationFeedback.length < model.calibration.length) {
    return { stage: "calibration", target: model.calibration.length, completed: calibrationFeedback.length, items: model.calibration };
  }
  const daily = dailyBatch(user, catalog, day);
  const responded = new Set(daily.feedback.map((item) => item.eventId));
  const allSeen = new Set(model.interactions.map((item) => item.eventId));
  const sections = [
    { id: "first_time", title: "Хорошо для первого раза", subtitle: "Понятные задачи и мягкий вход", eventIds: topEvents(catalog, model.vector, (event) => event.annotation?.filterTags?.includes("first_time"), `${user.id}:${day}:first-time`) },
    { id: "nearby", title: "Рядом с тобой", subtitle: "Москва и понятный первый шаг", eventIds: topEvents(catalog, model.vector, (event) => event.traits?.distance === "nearby", `${user.id}:${day}:nearby`) },
    { id: "weekend", title: "На выходные", subtitle: "Дата действительно выпадает на выходной", eventIds: topEvents(catalog, model.vector, (event) => event.annotation?.filterTags?.includes("weekend"), `${user.id}:${day}:weekend`) },
    { id: "friends", title: "Можно пойти с друзьями", subtitle: "Совместное участие подтверждено", eventIds: topEvents(catalog, model.vector, (event) => event.annotation?.filterTags?.includes("friends"), `${user.id}:${day}:friends`) },
    { id: "short", title: "На час-два", subtitle: "Короткая длительность указана в источнике", eventIds: topEvents(catalog, model.vector, (event) => event.annotation?.filterTags?.includes("short"), `${user.id}:${day}:short`) },
    { id: "remote", title: "Помочь из дома", subtitle: "Есть конкретная удалённая задача", eventIds: topEvents(catalog, model.vector, (event) => event.annotation?.filterTags?.includes("remote") || (!event.annotation && event.traits?.format === "online"), `${user.id}:${day}:remote`) },
    { id: "taste", title: "Похоже, тебе понравится", subtitle: "Собрали по твоим выборам", eventIds: ranked(catalog, model.vector, `${user.id}:${day}:taste`).slice(0, 6).map(({ event }) => event.id) },
    { id: "new", title: "Попробовать что-то новое", subtitle: "Чуть дальше привычных тем", eventIds: ranked(catalog, model.vector, `${user.id}:${day}:new`, allSeen).slice(-6).reverse().map(({ event }) => event.id) },
  ].filter((section) => section.eventIds.length);
  const topTaste = Object.entries(model.vector).filter(([key]) => key.startsWith("theme_")).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return {
    stage: responded.size >= daily.ids.length ? "feed" : "daily",
    daily: { date: day, ids: daily.ids, completed: responded.size, target: daily.ids.length, feedback: daily.feedback },
    sections,
    taste: topTaste.map(([dimension, weight]) => ({ id: dimension.slice(6), weight })),
  };
}

export function recordFeedback(user, catalog, { eventId, action, context }, day = moscowDay()) {
  if (!["like", "skip"].includes(action) || !["calibration", "daily", "plan", "visit"].includes(context)) throw new Error("Некорректная реакция.");
  const event = catalog.find((item) => item.id === String(eventId));
  if (!event || !live(event)) throw new Error("Это дело больше недоступно.");
  const model = ensureModel(user, catalog);
  const key = context === "daily" || context === "visit" ? day : context;
  if (model.interactions.some((item) => item.eventId === event.id && item.key === key)) return user;
  const interaction = { eventId: event.id, action, context, key, at: new Date().toISOString() };
  const strength = context === "plan" ? 0.35 : context === "visit" ? 0.45 : undefined;
  model.vector = applyFeedback(model.vector, event, action, strength);
  model.interactions.push(interaction);
  model.interactions = model.interactions.slice(-300);
  if (context === "daily") dailyBatch(user, catalog, day).feedback.push({ eventId: event.id, action });
  if (context === "calibration" && model.interactions.filter((item) => item.context === "calibration").length >= model.calibration.length) user.onboarded = true;
  return user;
}
