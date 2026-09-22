import fs from "node:fs";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
} from "node:crypto";
import { botReply, eligibleEvents, eventAllowedForUser, maxUser, validateRegistration } from "../server/domain.js";
import { appButton, maxCall } from "../server/max.js";
import { validateHours } from '../server/garden.js';
import { recommendationView, recordFeedback, resetRecommendation, themeIds } from '../server/recommendation.js';

const catalog = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data/catalog.json"), "utf8"),
);
const memory =
  globalThis.__firstStepVercel ||
  (globalThis.__firstStepVercel = {
    users: new Map(),
    plans: new Map(),
    invites: new Map(),
    offset: 0,
  });
const json = (res, status, data) => {
  res.status(status).setHeader("Cache-Control", "no-store").json(data);
};
const fail = (message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const readBody = async (req) => {
  // Vercel can parse JSON before invoking the handler.
  if (req.body !== undefined) {
    if (typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(String(req.body)); } catch { fail('Некорректный JSON.'); }
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16000) fail("Слишком большой запрос.", 413);
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    fail("Некорректный JSON.");
  }
};
function parseCookie(req, name) {
  return (
    req.headers.cookie?.match(
      new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{48})(?:;|$)`),
    )?.[1] || null
  );
}
function verifyInit(raw, token) {
  if (!token?.trim()) fail('На сервере не настроен MAX_BOT_TOKEN. Добавьте его в Vercel и выполните Redeploy.', 503);
  let u;
  try { u = maxUser(raw, token.trim()); } catch(e) { fail(e.message,401); }
  return { id: `max:${u.id}`, name: u.first_name || "Друг", chatId: u.id };
}
function user(req, res) {
  const init = req.headers["x-max-init-data"];
  let u;
  if (init) u = verifyInit(init, process.env.MAX_BOT_TOKEN);
  else if (process.env.DEMO_MODE === "true") {
    let s = parseCookie(req, "first_session");
    if (!s) {
      s = randomBytes(24).toString("hex");
      res.setHeader(
        "Set-Cookie",
        `first_session=${s}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
      );
    }
    const id = `demo:${s}`;
    u = memory.users.get(id) || {
      id,
      name: "Друг",
      profile: { city: "Москва", category: "all", barrier: "company", interests: [], age: null },
      registered: false,
      reminders: false,
      interestOnboarded: false,
      onboarded: false,
    };
  } else fail("Откройте приложение из MAX.", 401);
  const existing = memory.users.get(u.id);
  const complete = {
    reminders:false,
    createdAt:new Date().toISOString(),
    ...existing,
    ...u,
    profile: {city:'Москва',category:'all',barrier:'company',interests:[],age:null,...existing?.profile,...u.profile},
    registered: existing?.registered ?? u.registered ?? false,
  };
  memory.users.set(u.id, complete);
  return complete;
}
function event(id) {
  return catalog.find((e) => e.id === id);
}
function validate(fields, e) {
  if (!e || Date.parse(e.endsAt) < Date.now())
    fail("Событие завершилось. Выберите другое дело.");
  const when = fields.when || null;
  if (
    when &&
    (!Number.isFinite(Date.parse(when)) ||
      Date.parse(when) <= Date.now() ||
      Date.parse(when) < Date.parse(e.startsAt) ||
      Date.parse(when) > Date.parse(e.endsAt))
  )
    fail("Выберите будущую дату в периоде события.");
  return {
    when,
    meeting: String(fields.meeting || "")
      .trim()
      .slice(0, 240),
    mode: ["friend", "solo"].includes(fields.mode) ? fields.mode : "friend",
    confirmed: !!fields.confirmed,
  };
}
function safePlan(p, u) {
  const e = event(p.eventId);
  return {
    ...p,
    owner: p.owner === u.id ? p.owner : null,
    members: p.members.map(({ name }) => ({ name })),
    event: e,
  };
}
function plansFor(u) {
  return [...memory.plans.values()]
    .filter((p) => p.owner === u.id || p.members.some((m) => m.id === u.id))
    .map((p) => safePlan(p, u));
}
async function webhook(req, res) {
  if (req.method !== "POST")
    return json(res, 405, { error: "Метод не поддерживается." });
  const token = process.env.MAX_BOT_TOKEN?.trim();
  if(!token) fail('На сервере не настроен MAX_BOT_TOKEN.',503);
  const secret = process.env.MAX_WEBHOOK_SECRET?.trim();
  if (!secret || req.headers["x-max-bot-api-secret"] !== secret)
    return json(res, 403, { error: "Forbidden" });
  const update = await readBody(req);
  const message = update.message || (update.update_type === "bot_started" && update.user
    ? { sender: update.user, recipient: { user_id: update.user.user_id } }
    : null);
  const sender = message?.sender;
  if (sender?.user_id != null && !sender.is_bot) {
    const recipient = message.recipient || {};
    const destination = recipient.chat_id != null
      ? { kind: "chat_id", id: recipient.chat_id }
      : { kind: "user_id", id: sender.user_id };
    const id = `max:${sender.user_id}`;
    const u = memory.users.get(id) || {
      id,
      name: sender.first_name || "Друг",
      profile: { city: "Москва", category: "all", barrier: "company", interests: [] },
      reminders: false,
      chatId: destination.id,
    };
    u.chatId = destination.id;
    memory.users.set(id, u);
    const text = message.body?.text || "";
    const cmd = text.split(/[ @]/)[0];
    let reply = botReply(text, u.name),
      payload = "";
    const appUrl = process.env.MAX_MINI_APP_URL?.trim().replace(/\/+$/, '') || "";
    const botUsername = process.env.MAX_BOT_USERNAME?.trim().replace(/^@/, '') || "";
    if(!appUrl.startsWith('https://')) fail('Настройте HTTPS MAX_MINI_APP_URL в Vercel.',503);
    if (cmd === "/plan") {
      const p = plansFor(u).find(
        (p) => !["cancelled", "done"].includes(p.status),
      );
      reply = p
        ? `Твой план: ${p.event.short}. ${p.when ? "Дата: " + new Date(p.when).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : "Дата пока не согласована"}.`
        : "Пока нет активного плана.";
      payload = "tab_plan";
    }
    if (cmd === "/stop") {
      u.reminders = false;
      memory.users.set(id, u);
    }
    if (cmd === "/garden") {
      reply = "Твой сад хранит истории добрых дел. Открой его, чтобы увидеть растения и выбрать следующий шаг.";
      payload = "tab_garden";
    }
    if (cmd === "/delete") {
      memory.users.delete(id);
      for (const [pid, p] of memory.plans) {
        if (p.owner === id) memory.plans.delete(pid);
        else p.members = p.members.filter((v) => v.id !== id);
      }
    }
    const invite = text.match(/^\/start(?:@\w+)?[ _]i_([a-f0-9]{36})$/i)?.[1];
    if (invite) payload = `i_${invite}`;
    await maxCall(token, "/messages", {
      method: "POST",
      query: { [destination.kind]: destination.id },
      payload: {
        text: reply,
        attachments: [{
          type: "inline_keyboard",
          payload: { buttons: [[appButton({
            text: invite ? "Открыть приглашение" : "Открыть «хелпи»",
            botUsername,
            appUrl,
            payload,
          })]] },
        }],
      },
    });
  }
  return json(res, 200, { ok: true });
}
export default async function handler(req, res) {
  try {
    const pathname = new URL(req.url, `https://${req.headers.host || "vercel"}`)
      .pathname;
    if (pathname === "/api/max/webhook") return await webhook(req, res);
    if (pathname === "/api/health")
      return json(res, 200, {
        ok: true,
        mode: process.env.DEMO_MODE === "true" ? "demo" : "max",
      });
    const u = user(req, res);
    const method = req.method;
    const body = method === "GET" ? {} : await readBody(req);
    if (pathname === "/api/bootstrap" && method === "GET") {
      const availableCatalog = eligibleEvents(catalog, u);
      const recommendations = u.registered ? recommendationView(u, availableCatalog) : { stage: "registration" };
      memory.users.set(u.id, u);
      return json(res, 200, {
        user: u,
        plans: plansFor(u),
        catalog: availableCatalog,
        recommendations,
        mode: process.env.DEMO_MODE === "true" ? "demo" : "max",
        botUsername: process.env.MAX_BOT_USERNAME || null,
      });
    }
    if (pathname === "/api/profile" && method === "PATCH") {
      if (body.registration) {
        const registration = validateRegistration(body.registration);
        u.name = registration.name;
        u.profile = { ...u.profile, age: registration.age };
        u.registered = true;
        const savedInterests = (u.profile.interests || []).filter((value) => themeIds.includes(value));
        if (savedInterests.length >= 5)
          resetRecommendation(u, eligibleEvents(catalog, u), savedInterests);
        else u.recommendation = null;
      }
      const interests = Array.isArray(body.interests)
        ? [...new Set(body.interests.filter((value) => themeIds.includes(value)))].slice(0, 14)
        : null;
      if (interests && interests.length < 5) fail("Выберите минимум 5 интересов.");
      u.profile = {
        city: "Москва",
        category: ["all", "animals", "people"].includes(body.category)
          ? body.category
          : u.profile.category,
        barrier: ["company", "unknown", "time"].includes(body.barrier)
          ? body.barrier
          : u.profile.barrier,
        interests: interests || (u.profile.interests || []),
        age: u.profile.age ?? null,
      };
      if (interests) {
        if (!u.registered) fail("Сначала закончи регистрацию.", 403);
        resetRecommendation(u, eligibleEvents(catalog, u), interests);
      }
      if (typeof body.reminders === "boolean") u.reminders = body.reminders;
      memory.users.set(u.id, u);
      return json(res, 200, u);
    }
    if (pathname === "/api/recommendations/feedback" && method === "POST") {
      if (!u.registered) fail("Сначала закончи регистрацию.", 403);
      const availableCatalog = eligibleEvents(catalog, u);
      recordFeedback(u, availableCatalog, body);
      memory.users.set(u.id, u);
      return json(res, 200, { user: u, recommendations: recommendationView(u, availableCatalog) });
    }
    if (pathname === "/api/me" && method === "DELETE") {
      memory.users.delete(u.id);
      for (const [id, p] of memory.plans) {
        if (p.owner === u.id) memory.plans.delete(id);
        else p.members = p.members.filter((m) => m.id !== u.id);
      }
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/plans" && method === "POST") {
      if (!u.registered) fail("Сначала закончи регистрацию.", 403);
      const e = event(body.eventId);
      if (e && !eventAllowedForUser(e, u))
        fail("Это событие не подходит по возрастному ограничению.", 403);
      const fields = validate(body, e);
      const old = plansFor(u).find(
        (p) =>
          p.eventId === body.eventId &&
          !["done", "cancelled"].includes(p.status),
      );
      if (old) return json(res, 200, old);
      recordFeedback(u, catalog, { eventId: e.id, action: "like", context: "plan" });
      memory.users.set(u.id, u);
      const p = {
        id: randomUUID(),
        owner: u.id,
        eventId: e.id,
        ...fields,
        status: "draft",
        checks: [],
        members: [],
        createdAt: new Date().toISOString(),
        reflection: null,
      };
      memory.plans.set(p.id, p);
      return json(res, 201, safePlan(p, u));
    }
    const pm = pathname.match(/^\/api\/plans\/([^/]+)(?:\/(invite|leave))?$/);
    if (pm) {
      const p = memory.plans.get(pm[1]);
      if (!p || !(p.owner === u.id || p.members.some((m) => m.id === u.id)))
        fail("План не найден.", 404);
      if (pm[2] === "leave" && method === "POST") {
        if (p.owner === u.id) fail("Владелец может отменить план.");
        p.members = p.members.filter((m) => m.id !== u.id);
        return json(res, 200, { ok: true });
      }
      if (p.owner !== u.id) fail("Изменить план может его автор.", 403);
      if (pm[2] === "invite" && method === "POST") {
        const code = randomBytes(18).toString("hex");
        memory.invites.set(code, {
          plan: p.id,
          expires: Date.now() + 7 * 86400000,
        });
        return json(res, 201, { code });
      }
      if (pm[2] === "invite" && method === "DELETE") {
        for (const [code, i] of memory.invites)
          if (i.plan === p.id) memory.invites.delete(code);
        return json(res, 200, { ok: true });
      }
      if (!pm[2] && method === "PATCH") {
        if (["done", "cancelled"].includes(p.status))
          fail("Этот план уже закрыт.");
        if (body.status === "cancelled") {
          p.status = "cancelled";
        } else if (body.status === "done") {
          if (!p.when || Date.parse(p.when) > Date.now() || !p.confirmed)
            fail("Отметить визит можно после согласованной даты.");
          if (!["warm", "okay", "hard"].includes(body.reflection))
            fail("Выберите, как прошёл визит.");
          p.hours = validateHours(body.hours);
          p.status = "done";
          p.reflection = body.reflection;
          p.completedAt = new Date().toISOString();
          recordFeedback(u, catalog, { eventId: p.eventId, action: "like", context: "visit" });
          memory.users.set(u.id, u);
        } else {
          Object.assign(p, validate({ ...p, ...body }, event(p.eventId)));
          if (body.checks)
            p.checks = [...new Set(body.checks)].filter((x) =>
              ["contact", "route", "bag"].includes(x),
            );
          p.status = p.confirmed && p.when ? "ready" : "draft";
          if(p.status === 'ready' && !p.agreedAt) p.agreedAt = new Date().toISOString();
        }
        return json(res, 200, safePlan(p, u));
      }
    }
    const im = pathname.match(/^\/api\/invites\/([a-f0-9]{36})$/);
    if (im) {
      const i = memory.invites.get(im[1]),
        p = i && memory.plans.get(i.plan);
      if (
        !p ||
        i.expires < Date.now() ||
        ["done", "cancelled"].includes(p.status)
      )
        fail("Приглашение истекло или отозвано.", 410);
      if (method === "GET")
        return json(res, 200, {
          event: event(p.eventId),
          when: p.when,
          confirmed: p.confirmed,
          ownerName: memory.users.get(p.owner)?.name || "Друг",
          joined: p.owner === u.id || p.members.some((m) => m.id === u.id),
        });
      if (method === "POST") {
        if (!u.registered) fail("Сначала закончи регистрацию.", 403);
        const invitedEvent = event(p.eventId);
        if (invitedEvent && !eventAllowedForUser(invitedEvent, u))
          fail("Это событие не подходит по возрастному ограничению.", 403);
        if (p.owner !== u.id && !p.members.some((m) => m.id === u.id)) {
          if (p.members.length >= 3) fail("Компания уже собралась.");
          p.members.push({ id: u.id, name: u.name });
        }
        return json(res, 200, safePlan(p, u));
      }
    }
    fail("Не найдено.", 404);
  } catch (e) {
    return json(res, e.status || 400, {
      error: e.message || "Ошибка сервера.",
    });
  }
}
