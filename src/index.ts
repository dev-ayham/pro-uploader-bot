import "dotenv/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Bot, Context, InlineKeyboard, InputFile } from "grammy";
import type { InputMediaPhoto } from "grammy/types";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
    MTProtoUploader,
    UploadCancelledError,
    UploadProgress,
} from "./services/mtproto-uploader";
import {
    DownloadCancelledError,
    FileTooLargeError,
    isDirectFileUrl,
    probeIsDirectFile,
    shouldUseYtDlp,
    YtDlpOptions,
} from "./services/downloader";
import { extractInstagramUsername } from "./services/instagram-profile";
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
    isBanned,
    setLastUrl,
} from "./services/db";
import {
    chatWithOpenAI,
    getCachedIntent,
    parseIntentByKeywords,
    parseIntentWithOpenAI,
    setCachedIntent,
    type IntentAction,
} from "./services/ai-intent";
import { registerQuickCommandHandlers } from "./handlers/commands";
import {
    handleAdminPendingInputIfAny,
    registerAdminHandlers,
} from "./handlers/admin";
import { isAdmin } from "./services/admin";
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
import { cleanTitle, looksLikeVideoUrl } from "./services/title";

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Hard cap on inline filename overrides. Telegram itself tolerates much
 * longer document names but long captions / filenames make the tile ugly
 * and can break renaming on iOS. 120 chars matches what popular competitor
 * bots accept and leaves headroom for any extension we append later.
 */
const MAX_INLINE_FILENAME_LEN = 120;

/**
 * Parse a user-supplied `URL | filename` suffix. `rest` is the slice of
 * the original message that sits *after* the URL we already matched.
 * We accept an optional space, then `|`, then the rest of the line as
 * the custom base name. Empty strings and names containing control
 * characters or path separators are rejected so we never hand Telegram
 * a bogus `DocumentAttributeFilename`.
 */
function extractInlineFilename(
    text: string,
    afterUrlIndex: number,
): string | undefined {
    const rest = text.slice(afterUrlIndex);
    const m = rest.match(/^\s*\|\s*(.+?)\s*$/s);
    if (!m) return undefined;
    const raw = m[1].replace(/[\r\n\t]+/g, " ").trim();
    if (!raw) return undefined;
    // Disallow path separators and ASCII control chars. Everything else
    // (Arabic, emoji, punctuation, dots, spaces) is fine — Telegram
    // preserves the name verbatim in the doc attribute.
    if (/[\u0000-\u001f/\\]/.test(raw)) return undefined;
    if (raw.length > MAX_INLINE_FILENAME_LEN) {
        return raw.slice(0, MAX_INLINE_FILENAME_LEN);
    }
    return raw;
}

function buildCaption(
    emoji: string,
    url: string,
    customFilename?: string,
): string {
    // Strip a trailing extension from the inline override so the caption
    // reads as a clean title (users rarely want `.mp4` in the caption).
    const title = customFilename
        ? customFilename.replace(/\.[A-Za-z0-9]{1,6}$/, "")
        : cleanTitle(url);
    return `<b>${emoji}</b> <code>${escapeHtml(title)}</code>`;
}

function buildCaptionFromFilename(
    emoji: string,
    url: string,
    filename: string,
): string {
    const title = cleanTitle(url, filename);
    return `<b>${emoji}</b> <code>${escapeHtml(title)}</code>`;
}

function captionEmojiFor(mode: string, url: string): string {
    if (mode === "document") return "📄";
    // "video" and the quality-capped variants ("q1080"/"q720"/...) always
    // mean the user wants a video; shouldUseYtDlp / looksLikeVideoUrl
    // catch "default" mode for streaming sources and direct video URLs.
    const isVideo =
        mode === "video" ||
        mode.startsWith("q") ||
        shouldUseYtDlp(url) ||
        looksLikeVideoUrl(url);
    return isVideo ? "🎬" : "📄";
}

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

/**
 * Hard cap on the size of any single downloaded file, enforced both by
 * yt-dlp's `--max-filesize` and by an HTTP Content-Length check for direct
 * URLs. Default 2000 MB leaves headroom under Telegram's 2 GB MTProto limit
 * so the upload can actually complete. Override via env when running on a
 * beefier Railway plan.
 */
const MAX_FILE_SIZE_MB = (() => {
    const raw = process.env.MAX_FILE_SIZE_MB;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 2000;
})();

