/**
 * Admin registry.
 *
 * A chat_id is considered "admin" if it appears in the `ADMIN_CHAT_IDS`
 * environment variable (a comma-separated list of Telegram chat ids). The
 * owner's id is hard-coded as a baseline so the bot still has a known
 * admin even when the env var is empty or mis-configured. Additional
 * admins can be added on Railway without editing code.
 */

const BASELINE_ADMIN_IDS: readonly number[] = [
    // Bot owner (@ayham.othman974). Kept in code so the bot always has a
    // known admin even if ADMIN_CHAT_IDS is accidentally unset on Railway.
    382195489,
];

function parseAdminEnv(): number[] {
    const raw = process.env.ADMIN_CHAT_IDS || "";
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n !== 0);
}

export function getAdminIds(): number[] {
    const extras = parseAdminEnv();
    const seen = new Set<number>([...BASELINE_ADMIN_IDS, ...extras]);
    return [...seen];
}

export function isAdmin(chatId: number | undefined | null): boolean {
    if (chatId === undefined || chatId === null) return false;
    return getAdminIds().includes(chatId);
}
