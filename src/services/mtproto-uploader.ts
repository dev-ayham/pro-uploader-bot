import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { CustomFile } from "telegram/client/uploads";
import { HTMLParser } from "telegram/extensions/html";
import { generateRandomLong } from "telegram/Helpers";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import * as mime from "mime-types";
import {
    DownloadResult,
    FileTooLargeError,
    downloadAudioWithYtDlp,
    downloadDirect,
    downloadWithYtDlp,
    shouldUseYtDlp,
    YtDlpOptions,
} from "./downloader";
import { resolveDataDir } from "./db";
import { createRateTracker, RichProgress } from "./progress";

const TEMP_DIR = "/tmp";

/**
 * Cap on the number of parallel upload workers used by GramJS's
 * `uploadFile`. GramJS splits the file into 128–512 KB parts and uploads
 * this many at once. The library's default is 1; we bump it up for
 * throughput — but on large files (approaching Telegram's 2 GB MTProto
 * limit) too many parallel `SaveBigFilePart` calls can trip
 * `FloodWaitError`s from the MTProto DC, which GramJS then sleeps on
 * inside the upload loop — producing the classic "upload stuck at 60 %"
 * symptom. Default `8` is a safe balance; override via the
 * `MTPROTO_UPLOAD_WORKERS` env var (lower to `4` if you still see
 * stalls, raise on a very fast network with small files).
 */
const MTPROTO_UPLOAD_WORKERS_MAX = (() => {
    const raw = process.env.MTPROTO_UPLOAD_WORKERS;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 8;
})();

/**
 * Pick the actual worker count to use for a file of the given size in
 * bytes. We scale down for larger files because the upper bound for
 * `saveBigFilePart` rate-limits is more easily tripped by many
 * concurrent parts, and a FLOOD_WAIT on a single part blocks the whole
 * batch (see the GramJS `uploadFile` loop — it awaits `Promise.all`
 * per batch).
 *
 *   - ≤ 250 MB  → full worker count (small files, low DC pressure)
 *   - ≤ 1   GB  → half (balances speed vs flood risk)
 *   - >  1   GB → quarter (protects against stalls on 2 GB-ish
 *                 uploads; never exceeds the configured cap)
 *
 * All tiers are clamped into [1, max] so a user who explicitly lowered
 * `MTPROTO_UPLOAD_WORKERS` to throttle concurrency (e.g. on a very
 * constrained network) never sees a larger worker count for larger
 * files than they would for small ones.
 */
function workersFor(size: number): number {
    const max = MTPROTO_UPLOAD_WORKERS_MAX;
    if (size <= 250 * 1024 * 1024) return max;
    if (size <= 1024 * 1024 * 1024)
        return Math.min(max, Math.max(1, Math.floor(max / 2)));
    return Math.min(max, Math.max(1, Math.floor(max / 4)));
}

/**
 * Adapter from a GramJS fraction-only progress callback to the bot's rich
 * {@link UploadProgress} stream. Given the known `totalBytes` of the file
 * being uploaded (from `fs.stat`) we can recover a smoothed speed / ETA
 * via {@link createRateTracker} even though Telegram's own progress API
 * emits only a normalised [0, 1] fraction.
 */
function makeUploadEmitter(
    totalBytes: number,
    onProgress: ((progress: UploadProgress) => void) | undefined,
): (fraction: number) => void {
    if (!onProgress) {
        return () => {
            // No subscriber — skip the bookkeeping entirely.
        };
    }
    const tracker = createRateTracker();
    return (fraction: number) => {
        const clamped = Math.min(1, Math.max(0, fraction));
        const doneBytes = Math.round(clamped * totalBytes);
        const rich = tracker(doneBytes, totalBytes);
        onProgress({
            phase: "upload",
            ...rich,
            // Use the caller-supplied fraction verbatim so we never round
            // the final 1.0 tick down to 0.999 because of byte math.
            fraction: clamped,
        });
    };
}