/**
 * Hard cap on the number of uploads we are willing to process concurrently
 * across *all* chats. Each in-flight upload can spawn a `yt-dlp` child
 * process (~150-300 MB RAM peak) plus an `ffmpeg` screenshot pass, so
 * letting the counter grow unbounded is what turns a traffic spike into an
 * OOM kill. Default 5 is comfortable on Railway Hobby (8 GB RAM ceiling);
 * raise via env on Pro.
 */
const MAX_CONCURRENT_DOWNLOADS = (() => {
    const raw = process.env.MAX_CONCURRENT_DOWNLOADS;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 5;
})();

const ytDlpOptions: YtDlpOptions = {
    cookiesFile: materializeCookiesFile(),
    userAgent:
        process.env.YT_DLP_USER_AGENT ||
        // Pretend to be a recent Chrome on macOS. Many extractors (Instagram,
        // TikTok) silently serve different / better data to browser UAs.
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    maxFileSizeMb: MAX_FILE_SIZE_MB,
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

/**
 * Per-chat AbortController for the single upload currently in flight. The
 * "Cancel" button on the progress status message calls `.abort()` on the
 * entry for that chat, which unwinds the download + upload promise chain
 * and releases the concurrency slot.
 */
const chatUploadCancellers = new Map<number, AbortController>();

/**
 * Per-chat wall-clock timestamp (ms since epoch) at which the user is
 * allowed to start their next upload. Set to `Date.now() + COOLDOWN_MS`
 * in the {@link runUpload} finally block regardless of success / failure
 * / cancellation so a single user can never start more than one upload
 * per COOLDOWN_MS window.
 */
const chatCooldownUntil = new Map<number, number>();

/**
 * Hard per-user cooldown between consecutive uploads. 5 minutes matches
 * the competitor bots' rate-limiting and is comfortable enough that a
 * well-behaved user will never hit it in normal operation while still
 * making it expensive for the AI-intent parser to accidentally kick off
 * back-to-back re-downloads of the same 2 GB file.
 */
const UPLOAD_COOLDOWN_MS = (() => {
    const raw = process.env.UPLOAD_COOLDOWN_MS;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : 5 * 60 * 1000;
})();

/**
 * Soft cap on `chatCooldownUntil`. When the map exceeds this size the
 * runUpload finally block prunes expired entries and (if still over)
 * evicts oldest insertions. Chosen large enough that a single burst of
 * legitimate traffic (~thousands of concurrent users) does not trigger
 * eviction of still-live cooldown windows, but small enough that
 * long-lived processes never accumulate unbounded state. Matches the
 * bounding style of `processedMessages` (5000) and `intentCache` (500)
 * elsewhere in the codebase.
 */
const COOLDOWN_MAP_MAX = 10_000;

/**
 * Fixed callback-data payload for the single inline "Cancel" button
 * attached to the status-message keyboard. The chat id is implied by
 * the callback context so we don't need to encode it here.
 */
const CANCEL_UPLOAD_CALLBACK = "upload:cancel";

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

// Ban guard must run FIRST so it intercepts every update — including
// /start, /help, inline callback queries, etc. — before any command
// handler below gets a chance to reply. grammy runs middleware in
// registration order and command handlers stop the chain on match, so
// placing the guard after the register* calls would leak commands to
// banned users. Admins are never considered banned.
bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId && !isAdmin(chatId) && isBanned(chatId)) {
        return;
    }
    await next();
});

// Admin "pending input" is set by the inline /admin buttons (e.g.
// Broadcast → waiting for the message body, Ban → waiting for the
// chat_id). It gets consumed by the message:text handler below. But
// grammy runs bot.command() handlers before message:text, so if the
// admin types any other command while a pending input is armed, the
// command runs and the pending flag is never cleared — and the NEXT
// plain-text message would then be treated as the pending answer
// (e.g. accidentally broadcast "ok" to every user). Clear the flag
// pre-emptively whenever an admin sends any /command so only a direct
// reply to the prompt counts.
bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text;
    if (chatId && text && text.startsWith("/") && isAdmin(chatId)) {
        const pending = getPendingInput(chatId);
        if (pending && pending.kind.startsWith("admin_")) {
            clearPendingInput(chatId);
        }
    }
    await next();
});

// /start, /menu, /help, /about, /cancel and the top-level inline nav.
registerMenuHandlers(bot);

// /settings, /settings callback_query handlers etc.
registerSettingsHandlers(bot);

// Quick commands: /doc /prefix /suffix /screenshots /thumb
// /thumb_clear /reset /platforms /id /ping /stats
registerQuickCommandHandlers(bot);

