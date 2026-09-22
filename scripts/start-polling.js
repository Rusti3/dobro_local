import { spawn } from "node:child_process";
import { maxCall } from "../server/max.js";

const token = process.env.MAX_BOT_TOKEN?.trim();
const webhookUrl = process.env.MAX_WEBHOOK_URL?.trim().replace(/\/+$/, "");
if (!token) throw new Error("Укажите MAX_BOT_TOKEN в .env.");

// MAX does not allow Webhook and Long Polling simultaneously. Remove the
// configured subscription before starting the local process.
if (webhookUrl) {
  try {
    await maxCall(token, "/subscriptions", { method: "DELETE", query: { url: webhookUrl } });
    console.log(`MAX Webhook отключён: ${webhookUrl}`);
  } catch (error) {
    if (!/404|not found/i.test(error.message)) throw error;
    console.log("Активная MAX Webhook-подписка не найдена.");
  }
}

const child = spawn(process.execPath, ["--env-file-if-exists=.env", "server/index.js"], {
  stdio: "inherit",
  env: { ...process.env, MAX_WEBHOOK_URL: "", MAX_POLLING: "true" },
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
