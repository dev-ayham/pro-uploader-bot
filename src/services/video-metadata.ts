import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface VideoMetadata {
    durationSec: number;
    width: number;
    height: number;
}

/**
 * Run `ffprobe` on a video and return its duration / width / height, or
 * `null` if the file is not a decodable video (e.g. plain PDF / audio,
 * corrupted, or ffprobe missing). All probes are best-effort — a failure
 * here should never block an upload, only downgrade it to a regular
 * document.
 */
export function probeVideo(filePath: string): Promise<VideoMetadata | null> {
    return new Promise((resolve) => {
        const proc = spawn("ffprobe", [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "default=noprint_wrappers=1",
            filePath,
        ]);
        let stdout = "";
        proc.stdout.on("data", (c) => (stdout += c.toString()));
        proc.on("error", () => resolve(null));
        proc.on("close", (code) => {
            if (code !== 0) {
                resolve(null);
                return;
            }
            const parseKV = (key: string): number => {
                const m = new RegExp(`^${key}=([\\d.]+)`, "m").exec(stdout);
                if (!m) return 0;
                const n = parseFloat(m[1]);
                return Number.isFinite(n) ? n : 0;
            };
            const width = parseKV("width");
            const height = parseKV("height");
            const durationSec = parseKV("duration");
            if (width <= 0 || height <= 0) {
                resolve(null);
                return;
            }
            resolve({
                durationSec: durationSec > 0 ? durationSec : 0,
                width: Math.round(width),
                height: Math.round(height),
            });
        });
    });
}

/**
 * Telegram's custom-thumbnail rules: JPEG ≤ 320x320, ≤ 200 KB. Generate
 * one by seeking to the middle of the video, grabbing a single frame,
 * and scaling it down with aspect-preserving letterbox. Returns the
 * absolute path to the generated JPEG, or `null` if anything failed.
 *
 * Caller owns cleanup — we write into the given `destDir` so the
 * uploader can unlink it alongside the primary temp file.
 */
export async function generateVideoThumbnail(
    videoPath: string,
    meta: VideoMetadata,
    destDir: string,
): Promise<string | null> {
    const out = path.join(destDir, `thumb-${Date.now()}.jpg`);
    // Seek to the middle (or 0 for very short clips). The `-ss` before
    // `-i` form is fast-seek (keyframe-accurate, cheap) which matters
    // for 2 GB files.
    const seek = meta.durationSec > 1 ? meta.durationSec / 2 : 0;
    try {
        await ffmpegExtract(videoPath, seek, out, 3);
        if (!fs.existsSync(out) || fs.statSync(out).size === 0) return null;
        // Re-encode at lower quality if we tripped Telegram's 200 KB cap.
        if (fs.statSync(out).size > 200 * 1024) {
            await ffmpegExtract(videoPath, seek, out, 8);
        }
        return fs.existsSync(out) && fs.statSync(out).size > 0 ? out : null;
    } catch {
        try {
            fs.unlinkSync(out);
        } catch {
            // best-effort
        }
        return null;
    }
}

function ffmpegExtract(
    videoPath: string,
    atSeconds: number,
    outPath: string,
    qvalue: number,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn("ffmpeg", [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            atSeconds.toFixed(2),
            "-i",
            videoPath,
            "-frames:v",
            "1",
            "-vf",
            "scale='min(320,iw)':'min(320,ih)':force_original_aspect_ratio=decrease",
            "-q:v",
            qvalue.toString(),
            outPath,
        ]);
        let stderr = "";
        proc.stderr.on("data", (c) => (stderr += c.toString()));
        proc.on("error", reject);
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else
                reject(
                    new Error(
                        `ffmpeg thumb exited ${code}: ${stderr.trim()}`,
                    ),
                );
        });
    });
}
