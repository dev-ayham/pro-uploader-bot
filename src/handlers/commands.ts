import { Bot, Context } from "grammy";
import {
    getUserPrefs,
    incrementUploadsCount,
    resetUserPrefs,
    updateUserPrefs,
} from "../services/db";
import { deleteThumbnail, hasThumbnail } from "../services/thumbnails";
import {
    clearPendingInput,
    setPendingInput,
} from "../services/pending-input";
import { formatJoinedDate, LANG_FLAG, LANG_NATIVE, t } from "../i18n";

const MAX_RENAME_LEN = 64;
const SCREENSHOT_OPTIONS = [0, 3, 5, 10] as const;

/** Strip the leading command token and return the free-form argument.
 *  Telegram delivers a whole message like "/prefix  my prefix text"; grammy
 *  exposes the full text verbatim — we just chop off the first word. */
function argsAfterCommand(ctx: Context): string {
    const text = ctx.message?.text ?? "";
    const firstSpace = text.indexOf(" ");
    if (firstSpace < 0) return "";
    return text.slice(firstSpace + 1).trim();
}

export function registerQuickCommandHandlers(bot: Bot): void {
    // /doc — toggle "upload as document"
    bot.command("doc", async (ctx) => {
        if (!ctx.chat) return;
        const prefs = getUserPrefs(ctx.chat.id);
        const next = !prefs.uploadAsDocument;
        updateUserPrefs(ctx.chat.id, { uploadAsDocument: next });
        await ctx.reply(t(prefs.language).cmd_doc_toggled(next));
    });

    // /spoiler — toggle spoiler
    bot.command("spoiler", async (ctx) => {
        if (!ctx.chat) return;
        const prefs = getUserPrefs(ctx.chat.id);
        const next = !prefs.spoiler;
        updateUserPrefs(ctx.chat.id, { spoiler: next });
        await ctx.reply(t(prefs.language).cmd_spoiler_toggled(next));
    });

    // /prefix [text|clear] — show, set, or clear the filename prefix.
    bot.command("prefix", async (ctx) => {
        if (!ctx.chat) return;
        const prefs = getUserPrefs(ctx.chat.id);
        const s = t(prefs.language);
        const arg = argsAfterCommand(ctx);
        if (!arg) {
            const reply = prefs.renamePrefix
                ? s.cmd_prefix_current(prefs.renamePrefix)
                : s.cmd_prefix_none;
            await ctx.reply(reply, { parse_mode: "HTML" });
            return;
        }
        if (arg.toLowerCase() === "clear") {
            updateUserPrefs(ctx.chat.id, { renamePrefix: "" });
            await ctx.reply(s.cmd_prefix_cleared);
            return;
        }
        if (arg.length > MAX_RENAME_LEN) {
            await ctx.reply(s.rename_too_long(MAX_RENAME_LEN));
            return;
        }
        updateUserPrefs(ctx.chat.id, { renamePrefix: arg });
        await ctx.reply(s.cmd_prefix_set(arg), { parse_mode: "HTML" });
    });

    // /suffix [text|clear] — show, set, or clear the filename suffix.
    bot.command("suffix", async (ctx) => {
        if (!ctx.chat) return;
        const prefs = getUserPrefs(ctx.chat.id);
        const s = t(prefs.language);
        const arg = argsAfterCommand(ctx);
        if (!arg) {
            const reply = prefs.renameSuffix
                ? s.cmd_suffix_current(prefs.renameSuffix)
                : s.cmd_suffix_none;
            await ctx.reply(reply, { parse_mode: "HTML" });
            return;
        }
        if (arg.toLowerCase() === "clear") {
            updateUserPrefs(ctx.chat.id, { renameSuffix: "" });
            await ctx.reply(s.cmd_suffix_cleared);
            return;
        }
        if (arg.length > MAX_RENAME_LEN) {
            await ctx.reply(s.rename_too_long(MAX_RENAME_LEN));
            return;
        }
        updateUserPrefs(ctx.chat.id, { renameSuffix: arg });
        await ctx.reply(s.cmd_suffix_set(arg), { parse_mode: "HTML" });
    });

    // /screenshots <0|3|5|10> — set the per-upload screenshot count.
    bot.command("screenshots", async (ctx) => {
        if (!ctx.chat) return;
        const prefs = getUserPrefs(ctx.chat.id);
        const s = t(prefs.language);
        const arg = argsAfterCommand(ctx);
        const n = parseInt(arg, 10);
        if (!Number.isFinite(n) || !SCREENSHOT_OPTIONS.includes(n as typeof SCREENSHOT_OPTIONS[number])) {
            await ctx.reply(s.cmd_screenshots_usage, { parse_mode: "HTML" });
            return;
        }
        updateUserPrefs(ctx.chat.id, { screenshotsCount: n });
        await ctx.reply(s.cmd_screenshots_set(n));
    });

    // /thumb — open the same "send a photo" flow /settings uses.
    bot.command("thumb", async (ctx) => {
        if (!ctx.chat) return;
        const prefs = getUserPrefs(ctx.chat.id);
        setPendingInput(ctx.chat.id, { kind: "thumbnail_photo" });
        await ctx.reply(t(prefs.language).thumb_prompt);
    });

    // /thumb_clear — delete any stored thumbnail.
    bot.command("thumb_clear", async (ctx) => {
        if (!ctx.chat) return;
        const prefs = getUserPrefs(ctx.chat.id);
        const s = t(prefs.language);
        if (!hasThumbnail(ctx.chat.id)) {
            await ctx.reply(s.cmd_thumb_not_set);
            return;
        }
        deleteThumbnail(ctx.chat.id);
        await ctx.reply(s.cmd_thumb_clear_done);
    });

    // /reset — restore upload toggles + rename + screenshots to defaults.
    // Preserves lifetime stats (uploads count, created_at) and language.
    bot.command("reset", async (ctx) => {
        if (!ctx.chat) return;
        const prefs = getUserPrefs(ctx.chat.id);
        clearPendingInput(ctx.chat.id);
        resetUserPrefs(ctx.chat.id);
        // resetUserPrefs rolls language back to the default. Keep the user's
        // chosen language so a "reset" doesn't silently switch them.
        updateUserPrefs(ctx.chat.id, { language: prefs.language });
        deleteThumbnail(ctx.chat.id);
        await ctx.reply(t(prefs.language).cmd_reset_done);
    });

    // /platforms — list every supported extractor.
    bot.command("platforms", async (ctx) => {
        if (!ctx.chat) return;
        const prefs = getUserPrefs(ctx.chat.id);
        await ctx.reply(t(prefs.language).platforms_text, {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
        });
    });

    // /stats — show per-chat lifetime statistics.
    bot.command("stats", async (ctx) => {
        if (!ctx.chat) return;
        const prefs = getUserPrefs(ctx.chat.id);
        const s = t(prefs.language);
        const joined = formatJoinedDate(prefs.createdAt, prefs.language);
        await ctx.reply(
            s.stats_text(
                prefs.uploadsCount,
                joined || s.stats_never,
                `${LANG_FLAG[prefs.language]} ${LANG_NATIVE[prefs.language]}`,
            ),
            { parse_mode: "HTML" },
        );
    });

    // /id — debug helper showing the raw Telegram chat / user ids.
    bot.command("id", async (ctx) => {
        if (!ctx.chat) return;
        const prefs = getUserPrefs(ctx.chat.id);
        const s = t(prefs.language);
        await ctx.reply(
            s.id_text(ctx.chat.id, ctx.from?.id ?? 0),
            { parse_mode: "HTML" },
        );
    });

    // /ping — liveness / uptime probe.
    bot.command("ping", async (ctx) => {
        const prefs = ctx.chat
            ? getUserPrefs(ctx.chat.id)
            : { language: "ar" as const };
        await ctx.reply(t(prefs.language).pong(process.uptime()));
    });

    // Hidden test helper that nudges the stats counter. Not published in
    // the "/" menu. Kept out of the user-facing documentation on purpose.
    bot.command("stats_bump", async (ctx) => {
        if (!ctx.chat) return;
        incrementUploadsCount(ctx.chat.id);
        const prefs = getUserPrefs(ctx.chat.id);
        await ctx.reply(`uploads=${prefs.uploadsCount}`);
    });
}
