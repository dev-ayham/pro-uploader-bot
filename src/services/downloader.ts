import { spawn } from "child_process";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { createRateTracker, RichProgress } from "./progress";

/**
 * Callback surface shared by both the direct-HTTP and yt-dlp downloaders.
 * Emits richer telemetry than a bare fraction so the UI can render a
 * progress line with bytes / speed / ETA — see `src/services/progress.ts`.
 */
export type DownloadProgress = (rich: RichProgress) => void;

/**
 * Parse a single yt-dlp `[download]` progress line into a {@link RichProgress}.
 * yt-dlp already prints the exact size / speed / ETA the user cares about;
 * extracting them avoids an extra rate-tracker and matches what the
 * upstream CLI would show.
 *
 *   `[download]  42.3% of   10.2MiB at   1.5MiB/s ETA 00:04`
 *   `[download]  42.3% of ~10.2MiB at   1.5MiB/s ETA 00:04`
 *   `[download] 100% of   10.2MiB in 00:06`
 */
export function parseYtDlpProgress(line: string): RichProgress | null {
    const pct = /\[download\]\s+([\d.]+)%/.exec(line);
    if (!pct) return null;
    const fraction = Math.min(1, Math.max(0, parseFloat(pct[1]) / 100));
    const rich: RichProgress = { fraction };

    const sizeMatch = /of\s+~?\s*([\d.]+)\s*([KMGT]i?B)/i.exec(line);
    if (sizeMatch) {
        const total = parseSizeToBytes(sizeMatch[1], sizeMatch[2]);
        if (total !== undefined) {
            rich.totalBytes = total;
            rich.doneBytes = Math.round(total * fraction);
        }
    }

    const speedMatch = /at\s+([\d.]+)\s*([KMGT]?i?B)\/s/i.exec(line);
    if (speedMatch) {
        const bps = parseSizeToBytes(speedMatch[1], speedMatch[2]);
        if (bps !== undefined) rich.speedBps = bps;
    }

    const etaMatch = /ETA\s+(\d+):(\d+)(?::(\d+))?/.exec(line);
    if (etaMatch) {
        const a = parseInt(etaMatch[1], 10);
        const b = parseInt(etaMatch[2], 10);
        const c = etaMatch[3] !== undefined ? parseInt(etaMatch[3], 10) : NaN;
        rich.etaSec = Number.isFinite(c) ? a * 3600 + b * 60 + c : a * 60 + b;
    }

    return rich;
}

function parseSizeToBytes(value: string, unit: string): number | undefined {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return undefined;
    const u = unit.toUpperCase();
    // Support both SI-ish (KB/MB/GB/TB) and yt-dlp's binary spellings
    // (KiB/MiB/GiB/TiB). yt-dlp actually reports in IEC but tolerate both.
    const mult: Record<string, number> = {
        B: 1,
        KB: 1024,
        KIB: 1024,
        MB: 1024 ** 2,
        MIB: 1024 ** 2,
        GB: 1024 ** 3,
        GIB: 1024 ** 3,
        TB: 1024 ** 4,
        TIB: 1024 ** 4,
    };
    const m = mult[u];
    return m ? Math.round(n * m) : undefined;
}

/**
 * Number of HLS/DASH fragments yt-dlp fetches in parallel per download,
 * passed as `--concurrent-fragments`. Higher values typically deliver a
 * 3-8x speedup on YouTube/IG/TikTok fragmented MP4s, but raise peak
 * memory and can trip rate-limits on pickier CDNs — 8 is a good balance
 * on Railway. Override with the `YT_DLP_CONCURRENT_FRAGMENTS` env var on
 * busier hosts.
 */
const YT_DLP_CONCURRENT_FRAGMENTS = (() => {
    const raw = process.env.YT_DLP_CONCURRENT_FRAGMENTS;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 8;
})();

/**
 * Hostnames that should always be downloaded via yt-dlp rather than a plain
 * HTTP GET. yt-dlp's generic extractor could technically handle anything, but
 * we keep the plain-HTTP path for direct file URLs because it is faster and
 * avoids spawning a subprocess for the common case.
 */