// Admin-only commands: /admin /ai_status /stats_all /broadcast /user /ban /unban /bans
// Every handler short-circuits for non-admin chat ids so accidental
// callers see nothing.
registerAdminHandlers(bot);

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
 * by an AI-parsed follow-up intent ("audio" / "document" / "video") or by
 * the quality-selection inline menu ("q1080" / "q720" / "q480" / "q360").
 */
type UploadMode =
    | "default"
    | "audio"
    | "document"
    | "video"
    | "q1080"
    | "q720"
    | "q480"
    | "q360";

/** Resolve a quality mode to the yt-dlp height cap it implies. */
function maxHeightForMode(mode: UploadMode): number | undefined {
    switch (mode) {
        case "q1080":
            return 1080;
        case "q720":
            return 720;
        case "q480":
            return 480;
        case "q360":
            return 360;
        default:
            return undefined;
    }
}

const AI_DAILY_LIMIT = parseInt(
    // Per-chat cap on OpenAI fallback calls in a single UTC day. Override
    // by setting AI_DAILY_LIMIT_PER_USER on Railway. 20 balances cost
    // control with enough headroom for a power user to converse naturally.
    process.env.AI_DAILY_LIMIT_PER_USER || "20",
    10,
);
// gpt-4.1-nano is OpenAI's cheapest text model ($0.10 / 1M input tokens,
// $0.40 / 1M output), ~33% cheaper than gpt-4o-mini for our classification
// workload. Override via OPENAI_MODEL if a different model is desired.
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-nano";

/**
 * Send the cooldown-rejection message and then keep editing it in place
 * with a live-ticking countdown (minutes + seconds remaining) so the
 * user sees the number decrease rather than a static snapshot. Matches
 * the competitor bots' UX.
 *
 * The tick interval is 10s which gives 30 edits over a full 5-minute
 * cooldown — well under Telegram's "1 edit / sec per chat" rate limit.
 * We stop editing on first error that looks like the message was
 * deleted or the bot was blocked, so a long cooldown for a user who
 * cleared the chat doesn't keep hammering the API.
 */
