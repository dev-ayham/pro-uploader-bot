import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { MTProtoUploader } from "./services/mtproto-uploader";

const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
const apiId = parseInt(process.env.API_ID || "0");
const apiHash = process.env.API_HASH || "";

if (!botToken || !apiId || !apiHash) {
    console.error("Missing environment variables! Please set TELEGRAM_BOT_TOKEN, API_ID, and API_HASH.");
    process.exit(1);
}

const bot = new Bot(botToken);
const uploader = new MTProtoUploader(apiId, apiHash, botToken);

// --- i18n Simulation (Professional UI) ---
const strings = {
    ar: {
        welcome: "👋 أهلاً بك في بوت الرفع الاحترافي!\n\nأرسل لي أي رابط مباشر وسأقوم برفعه لك إلى تيليجرام (يدعم حتى 2 جيجابايت).",
        processing: "⏳ جاري المعالجة... يرجى الانتظار.",
        uploading: (p: number) => `📤 جاري الرفع: ${Math.round(p * 100)}%`,
        success: "✅ تم الرفع بنجاح!",
        error: "❌ حدث خطأ أثناء الرفع. تأكد من أن الرابط مباشر وصحيح.",
        invalid_url: "⚠️ عذراً، هذا الرابط غير صالح."
    }
};

// --- Bot Handlers ---
bot.command("start", (ctx) => ctx.reply(strings.ar.welcome));

bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const urlPattern = /https?:\/\/[^\s]+/;
    const match = text.match(urlPattern);

    if (!match) {
        return ctx.reply(strings.ar.invalid_url);
    }

    const url = match[0];
    const statusMsg = await ctx.reply(strings.ar.processing);

    try {
        await uploader.uploadFromUrl(
            ctx.chat.id, 
            url, 
            `<b>📄 الملف المرفوع:</b>\n<code>${url}</code>`,
            async (progress) => {
                // Update progress every 20% to avoid Telegram rate limits
                if (Math.round(progress * 100) % 20 === 0) {
                    try {
                        await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, strings.ar.uploading(progress));
                    } catch (e) {}
                }
            }
        );

        await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, strings.ar.success);
    } catch (error) {
        await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, strings.ar.error);
    }
});

// --- Web Server (for Railway Health Check) ---
const app = new Hono();
app.get("/", (c) => c.text("Bot is running!"));

const port = parseInt(process.env.PORT || "3000");
serve({ fetch: app.fetch, port });

// Start Bot (Polling for simplicity on Railway, can be Webhook)
bot.start();
console.log(`Bot is running on port ${port}...`);