const YT_DLP_HOSTS = new Set([
    "instagram.com",
    "www.instagram.com",
    "m.instagram.com",
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "tiktok.com",
    "www.tiktok.com",
    "vm.tiktok.com",
    "vt.tiktok.com",
    "twitter.com",
    "www.twitter.com",
    "x.com",
    "www.x.com",
    "mobile.twitter.com",
    "facebook.com",
    "www.facebook.com",
    "m.facebook.com",
    "fb.watch",
    "reddit.com",
    "www.reddit.com",
    "old.reddit.com",
    "v.redd.it",
    "vimeo.com",
    "www.vimeo.com",
    "twitch.tv",
    "www.twitch.tv",
    "clips.twitch.tv",
    "dailymotion.com",
    "www.dailymotion.com",
    "soundcloud.com",
    "www.soundcloud.com",
]);

export function shouldUseYtDlp(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return YT_DLP_HOSTS.has(host);
    } catch {
        return false;
    }
}

/**
 * Common file extensions we're willing to download directly over HTTP.
 * These are a superset of what Telegram renders natively (video / audio
 * / image / document) — anything we can't preview is still uploadable
 * as a regular file.
 */
const DIRECT_FILE_EXTS = new Set([
    // video
    ".mp4",
    ".m4v",
    ".mov",
    ".mkv",
    ".webm",
    ".avi",
    ".flv",
    ".wmv",
    ".ts",
    ".3gp",
    // audio
    ".mp3",
    ".m4a",
    ".aac",
    ".flac",
    ".ogg",
    ".wav",
    ".opus",
    ".wma",
    // image
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".tiff",
    ".heic",
    // document
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".txt",
    ".rtf",
    ".epub",
    ".mobi",
    // archive
    ".zip",
    ".rar",
    ".7z",
    ".tar",
    ".gz",
    ".bz2",
    ".xz",
    // misc
    ".iso",
    ".apk",
    ".exe",
    ".dmg",
]);

/**
 * Best-effort check for a "direct file URL" — i.e. a URL whose path
 * ends with a known downloadable extension. Used to reject obvious
 * junk URLs up-front with a friendly message before handing off to
 * yt-dlp or a plain HTTP GET.
 */
export function isDirectFileUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return false;
        }
        const pathname = parsed.pathname.toLowerCase();
        const dot = pathname.lastIndexOf(".");
        if (dot < 0) return false;
        const ext = pathname.slice(dot);
        return DIRECT_FILE_EXTS.has(ext);
    } catch {
        return false;
    }
}

/**
 * Media MIME type prefixes that we treat as uploadable when the URL has
 * no recognizable file extension (signed S3/R2 links, `/download?id=...`
 * style CDN URLs, Dropbox `?dl=1`, etc.). `application/octet-stream` is
 * included on purpose — many CDNs serve binary downloads that way and it
 * is still legitimately a file. `text/html` explicitly is NOT accepted,
 * which is what distinguishes a download URL from a landing page.
 */
const MEDIA_MIME_PREFIXES = [
    "video/",
    "audio/",
    "image/",
    "application/pdf",
    "application/zip",
    "application/x-zip",
    "application/x-rar",
    "application/x-7z",
    "application/x-tar",
    "application/gzip",
    "application/octet-stream",
    "application/epub",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
];

/**
 * Async fallback for {@link isDirectFileUrl} that accepts URLs with no
 * recognizable extension when the server advertises a downloadable MIME
 * type via `HEAD`. This lets pre-signed S3/R2/Dropbox links, CDN
 * `/download?id=...` endpoints, and similar opaque URLs take the same
 * zero-egress `InputMediaDocumentExternal` fast path as `.mp4`-style
 * direct links.
 *
 * Returns `true` for URLs that either (a) already match
 * {@link isDirectFileUrl}, or (b) return a media-ish `Content-Type` on
 * HEAD. Returns `false` for landing pages (`text/html`) or unreachable
 * hosts. Never throws — callers treat `false` as "probably not a direct
 * file, fall back to rejection".
 */
export async function probeIsDirectFile(url: string): Promise<boolean> {
    if (isDirectFileUrl(url)) return true;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return false;
        }
    } catch {
        return false;
    }
    try {
        const res = await axios.head(url, {
            maxRedirects: 5,
            timeout: 5_000,
            validateStatus: () => true,
        });
        const raw = res.headers["content-type"];
        const ct =
            typeof raw === "string"
                ? raw.toLowerCase()
                : Array.isArray(raw)
                ? String(raw[0] ?? "").toLowerCase()
                : "";
        if (!ct) return false;
        const disposition =
            typeof res.headers["content-disposition"] === "string"
                ? res.headers["content-disposition"].toLowerCase()
                : "";
        // Explicit `attachment` disposition always wins — CDNs use it to
        // force a download regardless of content type.
        if (disposition.includes("attachment")) return true;
        return MEDIA_MIME_PREFIXES.some((p) => ct.startsWith(p));
    } catch {
        return false;
    }
}

