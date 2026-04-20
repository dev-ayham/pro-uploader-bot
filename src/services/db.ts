import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

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
    language: "ar" | "en";
    renamePrefix: string;
    renameSuffix: string;
}

const DEFAULTS: Omit<UserPrefs, "chatId"> = {
    uploadAsDocument: false,
    spoiler: false,
    language: "ar",
    renamePrefix: "",
    renameSuffix: "",
};

function resolveDbPath(): string {
    const explicit = process.env.DB_PATH;
    if (explicit && explicit.trim()) return explicit;
    // Railway volumes are conventionally mounted at /data. If that directory
    // exists and is writable we use it; otherwise fall back to a local path.
    const railwayVolume = "/data";
    try {
        fs.accessSync(railwayVolume, fs.constants.W_OK);
        return path.join(railwayVolume, "pro-uploader.db");
    } catch {
        const local = path.join(process.cwd(), "data");
        fs.mkdirSync(local, { recursive: true });
        return path.join(local, "pro-uploader.db");
    }
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
    console.log(`SQLite preferences DB opened at ${dbPath}`);
    return db;
}

interface Row {
    chat_id: number;
    upload_as_document: number;
    spoiler: number;
    language: string;
    rename_prefix: string;
    rename_suffix: string;
}

function rowToPrefs(row: Row): UserPrefs {
    return {
        chatId: row.chat_id,
        uploadAsDocument: !!row.upload_as_document,
        spoiler: !!row.spoiler,
        language: row.language === "en" ? "en" : "ar",
        renamePrefix: row.rename_prefix,
        renameSuffix: row.rename_suffix,
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
                (chat_id, upload_as_document, spoiler, language, rename_prefix, rename_suffix, updated_at)
            VALUES
                (@chatId, @uploadAsDocument, @spoiler, @language, @renamePrefix, @renameSuffix, strftime('%s','now'))
            ON CONFLICT(chat_id) DO UPDATE SET
                upload_as_document = excluded.upload_as_document,
                spoiler            = excluded.spoiler,
                language           = excluded.language,
                rename_prefix      = excluded.rename_prefix,
                rename_suffix      = excluded.rename_suffix,
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
