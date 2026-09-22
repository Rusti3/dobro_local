import { maxCall } from "../server/max.js";

const token = process.env.MAX_BOT_TOKEN?.trim();
if (!token) throw new Error("Укажите MAX_BOT_TOKEN в .env.");
const info = await maxCall(token, "/me");
console.log(`MAX-бот: ${info.first_name || info.name || "без имени"}`);
console.log(`Username: ${info.username ? "@" + info.username : "не задан"}`);
console.log(`ID: ${info.user_id ?? "неизвестен"}`);
if (process.env.MAX_MINI_APP_URL && !process.env.MAX_MINI_APP_URL.startsWith("https://"))
  throw new Error("MAX_MINI_APP_URL должен начинаться с https://.");
console.log("Токен проверен. Ссылку Mini App укажите в настройках бота MAX.");
console.log("Для production запустите npm run webhook:setup после публикации HTTPS-endpoint.");
