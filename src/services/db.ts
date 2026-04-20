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
}

const DEFAULTS: Omit<UserPrefs, "chatId"> = {
    uploadAsDocument: false,
    spoiler: false,
    language: "ar",
    renamePrefix: "",
    renameSuffix: "",
    screenshotsCount: 0,
};

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
    patch: Partial<Omit<UserPrefs, "chatId">>,
): UserPrefs {
    const current = getUserPrefs(chatId);
    const next: UserPrefs = { ...current, ...patch, chatId };
    getDb()
        .prepare(
            `
            INSERT INTO user_prefs
                (chat_id, upload_as_document, spoiler, language, rename_prefix, rename_suffix, screenshots_count, updated_at)
            VALUES
                (@chatId, @uploadAsDocument, @spoiler, @language, @renamePrefix, @renameSuffix, @screenshotsCount, strftime('%s','now'))
            ON CONFLICT(chat_id) DO UPDATE SET
                upload_as_document = excluded.upload_as_document,
                spoiler            = excluded.spoiler,
                language           = excluded.language,
                rename_prefix      = excluded.rename_prefix,
                rename_suffix      = excluded.rename_suffix,
                screenshots_count  = excluded.screenshots_count,
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
        });
    return next;
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