const COOLDOWN_COUNTDOWN_TICK_MS = 10_000;
async function sendCooldownCountdown(
    ctx: Context,
    chatId: number,
    cooldownUntil: number,
    s: ReturnType<typeof t>,
): Promise<void> {
    const fmt = (ms: number) => {
        const totalSec = Math.max(0, Math.ceil(ms / 1000));
        return {
            minutes: Math.floor(totalSec / 60),
            seconds: totalSec % 60,
        };
    };
    const initial = fmt(cooldownUntil - Date.now());
    let sent: { message_id: number } | undefined;
    try {
        sent = await ctx.reply(s.cooldown_active(initial.minutes, initial.seconds));
    } catch (err) {
        console.error("Failed to send cooldown message:", err);
        return;
    }
    if (!sent) return;
    const messageId = sent.message_id;

    const api = ctx.api;
    const interval = setInterval(async () => {
        const remaining = cooldownUntil - Date.now();
        if (remaining <= 0) {
            clearInterval(interval);
            try {
                await api.editMessageText(chatId, messageId, s.cooldown_ready);
            } catch {
                // Message likely gone; nothing to do.
            }
            return;
        }
        const { minutes, seconds } = fmt(remaining);
        try {
            await api.editMessageText(
                chatId,
                messageId,
                s.cooldown_active(minutes, seconds),
            );
        } catch (err) {
            const description = String(
                (err as { description?: string })?.description ?? err ?? "",
            );
            // "message is not modified" means the formatted text happened
            // to land identical — harmless, keep ticking.
            if (/not modified/i.test(description)) return;
            // Permanent failures: message deleted, bot blocked, etc. Stop
            // re-editing.
            if (
                /message to edit not found|message can't be edited|bot was blocked|chat not found|user is deactivated|forbidden/i.test(
                    description,
                )
            ) {
                clearInterval(interval);
            }
        }
    }, COOLDOWN_COUNTDOWN_TICK_MS);
    // Hard safety net: never let an interval outlive the cooldown window by
    // more than 30 seconds, even if the tick handler somehow fails to
    // clear itself.
    setTimeout(
        () => clearInterval(interval),
        Math.max(cooldownUntil - Date.now() + 30_000, 60_000),
    );
}

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
    customFilename?: string,
): Promise<boolean> {
    if (!ctx.chat) return false;
    const chatId = ctx.chat.id;
    const s = t(langOf(chatId));

    // Strict per-user single-flight guard + per-user 5-minute cooldown.
    // These are the core of the "1 upload per user per 5 minutes" rule
    // the product requires — every other path (URL receipt, quality
    // menu, AI follow-up intents) funnels through this function, so
    // enforcing here catches them all.
    if (inFlightChats.has(chatId)) {
        await ctx.reply(s.already_in_flight);
        return false;
    }
    const cooldownUntil = chatCooldownUntil.get(chatId) ?? 0;
    const remainingMs = cooldownUntil - Date.now();
    if (remainingMs > 0) {
        await sendCooldownCountdown(ctx, chatId, cooldownUntil, s);
        return false;
    }

    // Global concurrency cap: each in-flight upload can burn ~200-500 MB of
    // RAM (yt-dlp + ffmpeg + MTProto buffers) so we refuse new work past
    // MAX_CONCURRENT_DOWNLOADS rather than let a traffic spike OOM-kill the
    // container. The user can just retry a minute later.
    if (inFlightChats.size >= MAX_CONCURRENT_DOWNLOADS) {
        await ctx.reply(s.queue_full(MAX_CONCURRENT_DOWNLOADS));
        return false;
    }

    inFlightChats.add(chatId);
    const abortController = new AbortController();
    chatUploadCancellers.set(chatId, abortController);
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

        // The progress status message carries a single inline "Cancel"
        // button that routes to the CANCEL_UPLOAD_CALLBACK handler. We
        // keep the same keyboard attached through every editMessageText
        // so the user can abort at any point during download or upload.
        const cancelKeyboard = new InlineKeyboard().text(
            s.upload_cancel_button,
            CANCEL_UPLOAD_CALLBACK,
        );

        let statusMsg: { message_id: number } | undefined;
        try {
            statusMsg = await ctx.reply(initialText, {
                reply_markup: cancelKeyboard,
            });
        } catch (err) {
            console.error("Failed to send initial status message:", err);
        }

        const editStatus = async (
            text: string,
            parseMode?: "HTML",
            keepCancelButton = true,
        ) => {
            if (!statusMsg) return;
            try {
                await bot.api.editMessageText(
                    chatId,
                    statusMsg.message_id,
                    text,
                    {
                        ...(parseMode ? { parse_mode: parseMode } : {}),
                        // Terminal edits (success, error, cancelled) drop
                        // the cancel button — clicking it after the
                        // upload has resolved would be confusing.
                        reply_markup: keepCancelButton
                            ? cancelKeyboard
                            : undefined,
                    },
                );
            } catch {
                // Ignore rate-limit / no-change errors
            }
        };

        // Status-message refresh throttle. The download / upload layers now
        // emit 4+ ticks / second with rich bytes-speed-ETA telemetry; we
        // refresh the status message at most once every 1.5 s (plus an
        // immediate refresh on phase change) so Telegram's edit-rate limit
        // never bites while the user still sees a responsive display.
        let lastEditTs = 0;
        let lastPhase = "";
        const MIN_EDIT_INTERVAL_MS = 1500;

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
            const now = Date.now();
            const phaseChanged = progress.phase !== lastPhase;
            const isTerminal = progress.fraction >= 1;
            if (
                !phaseChanged &&
                !isTerminal &&
                now - lastEditTs < MIN_EDIT_INTERVAL_MS
            ) {
                return;
            }
            lastEditTs = now;
            lastPhase = progress.phase;
            const text =
                mode === "audio"
                    ? progress.phase === "download"
                        ? s.ai_audio_extracting
                        : s.ai_audio_uploading(progress)
                    : progress.phase === "download"
                    ? s.downloading(progress)
                    : s.uploading(progress);
            await editStatus(text);
        };

        try {
            if (mode === "audio") {
                await uploader.uploadAudioFromUrl(
                    chatId,
                    url,
                    buildCaption("🎵", url, customFilename),
                    onProgress,
                    {
                        renamePrefix: prefs.renamePrefix,
                        renameSuffix: prefs.renameSuffix,
                        customFilename,
                        signal: abortController.signal,
                    },
                );
                await editStatus(s.ai_audio_success, undefined, false);
            } else {
                const emoji = captionEmojiFor(mode, url);
                await uploader.uploadFromUrl(
                    chatId,
                    url,
                    buildCaption(emoji, url, customFilename),
                    onProgress,
                    {
                        asDocument,
                        maxHeight: maxHeightForMode(mode),
                        renamePrefix: prefs.renamePrefix,
                        renameSuffix: prefs.renameSuffix,
                        customFilename,
                        signal: abortController.signal,
                        // Rebuild the caption once the real filename is
                        // known (yt-dlp's %(title)s / Content-Disposition)
                        // so YouTube/TikTok/etc. get meaningful titles
                        // instead of "YouTube · dQw4w9WgXcQ". When the
                        // user supplied an inline filename override, we
                        // pin the caption to that name up-front and skip
                        // this hook entirely.
                        captionFromFilename: customFilename
                            ? undefined
                            : (filename) =>
                                  buildCaptionFromFilename(emoji, url, filename),
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
                await editStatus(s.success, undefined, false);
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
            // User-initiated cancel (clicked the Cancel button) surfaces
            // as either DownloadCancelledError (aborted mid-download) or
            // UploadCancelledError (aborted mid-upload). Report the same
            // friendly message for both — stack traces and raw Error
            // messages belong in the logs, not in the user's chat.
            if (
                error instanceof DownloadCancelledError ||
                error instanceof UploadCancelledError
            ) {
                await editStatus(s.upload_cancelled, undefined, false);
                return false;
            }
            console.error(`Upload (${mode}) failed:`, error);
            // Surface the size-cap rejection as a friendly message instead of
            // the raw "File exceeds 2000MB limit" Error.message — users should
            // know to pick a lower quality rather than think the bot crashed.
            if (
                error instanceof FileTooLargeError ||
                (error instanceof Error &&
                    /File is larger than max-filesize/i.test(error.message))
            ) {
                const limit =
                    error instanceof FileTooLargeError
                        ? error.limitMb
                        : MAX_FILE_SIZE_MB;
                await editStatus(s.file_too_large(limit), undefined, false);
                return false;
            }
            // The MTProto uploader's stall watchdog throws an Error whose
            // message starts with "Upload stalled" when no progress tick
            // has advanced for UPLOAD_STALL_TIMEOUT_MS. Surface this as a
            // friendly, actionable message rather than a raw stack trace.
            if (
                error instanceof Error &&
                /^Upload stalled/i.test(error.message)
            ) {
                await editStatus(s.upload_stalled, undefined, false);
                return false;
            }
            // Map common "link is dead" signals to a friendly one-liner so the
            // user knows to double-check the URL instead of wading through a
            // stack-ish axios message or yt-dlp's raw stderr.
            const notFoundStatus =
                (error as { response?: { status?: number } })?.response
                    ?.status;
            if (
                notFoundStatus === 404 ||
                notFoundStatus === 410 ||
                (error instanceof Error &&
                    /status code (404|410)\b|HTTP Error (404|410)\b|URL no longer exists|This video is (unavailable|no longer available)|Video unavailable/i.test(
                        error.message,
                    ))
            ) {
                await editStatus(s.url_not_found, undefined, false);
                return false;
            }
            const detail =
                error instanceof Error
                    ? error.message.slice(0, 300)
                    : String(error);
            const escaped = escapeHtmlForMsg(detail);
            const template =
                mode === "audio" ? s.ai_audio_error(escaped) : `${s.error}\n\n<code>${escaped}</code>`;
            await editStatus(template, "HTML", false);
            return false;
        }
    } finally {
        inFlightChats.delete(chatId);
        chatUploadCancellers.delete(chatId);
        // Start the 5-minute cooldown *regardless* of success / failure /
        // cancellation. If the user cancelled early this still costs them
        // a cooldown — intentional, matches the product spec of "1 op per
        // 5 minutes per user" without creating a retry-spam loophole.
        if (UPLOAD_COOLDOWN_MS > 0) {
            const now = Date.now();
            chatCooldownUntil.set(chatId, now + UPLOAD_COOLDOWN_MS);
            // Sweep expired entries opportunistically so the map
            // doesn't grow unboundedly with one entry per user that
            // ever uploaded. Each entry is tiny (two numbers) but
            // long-lived bot processes can accumulate tens of
            // thousands of stale rows otherwise. We only scan when
            // the map is already large to keep the common path O(1).
            if (chatCooldownUntil.size > COOLDOWN_MAP_MAX) {
                for (const [cid, until] of chatCooldownUntil) {
                    if (until <= now) chatCooldownUntil.delete(cid);
                }
                // Bounded belt-and-braces: if everyone is still
                // inside their cooldown window we fall back to
                // evicting the oldest insertion. Map iteration is
                // insertion-ordered in JS, so the first key is the
                // oldest. Keeps memory deterministic under pathological
                // growth (DoS / bot spam).
                while (chatCooldownUntil.size > COOLDOWN_MAP_MAX) {
                    const oldest = chatCooldownUntil.keys().next().value;
                    if (oldest === undefined) break;
                    chatCooldownUntil.delete(oldest);
                }
            }
        }
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
interface FollowUpResult {
    action: IntentAction;
    rateLimited?: boolean;
    /**
     * True when an OpenAI call was actually made (and therefore a daily
     * budget unit was consumed). Callers that want to run a *second*
     * OpenAI request (e.g. the chat fallback) should skip their own
     * budget increment when this is true so a single user message only
     * ever charges 1 unit end-to-end.
     */
    apiCallMade?: boolean;
}

async function classifyFollowUp(
    chatId: number,
    text: string,
): Promise<FollowUpResult | null> {
    const byKeyword = parseIntentByKeywords(text);
    if (byKeyword !== "unknown") {
        return { action: byKeyword };
    }

    // Before spending an OpenAI call, check the in-process classification
    // cache. When a user asks the same fuzzy phrase twice within 10 minutes
    // we don't need to pay again.
    const cached = getCachedIntent(chatId, text);
    if (cached) return { action: cached };

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
        return { action: "unknown", rateLimited: true, apiCallMade: true };
    }

    const intent = await parseIntentWithOpenAI(text, {
        apiKey,
        model: OPENAI_MODEL,
    });
    if (intent.action === "unknown") {
        return { action: "unknown", apiCallMade: true };
    }
    setCachedIntent(chatId, text, intent.action);
    return { action: intent.action, apiCallMade: true };
}

/**
 * Reply conversationally using OpenAI when the user's message is neither
 * a URL nor a recognised follow-up intent. Consumes one AI-budget unit
 * per call; if the key is unset or the budget is exhausted we fall back
 * to the static "لم أفهم" reply so behaviour degrades gracefully.
 */
async function respondWithOpenAIChat(
    ctx: Context,
    chatId: number,
    text: string,
    options: { budgetAlreadyConsumed?: boolean } = {},
): Promise<void> {
    const s = t(langOf(chatId));
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        await ctx.reply(s.ai_intent_unknown);
        return;
    }

    // When the intent classifier already consumed a budget unit on this
    // message (e.g. it called OpenAI and got "unknown"), the chat
    // fallback re-uses that same budget unit instead of charging twice.
    // We still respect the cap by re-reading the counter without
    // incrementing.
    if (options.budgetAlreadyConsumed) {
        const usedSoFar = getAiCallsToday(chatId);
        if (usedSoFar > AI_DAILY_LIMIT) {
            await ctx.reply(s.ai_daily_limit(AI_DAILY_LIMIT));
            return;
        }
    } else {
        let used: number;
        try {
            used = incrementAiCallsToday(chatId);
        } catch (err) {
            console.error("incrementAiCallsToday failed:", err);
            await ctx.reply(s.ai_intent_unknown);
            return;
        }
        if (used > AI_DAILY_LIMIT) {
            await ctx.reply(s.ai_daily_limit(AI_DAILY_LIMIT));
            return;
        }
    }

    const reply = await chatWithOpenAI(text, {
        apiKey,
        model: OPENAI_MODEL,
        language: langOf(chatId),
    });
    if (!reply) {
        await ctx.reply(s.ai_intent_unknown);
        return;
    }
    await ctx.reply(reply, {
        link_preview_options: { is_disabled: true },
    });
}

/**
 * In-memory map of chatId → last URL that is waiting on a quality/format
 * selection. Cleared either when the user clicks a button, when the entry
 * expires (5 minutes), or when a new URL replaces it.
 *
 * Intentionally not persisted: losing the pending selection on redeploy is
 * harmless (the user just re-pastes the URL), and keeping this out of
 * SQLite avoids write churn on every URL message.
 */
interface PendingUpload {
    url: string;
    at: number;
    /** Message id of the menu message, so we can edit / delete it. */
    menuMessageId?: number;
    /**
     * Inline filename override (`URL | custom_name`) captured from the
     * message that opened the quality menu. Replayed when the callback
     * fires so the user gets their chosen name regardless of which
     * quality they pick.
     */
    customFilename?: string;
}
const pendingUploads: Map<number, PendingUpload> = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;

function getPendingUpload(chatId: number): PendingUpload | undefined {
    const p = pendingUploads.get(chatId);
    if (!p) return undefined;
    if (Date.now() - p.at > PENDING_TTL_MS) {
        pendingUploads.delete(chatId);
        return undefined;
    }
    return p;
}

/**
 * Render the quality / format inline keyboard and remember the pending URL
 * so the subsequent callback_query knows what to download. We do NOT embed
 * the URL in callback_data — Telegram limits that field to 64 bytes. We
 * look it up from the pendingUploads map keyed by chat id.
 */
async function presentQualityMenu(
    ctx: Context,
    url: string,
    customFilename?: string,
): Promise<void> {
    if (!ctx.chat) return;
    const chatId = ctx.chat.id;
    const s = t(langOf(chatId));

    const kb = new InlineKeyboard()
        .text(s.quality_btn_audio, "q:audio")
        .text(s.quality_btn_best, "q:best")
        .row()
        .text(s.quality_btn_1080, "q:1080")
        .text(s.quality_btn_720, "q:720")
        .row()
        .text(s.quality_btn_480, "q:480")
        .text(s.quality_btn_360, "q:360")
        .row()
        .text(s.quality_btn_document, "q:doc")
        .text(s.quality_btn_cancel, "q:cancel");

    let menuMessageId: number | undefined;
    try {
        const sent = await ctx.reply(s.quality_menu_title, {
            reply_markup: kb,
        });
        menuMessageId = sent.message_id;
    } catch (err) {
        console.error("Failed to send quality menu:", err);
        // If we can't render the menu, fall back to the legacy direct upload
        // so the user isn't left hanging.
        await runUpload(ctx, url, "default");
        return;
    }

    pendingUploads.set(chatId, {
        url,
        at: Date.now(),
        menuMessageId,
        customFilename,
    });
}

const QUALITY_MODE_MAP: Record<string, UploadMode> = {
    audio: "audio",
    best: "default",
    "1080": "q1080",
    "720": "q720",
    "480": "q480",
    "360": "q360",
    doc: "document",
};

/**
 * "Cancel" button on the progress status message. Aborts the active
 * upload for this chat (download + upload pipelines both unwind via
 * AbortSignal) and acknowledges the click. The runUpload finally block
 * takes care of the cooldown bookkeeping and the terminal edit of the
 * status message — we do NOT edit the message here to avoid racing
 * with the runUpload catch handler.
 */
bot.callbackQuery(CANCEL_UPLOAD_CALLBACK, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
        await ctx.answerCallbackQuery();
        return;
    }
    const s = t(langOf(chatId));
    const controller = chatUploadCancellers.get(chatId);
    if (!controller) {
        await ctx.answerCallbackQuery({ text: s.upload_cancelled });
        return;
    }
    try {
        controller.abort();
    } catch {
        // AbortController.abort() never throws, but be defensive.
    }
    await ctx.answerCallbackQuery({ text: s.upload_cancelled });
});