/**
 * Abort an upload if the GramJS progress callback has not advanced for
 * this many milliseconds. Without this guard, a FLOOD_WAIT returned by
 * Telegram for an impractically long duration (minutes) — or a silently
 * dead TCP connection — would leave the user's upload frozen forever at
 * whatever bucket it had last reached, and the chat's concurrency slot
 * would stay occupied until the process restarted.
 */
const UPLOAD_STALL_TIMEOUT_MS = (() => {
    const raw = process.env.UPLOAD_STALL_TIMEOUT_MS;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 180_000;
})();

/**
 * Wrap an upload-producing async function so that if no progress
 * fraction change is observed for `UPLOAD_STALL_TIMEOUT_MS`, the
 * returned promise rejects with a clear `Upload stalled` error. The
 * inner function receives a wrapped progress callback; call sites pass
 * their existing `onProgress` through that wrapper so the watchdog sees
 * the same fractions.
 */
async function withStallGuard<T>(
    innerProgress: ((fraction: number) => void) | undefined,
    fn: (
        progressCb: (fraction: number) => void,
    ) => Promise<T>,
): Promise<T> {
    let lastFraction = -1;
    let lastTick = Date.now();
    let rejectStall: ((err: Error) => void) | null = null;
    let settled = false;

    const tick = (fraction: number) => {
        if (fraction !== lastFraction) {
            lastFraction = fraction;
            lastTick = Date.now();
        }
        innerProgress?.(fraction);
    };

    const watchdog = new Promise<never>((_, reject) => {
        rejectStall = reject;
        const id = setInterval(() => {
            if (settled) {
                clearInterval(id);
                return;
            }
            if (Date.now() - lastTick > UPLOAD_STALL_TIMEOUT_MS) {
                clearInterval(id);
                reject(
                    new Error(
                        `Upload stalled: no progress for ${Math.round(
                            UPLOAD_STALL_TIMEOUT_MS / 1000,
                        )}s (last fraction ${lastFraction.toFixed(2)}). ` +
                            "Likely a Telegram FLOOD_WAIT or network drop.",
                    ),
                );
            }
        }, 5_000);
    });

    try {
        return await Promise.race([fn(tick), watchdog]);
    } finally {
        settled = true;
        // Detach the unused reject so the watchdog promise can be GC'd.
        rejectStall = null;
        void rejectStall;
    }
}

/**
 * Give up on `messages.sendMedia(InputMediaDocumentExternal)` after this
 * long. Telegram's DC tries to fetch the URL server-side before replying;
 * for unreachable CDNs (FASELHD edge nodes, private storage, expired
 * links) that can take 5–10 minutes to surface a `WEBPAGE_CURL_FAILED`,
 * during which the user's chat is frozen and the global concurrency slot
 * is held. 20 s is comfortably longer than a healthy Telegram fetch
 * (which typically completes in under a second) but short enough that a
 * bad CDN falls through to the legacy download+upload path almost
 * immediately.
 */
const EXTERNAL_URL_TIMEOUT_MS = (() => {
    const raw = process.env.EXTERNAL_URL_TIMEOUT_MS;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 20_000;
})();

export interface UploadProgress extends RichProgress {
    phase: "download" | "upload";
}

export interface UploadOptions {
    /** Force the file to be sent as a generic document (no video preview). */
    asDocument?: boolean;
    /** Send the media with Telegram's spoiler ("click to reveal") overlay. */
    spoiler?: boolean;
    /** String to prepend to the visible filename before the extension. */
    renamePrefix?: string;
    /** String to append to the visible filename before the extension. */
    renameSuffix?: string;
    /**
     * Cap the selected video stream height (e.g. 720 for "720p or lower").
     * Forwarded to yt-dlp's format selector. Ignored for direct-download
     * URLs (there's nothing to transcode on our side).
     */
    maxHeight?: number;
    /**
     * Absolute path to a JPEG (≤ 320x320, ≤ 200 KB) to use as the document /
     * video thumbnail. When unset the media is uploaded without a custom
     * thumb and Telegram generates one from the first frame.
     */
    thumbnailPath?: string;
    /**
     * Hook called after a successful upload but *before* the downloaded
     * file is deleted. Used by callers that want to do additional work on
     * the local file (e.g. extract screenshots, compute a hash) without
     * having to re-download. Throws are logged but don't fail the upload.
     */
    postUpload?: (filePath: string, filename: string) => Promise<void>;
}

