import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolveDataDir } from "./db";

/**
 * Telegram requires custom thumbnails to be JPEG, ≤ 320x320 and ≤ 200 KB.
 * We re-encode every uploaded photo through ffmpeg to guarantee that,
 * regardless of what format the user sent.
 */
const THUMB_MAX_DIMENSION = 320;

export function resolveThumbsDir(): string {
    const dir = path.join(resolveDataDir(), "thumbs");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function thumbnailPath(chatId: number): string {
    return path.join(resolveThumbsDir(), `${chatId}.jpg`);
}

export function hasThumbnail(chatId: number): boolean {
    try {
        const p = thumbnailPath(chatId);
        return fs.existsSync(p) && fs.statSync(p).size > 0;
    } catch {
        return false;
    }
}

export function deleteThumbnail(chatId: number): void {
    try {
        fs.unlinkSync(thumbnailPath(chatId));
    } catch {
        // best-effort: already missing is fine
    }
}

/**
 * Take a source image file (whatever the user sent via the Telegram
 * photo picker) and produce a properly-sized JPEG at
 * `thumbs/<chatId>.jpg`. Uses ffmpeg's scale filter with aspect-preserving
 * letterbox so the thumbnail always fits within 320x320.
 */
export async function saveThumbnailFromFile(
    chatId: number,
    sourcePath: string,
): Promise<void> {
    const outPath = thumbnailPath(chatId);
    await ffmpegEncodeThumbnail(sourcePath, outPath);
    // Re-encode again at lower quality if we somehow exceed 200 KB.
    if (fs.statSync(outPath).size > 200 * 1024) {
        await ffmpegEncodeThumbnail(sourcePath, outPath, 8);
    }
}

function ffmpegEncodeThumbnail(
    sourcePath: string,
    outPath: string,
    qvalue: number = 3,
): Promise<void> {
    // ffmpeg's scale filter with force_original_aspect_ratio=decrease
    // guarantees we stay within the max box without distortion. -q:v 3
    // is visually lossless JPEG (lower = better, 2-5 is sane).
    return new Promise((resolve, reject) => {
        const proc = spawn("ffmpeg", [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            sourcePath,
            "-vf",
            `scale='min(${THUMB_MAX_DIMENSION},iw)':'min(${THUMB_MAX_DIMENSION},ih)':force_original_aspect_ratio=decrease`,
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
                    new Error(`ffmpeg (thumb) exited ${code}: ${stderr.trim()}`),
                );
        });
    });
}