bot.callbackQuery(/^q:(audio|best|1080|720|480|360|doc|cancel)$/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
        await ctx.answerCallbackQuery();
        return;
    }
    const s = t(langOf(chatId));
    const choice = ctx.match?.[1] as string | undefined;

    const pending = getPendingUpload(chatId);
    if (!pending) {
        await ctx.answerCallbackQuery();
        try {
            await ctx.editMessageText(s.quality_expired);
        } catch {
            // ignore
        }
        return;
    }

    // Always acknowledge the button press promptly; the long upload that
    // may follow should not keep Telegram's "loading" spinner active.
    await ctx.answerCallbackQuery();

    // Remove the keyboard now that a choice was made so the user can't
    // accidentally click a second option while the first one is running.
    try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
        // ignore
    }

    pendingUploads.delete(chatId);

    if (choice === "cancel") {
        try {
            await ctx.editMessageText(s.quality_cancelled);
        } catch {
            // ignore
        }
        return;
    }

    const mode = choice ? QUALITY_MODE_MAP[choice] : undefined;
    if (!mode) return;

    // Delete the now-stale menu message so the chat timeline shows the
    // upload progress message directly. Failure is non-fatal.
    if (pending.menuMessageId) {
        try {
            await ctx.api.deleteMessage(chatId, pending.menuMessageId);
        } catch {
            // ignore
        }
    }

    await runUpload(ctx, pending.url, mode, pending.customFilename);
});

