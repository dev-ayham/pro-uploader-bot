import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { Lang, SUPPORTED_LANGS } from "../i18n";

/**
 * Per-chat user preferences that persist across deploys.
 *
 * The DB file lives on a Railway volume (default `/data/pro-uploader.db`) so
 * that toggles the user flips survive redeploys and host rotations. When
 * running locally without Railway, the default falls back to
 * `./data/pro-uploader.db` under the project.
 */
export interface UserPrefs {
    chatId: number;
    uploadAsDocument: boolean;
    spoiler: boolean;
    language: Lang;
    renamePrefix: string;
    renameSuffix: string;
    /** How many equidistant frames to attach as an album after a video
     * upload. 0 disables the feature. */
    screenshotsCount: number;
    /** Number of successful uploads this chat has performed. Shown by /stats. */
    uploadsCount: number;
    /** First-seen unix seconds; null until first write. */
    createdAt: number | null;
    /** Last URL this chat successfully uploaded; used as the implicit target
     *  for AI intents like "give me the audio" when the user follows up
     *  without re-pasting the link. Empty string when none is known. */
    lastUrl: string;
}

const DEFAULTS: Omit<UserPrefs, "chatId"> = {
    uploadAsDocument: false,
    spoiler: false,
    language: "ar",
    renamePrefix: "",
    renameSuffix: "",
    screenshotsCount: 0,
    uploadsCount: 0,
    createdAt: null,
    lastUrl: "",
};

/** Mutable fields that the public API is allowed to patch. uploadsCount and
 *  createdAt are maintained internally (by incrementUploadsCount) and are
 *  therefore excluded from the type of the patch argument. */
export type UserPrefsPatch = Partial<
    Omit<UserPrefs, "chatId" | "uploadsCount" | "createdAt">
>;

/**
 * Writable root directory for persistent state. On Railway we use the
 * `/data` volume mount so state survives redeploys; locally we fall back
 * to `./data/`. Everything persistent (SQLite file, per-user thumbnails,
 * etc.) should live under this directory so operators only have to back
 * up one thing.
 */
export function resolveDataDir(): string {
    const railwayVolume = "/data";
    try {
        fs.accessSync(railwayVolume, fs.constants.W_OK);
        return railwayVolume;
    } catch {
        const local = path.join(process.cwd(), "data");
        fs.mkdirSync(local, { recursive: true });
        return local;
    }
}

function resolveDbPath(): string {
    const explicit = process.env.DB_PATH;
    if (explicit && explicit.trim()) return explicit;
    return path.join(resolveDataDir(), "pro-uploader.db");
}

let db: Database.Database | undefined;