/**
 * Apply optional prefix/suffix around the base name, keeping the extension
 * intact. `"my video.mp4"` with prefix `"[PRO] "` and suffix `" (final)"`
 * becomes `"[PRO] my video (final).mp4"`. Passes the original through when
 * both strings are empty.
 */
export function applyRename(
    original: string,
    prefix?: string,
    suffix?: string,
): string {
    if (!prefix && !suffix) return original;
    const dot = original.lastIndexOf(".");
    const hasExt = dot > 0 && dot < original.length - 1;
    const base = hasExt ? original.slice(0, dot) : original;
    const ext = hasExt ? original.slice(dot) : "";
    return `${prefix ?? ""}${base}${suffix ?? ""}${ext}`;
}

/**
 * Absolute path to the persisted GramJS session string. Lives on the
 * Railway volume (`/data/mtproto.session`) alongside the SQLite file so
 * the MTProto sign-in survives container restarts. Without persistence
 * every redeploy issues a fresh `auth.ImportBotAuthorization` and
 * Telegram rate-limits the bot token with a multi-minute flood-wait
 * after a handful of consecutive sign-ins.
 */
function sessionFilePath(): string {
    return path.join(resolveDataDir(), "mtproto.session");
}

function loadSessionString(): string {
    try {
        return fs.readFileSync(sessionFilePath(), "utf8").trim();
    } catch {
        return "";
    }
}

function saveSessionString(s: string): void {
    try {
        const file = sessionFilePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, s, { mode: 0o600 });
    } catch (err) {
        console.error("Failed to persist MTProto session:", err);
    }
}

export class MTProtoUploader {
    private client: TelegramClient;
    private readyPromise: Promise<void>;
    private ytDlpOptions: YtDlpOptions;

    constructor(
        apiId: number,
        apiHash: string,
        botToken: string,
        ytDlpOptions: YtDlpOptions = {},
    ) {
        // Rehydrate a previously-saved session so Railway redeploys do
        // not trigger a fresh auth.ImportBotAuthorization each time,
        // which Telegram throttles with a 4-5 minute flood-wait after
        // a few consecutive sign-ins.
        const storedSession = loadSessionString();
        this.client = new TelegramClient(
            new StringSession(storedSession),
            apiId,
            apiHash,
            { connectionRetries: 5 },
        );
        this.readyPromise = this.client
            .start({ botAuthToken: botToken })
            .then(() => {
                // Persist whatever session the client settled on. Safe to
                // call repeatedly — the string is idempotent once signed
                // in, so later invocations just overwrite with the same
                // bytes.
                try {
                    // GramJS types .save() as void but StringSession
                    // actually returns the serialised string — treat it
                    // as unknown and narrow at runtime.
                    const saved: unknown = (
                        this.client.session as unknown as {
                            save: () => unknown;
                        }
                    ).save();
                    if (typeof saved === "string" && saved.length > 0) {
                        saveSessionString(saved);
                    }
                } catch (err) {
                    console.error("Session save after start() failed:", err);
                }
            });
        // Attach a no-op catch so an early failure (bad token, network) does
        // not crash the process via Node's unhandled-rejection handler before
        // any caller has a chance to await and handle the error.
        this.readyPromise.catch(() => {});
        this.ytDlpOptions = ytDlpOptions;
    }

    async ready(): Promise<void> {
        await this.readyPromise;
    }

