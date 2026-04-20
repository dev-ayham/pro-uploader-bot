import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Extract `count` equidistant JPEG screenshots from a video file. Returns
 * the absolute paths of the generated files, in chronological order.
 *
 * Uses `ffprobe` to read duration, then one `ffmpeg` invocation per frame
 * (seek-then-decode). This is O(count) seeks rather than one full decode,
 * which matters for longer videos on Railway's small instances.
 *
 * On any failure we best-effort clean up the partial files before
 * rethrowing so we never leave orphan JPEGs on the shared /tmp volume.
 */
export async function generateScreenshots(
    videoPath: string,
    count: number,
    outDir: string,
): Promise<string[]> {
    if (count < 1) return [];
    const duration = await probeDurationSeconds(videoPath);
    if (!duration || duration <= 0) return [];

    const outputs: string[] = [];
    try {
        for (let i = 0; i < count; i++) {
            // Sample at (i + 1) / (count + 1) of the video so the first and
            // last frames are never at exactly 0s or EOF (both tend to be
            // black / partial keyframes).
            const ts = (duration * (i + 1)) / (count + 1);
            const out = path.join(
                outDir,
                `shot-${Date.now()}-${i + 1}-of-${count}.jpg`,
            );
            await ffmpegSnapshot(videoPath, ts, out);
            // Skip empty or missing outputs instead of failing the whole
            // batch — a single bad keyframe should not kill the upload.
            if (fs.existsSync(out) && fs.statSync(out).size > 0) {
                outputs.push(out);
            }
        }
        return outputs;
    } catch (err) {
        for (const p of outputs) {
            try {
                fs.unlinkSync(p);
            } catch {
                // best-effort
            }
        }
        throw err;
    }
}

function probeDurationSeconds(videoPath: string): Promise<number> {
    return new Promise((resolve) => {
        const proc = spawn("ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            videoPath,
        ]);
        let stdout = "";
        proc.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        proc.on("error", () => resolve(0));
        proc.on("close", () => {
            const n = parseFloat(stdout.trim());
            resolve(Number.isFinite(n) ? n : 0);
        });
    });
}

function ffmpegSnapshot(
    videoPath: string,
    atSeconds: number,
    outputPath: string,
): Promise<void> {
    return new Promise((resolve, reject) => {
        // -ss before -i is the "fast seek" form: ffmpeg seeks by keyframe
        // before decoding. -frames:v 1 grabs exactly one frame. -q:v 2 is
        // near-lossless JPEG.
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
            "-q:v",
            "2",
            outputPath,
        ]);
        let stderr = "";
        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        proc.on("error", reject);
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else
                reject(
                    new Error(
                        `ffmpeg exited with code ${code}: ${stderr.trim()}`,
                    ),
                );
        });
    });
}
