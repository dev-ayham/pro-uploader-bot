import { spawn } from "child_process";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";

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

export interface DownloadResult {
    filePath: string;
    filename: string;
}

/**
 * Download via plain HTTP for direct file URLs.
 */
export async function downloadDirect(
    url: string,
    destDir: string,
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

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    try {
        await new Promise<void>((resolve, reject) => {
            writer.on("finish", () => resolve());
            writer.on("error", reject);
            response.data.on("error", reject);
        });
    } catch (err) {
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

    const args = [
        "--no-playlist",
        "--no-warnings",
        "--no-part",
        "--restrict-filenames",
        "--newline",
        "-f",
        "best[ext=mp4]/best[ext=mkv]/best",
        "-o",
        outputTemplate,
        "--print",
        "after_move:filepath",
        // Small polite delay between retries to avoid triggering Instagram /
        // TikTok rate-limits when the same IP hits them repeatedly.
        "--retries",
        "10",
        "--fragment-retries",
        "10",
        "--sleep-requests",
        "1",
    ];

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
        "--sleep-requests",
        "1",
    ];

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