    async uploadFromUrl(
        chatId: number | string,
        url: string,
        caption: string,
        onProgress?: (progress: UploadProgress) => void,
        options: UploadOptions = {},
    ): Promise<void> {
        await this.readyPromise;

        // Zero-egress fast path: hand the URL to Telegram via
        // InputMediaDocumentExternal and let Telegram's own datacenters
        // fetch the bytes. The file never touches our host, which keeps
        // egress at $0 on any provider — a huge win at the 5 TB/month
        // scale where Railway egress alone would cost ~$500. Falls
        // through to the legacy download+upload path on any failure
        // (unreachable URL, unsupported mime, Telegram
        // WEBPAGE_MEDIA_EMPTY, timeout, etc.).
        //
        // Options that require a local file copy (thumbnail, spoiler,
        // filename rename) disable the fast path entirely — Telegram's
        // external-media API does not let us attach a thumb or override
        // the document attributes.
        //
        // `postUpload` (screenshots) does not disable the fast path:
        // when external delivery succeeds we still need the file for
        // ffmpeg, but we fetch it in the background after the user
        // already has their upload. On Railway this costs inbound
        // bandwidth (free) + the tiny screenshot outbound (~MBs),
        // saving the GBs of outbound that the full download+upload
        // path would have cost.
        const canUseExternal =
            !shouldUseYtDlp(url) &&
            !options.spoiler &&
            !options.thumbnailPath &&
            !options.renamePrefix &&
            !options.renameSuffix;
        if (canUseExternal) {
            onProgress?.({ phase: "upload", fraction: 0 });
            const sent = await this.sendByExternalUrl(
                chatId,
                url,
                caption,
                options,
                this.ytDlpOptions.maxFileSizeMb,
            );
            if (sent) {
                onProgress?.({ phase: "upload", fraction: 1 });
                if (options.postUpload) {
                    // Detached: the user already has their file, and the
                    // global concurrency slot (inFlightChats) has been
                    // released by the caller. Errors are logged and
                    // swallowed — a missing screenshot album is
                    // infinitely preferable to a crash.
                    void this.runPostUploadInBackground(
                        url,
                        options.postUpload,
                    );
                }
                return;
            }
            // External fetch failed — fall through to download+upload so
            // the user still gets their file.
        }

        // `downloaded` is set as soon as the download call returns *or* throws
        // partway through having written to /tmp. Keep it out of the try so
        // we can still clean up in the finally even if download itself fails.
        let downloaded: DownloadResult | undefined;
        try {
            if (shouldUseYtDlp(url)) {
                downloaded = await downloadWithYtDlp(
                    url,
                    TEMP_DIR,
                    (rich) => {
                        onProgress?.({ phase: "download", ...rich });
                    },
                    // Merge per-call overrides (max height) on top of the
                    // instance-wide cookies / user-agent / size-cap defaults.
                    { ...this.ytDlpOptions, maxHeight: options.maxHeight },
                );
            } else {
                // Plain direct URL (.mp4, .pdf, ...). yt-dlp's generic
                // extractor could also handle this but `axios` stream is
                // faster and avoids the subprocess overhead for the common
                // case.
                downloaded = await downloadDirect(url, TEMP_DIR, {
                    maxFileSizeMb: this.ytDlpOptions.maxFileSizeMb,
                    onProgress: (rich) => {
                        onProgress?.({ phase: "download", ...rich });
                    },
                });
            }

            const stats = fs.statSync(downloaded.filePath);
            // Apply the user's rename prefix/suffix to the *visible* filename
            // only. We never rename the file on disk — it's deleted in the
            // finally a few lines down.
            const visibleName = applyRename(
                downloaded.filename,
                options.renamePrefix,
                options.renameSuffix,
            );
            const toUpload = new CustomFile(
                visibleName,
                stats.size,
                downloaded.filePath,
            );

            if (options.spoiler) {
                // GramJS's high-level sendFile() does not expose the spoiler
                // flag, so we drop to raw API: upload the bytes, build an
                // InputMediaUploadedDocument with spoiler (+forceFile when
                // asDocument is also requested), then messages.SendMedia it.
                await this.sendWithSpoiler(
                    chatId,
                    toUpload,
                    visibleName,
                    caption,
                    options.asDocument === true,
                    onProgress,
                    options.thumbnailPath,
                );
            } else {
                await withStallGuard(
                    makeUploadEmitter(stats.size, onProgress),
                    (progressCb) =>
                        this.client.sendFile(chatId, {
                            file: toUpload,
                            caption,
                            parseMode: "html",
                            forceDocument: options.asDocument === true,
                            thumb: options.thumbnailPath,
                            workers: workersFor(stats.size),
                            progressCallback: progressCb,
                        }),
                );
            }

            if (options.postUpload) {
                try {
                    await options.postUpload(
                        downloaded.filePath,
                        downloaded.filename,
                    );
                } catch (err) {
                    // Never let a post-upload side-effect (screenshots, etc.)
                    // fail the primary operation the user asked for.
                    console.error("postUpload hook threw:", err);
                }
            }
        } finally {
            if (downloaded) {
                try {
                    fs.unlinkSync(downloaded.filePath);
                } catch {
                    // best-effort cleanup
                }
            }
        }
    }