export interface DownloadResult {
    filePath: string;
    filename: string;
}

/**
 * Download via plain HTTP for direct file URLs. When `maxFileSizeMb` is set
 * and the remote server advertises a larger `Content-Length`, a
 * {@link FileTooLargeError} is thrown without streaming any bytes.
 */
export async function downloadDirect(
    url: string,
    destDir: string,
    options: {
        maxFileSizeMb?: number;
        onProgress?: DownloadProgress;
        signal?: AbortSignal;
    } = {},
): Promise<DownloadResult> {
    const parsedUrl = new URL(url);
    const filename =
        path.basename(parsedUrl.pathname).split("?")[0] || `file_${Date.now()}`;
    const filePath = path.join(destDir, `${Date.now()}_${filename}`);

    if (options.signal?.aborted) throw new DownloadCancelledError();
    const response = await axios({
        url,
        method: "GET",
        responseType: "stream",
        signal: options.signal,
    });

    // Server-advertised size check. Not all servers return Content-Length
    // (e.g. chunked transfer), in which case we rely on the per-chunk guard
    // inside the stream pipeline below.
    const limitMb = options.maxFileSizeMb;
    const limitBytes = limitMb && limitMb > 0 ? limitMb * 1024 * 1024 : 0;
    const rawLength = Number(response.headers["content-length"]);
    const contentLength = Number.isFinite(rawLength) && rawLength > 0
        ? rawLength
        : undefined;
    if (
        limitBytes > 0 &&
        contentLength !== undefined &&
        contentLength > limitBytes
    ) {
        response.data.destroy?.();
        throw new FileTooLargeError(limitMb!, contentLength);
    }

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    // Streaming guard: abort mid-download if the body exceeds the limit
    // despite a missing / lying Content-Length header. We must pass an
    // Error into .destroy() — a bare .destroy() only emits 'close', not
    // 'error', so the Promise below (which awaits 'finish' or 'error')
    // would otherwise hang forever and leak the chat's concurrency slot.
    let received = 0;
    let sizeExceeded = false;
    let cancelled = false;
    const sizeLimitError = new Error("__file_too_large__");
    const cancelError = new Error("__cancelled__");

    // Propagate a user-initiated cancellation mid-stream: tear down the
    // HTTP response and the on-disk writer so the caller's await
    // resolves quickly with a clear error rather than blocking on a
    // request that no one is listening to any more.
    const onAbort = () => {
        cancelled = true;
        try { response.data.destroy?.(cancelError); } catch { /* */ }
        try { writer.destroy(cancelError); } catch { /* */ }
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    // Progress tracker: only instantiated when the caller wants updates.
    // Emits no more than ~4 ticks / second so Telegram rate limits are
    // never threatened regardless of how fast bytes arrive. Every
    // incoming chunk still updates `received` (that counter is used by
    // the size guard).
    const tracker = options.onProgress ? createRateTracker() : null;
    let lastEmit = 0;
    response.data.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (limitBytes > 0 && received > limitBytes) {
            sizeExceeded = true;
            response.data.destroy?.(sizeLimitError);
            writer.destroy(sizeLimitError);
            return;
        }
        if (tracker && options.onProgress) {
            const now = Date.now();
            if (now - lastEmit >= 250) {
                lastEmit = now;
                try {
                    options.onProgress(tracker(received, contentLength));
                } catch {
                    // Callback errors must never kill the download.
                }
            }
        }
    });

    try {
        await new Promise<void>((resolve, reject) => {
            writer.on("finish", () => resolve());
            writer.on("error", reject);
            response.data.on("error", reject);
        });
    } catch (err) {
        if (cancelled) {
            try { fs.unlinkSync(filePath); } catch { /* */ }
            throw new DownloadCancelledError();
        }
        if (sizeExceeded) {
            try {
                fs.unlinkSync(filePath);
            } catch {
                // best-effort cleanup
            }
            throw new FileTooLargeError(limitMb!, received);
        }
        // Clean up the partial file before propagating the error so the
        // caller does not have to know we ever created one.
        try {
            writer.destroy();
            response.data.destroy?.();
            fs.unlinkSync(filePath);
        } catch {
            // best-effort cleanup
        }
        throw err;
    } finally {
        options.signal?.removeEventListener("abort", onAbort);
    }

    // Final 100% tick so the UI snaps to a complete bar instead of leaving
    // the last partial tick (e.g. 97%) on screen while the upload phase
    // starts.
    if (options.onProgress) {
        try {
            const total = contentLength ?? received;
            options.onProgress({
                fraction: 1,
                doneBytes: received,
                totalBytes: total,
            });
        } catch {
            // Ignored
        }
    }

    return { filePath, filename };
}

