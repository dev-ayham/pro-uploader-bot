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
        already_in_flight:
            "⏳ لديك رفع قيد التنفيذ بالفعل. انتظر حتى ينتهي ثم أرسل الرابط الجديد.",
        duplicate_ignored:
            "ℹ️ تم تجاهل رابط مكرر (نفس الرابط الذي أرسلته قبل قليل).",
    },
};

// Track uploads that are currently being processed so we never start two
// uploads in parallel for the same chat, and we silently drop any update that
// Telegram re-delivers for an already-processed or in-flight message id.
const processedMessages = new Set<string>();
const inFlightChats = new Set<number>();
const recentUrls = new Map<number, { url: string; at: number }>();

function rememberProcessed(chatId: number, messageId: number): boolean {
    const key = `${chatId}:${messageId}`;
    if (processedMessages.has(key)) return false;
    processedMessages.add(key);
    // Keep the Set bounded so it cannot grow without bound on a long-lived
    // process. 5000 recent messages is plenty for dedup and costs ~200kB.
    if (processedMessages.size > 5000) {
        const firstKey = processedMessages.values().next().value;
        if (firstKey !== undefined) processedMessages.delete(firstKey);
    }
    return true;
}

// --- Bot Handlers ---
bot.command("start", (ctx) => ctx.reply(strings.ar.welcome));

bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const urlPattern = /https?:\/\/[^\s]+/;
    const match = text.match(urlPattern);

    if (!match) {
        return ctx.reply(strings.ar.invalid_url);
    }

    // De-dup: Telegram Bot API occasionally re-delivers the same update after
    // a restart. Skip any message id we already handled.
    if (!rememberProcessed(ctx.chat.id, ctx.message.message_id)) {
        console.warn(
            `Skipping duplicate delivery of message ${ctx.message.message_id} in chat ${ctx.chat.id}`,
        );
        return;
    }

    // If the same user already has an upload running, refuse rather than
    // running two MTProto uploads in parallel for the same session.
    if (inFlightChats.has(ctx.chat.id)) {
        await ctx.reply(strings.ar.already_in_flight);
        return;
    }

    const url = match[0];

    // If the user paste-spams the same URL twice within 30s we treat the
    // second one as an accidental double-send.
    const prev = recentUrls.get(ctx.chat.id);
    if (prev && prev.url === url && Date.now() - prev.at < 30_000) {
        await ctx.reply(strings.ar.duplicate_ignored);
        return;
    }
    recentUrls.set(ctx.chat.id, { url, at: Date.now() });

    inFlightChats.add(ctx.chat.id);
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
    } finally {
        inFlightChats.delete(ctx.chat.id);
    }
});

// Global handler-level error safety net. A throw inside a handler should
// never kill the whole bot (Node's unhandled-rejection default aborts the
// process, which would trigger a Railway restart and cause pending updates
// to look "duplicated" on the next start).
bot.catch((err) => {
    console.error("Unhandled error in grammy handler:", err);
});

// --- Web Server (for Railway Health Check) ---
const app = new Hono();
app.get("/", (c) => c.text("Bot is running!"));

const port = parseInt(process.env.PORT || "3000", 10);
serve({ fetch: app.fetch, port });

// Start Bot (Polling for simplicity on Railway, can be Webhook).
//
// drop_pending_updates: on a fresh container we should *not* re-process
// updates that Telegram still has queued from a previous (killed) instance.
// Without this flag, a rolling deploy that dies mid-upload causes the new
// container to re-process the user's message and effectively upload it
// twice. Losing a pending message on a cold start is much less bad than
// silently double-processing one.
//
// allowed_updates: tell Telegram we only care about messages and callback
// queries. Reduces noise and the risk of unrelated update types triggering
// handlers.
bot.start({
    drop_pending_updates: true,
    allowed_updates: ["message", "callback_query"],
    onStart: (me) => {
        console.log(`Bot @${me.username} is polling on port ${port}...`);
    },
}).catch((err) => {
    console.error("bot.start() failed:", err);
    // Let Railway restart us rather than leaving a zombie HTTP server.
    process.exit(1);
});

// Graceful shutdown: give grammy a chance to confirm the current offset with
// Telegram's Bot API before we exit, so the *just-handled* message id is not
// redelivered to the next container.
let shuttingDown = false;
const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down...`);
    try {
        await bot.stop();
    } catch (err) {
        console.error("Error during bot.stop():", err);
    }
    process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
    console.error("uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
    console.error("unhandledRejection:", reason);
});
