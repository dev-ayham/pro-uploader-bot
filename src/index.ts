import "dotenv/config";
import { Bot } from "grammy";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { MTProtoUploader, UploadProgress } from "./services/mtproto-uploader";
import { shouldUseYtDlp } from "./services/downloader";

const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
const apiId = parseInt(process.env.API_ID || "0", 10);
const apiHash = process.env.API_HASH || "";

if (!botToken || !apiId || !apiHash) {
    console.error(
        "Missing environment variables! Please set TELEGRAM_BOT_TOKEN, API_ID, and API_HASH.",
    );
    process.exit(1);
}

const bot = new Bot(botToken);
const uploader = new MTProtoUploader(apiId, apiHash, botToken);

// --- i18n Simulation (Professional UI) ---
const strings = {
    ar: {
        welcome:
            "👋 أهلاً بك في بوت الرفع الاحترافي!\n\nأرسل لي أي رابط وسأقوم برفعه لك إلى تيليجرام (يدعم حتى 2 جيجابايت).\n\nالمنصات المدعومة:\n• روابط مباشرة (mp4, mkv, pdf, zip...)\n• Instagram / Reels / Stories\n• YouTube / Shorts\n• TikTok\n• Twitter / X\n• Facebook / Reddit / Vimeo / Twitch / SoundCloud",
        processing: "⏳ جاري المعالجة...",
        extracting: "🔍 جاري استخراج الفيديو من المنصة...",
        downloading: (p: number) => `📥 جاري التحميل: ${Math.round(p * 100)}%`,
        uploading: (p: number) => `📤 جاري الرفع إلى تيليجرام: ${Math.round(p * 100)}%`,
        success: "✅ تم الرفع بنجاح!",
        error: "❌ حدث خطأ أثناء الرفع.",
        invalid_url: "⚠️ عذراً، لم أجد رابطاً صالحاً في الرسالة.",
    },
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
    const initialText = shouldUseYtDlp(url)
        ? strings.ar.extracting
        : strings.ar.processing;
    const statusMsg = await ctx.reply(initialText);

    const editStatus = async (text: string, parseMode?: "HTML") => {
        try {
            await bot.api.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                text,
                parseMode ? { parse_mode: parseMode } : undefined,
            );
        } catch {
            // Ignore rate-limit / no-change errors
        }
    };

    let lastBucket: { phase: string; bucket: number } = {
        phase: "",
        bucket: -1,
    };
    try {
        await uploader.uploadFromUrl(
            ctx.chat.id,
            url,
            `<b>📄 الملف المرفوع:</b>\n<code>${url}</code>`,
            async (progress: UploadProgress) => {
                // Report at each 20% bucket per phase (0, 20, 40, 60, 80).
                const bucket = Math.min(4, Math.floor(progress.fraction * 5));
                if (
                    progress.phase === lastBucket.phase &&
                    bucket === lastBucket.bucket
                ) {
                    return;
                }
                lastBucket = { phase: progress.phase, bucket };
                const text =
                    progress.phase === "download"
                        ? strings.ar.downloading(progress.fraction)
                        : strings.ar.uploading(progress.fraction);
                await editStatus(text);
            },
        );

        await editStatus(strings.ar.success);
    } catch (error) {
        console.error("Upload failed:", error);
        const detail =
            error instanceof Error ? error.message.slice(0, 300) : String(error);
        const escaped = detail
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        await editStatus(
            `${strings.ar.error}\n\n<code>${escaped}</code>`,
            "HTML",
        );
    }
});

// --- Web Server (for Railway Health Check) ---
const app = new Hono();
app.get("/", (c) => c.text("Bot is running!"));

const port = parseInt(process.env.PORT || "3000", 10);
serve({ fetch: app.fetch, port });

// Start Bot (Polling for simplicity on Railway, can be Webhook)
bot.start();
console.log(`Bot is running on port ${port}...`);

// Graceful shutdown
const shutdown = async () => {
    console.log("Shutting down...");
    try {
        await bot.stop();
    } catch {
        // ignore
    }
    process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
