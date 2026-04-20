import "dotenv/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Bot, Context, InputFile } from "grammy";
import type { InputMediaPhoto } from "grammy/types";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { MTProtoUploader, UploadProgress } from "./services/mtproto-uploader";
import { shouldUseYtDlp, YtDlpOptions } from "./services/downloader";
import {
    handlePendingInputIfAny,
    registerSettingsHandlers,
} from "./handlers/settings";
import {
    publishBotCommands,
    registerMenuHandlers,
} from "./handlers/menu";
import {
    closeDb,
    getAiCallsToday,
    getUserPrefs,
    incrementAiCallsToday,
    incrementUploadsCount,
    setLastUrl,
} from "./services/db";
import {
    parseIntentByKeywords,
    parseIntentWithOpenAI,
    type IntentAction,
} from "./services/ai-intent";
import { registerQuickCommandHandlers } from "./handlers/commands";
import { t } from "./i18n";
import { generateScreenshots } from "./services/screenshots";
import {
    hasThumbnail,
    saveThumbnailFromFile,
    thumbnailPath,
} from "./services/thumbnails";
import {
    clearPendingInput,
    getPendingInput,
} from "./services/pending-input";

const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
const apiId = parseInt(process.env.API_ID || "0", 10);
const apiHash = process.env.API_HASH || "";

if (!botToken || !apiId || !apiHash) {
    console.error(
        "Missing environment variables! Please set TELEGRAM_BOT_TOKEN, API_ID, and API_HASH.",
    );
    process.exit(1);
}

/**
 * Materialize a yt-dlp cookies.txt file from the YT_DLP_COOKIES env var.
 *
 * Private Instagram posts, age-restricted YouTube videos and rate-limited
 * TikTok / Twitter URLs require yt-dlp to present a logged-in session. The
 * canonical way to do that headlessly is a Netscape-format cookies.txt
 * exported from a real browser. We accept the file contents verbatim via an
 * env var (Railway secret) and drop it on disk at startup so every yt-dlp
 * invocation can pass it with `--cookies`.
 */
function materializeCookiesFile(): string | undefined {
    const raw = process.env.YT_DLP_COOKIES;
    if (!raw || !raw.trim()) return undefined;
    const cookiesPath = path.join(os.tmpdir(), "yt-dlp-cookies.txt");
    try {
        fs.writeFileSync(cookiesPath, raw, { mode: 0o600 });
        console.log(
            `Loaded yt-dlp cookies from YT_DLP_COOKIES -> ${cookiesPath}`,
        );
        return cookiesPath;
    } catch (err) {
        console.error("Failed to write yt-dlp cookies file:", err);
        return undefined;
    }
}

const ytDlpOptions: YtDlpOptions = {
    cookiesFile: materializeCookiesFile(),
    userAgent:
        process.env.YT_DLP_USER_AGENT ||
        // Pretend to be a recent Chrome on macOS. Many extractors (Instagram,
        // TikTok) silently serve different / better data to browser UAs.
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
};

const bot = new Bot(botToken);
const uploader = new MTProtoUploader(apiId, apiHash, botToken, ytDlpOptions);

// All user-facing strings live in src/i18n.ts. Fetch them per chat at the
// point of rendering so the user's stored language preference is honoured
// even when the same code path serves multiple chats concurrently.
function langOf(chatId: number) {
    return getUserPrefs(chatId).language;
}

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

/**
 * Generate up to `count` equidistant JPEG thumbnails for a just-uploaded
 * video and send them to the same chat as an album. No-op for non-video
 * MIME types. Errors are caught and reported in-chat so the successful
 * main upload is not retroactively "failed" by a ffmpeg hiccup.
 */
const VIDEO_EXTS = new Set([
    ".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".m4v", ".ts",
    ".mpg", ".mpeg", ".3gp", ".wmv",
]);

