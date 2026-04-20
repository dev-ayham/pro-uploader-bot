import { spawn } from "child_process";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";

/**
 * Number of parallel HTTP connections yt-dlp uses per download, passed to
 * both `--concurrent-fragments` (for HLS/DASH fragmented streams) and
 * `-N` (for multi-range byte-stream downloads). Higher values typically
 * deliver a 3-8x speedup on YouTube/IG/TikTok fragmented MP4s, but raise
 * peak memory and can trip rate-limits on pickier CDNs — 8 is a good
 * balance on Railway. Override with the `YT_DLP_CONCURRENT_FRAGMENTS`
 * env var on busier hosts.
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
    options: { maxFileSizeMb?: number } = {},
): Promise<DownloadResult> {
    const parsedUrl = new URL(url);
    const filename =
        path.basename(parsedUrl.pathname).split("?")[0] || `file_${Date.now()}`;
    const filePath = path.join(destDir, `${Date.now()}_${filename}`);

    const response = await axios({
        url,
        method: "GET",
        responseType: "stream",
    });

    // Server-advertised size check. Not all servers return Content-Length
    // (e.g. chunked transfer), in which case we rely on the per-chunk guard
    // inside the stream pipeline below.
    const limitMb = options.maxFileSizeMb;
    const limitBytes = limitMb && limitMb > 0 ? limitMb * 1024 * 1024 : 0;
    const contentLength = Number(response.headers["content-length"]);
    if (
        limitBytes > 0 &&
        Number.isFinite(contentLength) &&
        contentLength > limitBytes
    ) {
        response.data.destroy?.();
        throw new FileTooLargeError(limitMb!, contentLength);
    }

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    // Streaming guard: abort mid-download if the body exceeds the limit
    // despite a missing / lying Content-Length header.
    let received = 0;
    let sizeExceeded = false;
    if (limitBytes > 0) {
        response.data.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > limitBytes) {
                sizeExceeded = true;
                response.data.destroy?.();
                writer.destroy();
            }
        });
    }

    try {
        await new Promise<void>((resolve, reject) => {
            writer.on("finish", () => resolve());
            writer.on("error", reject);
            response.data.on("error", reject);
        });
    } catch (err) {
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

export async function downloadWithYtDlp(
    url: string,
    destDir: string,
    onProgress?: (fraction: number) => void,
    options: YtDlpOptions = {},
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
        // Parallelism: pull HLS/DASH fragments concurrently and open
        // multiple connections to the CDN. On anything that streams as
        // fragmented MP4 (YouTube, IG Reels, TikTok) this is typically
        // a 3-8x speedup versus the single-connection default.
        "--concurrent-fragments",
        `${YT_DLP_CONCURRENT_FRAGMENTS}`,
        "-N",
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

    return await new Promise<DownloadResult>((resolve, reject) => {
        const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        proc.stderr.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            stderr += text;
            if (!onProgress) return;
            // yt-dlp progress lines look like:
            //   [download]  42.3% of   10.2MiB at   1.5MiB/s ETA 00:04
            for (const line of text.split("\n")) {
                const m = /\[download\]\s+([\d.]+)%/.exec(line);
                if (m) {
                    const fraction = Math.min(
                        1,
                        Math.max(0, parseFloat(m[1]) / 100),
                    );
                    try {
                        onProgress(fraction);
                    } catch {
                        // ignore callback errors
                    }
                }
            }
        });

        // Best-effort cleanup of any partial files yt-dlp may have written
        // under our unique prefix when the process fails.
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
            cleanupPartials();
            reject(err);
        });

        proc.on("close", (code) => {
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
    onProgress?: (fraction: number) => void,
    options: YtDlpOptions = {},
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
        "-N",
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

    return await new Promise<DownloadResult>((resolve, reject) => {
        const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        proc.stderr.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            stderr += text;
            if (!onProgress) return;
            for (const line of text.split("\n")) {
                const m = /\[download\]\s+([\d.]+)%/.exec(line);
                if (m) {
                    const fraction = Math.min(
                        1,
                        Math.max(0, parseFloat(m[1]) / 100),
                    );
                    try {
                        onProgress(fraction);
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
            cleanupPartials();
            reject(err);
        });

        proc.on("close", (code) => {
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
                        `yt-dlp completed but the audio file was not found (stdout: ${stdout.trim()})`,
                    ),
                );
                return;
            }
            resolve({ filePath, filename: path.basename(filePath) });
        });
    });
}