    /**
     * Download audio only from a URL via yt-dlp (`-x --audio-format mp3`)
     * and send it as a Telegram audio message (native audio player, not a
     * generic document). Intended for AI intents of the form "give me the
     * audio" / "بدي ياه صوت" where the user has already received the full
     * video and now wants just the soundtrack.
     */
    async uploadAudioFromUrl(
        chatId: number | string,
        url: string,
        caption: string,
        onProgress?: (progress: UploadProgress) => void,
        options: Pick<UploadOptions, "renamePrefix" | "renameSuffix"> = {},
    ): Promise<void> {
        await this.readyPromise;

        let downloaded: DownloadResult | undefined;
        try {
            downloaded = await downloadAudioWithYtDlp(
                url,
                TEMP_DIR,
                (rich) => {
                    onProgress?.({ phase: "download", ...rich });
                },
                this.ytDlpOptions,
            );

            const stats = fs.statSync(downloaded.filePath);
            const visibleName = applyRename(
                downloaded.filename,
                options.renamePrefix,
                options.renameSuffix,
            );
            const toUpload = new CustomFile(
                visibleName,
                stats.size,
                downloaded.filePath,
            );

            // Native Telegram audio message: mime=audio/mpeg + the Audio
            // attribute so Telegram renders the inline player rather than a
            // generic document tile.
            await withStallGuard(
                makeUploadEmitter(stats.size, onProgress),
                (progressCb) =>
                    this.client.sendFile(chatId, {
                        file: toUpload,
                        caption,
                        parseMode: "html",
                        forceDocument: false,
                        voiceNote: false,
                        attributes: [
                            new Api.DocumentAttributeAudio({
                                duration: 0,
                                voice: false,
                                title: visibleName.replace(/\.mp3$/i, ""),
                            }),
                        ],
                        workers: workersFor(stats.size),
                        progressCallback: progressCb,
                    }),
            );
        } finally {
            if (downloaded) {
                try {
                    fs.unlinkSync(downloaded.filePath);
                } catch {
                    // best-effort cleanup
                }
            }
        }
    }

