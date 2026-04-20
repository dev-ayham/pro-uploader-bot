import fs from "node:fs";

import axios from "axios";

/**
 * Minimal subset of the Instagram `web_profile_info` response that we
 * surface to the bot. All numeric fields may legitimately be 0.
 */
export interface InstagramProfile {
    username: string;
    fullName: string;
    biography: string;
    /** Highest-resolution profile picture URL we can link to. */
    profilePicUrl: string;
    /** Smaller variant used as the photo message; falls back to HD. */
    profilePicUrlMedium: string;
    postsCount: number;
    followers: number;
    following: number;
    isPrivate: boolean;
    isVerified: boolean;
    externalUrl?: string;
}

/**
 * Pull cookies for a given domain out of a Netscape-format cookies.txt
 * file (the same format yt-dlp consumes). Returns a `name → value` map
 * limited to cookies that Telegram should forward with the Instagram
 * API call. Missing files / malformed lines are tolerated silently so
 * bot startup never fails because of cookie issues.
 */
function parseNetscapeCookies(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
        if (!line || line.startsWith("#")) continue;
        const parts = line.split("\t");
        if (parts.length < 7) continue;
        const domain = parts[0] ?? "";
        if (!/instagram\.com$/i.test(domain.replace(/^\./, ""))) continue;
        const name = parts[5];
        const value = parts[6];
        if (name && value) out[name] = value;
    }
    return out;
}

function buildCookieHeader(map: Record<string, string>): string {
    return Object.entries(map)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
}

/**
 * Reserved path prefixes on instagram.com that don't identify a user
 * profile. `/p/<id>` is a post, `/reel/<id>` is a reel, etc.
 */
const RESERVED_PATHS = new Set([
    "p",
    "reel",
    "reels",
    "tv",
    "stories",
    "explore",
    "accounts",
    "direct",
    "web",
    "api",
    "graphql",
    "about",
    "developer",
    "legal",
    "privacy",
    "terms",
    "i",
]);

/**
 * Given an arbitrary URL, return the Instagram username if and only if
 * the URL points at a profile page (e.g. `instagram.com/sm17_x`). Any
 * URL that points at a specific piece of content — posts, reels, TV,
 * stories — returns `null` and should fall through to the normal
 * yt-dlp download path.
 */
export function extractInstagramUsername(url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "instagram.com" && !host.endsWith(".instagram.com")) {
        return null;
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    const first = segments[0].toLowerCase();
    if (RESERVED_PATHS.has(first)) return null;
    // Instagram usernames: letters, digits, dot, underscore; up to 30 chars.
    if (!/^[a-zA-Z0-9._]{1,30}$/.test(segments[0])) return null;
    return segments[0];
}

const IG_WEB_PROFILE_ENDPOINT =
    "https://www.instagram.com/api/v1/users/web_profile_info/";

/**
 * Thrown for a rate-limit / login-wall response. The calling layer
 * surfaces it with a friendlier message (asking the user to retry
 * later / hinting that cookies may be stale).
 */
export class InstagramRateLimitedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InstagramRateLimitedError";
    }
}

/**
 * Thrown when Instagram responds but the username doesn't resolve to
 * a real profile (404 / missing user node).
 */
export class InstagramUserNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InstagramUserNotFoundError";
    }
}

/**
 * Fetch a profile's public metadata via Instagram's internal web API.
 * Requires a browser-style User-Agent and the `x-ig-app-id` header;
 * cookies are optional but dramatically improve success rates and are
 * required for any private-ish account. Callers should pass the same
 * cookies file that yt-dlp uses (`YT_DLP_COOKIES`).
 */
export async function fetchInstagramProfile(
    username: string,
    cookiesFile?: string,
): Promise<InstagramProfile> {
    const headers: Record<string, string> = {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        "x-ig-app-id": "936619743392459",
        "x-asbd-id": "129477",
        "x-requested-with": "XMLHttpRequest",
        Referer: `https://www.instagram.com/${username}/`,
    };

    if (cookiesFile && fs.existsSync(cookiesFile)) {
        try {
            const raw = fs.readFileSync(cookiesFile, "utf8");
            const cookies = parseNetscapeCookies(raw);
            if (Object.keys(cookies).length > 0) {
                headers.Cookie = buildCookieHeader(cookies);
                if (cookies.csrftoken) {
                    headers["x-csrftoken"] = cookies.csrftoken;
                }
            }
        } catch (err) {
            console.warn(
                "Failed to read cookies file for Instagram profile:",
                err,
            );
        }
    }

    let res;
    try {
        res = await axios.get(IG_WEB_PROFILE_ENDPOINT, {
            params: { username },
            headers,
            timeout: 20_000,
            validateStatus: () => true,
        });
    } catch (err) {
        throw new Error(
            `Network error talking to Instagram: ${(err as Error).message}`,
        );
    }

    if (res.status === 404) {
        throw new InstagramUserNotFoundError(
            `Instagram returned 404 for @${username}`,
        );
    }
    if (res.status === 401 || res.status === 403) {
        throw new InstagramRateLimitedError(
            `Instagram refused the request (HTTP ${res.status}); ` +
                `cookies may be missing or expired.`,
        );
    }
    if (res.status === 429) {
        throw new InstagramRateLimitedError(
            "Instagram rate-limited the request (HTTP 429).",
        );
    }
    if (res.status >= 400) {
        throw new Error(`Instagram HTTP ${res.status}`);
    }

    const data = res.data as
        | {
              data?: { user?: Record<string, unknown> };
          }
        | undefined;
    const user = data?.data?.user;
    if (!user) {
        throw new InstagramUserNotFoundError(
            `No user node in Instagram response for @${username}`,
        );
    }

    const getStr = (k: string): string => {
        const v = user[k];
        return typeof v === "string" ? v : "";
    };
    const getBool = (k: string): boolean => user[k] === true;
    const getCount = (k: string): number => {
        const node = user[k] as { count?: unknown } | undefined;
        const count = node?.count;
        return typeof count === "number" ? count : 0;
    };

    return {
        username: getStr("username") || username,
        fullName: getStr("full_name"),
        biography: getStr("biography"),
        profilePicUrl:
            getStr("profile_pic_url_hd") || getStr("profile_pic_url"),
        profilePicUrlMedium:
            getStr("profile_pic_url") || getStr("profile_pic_url_hd"),
        postsCount: getCount("edge_owner_to_timeline_media"),
        followers: getCount("edge_followed_by"),
        following: getCount("edge_follow"),
        isPrivate: getBool("is_private"),
        isVerified: getBool("is_verified"),
        externalUrl: getStr("external_url") || undefined,
    };
}