function getDb(): Database.Database {
    if (db) return db;
    const dbPath = resolveDbPath();
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_prefs (
            chat_id INTEGER PRIMARY KEY,
            upload_as_document INTEGER NOT NULL DEFAULT 0,
            spoiler INTEGER NOT NULL DEFAULT 0,
            language TEXT NOT NULL DEFAULT 'ar',
            rename_prefix TEXT NOT NULL DEFAULT '',
            rename_suffix TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
    `);
    // Additive migrations: tolerate the column already existing on a fresh
    // install (where CREATE TABLE above already includes it) and on repos
    // that pre-dated this column.
    addColumnIfMissing(db, "user_prefs", "screenshots_count", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "user_prefs", "uploads_count", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "user_prefs", "last_url", "TEXT NOT NULL DEFAULT ''");
    db.exec(`
        CREATE TABLE IF NOT EXISTS ai_usage (
            chat_id INTEGER NOT NULL,
            day TEXT NOT NULL,
            calls INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (chat_id, day)
        );
    `);
    // Admin-managed banlist. A row for chat_id means the chat is banned.
    // Admins can /ban and /unban; banned chats are silently rejected by
    // the message handlers.
    db.exec(`
        CREATE TABLE IF NOT EXISTS banned_users (
            chat_id INTEGER PRIMARY KEY,
            reason  TEXT NOT NULL DEFAULT '',
            at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
    `);
    console.log(`SQLite preferences DB opened at ${dbPath}`);
    return db;
}

function addColumnIfMissing(
    database: Database.Database,
    table: string,
    column: string,
    definition: string,
): void {
    const info = database.prepare(`PRAGMA table_info(${table})`).all() as Array<
        { name: string }
    >;
    if (info.some((c) => c.name === column)) return;
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

interface Row {
    chat_id: number;
    upload_as_document: number;
    spoiler: number;
    language: string;
    rename_prefix: string;
    rename_suffix: string;
    screenshots_count: number;
    uploads_count: number;
    created_at: number | null;
    last_url: string | null;
}

function rowToPrefs(row: Row): UserPrefs {
    return {
        chatId: row.chat_id,
        uploadAsDocument: !!row.upload_as_document,
        spoiler: !!row.spoiler,
        // Coerce to a supported locale; unknown codes (e.g. from a very old
        // row or hand-edited DB) fall back to Arabic.
        language: (SUPPORTED_LANGS as readonly string[]).includes(row.language)
            ? (row.language as Lang)
            : "ar",
        renamePrefix: row.rename_prefix,
        renameSuffix: row.rename_suffix,
        screenshotsCount: row.screenshots_count ?? 0,
        uploadsCount: row.uploads_count ?? 0,
        createdAt: row.created_at ?? null,
        lastUrl: row.last_url ?? "",
    };
}

export function getUserPrefs(chatId: number): UserPrefs {
    const row = getDb()
        .prepare("SELECT * FROM user_prefs WHERE chat_id = ?")
        .get(chatId) as Row | undefined;
    if (!row) return { chatId, ...DEFAULTS };
    return rowToPrefs(row);
}

/**
 * Upsert: write the given partial patch for this chat, defaulting any
 * unspecified columns to DEFAULTS on first write.
 */
export function updateUserPrefs(
    chatId: number,
    patch: UserPrefsPatch,
): UserPrefs {
    const current = getUserPrefs(chatId);
    const next: UserPrefs = { ...current, ...patch, chatId };
    getDb()
        .prepare(
            `
            INSERT INTO user_prefs
                (chat_id, upload_as_document, spoiler, language, rename_prefix, rename_suffix, screenshots_count, last_url, updated_at)
            VALUES
                (@chatId, @uploadAsDocument, @spoiler, @language, @renamePrefix, @renameSuffix, @screenshotsCount, @lastUrl, strftime('%s','now'))
            ON CONFLICT(chat_id) DO UPDATE SET
                upload_as_document = excluded.upload_as_document,
                spoiler            = excluded.spoiler,
                language           = excluded.language,
                rename_prefix      = excluded.rename_prefix,
                rename_suffix      = excluded.rename_suffix,
                screenshots_count  = excluded.screenshots_count,
                last_url           = excluded.last_url,
                updated_at         = strftime('%s','now')
            `,
        )
        .run({
            chatId: next.chatId,
            uploadAsDocument: next.uploadAsDocument ? 1 : 0,
            spoiler: next.spoiler ? 1 : 0,
            language: next.language,
            renamePrefix: next.renamePrefix,
            renameSuffix: next.renameSuffix,
            screenshotsCount: next.screenshotsCount,
            lastUrl: next.lastUrl,
        });
    return next;
}

/** Remember the most recent URL this chat uploaded so AI follow-ups can
 *  reference it ("give me the audio", "as document"). Kept on a separate
 *  entry point so code paths that just want to remember a URL don't have
 *  to go through the full updateUserPrefs patch. */
export function setLastUrl(chatId: number, url: string): void {
    getDb()
        .prepare(
            `INSERT INTO user_prefs (chat_id, last_url, updated_at)
             VALUES (?, ?, strftime('%s','now'))
             ON CONFLICT(chat_id) DO UPDATE SET
                 last_url   = excluded.last_url,
                 updated_at = strftime('%s','now')`,
        )
        .run(chatId, url);
}

/** Return today's date stamped as YYYY-MM-DD in UTC. Used as the partition
 *  key for the per-chat AI rate limiter. */
function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Atomic +1 on the per-chat AI call counter for today. Returns the new
 * value so the caller can decide whether the user has exceeded
 * `AI_DAILY_LIMIT_PER_USER`. We count the attempt before the OpenAI call
 * so that a spam of requests quickly trips the limit even if each call
 * eventually errors out.
 */
export function incrementAiCallsToday(chatId: number): number {
    const day = todayKey();
    const database = getDb();
    database
        .prepare(
            `INSERT INTO ai_usage (chat_id, day, calls) VALUES (?, ?, 1)
             ON CONFLICT(chat_id, day) DO UPDATE SET calls = calls + 1`,
        )
        .run(chatId, day);
    const row = database
        .prepare("SELECT calls FROM ai_usage WHERE chat_id = ? AND day = ?")
        .get(chatId, day) as { calls: number } | undefined;
    return row?.calls ?? 1;
}

export function getAiCallsToday(chatId: number): number {
    const row = getDb()
        .prepare("SELECT calls FROM ai_usage WHERE chat_id = ? AND day = ?")
        .get(chatId, todayKey()) as { calls: number } | undefined;
    return row?.calls ?? 0;
}

/**
 * Reset all toggles, rename and screenshots preferences for this chat back
 * to DEFAULTS. We intentionally preserve `uploads_count` and `created_at`
 * so the user's lifetime stats survive a /reset.
 */
export function resetUserPrefs(chatId: number): UserPrefs {
    return updateUserPrefs(chatId, {
        uploadAsDocument: DEFAULTS.uploadAsDocument,
        spoiler: DEFAULTS.spoiler,
        language: DEFAULTS.language,
        renamePrefix: DEFAULTS.renamePrefix,
        renameSuffix: DEFAULTS.renameSuffix,
        screenshotsCount: DEFAULTS.screenshotsCount,
    });
}

/** Atomic +1 on the uploads counter; called after a successful upload. */
export function incrementUploadsCount(chatId: number): void {
    getDb()
        .prepare(
            `INSERT INTO user_prefs (chat_id, uploads_count, updated_at)
             VALUES (?, 1, strftime('%s','now'))
             ON CONFLICT(chat_id) DO UPDATE SET
                 uploads_count = uploads_count + 1,
                 updated_at    = strftime('%s','now')`,
        )
        .run(chatId);
}

/** True when the given chat_id is on the admin-managed banlist. */
export function isBanned(chatId: number): boolean {
    const row = getDb()
        .prepare("SELECT 1 FROM banned_users WHERE chat_id = ?")
        .get(chatId);
    return !!row;
}

/** Insert or remove a row on the banlist. */
export function setBanned(
    chatId: number,
    banned: boolean,
    reason = "",
): void {
    if (banned) {
        getDb()
            .prepare(
                `INSERT INTO banned_users (chat_id, reason) VALUES (?, ?)
                 ON CONFLICT(chat_id) DO UPDATE SET reason = excluded.reason`,
            )
            .run(chatId, reason);
    } else {
        getDb()
            .prepare("DELETE FROM banned_users WHERE chat_id = ?")
            .run(chatId);
    }
}

/** All chat_ids currently marked as banned, plus their reason + ban-time. */
export function listBannedUsers(): Array<{
    chatId: number;
    reason: string;
    at: number;
}> {
    const rows = getDb()
        .prepare("SELECT chat_id, reason, at FROM banned_users ORDER BY at DESC")
        .all() as Array<{ chat_id: number; reason: string; at: number }>;
    return rows.map((r) => ({ chatId: r.chat_id, reason: r.reason, at: r.at }));
}

/** All chat_ids that have ever touched the bot. Used by /broadcast. */
export function getAllChatIds(): number[] {
    const rows = getDb()
        .prepare("SELECT chat_id FROM user_prefs")
        .all() as Array<{ chat_id: number }>;
    return rows.map((r) => r.chat_id);
}

/** Aggregate stats shown by /stats_all. */
export interface AggregateStats {
    totalUsers: number;
    bannedUsers: number;
    totalUploads: number;
    aiCallsToday: number;
    activeToday: number;
    perLanguage: Array<{ language: string; count: number }>;
}

export function aggregateStats(): AggregateStats {
    const database = getDb();
    const totalUsers = (database
        .prepare("SELECT COUNT(*) AS n FROM user_prefs")
        .get() as { n: number }).n;
    const bannedUsers = (database
        .prepare("SELECT COUNT(*) AS n FROM banned_users")
        .get() as { n: number }).n;
    const totalUploads = (database
        .prepare("SELECT COALESCE(SUM(uploads_count),0) AS n FROM user_prefs")
        .get() as { n: number }).n;
    const day = todayKey();
    const aiCallsToday = (database
        .prepare("SELECT COALESCE(SUM(calls),0) AS n FROM ai_usage WHERE day = ?")
        .get(day) as { n: number }).n;
    const activeToday = (database
        .prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE day = ?")
        .get(day) as { n: number }).n;
    const perLanguage = database
        .prepare(
            `SELECT language, COUNT(*) AS n FROM user_prefs
             GROUP BY language ORDER BY n DESC`,
        )
        .all() as Array<{ language: string; n: number }>;
    return {
        totalUsers,
        bannedUsers,
        totalUploads,
        aiCallsToday,
        activeToday,
        perLanguage: perLanguage.map((r) => ({
            language: r.language,
            count: r.n,
        })),
    };
}

export function closeDb(): void {
    if (db) {
        try {
            db.close();
        } catch {
            // best-effort on shutdown
        }
        db = undefined;
    }
}