async function sendScreenshots(
    ctx: Context,
    filePath: string,
    filename: string,
    count: number,
): Promise<void> {
    if (count < 1) return;
    const ext = path.extname(filename).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) return;
    if (!ctx.chat) return;
    const s = t(langOf(ctx.chat.id));
    let shots: string[] = [];
    try {
        shots = await generateScreenshots(filePath, count, os.tmpdir());
        if (shots.length === 0) {
            await ctx.reply(s.screenshots_none);
            return;
        }
        // Telegram albums take 2-10 items. If count<2 we still want to show
        // the single shot as a standalone photo.
        if (shots.length === 1) {
            await ctx.replyWithPhoto(new InputFile(shots[0]), {
                caption: s.screenshots_single,
            });
        } else {
            // sendMediaGroup caps at 10 items per call; our cycle is [0,3,5,10]
            // so we never overflow.
            const media: InputMediaPhoto[] = shots.slice(0, 10).map((p, i) => ({
                type: "photo",
                media: new InputFile(p),
                caption: i === 0 ? s.screenshots_caption(shots.length) : undefined,
            }));
            await ctx.replyWithMediaGroup(media);
        }
    } catch (err) {
        console.error("sendScreenshots failed:", err);
        const detail = err instanceof Error ? err.message : String(err);
        await ctx.reply(s.screenshots_fail(escapeHtmlForMsg(detail)), {
            parse_mode: "HTML",
        });
    } finally {
        for (const p of shots) {
            try {
                fs.unlinkSync(p);
            } catch {
                // best-effort
            }
        }
    }
}