/**
 * Download via yt-dlp for platform URLs (Instagram, YouTube, TikTok, ...).
 * Resolves with the absolute path of the downloaded file.
 */
export interface YtDlpOptions {
    /**
     * Absolute path to a Netscape-format cookies.txt file. When set, yt-dlp
     * is invoked with `--cookies <path>` so it can access content that
     * requires a logged-in session (private Instagram, age-restricted
     * YouTube, rate-limit-protected URLs, etc).
     */
    cookiesFile?: string;
    /** Browser User-Agent string forwarded with `--user-agent`. */
    userAgent?: string;
    /**
     * Cap the selected video stream height (e.g. 720 for "720p or lower").
     * Implemented via yt-dlp's `-f` format selector so the merged output
     * is still the best quality that fits the cap. Falls back to "best"
     * if the requested height is unavailable.
     */
    maxHeight?: number;
    /**
     * Hard cap on the downloaded file size in megabytes. When set, passed to
     * yt-dlp as `--max-filesize` so the extractor refuses to start a download
     * that exceeds this limit instead of letting it fill the disk.
     */
    maxFileSizeMb?: number;
}

/**
 * Error thrown by {@link downloadDirect} when the remote server advertises a
 * `Content-Length` larger than the configured per-upload limit. Callers
 * should translate this to a user-facing message rather than a stack trace.
 */
export class FileTooLargeError extends Error {
    constructor(public readonly limitMb: number, public readonly actualBytes: number) {
        super(`File exceeds ${limitMb}MB limit (actual ${actualBytes} bytes)`);
        this.name = "FileTooLargeError";
    }
}

/**
 * Thrown when the current download is interrupted by a user-initiated
 * cancel (progress-message "Cancel" button, admin kill, …). Callers
 * should translate this to a calm in-chat confirmation rather than a
 * stack trace.
 */
export class DownloadCancelledError extends Error {
    constructor() {
        super("Download cancelled");
        this.name = "DownloadCancelledError";
    }
}

export async function downloadWithYtDlp(
    url: string,
    destDir: string,
    onProgress?: DownloadProgress,
    options: YtDlpOptions & { signal?: AbortSignal } = {},
): Promise<DownloadResult> {
    await fs.promises.mkdir(destDir, { recursive: true });

    // Use a unique prefix so concurrent downloads do not collide on %(id)s.
    const prefix = `${Date.now()}`;
    const outputTemplate = path.join(
        destDir,
        `${prefix}_%(title).80B_%(id)s.%(ext)s`,
    );

    // When the caller asks for a max height we still let yt-dlp merge the
    // best video+audio tracks that fit the cap so the output is a normal
    // playable mp4, not a video-only stream.
    const formatSelector =
        options.maxHeight && options.maxHeight > 0
            ? `bestvideo[height<=${options.maxHeight}]+bestaudio/best[height<=${options.maxHeight}]/best`
            : "best[ext=mp4]/best[ext=mkv]/best";

    const args = [
        "--no-playlist",
        "--no-warnings",
        "--no-part",
        "--restrict-filenames",
        "--newline",
        "-f",
        formatSelector,
        "--merge-output-format",
        "mp4",
        "-o",
        outputTemplate,
        "--print",
        "after_move:filepath",
        "--retries",
        "10",
        "--fragment-retries",
        "10",
        // Parallelism: pull HLS/DASH fragments concurrently for a 3-8x
        // speedup on fragmented MP4 (YouTube, IG Reels, TikTok) versus
        // the single-connection default.
        "--concurrent-fragments",
        `${YT_DLP_CONCURRENT_FRAGMENTS}`,
    ];

    if (options.maxFileSizeMb && options.maxFileSizeMb > 0) {
        args.push("--max-filesize", `${options.maxFileSizeMb}M`);
    }
    if (options.cookiesFile && fs.existsSync(options.cookiesFile)) {
        args.push("--cookies", options.cookiesFile);
    }
    if (options.userAgent) {
        args.push("--user-agent", options.userAgent);
    }

    args.push(url);

    return runYtDlp({
        args,
        destDir,
        prefix,
        onProgress,
        signal: options.signal,
    });
}

