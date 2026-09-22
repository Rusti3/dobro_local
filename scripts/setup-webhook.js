import { maxCall } from "../server/max.js";

const token = process.env.MAX_BOT_TOKEN?.trim();
const url = process.env.MAX_WEBHOOK_URL?.trim().replace(/\/+$/, "");
const secret = process.env.MAX_WEBHOOK_SECRET?.trim();
if (!token || !url?.startsWith("https://") || !secret)
  throw new Error("Укажите MAX_BOT_TOKEN, HTTPS MAX_WEBHOOK_URL и MAX_WEBHOOK_SECRET в .env.");
try { await maxCall(token, "/subscriptions", { method: "DELETE", query: { url } }); } catch (error) {
  if (!/404|not found/i.test(error.message)) throw error;
}
const result = await maxCall(token, "/subscriptions", {
  method: "POST",
  payload: { url, update_types: ["message_created", "bot_started"], secret },
});
console.log(JSON.stringify({ ok: true, url, update_types: result.update_types || ["message_created", "bot_started"] }, null, 2));