function escapeHtmlForMsg(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// --- Bot Handlers ---
// /start, /menu, /help, /about, /cancel and the top-level inline nav.
registerMenuHandlers(bot);

// /settings, /settings callback_query handlers etc.
registerSettingsHandlers(bot);

// Quick commands: /doc /prefix /suffix /screenshots /thumb
// /thumb_clear /reset /platforms /id /ping /stats
registerQuickCommandHandlers(bot);

bot.on("message:photo", async (ctx) => {
    // Photos are only interesting when the user is mid-flow on /settings →
    // "ضبط الصورة المصغّرة". Any other photo is ignored silently.
    const chatId = ctx.chat.id;
    const pending = getPendingInput(chatId);
    if (!pending || pending.kind !== "thumbnail_photo") return;

    const photos = ctx.message.photo;
    const biggest = photos[photos.length - 1];
    if (!biggest) return;
    let tmpPath: string | undefined;
    try {
        const fileInfo = await ctx.api.getFile(biggest.file_id);
        if (!fileInfo.file_path) {
            throw new Error("Telegram did not return a file_path");
        }
        // Download the photo through the Bot API. `bot.api.getFile` returns
        // the relative path; we concat with the configured Bot API base URL.
        const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
        const res = await fetch(downloadUrl);
        if (!res.ok) {
            throw new Error(`Telegram getFile returned HTTP ${res.status}`);
        }
        tmpPath = path.join(
            os.tmpdir(),
            `tg-thumb-${chatId}-${Date.now()}.src`,
        );
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(tmpPath, buffer);
        await saveThumbnailFromFile(chatId, tmpPath);
        clearPendingInput(chatId);
        const s = t(langOf(chatId));
        await ctx.reply(s.thumb_saved);
    } catch (err) {
        console.error("thumbnail save failed:", err);
        const detail = err instanceof Error ? err.message : String(err);
        clearPendingInput(chatId);
        const s = t(langOf(chatId));
        await ctx.reply(s.thumb_save_error(escapeHtmlForMsg(detail)), {
            parse_mode: "HTML",
        });
    } finally {
        if (tmpPath) {
            try {
                fs.unlinkSync(tmpPath);
            } catch {
                // best-effort
            }
        }
    }
});

/**
 * Upload modes driven either by the user's stored preferences (default) or
 * by an AI-parsed follow-up intent ("audio" / "document" / "video").
 */
type UploadMode = "default" | "audio" | "document" | "video";

const AI_DAILY_LIMIT = parseInt(
    process.env.AI_DAILY_LIMIT_PER_USER || "20",
    10,
);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * Shared upload pipeline used by both the URL-in-message path and the AI
 * intent-dispatch path. Owns the "processing..." status message, the
 * progress callback, the in-flight guard and the post-upload bookkeeping
 * (setLastUrl, incrementUploadsCount). Returns true iff the upload
 * finished without throwing, so callers can chain follow-up actions.
 */
async function runUpload(
    ctx: Context,
    url: string,
    mode: UploadMode,
): Promise<boolean> {
    if (!ctx.chat) return false;
    const chatId = ctx.chat.id;
    const s = t(langOf(chatId));

    if (inFlightChats.has(chatId)) {
        await ctx.reply(s.already_in_flight);
        return false;
    }

    inFlightChats.add(chatId);
    try {
        const initialText =
            mode === "audio"
                ? s.ai_audio_extracting
                : mode === "document"
                ? s.ai_reupload_document
                : mode === "video"
                ? s.ai_reupload_video
                : shouldUseYtDlp(url)
                ? s.extracting
                : s.processing;

        let statusMsg: { message_id: number } | undefined;
        try {
            statusMsg = await ctx.reply(initialText);
        } catch (err) {
            console.error("Failed to send initial status message:", err);
        }

        const editStatus = async (text: string, parseMode?: "HTML") => {
            if (!statusMsg) return;
            try {
                await bot.api.editMessageText(
                    chatId,
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

        // Honour the user's saved toggles. For AI intents we *override*
        // the document/video flag for this single upload without
        // persisting the change — it would be surprising if "give me as
        // document" permanently flipped the user's default.
        const prefs = getUserPrefs(chatId);
        const asDocument =
            mode === "document"
                ? true
                : mode === "video"
                ? false
                : prefs.uploadAsDocument;

        const onProgress = async (progress: UploadProgress) => {
            const bucket = Math.min(4, Math.floor(progress.fraction * 5));
            if (
                progress.phase === lastBucket.phase &&
                bucket === lastBucket.bucket
            ) {
                return;
            }
            lastBucket = { phase: progress.phase, bucket };
            const text =
                mode === "audio"
                    ? progress.phase === "download"
                        ? s.ai_audio_extracting
                        : s.ai_audio_uploading(progress.fraction)
                    : progress.phase === "download"
                    ? s.downloading(progress.fraction)
                    : s.uploading(progress.fraction);
            await editStatus(text);
        };

        try {
            if (mode === "audio") {
                await uploader.uploadAudioFromUrl(
                    chatId,
                    url,
                    `<b>🎵</b>\n<code>${url}</code>`,
                    onProgress,
                    {
                        renamePrefix: prefs.renamePrefix,
                        renameSuffix: prefs.renameSuffix,
                    },
                );
                await editStatus(s.ai_audio_success);
            } else {
                await uploader.uploadFromUrl(
                    chatId,
                    url,
                    `<b>📄</b>\n<code>${url}</code>`,
                    onProgress,
                    {
                        asDocument,
                        renamePrefix: prefs.renamePrefix,
                        renameSuffix: prefs.renameSuffix,
                        thumbnailPath: hasThumbnail(chatId)
                            ? thumbnailPath(chatId)
                            : undefined,
                        postUpload:
                            prefs.screenshotsCount > 0
                                ? async (filePath, filename) => {
                                      await sendScreenshots(
                                          ctx,
                                          filePath,
                                          filename,
                                          prefs.screenshotsCount,
                                      );
                                  }
                                : undefined,
                    },
                );
                await editStatus(s.success);
            }

            // Remember this URL so an AI follow-up ("give me the audio")
            // knows what to operate on without a re-paste.
            try {
                setLastUrl(chatId, url);
            } catch (err) {
                console.error("setLastUrl failed:", err);
            }
            try {
                incrementUploadsCount(chatId);
            } catch (err) {
                console.error("incrementUploadsCount failed:", err);
            }
            return true;
        } catch (error) {
            console.error(`Upload (${mode}) failed:`, error);
            const detail =
                error instanceof Error
                    ? error.message.slice(0, 300)
                    : String(error);
            const escaped = escapeHtmlForMsg(detail);
            const template =
                mode === "audio" ? s.ai_audio_error(escaped) : `${s.error}\n\n<code>${escaped}</code>`;
            await editStatus(template, "HTML");
            return false;
        }
    } finally {
        inFlightChats.delete(chatId);
    }
}

/**
 * Resolve a no-URL follow-up message into a concrete action. Tries the
 * free regex classifier first, then falls back to OpenAI when (a) it's
 * configured via `OPENAI_API_KEY`, (b) the user hasn't exhausted their
 * per-day AI budget, and (c) the regex pass was inconclusive.
 *
 * Returns `null` when no classification can be made so the caller can
 * surface `ai_intent_unknown` to the user.
 */
async function classifyFollowUp(
    chatId: number,
    text: string,
): Promise<{ action: IntentAction; rateLimited?: boolean } | null> {
    const byKeyword = parseIntentByKeywords(text);
    if (byKeyword !== "unknown") {
        return { action: byKeyword };
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    // Count the attempt *before* making the network call so a burst of
    // nonsense messages quickly trips the quota regardless of what OpenAI
    // answers.
    let used: number;
    try {
        used = incrementAiCallsToday(chatId);
    } catch (err) {
        console.error("incrementAiCallsToday failed:", err);
        return null;
    }
    if (used > AI_DAILY_LIMIT) {
        return { action: "unknown", rateLimited: true };
    }

    const intent = await parseIntentWithOpenAI(text, {
        apiKey,
        model: OPENAI_MODEL,
    });
    if (intent.action === "unknown") return null;
    return { action: intent.action };
}

bot.on("message:text", async (ctx) => {
    // If the user is mid-flow inside a /settings prompt (typing a rename
    // prefix / suffix), consume this message as the answer and don't try to
    // parse it as a URL.
    if (await handlePendingInputIfAny(ctx)) {
        return;
    }

    const text = ctx.message.text;
    const urlPattern = /https?:\/\/[^\s]+/;
    const match = text.match(urlPattern);
    const chatId = ctx.chat.id;
    const s = t(langOf(chatId));

    // --- No URL branch: treat the message as an AI follow-up instruction
    //     against the last remembered URL for this chat.
    if (!match) {
        if (!rememberProcessed(chatId, ctx.message.message_id)) return;

        const prefs = getUserPrefs(chatId);
        if (!prefs.lastUrl) {
            await ctx.reply(s.invalid_url);
            return;
        }

        const resolved = await classifyFollowUp(chatId, text);
        if (!resolved) {
            await ctx.reply(s.ai_intent_unknown);
            return;
        }
        if (resolved.rateLimited) {
            await ctx.reply(s.ai_daily_limit(AI_DAILY_LIMIT));
            return;
        }

        switch (resolved.action) {
            case "audio":
                await runUpload(ctx, prefs.lastUrl, "audio");
                return;
            case "document":
                await runUpload(ctx, prefs.lastUrl, "document");
                return;
            case "video":
                await runUpload(ctx, prefs.lastUrl, "video");
                return;
            case "retry":
                await ctx.reply(s.ai_retrying);
                await runUpload(ctx, prefs.lastUrl, "default");
                return;
            default:
                await ctx.reply(s.ai_intent_unknown);
                return;
        }
    }

    // --- URL branch: regular upload.
    if (!rememberProcessed(chatId, ctx.message.message_id)) {
        console.warn(
            `Skipping duplicate delivery of message ${ctx.message.message_id} in chat ${chatId}`,
        );
        return;
    }

    const url = match[0];
    const prev = recentUrls.get(chatId);
    if (prev && prev.url === url && Date.now() - prev.at < 30_000) {
        await ctx.reply(s.duplicate_ignored);
        return;
    }
    recentUrls.set(chatId, { url, at: Date.now() });
    await runUpload(ctx, url, "default");
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
        // Publish the Telegram /-command menu once the bot is live. Failure
        // here is logged inside publishBotCommands and must not block the
        // main polling loop.
        void publishBotCommands(bot);
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
    try {
        closeDb();
    } catch (err) {
        console.error("Error during closeDb():", err);
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
