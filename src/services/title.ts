/**
 * Derive a human-readable title from a URL, filename, or both. Used to
 * build clean captions (e.g. `[FASELHD][1080p]I.Kill.Giants.2017.WEB-DL`)
 * instead of echoing the raw URL which is noisy and often wraps across
 * many lines on mobile.
 *
 * Priority:
 *   1. `?title=...` query parameter (some CDNs — e.g. scdns.io — surface
 *      the original filename this way).
 *   2. The supplied local filename, if any (from yt-dlp's `%(title)s` or
 *      the `Content-Disposition` header on a direct download).
 *   3. The last path segment of the URL.
 *
 * In every case the extension is stripped and any timestamp-prefix that
 * our own downloader added (`1776761234_filename.mp4`) is removed.
 */
export function cleanTitle(url: string, filename?: string): string {
    // 1. ?title= wins
    try {
        const u = new URL(url);
        const t = u.searchParams.get("title");
        if (t) return stripExt(t.trim());
    } catch {
        // fall through
    }

    // 2. Local filename
    if (filename && filename.trim()) {
        return stripExt(stripTimestampPrefix(filename.trim()));
    }

    // 3. Last path segment, falling back to host-specific handling when
    //    the raw segment is generic ("watch", "download", numeric id…).
    try {
        const u = new URL(url);
        const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
        const decoded = last ? decodeURIComponent(last) : "";
        const hostBased = hostSpecificTitle(u);
        if (hostBased) return hostBased;
        if (decoded && !isGenericSlug(decoded)) return stripExt(decoded);
        // Final best-effort: "host / last-segment" so the caption at
        // least names the source (better than a bare "watch").
        const host = u.hostname.replace(/^www\./, "");
        return decoded ? `${host} · ${stripExt(decoded)}` : host;
    } catch {
        // fall through
    }
    return "file";
}

/**
 * Special-cased extraction for common streaming hosts whose URL path
 * ends in a meaningless slug. YouTube's `/watch?v=ID`, TikTok's
 * `/@user/video/ID`, Twitter/X's `/user/status/ID`, Reddit's
 * `/r/sub/comments/ID/slug`, etc.
 */
function hostSpecificTitle(u: URL): string | null {
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const segments = u.pathname.split("/").filter(Boolean);
    if (host === "youtube.com" || host === "m.youtube.com") {
        const v = u.searchParams.get("v");
        if (v) return `YouTube · ${v}`;
    }
    if (host === "youtu.be") {
        if (segments[0]) return `YouTube · ${segments[0]}`;
    }
    if (host.endsWith("tiktok.com")) {
        const user = segments.find((s) => s.startsWith("@"));
        const videoIdx = segments.findIndex((s) => s === "video");
        const id = videoIdx >= 0 ? segments[videoIdx + 1] : undefined;
        if (user && id) return `TikTok · ${user} · ${id}`;
        if (user) return `TikTok · ${user}`;
    }
    if (host === "twitter.com" || host === "x.com") {
        const statusIdx = segments.findIndex((s) => s === "status");
        const id = statusIdx >= 0 ? segments[statusIdx + 1] : undefined;
        const user = segments[0];
        if (user && id) return `${host === "x.com" ? "X" : "Twitter"} · @${user} · ${id}`;
    }
    if (host.endsWith("instagram.com")) {
        const kind = segments[0];
        const id = segments[1];
        if (kind && id && (kind === "p" || kind === "reel" || kind === "tv")) {
            return `Instagram · ${kind} · ${id}`;
        }
    }
    if (host.endsWith("reddit.com")) {
        const commentsIdx = segments.findIndex((s) => s === "comments");
        const id = commentsIdx >= 0 ? segments[commentsIdx + 1] : undefined;
        const slug = commentsIdx >= 0 ? segments[commentsIdx + 2] : undefined;
        if (slug) return stripExt(decodeURIComponent(slug).replace(/_/g, " "));
        if (id) return `Reddit · ${id}`;
    }
    return null;
}

/** Segments like "watch", "download", or a pure numeric ID carry no info. */
function isGenericSlug(s: string): boolean {
    const lower = s.toLowerCase();
    const generics = new Set([
        "watch", "download", "view", "play", "video", "media", "file",
        "index", "home", "stream", "embed",
    ]);
    if (generics.has(lower)) return true;
    if (/^\d+$/.test(lower)) return true;
    if (lower.length <= 2) return true;
    return false;
}

function stripExt(name: string): string {
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return name;
    const ext = name.slice(dot + 1).toLowerCase();
    // Only strip *known* media / archive extensions. Titles like
    // "Season.1" (with a trailing ".1") should not lose their suffix.
    const known = new Set([
        "mp4", "mkv", "webm", "mov", "avi", "flv", "wmv", "m4v", "3gp",
        "mp3", "m4a", "aac", "flac", "wav", "ogg", "opus",
        "jpg", "jpeg", "png", "gif", "webp",
        "pdf", "zip", "rar", "7z", "tar", "gz",
    ]);
    return known.has(ext) ? name.slice(0, dot) : name;
}

function stripTimestampPrefix(name: string): string {
    // `downloadDirect` prepends `${Date.now()}_` to avoid temp collisions.
    return name.replace(/^\d{10,}_/, "");
}

/**
 * Quick heuristic: does this URL or filename look like a video? Used to
 * disable the zero-egress external-URL fast path when we want to be
 * sure Telegram shows the result as a playable video with a thumbnail
 * (rather than a document tile) — the fast path cannot attach
 * `DocumentAttributeVideo` or a thumb.
 */
export function looksLikeVideoUrl(url: string): boolean {
    const videoExts = [
        "mp4", "mkv", "webm", "mov", "avi", "m4v", "flv", "wmv", "3gp",
        "ts", "mpeg", "mpg",
    ];
    let candidate = url.toLowerCase();
    try {
        const u = new URL(url);
        const t = u.searchParams.get("title");
        if (t) candidate = t.toLowerCase();
        else candidate = u.pathname.toLowerCase();
    } catch {
        // use the raw string
    }
    return videoExts.some((ext) => candidate.endsWith(`.${ext}`));
}