/**
 * Shared yt-dlp runner used by both the video and audio download paths.
 * Handles progress streaming, partial cleanup, and cooperative
 * cancellation via `AbortSignal` (SIGTERM, then SIGKILL after 3 s).
 */
function runYtDlp(opts: {
    args: string[];
    destDir: string;
    prefix: string;
    onProgress?: DownloadProgress;
    signal?: AbortSignal;
}): Promise<DownloadResult> {
    const { args, destDir, prefix, onProgress, signal } = opts;
    return new Promise<DownloadResult>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DownloadCancelledError());
            return;
        }
        const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let cancelled = false;

        const onAbort = () => {
            cancelled = true;
            try { proc.kill("SIGTERM"); } catch { /* */ }
            setTimeout(() => {
                try { proc.kill("SIGKILL"); } catch { /* */ }
            }, 3_000).unref();
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        proc.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        proc.stderr.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            stderr += text;
            if (!onProgress) return;
            for (const line of text.split("\n")) {
                const rich = parseYtDlpProgress(line);
                if (rich) {
                    try {
                        onProgress(rich);
                    } catch {
                        // ignore callback errors
                    }
                }
            }
        });

        const cleanupPartials = () => {
            try {
                for (const entry of fs.readdirSync(destDir)) {
                    if (entry.startsWith(`${prefix}_`)) {
                        try {
                            fs.unlinkSync(path.join(destDir, entry));
                        } catch {
                            // ignore
                        }
                    }
                }
            } catch {
                // ignore
            }
        };

        proc.on("error", (err) => {
            signal?.removeEventListener("abort", onAbort);
            cleanupPartials();
            reject(cancelled ? new DownloadCancelledError() : err);
        });

        proc.on("close", (code) => {
            signal?.removeEventListener("abort", onAbort);
            if (cancelled) {
                cleanupPartials();
                reject(new DownloadCancelledError());
                return;
            }
            if (code !== 0) {
                cleanupPartials();
                reject(
                    new Error(
                        `yt-dlp exited with code ${code}: ${stderr.trim() || stdout.trim()}`,
                    ),
                );
                return;
            }
            const lines = stdout
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.length > 0);
            const filePath = lines[lines.length - 1];
            if (!filePath || !fs.existsSync(filePath)) {
                reject(
                    new Error(
                        `yt-dlp completed but the output file was not found (stdout: ${stdout.trim()})`,
                    ),
                );
                return;
            }
            resolve({ filePath, filename: path.basename(filePath) });
        });
    });
}

/**
 * Download the best-available audio stream and transcode it to MP3 via
 * ffmpeg (yt-dlp does that for us when --audio-format=mp3 is set).
 * Intended for "give me the audio" follow-ups where the user already saw
 * the full video upload and just wants the soundtrack.
 */
export async function downloadAudioWithYtDlp(
    url: string,
    destDir: string,
    onProgress?: DownloadProgress,
    options: YtDlpOptions & { signal?: AbortSignal } = {},
): Promise<DownloadResult> {
    await fs.promises.mkdir(destDir, { recursive: true });
    const prefix = `${Date.now()}`;
    const outputTemplate = path.join(
        destDir,
        `${prefix}_%(title).80B_%(id)s.%(ext)s`,
    );

    const args = [
        "--no-playlist",
        "--no-warnings",
        "--no-part",
        "--restrict-filenames",
        "--newline",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "-o",
        outputTemplate,
        "--print",
        "after_move:filepath",
        "--retries",
        "10",
        "--fragment-retries",
        "10",
        "--concurrent-fragments",
        `${YT_DLP_CONCURRENT_FRAGMENTS}`,
    ];

    if (options.maxFileSizeMb && options.maxFileSizeMb > 0) {
        args.push("--max-filesize", `${options.maxFileSizeMb}M`);
    }
    if (options.cookiesFile && fs.existsSync(options.cookiesFile)) {
        args.push("--cookies", options.cookiesFile);
    }
    if (options.userAgent) {
        args.push("--user-agent", options.userAgent);
    }
    args.push(url);

    return runYtDlp({
        args,
        destDir,
        prefix,
        onProgress,
        signal: options.signal,
    });
}
