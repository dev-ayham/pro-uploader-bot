/**
 * Helpers for producing rich progress updates (percent + bytes + speed +
 * ETA) from the thin fraction/byte callbacks that the underlying upload /
 * download machinery emits. Kept side-effect free so it can be unit-tested
 * without a Telegram client.
 */

export interface RichProgress {
    /** Completion in [0, 1]. Always defined — falls back to 0 when unknown. */
    fraction: number;
    /** Bytes transferred so far, when a byte counter is available. */
    doneBytes?: number;
    /** Total size in bytes, when the source advertised one. */
    totalBytes?: number;
    /** Smoothed transfer speed in bytes / second. */
    speedBps?: number;
    /** Estimated seconds until completion. */
    etaSec?: number;
}

/**
 * Exponentially-smoothed rate tracker. Call the returned function on every
 * progress tick with the current (doneBytes, totalBytes?) and it returns a
 * {@link RichProgress} with a stable `speedBps` / `etaSec` even when the
 * underlying ticks are bursty. Speed samples under ~250 ms apart are folded
 * into the previous window to avoid divide-by-zero noise.
 */
export function createRateTracker(): (
    doneBytes: number,
    totalBytes?: number,
) => RichProgress {
    const startedAt = Date.now();
    let lastTs = startedAt;
    let lastBytes = 0;
    let smoothedBps = 0;

    return (doneBytes: number, totalBytes?: number): RichProgress => {
        const now = Date.now();
        const dt = (now - lastTs) / 1000;
        if (dt >= 0.25) {
            const db = Math.max(0, doneBytes - lastBytes);
            const instantBps = dt > 0 ? db / dt : 0;
            smoothedBps =
                smoothedBps === 0
                    ? instantBps
                    : smoothedBps * 0.6 + instantBps * 0.4;
            lastTs = now;
            lastBytes = doneBytes;
        } else if (smoothedBps === 0 && doneBytes > 0) {
            // First meaningful sample: use total elapsed so the user does
            // not stare at a blank "speed" line for the first few seconds.
            const elapsed = (now - startedAt) / 1000;
            if (elapsed > 0) smoothedBps = doneBytes / elapsed;
        }

        const knownTotal =
            typeof totalBytes === "number" && totalBytes > 0
                ? totalBytes
                : undefined;
        const fraction =
            knownTotal !== undefined
                ? Math.min(1, Math.max(0, doneBytes / knownTotal))
                : 0;
        const remaining =
            knownTotal !== undefined && knownTotal > doneBytes
                ? knownTotal - doneBytes
                : 0;
        const etaSec =
            smoothedBps > 0 && remaining > 0 ? remaining / smoothedBps : undefined;

        return {
            fraction,
            doneBytes,
            totalBytes: knownTotal,
            speedBps: smoothedBps > 0 ? smoothedBps : undefined,
            etaSec,
        };
    };
}

/** "1.84 GB" / "252.5 MB" / "512 KB" / "123 B". */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "-";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let v = bytes / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    // Match the aesthetic in the reference screenshots: 2 decimals for
    // MB/GB, integer for KB. Strip trailing .0 for clean output.
    const decimals = i === 0 ? 0 : 2;
    return `${v.toFixed(decimals)} ${units[i]}`;
}

/** "13.12 MB/s". Returns "-" for unknown / zero rates. */
export function formatSpeed(bps?: number): string {
    if (!bps || bps <= 0 || !Number.isFinite(bps)) return "-";
    return `${formatBytes(bps)}/s`;
}

/** "1m 7s" / "45s" / "2h 5m". Short, always non-negative. */
export function formatEta(sec?: number): string {
    if (sec === undefined || !Number.isFinite(sec) || sec < 0) return "-";
    const s = Math.round(sec);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    if (m < 60) return rs === 0 ? `${m}m` : `${m}m ${rs}s`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

/**
 * ASCII/emoji progress bar with `width` cells. Each cell represents
 * `1/width` of total work. Filled cells use a solid block, empty cells use
 * a light block, producing e.g. `[▓▓▓▓▓░░░░░]` for 50% at width=10.
 */
export function renderBar(fraction: number, width = 12): string {
    const clamped = Math.max(0, Math.min(1, fraction));
    const filled = Math.round(clamped * width);
    return "[" + "▓".repeat(filled) + "░".repeat(width - filled) + "]";
}
