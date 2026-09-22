import fs from "node:fs";
import https from "node:https";
import tls from "node:tls";
import { URL } from "node:url";
import { botReply } from "./domain.js";

export const MAX_API_URL = "https://platform-api2.max.ru";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function caBundle() {
  const file = process.env.MAX_CA_BUNDLE || new URL("../russiantrustedca.pem", import.meta.url);
  try { return [...tls.rootCertificates, fs.readFileSync(file, "utf8")]; } catch { return undefined; }
}

function request(token, path, { method = "GET", query, payload } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(MAX_API_URL + path);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, value);
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const req = https.request(url, {
      method,
      ca: caBundle(),
      timeout: 40000,
      headers: {
        Accept: "application/json",
        Authorization: token,
        ...(body ? { "Content-Type": "application/json", "Content-Length": body.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try { if (raw) data = JSON.parse(raw); } catch { reject(new Error("MAX API вернул некорректный JSON")); return; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`MAX API HTTP ${res.statusCode}: ${data.message || data.error || raw || res.statusMessage}`));
          return;
        }
        resolve(data);
      });
    });
    req.on("timeout", () => req.destroy(new Error("Таймаут MAX API")));
    req.on("error", (error) => reject(error));
    if (body) req.write(body);
    req.end();
  });
}

export async function maxCall(token, path, options = {}) {
  if (!token?.trim()) throw new Error("MAX_BOT_TOKEN не задан.");
  try { return await request(token.trim(), path, options); }
  catch (error) {
    if (/certificate|unable to verify/i.test(String(error)))
      throw new Error("Не удалось проверить сертификат MAX. Проверьте russiantrustedca.pem или MAX_CA_BUNDLE.");
    throw error;
  }
}

export function updateUser(update) {
  const message = update?.message || {};
  const sender = message.sender || update?.user || {};
  const recipient = message.recipient || {};
  if (sender.is_bot || sender.user_id == null) return null;
  const destination = recipient.chat_id != null
    ? { kind: "chat_id", id: recipient.chat_id }
    : { kind: "user_id", id: sender.user_id };
  return { sender, destination, message };
}

export function appButton({ text, botUsername, appUrl, payload = "" }) {
  if (botUsername) return { type: "open_app", text, web_app: botUsername.replace(/^@/, ""), ...(payload ? { payload } : {}) };
  return { type: "link", text, url: appUrl };
}

export async function sendMessage(token, destination, text, { botUsername, appUrl, payload } = {}) {
  const attachments = appUrl ? [{ type: "inline_keyboard", payload: { buttons: [[appButton({ text: "Открыть «Первый шаг»", botUsername, appUrl, payload })]] } }] : undefined;
  return maxCall(token, "/messages", { method: "POST", query: { [destination.kind]: destination.id }, payload: { text, ...(attachments ? { attachments } : {}) } });
}

function command(text) { return String(text || "").trim().split(/[ @]/)[0].toLowerCase(); }

export function messageReply({ text, name, plan, appUrl, botUsername, invite }) {
  const cmd = command(text);
  let reply = botReply(text, name);
  let payload = invite ? `i_${invite}` : "";
  if (cmd === "/plan") {
    reply = plan
      ? `Твой план: ${plan.event?.short || plan.event?.title || "доброе дело"}. ${plan.when ? "Дата: " + new Date(plan.when).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : "Дата пока не согласована"}.`
      : "Пока нет активного плана.";
    payload = "tab_plan";
  }
  if (cmd === "/garden") payload = "tab_garden";
  if (invite) reply = "Тебя пригласили сделать первый шаг вместе. Посмотри дело и присоединись, если тебе подходит.";
  return { reply, payload, appUrl };
}

export async function startPolling({ token, appUrl, botUsername, store, catalog }) {
  let marker = Number(await store.meta("max_marker") || 0) || null;
  console.log("MAX Long Polling запущен (для разработки; production используйте Webhook).");
  while (true) {
    try {
      const query = { limit: 100, timeout: 30, types: "message_created,bot_started" };
      if (marker != null) query.marker = marker;
      const result = await maxCall(token, "/updates", { query });
      if (result.marker != null) { marker = result.marker; await store.setMeta("max_marker", marker); }
      const currentCatalog = typeof catalog === "function" ? await catalog() : catalog;
      for (const update of result.updates || []) await processUpdate({ token, update, appUrl, botUsername, store, catalog: currentCatalog });
    } catch (error) {
      console.error(`MAX connection failed: ${error.message}. Повтор через 5 секунд.`);
      await pause(5000);
    }
  }
}

export async function processUpdate({ token, update, appUrl, botUsername, store, catalog }) {
  if (update?.update_type === "bot_started" && update.user) {
    update.message = { sender: update.user, recipient: { user_id: update.user.user_id } };
  }
  const parsed = updateUser(update);
  if (!parsed) return;
  const { sender, destination, message } = parsed;
  const id = `max:${sender.user_id}`;
  let user = await store.user(id) || { id, name: sender.first_name || "Друг", profile: { city: "Москва", category: "all", barrier: "company", interests: [] }, reminders: false };
  user.name = sender.first_name || user.name || "Друг";
  user.chatId = destination.id;
  await store.saveUser(user);
  const text = message.body?.text || "";
  const invite = text.match(/^\/start(?:@\w+)?[ _]i_([a-f0-9]{36})$/i)?.[1];
  const plan = (await store.plans()).find((item) => (item.owner === id || item.members.some((member) => member.id === id)) && !["cancelled", "done"].includes(item.status));
  const result = messageReply({ text, name: user.name, plan: plan ? { ...plan, event: catalog.find((event) => event.id === plan.eventId) } : null, appUrl, botUsername, invite });
  if (command(text) === "/stop") { user.reminders = false; await store.saveUser(user); }
  if (command(text) === "/delete") await store.deleteUser(id);
  await sendMessage(token, destination, result.reply, { appUrl, botUsername, payload: result.payload });
}

export async function startReminderLoop({ token, appUrl, botUsername, store, catalog }) {
  setInterval(async () => {
    const currentCatalog = typeof catalog === "function" ? await catalog() : catalog;
    for (const plan of await store.plans()) {
      const user = await store.user(plan.owner);
      const delta = Date.parse(plan.when) - Date.now();
      if (plan.status !== "ready" || !user?.reminders || !user.chatId || plan.reminded || !(delta > 0 && delta <= 86400000)) continue;
      try {
        await sendMessage(token, { kind: "chat_id", id: user.chatId }, `Завтра или сегодня твой первый шаг: ${currentCatalog.find((event) => event.id === plan.eventId)?.title}. Проверь время и место в плане. Если планы поменялись, можно отменить без чувства вины.`, { appUrl, botUsername, payload: "tab_plan" });
        plan.reminded = true; await store.savePlan(plan);
      } catch (error) { console.error(`Reminder delivery failed: ${error.message}`); }
    }
  }, 60000).unref();
}