bot.on("message:text", async (ctx) => {
    // If the admin is mid-flow on an inline /admin button (typing a
    // chat_id to look up / ban / unban, or a broadcast body), consume
    // this message as the answer. Checked before the settings flow
    // because admin flows take priority for admin chats.
    if (await handleAdminPendingInputIfAny(ctx)) {
        return;
    }

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
    //     against the last remembered URL for this chat, falling back to
    //     a generic OpenAI chat reply when nothing else matches.
    if (!match) {
        if (!rememberProcessed(chatId, ctx.message.message_id)) return;

        const prefs = getUserPrefs(chatId);

        // If the user has a lastUrl we try the action classifier first,
        // because follow-up intents ("as audio", "as document", "retry")
        // are the hot path. Only when classification fails — or the user
        // has never sent a URL — do we spend an extra AI call to answer
        // conversationally.
        let classifierSpentBudget = false;
        if (prefs.lastUrl) {
            const resolved = await classifyFollowUp(chatId, text);
            if (resolved) {
                if (resolved.rateLimited) {
                    await ctx.reply(s.ai_daily_limit(AI_DAILY_LIMIT));
                    return;
                }
                // If the user already has an upload running we must
                // NEVER kick off another one here — that's exactly the
                // "AI re-triggered a duplicate upload" bug the product
                // guards against. For cancel-intent messages we abort
                // the active upload; for every other intent we just
                // tell the user to wait. Any message that classifies
                // as "cancel" is handled uniformly regardless of state:
                // if nothing is running the cancel becomes a no-op with
                // a polite ack.
                if (resolved.action === "cancel") {
                    const controller = chatUploadCancellers.get(chatId);
                    if (controller) {
                        try {
                            controller.abort();
                        } catch {
                            // ignore
                        }
                        await ctx.reply(s.upload_cancelled);
                    } else {
                        await ctx.reply(s.cancel_done);
                    }
                    return;
                }
                if (inFlightChats.has(chatId)) {
                    await ctx.reply(s.already_in_flight);
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
                    // fall through to chat fallback on "unknown"
                }
                // The classifier already spent a budget unit if it hit
                // OpenAI; the chat fallback must not charge again.
                classifierSpentBudget = resolved.apiCallMade === true;
            }
        }

        await respondWithOpenAIChat(ctx, chatId, text, {
            budgetAlreadyConsumed: classifierSpentBudget,
        });
        return;
    }

    // --- URL branch: present the user with an inline quality-selection
    //     menu instead of downloading right away.
    if (!rememberProcessed(chatId, ctx.message.message_id)) {
        console.warn(
            `Skipping duplicate delivery of message ${ctx.message.message_id} in chat ${chatId}`,
        );
        return;
    }

    const url = match[0];
    // Inline rename syntax: `URL | custom_name`. The URL regex stops at
    // the first whitespace so anything after it is free for us to parse.
    // We accept an optional space before/after the pipe and take the rest
    // of the line as the filename (spaces allowed). Strings that are
    // empty after trimming, or that contain characters Telegram rejects
    // in DocumentAttributeFilename, are ignored so the upload still
    // proceeds with the default name instead of failing late.
    const customFilename = extractInlineFilename(
        text,
        (match.index ?? 0) + url.length,
    );
    const prev = recentUrls.get(chatId);
    if (prev && prev.url === url && Date.now() - prev.at < 30_000) {
        await ctx.reply(s.duplicate_ignored);
        return;
    }
    recentUrls.set(chatId, { url, at: Date.now() });

    // Instagram profile URLs (`instagram.com/<username>` with no /p/,
    // /reel/, /tv/, /stories/ segment) carry no downloadable media on
    // their own. Tell the user clearly — the profile-info feature is
    // disabled for now (Instagram IP-blocks our host) and will be
    // revisited as a separate bot later.
    const igUsername = extractInstagramUsername(url);
    if (igUsername) {
        await ctx.reply(s.profile_link_not_supported);
        return;
    }

    // Obvious junk URLs (localhost, raw IPs, unknown TLDs that are also
    // not direct-file URLs) are rejected up-front with a friendly
    // message rather than being handed to yt-dlp which would error out
    // with a technical "Unsupported URL" message. For URLs without a
    // known file extension we fall back to a HEAD probe — many signed
    // CDN links (S3/R2/Dropbox, `/download?id=...`) advertise a media
    // `Content-Type` without ever putting the extension in the path,
    // and we want those to take the zero-egress external fast path too.
    if (!shouldUseYtDlp(url) && !isDirectFileUrl(url)) {
        const probed = await probeIsDirectFile(url);
        if (!probed) {
            await ctx.reply(s.unsupported_url);
            return;
        }
    }

    // Direct-download URLs (.mp4, .pdf, …) have no per-quality alternatives
    // — yt-dlp is not involved. Skip the menu for those and upload directly.
    if (!shouldUseYtDlp(url)) {
        await runUpload(ctx, url, "default", customFilename);
        return;
    }

    await presentQualityMenu(ctx, url, customFilename);
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