    /**
     * Attempt to deliver a direct HTTP(S) file URL via Telegram's
     * `InputMediaDocumentExternal` — the file is fetched server-side by
     * Telegram from the source CDN, so our host's outbound bandwidth
     * stays at zero.
     *
     * Returns `true` on success, `false` on any failure (unreachable
     * URL, Telegram rejecting the CDN, unsupported mime, size >
     * Telegram's 2 GB external-media cap, ...). Callers treat `false`
     * as a signal to fall back to the legacy download+upload path so
     * the user still gets their file.
     *
     * A pre-flight HEAD request enforces our own `MAX_FILE_SIZE_MB` cap
     * — without it, Telegram would happily pull a 10 GB file through
     * its CDN on the user's behalf, bypassing the per-upload limit we
     * advertise in `/admin`.
     */
    private async sendByExternalUrl(
        chatId: number | string,
        url: string,
        caption: string,
        options: UploadOptions,
        maxFileSizeMb?: number,
    ): Promise<boolean> {
        if (maxFileSizeMb && maxFileSizeMb > 0) {
            try {
                const head = await axios.head(url, {
                    maxRedirects: 5,
                    timeout: 10_000,
                    // Never throw on non-2xx — some CDNs reject HEAD;
                    // treat that as "size unknown" and let Telegram try.
                    validateStatus: () => true,
                });
                const len = Number(head.headers["content-length"]);
                if (
                    Number.isFinite(len) &&
                    len > maxFileSizeMb * 1024 * 1024
                ) {
                    throw new FileTooLargeError(maxFileSizeMb, len);
                }
            } catch (err) {
                // Pre-flight size failure is fatal to the upload — the
                // caller translates FileTooLargeError into a friendly
                // `file_too_large` message.
                if (err instanceof FileTooLargeError) throw err;
                // Any other HEAD failure (DNS, timeout, 405 Method Not
                // Allowed) just means "size unknown" — let Telegram try
                // and rely on its own 2 GB cap.
            }
        }
        // Race the sendFile against a hard timeout. When Telegram cannot
        // reach the source CDN (e.g. FASELHD edge nodes that block
        // non-browser UAs), `messages.sendMedia(InputMediaDocumentExternal)`
        // can hang for ~10 minutes before the DC finally replies with
        // WEBPAGE_CURL_FAILED. During that window the chat's upload slot
        // is held and the user sees total silence. We instead give up
        // after `EXTERNAL_URL_TIMEOUT_MS` (default 20 s) and fall through
        // to the local download+upload path, so slow CDNs degrade
        // gracefully instead of looking like a dead bot.
        //
        // GramJS has no cancellation, so the abandoned `sendFile` keeps
        // running in the background. If Telegram eventually accepts the
        // URL *after* we've already started the fallback download+upload,
        // the user would receive the same file twice. To prevent that we
        // attach a late-success handler that deletes the duplicate
        // message from the chat once it arrives.
        let timedOut = false;
        const sendPromise = this.client.sendFile(chatId, {
            file: url,
            caption,
            parseMode: "html",
            forceDocument: options.asDocument === true,
        });
        sendPromise.then(
            (msg) => {
                if (!timedOut) return;
                const id = (msg as { id?: unknown } | null | undefined)?.id;
                if (typeof id !== "number" && typeof id !== "bigint") return;
                this.client
                    .deleteMessages(chatId, [Number(id)], { revoke: true })
                    .catch((err: unknown) => {
                        console.warn(
                            `[external-url] failed to delete late duplicate: ${
                                err instanceof Error
                                    ? err.message
                                    : String(err)
                            }`,
                        );
                    });
            },
            // Swallow late rejections so Node doesn't raise
            // UnhandledPromiseRejection after we've already fallen back.
            () => {},
        );
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    timedOut = true;
                    reject(new Error("external-url timeout"));
                }, EXTERNAL_URL_TIMEOUT_MS);
                sendPromise.then(
                    () => {
                        clearTimeout(timer);
                        resolve();
                    },
                    (err) => {
                        clearTimeout(timer);
                        reject(err);
                    },
                );
            });
            return true;
        } catch (err) {
            // Log enough detail that we can tell whether Telegram is
            // rejecting the CDN (WEBPAGE_CURL_FAILED / WEBPAGE_MEDIA_EMPTY),
            // the file is too big (FILE_PART_*_MISSING), our own timeout
            // fired, or something unrelated happened. The caller will
            // retry via download+upload.
            console.warn(
                `[external-url] Telegram rejected direct fetch for ${url}: ${
                    err instanceof Error ? err.message : String(err)
                } — falling back to local download`,
            );
            return false;
        }
    }

    /**
     * Fire-and-forget: after an external-URL upload has succeeded, Telegram
     * already has the file but *we* don't have local bytes to feed to
     * ffmpeg for screenshot generation. Pull the file down in the
     * background, run the postUpload hook, and clean up. Any failure is
     * logged and swallowed — the primary upload has already been
     * delivered to the user so a missing screenshot album is strictly
     * non-fatal.
     */
    private async runPostUploadInBackground(
        url: string,
        postUpload: (filePath: string, filename: string) => Promise<void>,
    ): Promise<void> {
        let downloaded: DownloadResult | undefined;
        try {
            downloaded = await downloadDirect(url, TEMP_DIR, {
                maxFileSizeMb: this.ytDlpOptions.maxFileSizeMb,
            });
            await postUpload(downloaded.filePath, downloaded.filename);
        } catch (err) {
            console.error(
                "[external-url] background postUpload hook failed:",
                err instanceof Error ? err.message : err,
            );
        } finally {
            if (downloaded?.filePath) {
                try {
                    fs.unlinkSync(downloaded.filePath);
                } catch {
                    // Already gone — nothing to do.
                }
            }
        }
    }

    private async sendWithSpoiler(
        chatId: number | string,
        file: CustomFile,
        filename: string,
        captionHtml: string,
        forceFile: boolean,
        onProgress?: (progress: UploadProgress) => void,
        thumbnailPath?: string,
    ): Promise<void> {
        const mimeType =
            (mime.lookup(filename) as string) || "application/octet-stream";

        const uploadedFile = await withStallGuard(
            makeUploadEmitter(file.size, onProgress),
            (progressCb) =>
                this.client.uploadFile({
                    file,
                    workers: workersFor(file.size),
                    onProgress: (progress) => {
                        // GramJS's raw uploadFile reports progress as a
                        // BigInteger-ish fraction in [0,1].
                        const fraction =
                            typeof progress === "number"
                                ? progress
                                : Number(progress);
                        progressCb(fraction);
                    },
                }),
        );

        // Custom thumbnail (if any) is uploaded as a separate InputFile so we
        // can attach it to the InputMediaUploadedDocument below. Failures
        // here degrade gracefully to "no thumb" so the main upload is not
        // sabotaged by a bad thumbnail.
        let uploadedThumb: Api.TypeInputFile | undefined;
        if (thumbnailPath) {
            try {
                const thumbStats = fs.statSync(thumbnailPath);
                const thumbFile = new CustomFile(
                    "thumb.jpg",
                    thumbStats.size,
                    thumbnailPath,
                );
                uploadedThumb = await this.client.uploadFile({
                    file: thumbFile,
                    workers: 1,
                });
            } catch (err) {
                console.error("thumbnail upload failed, continuing without:", err);
            }
        }

        const attributes: Api.TypeDocumentAttribute[] = [
            new Api.DocumentAttributeFilename({ fileName: filename }),
        ];
        if (!forceFile && mimeType.startsWith("video/")) {
            // Keep video playable inside Telegram. Real dimensions / duration
            // would require probing with ffprobe; 0s are accepted and the
            // client computes them on demand.
            attributes.push(
                new Api.DocumentAttributeVideo({
                    duration: 0,
                    w: 0,
                    h: 0,
                    supportsStreaming: true,
                }),
            );
        }

        const media = new Api.InputMediaUploadedDocument({
            file: uploadedFile,
            thumb: uploadedThumb,
            mimeType,
            attributes,
            spoiler: true,
            forceFile,
        });

        // HTML entities must be pre-parsed because messages.SendMedia doesn't
        // take a parseMode of its own.
        const [parsedText, entities] = HTMLParser.parse(captionHtml);

        const peer = await this.client.getInputEntity(chatId);
        await this.client.invoke(
            new Api.messages.SendMedia({
                peer,
                media,
                message: parsedText,
                entities,
                randomId: generateRandomLong(),
            }),
        );
    }
}
