import { Bot, Context, InlineKeyboard } from "grammy";
import { getUserPrefs, updateUserPrefs, UserPrefs } from "../services/db";
import {
    clearPendingInput,
    getPendingInput,
    setPendingInput,
} from "../services/pending-input";
import { deleteThumbnail, hasThumbnail } from "../services/thumbnails";
import { Lang, LANG_FLAG, LANG_NATIVE, t } from "../i18n";

const MAX_RENAME_LEN = 64;

type Page = "main" | "upload" | "rename" | "media";

function buildHomeKeyboard(lang: Lang): InlineKeyboard {
    const s = t(lang);
    return new InlineKeyboard()
        .text(s.settings_upload, "settings:page:upload")
        .text(s.settings_rename, "settings:page:rename")
        .row()
        .text(s.settings_media, "settings:page:media")
        .text(`${LANG_FLAG[lang]} ${s.menu_language}`, "menu:lang:pick")
        .row()
        .text(s.menu_back, "menu:home");
}

function buildUploadKeyboard(prefs: UserPrefs): InlineKeyboard {
    const s = t(prefs.language);
    const check = (on: boolean): string => (on ? s.enabled : s.disabled);
    return new InlineKeyboard()
        .text(
            `${check(prefs.uploadAsDocument)} ${s.upload_as_document}`,
            "settings:toggle:uploadAsDocument",
        )
        .row()
        .text(s.settings_back, "settings:page:main");
}

function buildRenameKeyboard(prefs: UserPrefs): InlineKeyboard {
    const s = t(prefs.language);
    return new InlineKeyboard()
        .text(s.rename_prefix, "settings:rename:prefix:set")
        .text(
            prefs.renamePrefix ? s.rename_clear_prefix : "—",
            prefs.renamePrefix ? "settings:rename:prefix:clear" : "settings:noop",
        )
        .row()
        .text(s.rename_suffix, "settings:rename:suffix:set")
        .text(
            prefs.renameSuffix ? s.rename_clear_suffix : "—",
            prefs.renameSuffix ? "settings:rename:suffix:clear" : "settings:noop",
        )
        .row()
        .text(s.settings_back, "settings:page:main");
}

function buildMediaKeyboard(prefs: UserPrefs, thumbSet: boolean): InlineKeyboard {
    const s = t(prefs.language);
    return new InlineKeyboard()
        .text(s.screenshots_label(prefs.screenshotsCount), "settings:screenshots:cycle")
        .row()
        .text(
            thumbSet ? s.thumb_change : s.thumb_set,
            "settings:thumb:set",
        )
        .text(
            thumbSet ? s.thumb_delete : "—",
            thumbSet ? "settings:thumb:clear" : "settings:noop",
        )
        .row()
        .text(s.settings_back, "settings:page:main");
}

function renderText(page: Page, prefs: UserPrefs, thumbSet: boolean): string {
    const s = t(prefs.language);
    const header = s.settings_title;
    const summary =
        `\n\n${s.settings_summary}\n` +
        `${prefs.uploadAsDocument ? s.enabled : s.disabled} ${s.upload_as_document}\n` +
        `${LANG_FLAG[prefs.language]} ${LANG_NATIVE[prefs.language]}\n` +
        `✏️ ${prefs.renamePrefix ? `<code>${escapeHtml(prefs.renamePrefix)}</code>` : "—"} / ${prefs.renameSuffix ? `<code>${escapeHtml(prefs.renameSuffix)}</code>` : "—"}\n` +
        `${s.screenshots_label(prefs.screenshotsCount)}\n` +
        `🖼️ ${thumbSet ? s.set_ : s.not_set}`;

    switch (page) {
        case "upload":
            return `${header}\n\n${s.upload_page_desc}`;
        case "rename":
            return (
                `${header}\n\n${s.rename_page_desc(MAX_RENAME_LEN)}\n\n` +
                `• ${s.rename_prefix}: ${prefs.renamePrefix ? `<code>${escapeHtml(prefs.renamePrefix)}</code>` : "—"}\n` +
                `• ${s.rename_suffix}: ${prefs.renameSuffix ? `<code>${escapeHtml(prefs.renameSuffix)}</code>` : "—"}`
            );
        case "media":
            return `${header}\n\n${s.media_page_desc(prefs.screenshotsCount, thumbSet)}`;
        default:
            return `${header}${summary}\n\n${s.settings_choose_section}`;
    }
}

function buildKeyboard(
    page: Page,
    prefs: UserPrefs,
    thumbSet: boolean,
): InlineKeyboard {
    switch (page) {
        case "upload":
            return buildUploadKeyboard(prefs);
        case "rename":
            return buildRenameKeyboard(prefs);
        case "media":
            return buildMediaKeyboard(prefs, thumbSet);
        default:
            return buildHomeKeyboard(prefs.language);
    }
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Wire up /settings + all settings callback_query handlers onto the bot.
 */
export function registerSettingsHandlers(bot: Bot): void {
    bot.command("settings", async (ctx) => {
        if (!ctx.chat) return;
        clearPendingInput(ctx.chat.id);
        const prefs = getUserPrefs(ctx.chat.id);
        const thumbSet = hasThumbnail(ctx.chat.id);
        await ctx.reply(renderText("main", prefs, thumbSet), {
            parse_mode: "HTML",
            reply_markup: buildKeyboard("main", prefs, thumbSet),
        });
    });

    bot.callbackQuery(/^settings:page:(main|upload|rename|media)$/, async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.answerCallbackQuery();
            return;
        }
        const page = ctx.match?.[1] as Page;
        await updateSettingsMessage(ctx, page);
    });

    bot.callbackQuery(/^settings:toggle:(.+)$/, async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.answerCallbackQuery();
            return;
        }
        const field = ctx.match?.[1];
        const current = getUserPrefs(chatId);
        switch (field) {
            case "uploadAsDocument":
                updateUserPrefs(chatId, {
                    uploadAsDocument: !current.uploadAsDocument,
                });
                await updateSettingsMessage(ctx, "upload");
                return;
            default:
                await ctx.answerCallbackQuery();
                return;
        }
    });

    bot.callbackQuery("settings:screenshots:cycle", async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.answerCallbackQuery();
            return;
        }
        const cycle = [0, 3, 5, 10];
        const current = getUserPrefs(chatId).screenshotsCount;
        const idx = cycle.indexOf(current);
        const nextCount = cycle[(idx + 1) % cycle.length];
        updateUserPrefs(chatId, { screenshotsCount: nextCount });
        await updateSettingsMessage(ctx, "media");
    });

    bot.callbackQuery(/^settings:rename:(prefix|suffix):(set|clear)$/, async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.answerCallbackQuery();
            return;
        }
        const which = ctx.match?.[1] as "prefix" | "suffix";
        const action = ctx.match?.[2] as "set" | "clear";
        if (action === "clear") {
            updateUserPrefs(chatId, {
                [which === "prefix" ? "renamePrefix" : "renameSuffix"]: "",
            });
            await updateSettingsMessage(ctx, "rename");
            return;
        }
        setPendingInput(chatId, {
            kind: which === "prefix" ? "rename_prefix" : "rename_suffix",
        });
        const lang = getUserPrefs(chatId).language;
        const s = t(lang);
        const prompt = which === "prefix"
            ? s.rename_prompt_prefix(MAX_RENAME_LEN)
            : s.rename_prompt_suffix(MAX_RENAME_LEN);
        await ctx.reply(prompt);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^settings:thumb:(set|clear)$/, async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.answerCallbackQuery();
            return;
        }
        const action = ctx.match?.[1];
        if (action === "clear") {
            deleteThumbnail(chatId);
            await updateSettingsMessage(ctx, "media");
            return;
        }
        setPendingInput(chatId, { kind: "thumbnail_photo" });
        const lang = getUserPrefs(chatId).language;
        await ctx.reply(t(lang).thumb_prompt);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery("settings:noop", async (ctx) => {
        await ctx.answerCallbackQuery();
    });
}

/**
 * Attempt to consume the message as an answer to a pending settings prompt
 * (e.g. "type your rename prefix"). Returns true when consumed so the
 * caller skips its own URL-parsing fallback.
 */
export async function handlePendingInputIfAny(ctx: Context): Promise<boolean> {
    if (!ctx.chat || !ctx.message?.text) return false;
    const chatId = ctx.chat.id;
    const pending = getPendingInput(chatId);
    if (!pending) return false;

    const text = ctx.message.text;
    const lang = getUserPrefs(chatId).language;
    const s = t(lang);
    if (text === "/" || text.startsWith("/")) {
        clearPendingInput(chatId);
        await ctx.reply(s.cancel_text);
        return true;
    }
    if (text.length > MAX_RENAME_LEN) {
        await ctx.reply(s.rename_too_long(MAX_RENAME_LEN));
        return true;
    }
    if (pending.kind === "rename_prefix") {
        updateUserPrefs(chatId, { renamePrefix: text });
    } else if (pending.kind === "rename_suffix") {
        updateUserPrefs(chatId, { renameSuffix: text });
    } else {
        return false;
    }
    clearPendingInput(chatId);
    await ctx.reply(s.rename_saved);
    return true;
}

async function updateSettingsMessage(ctx: Context, page: Page): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
        await ctx.answerCallbackQuery();
        return;
    }
    const prefs = getUserPrefs(chatId);
    const thumbSet = hasThumbnail(chatId);
    try {
        await ctx.editMessageText(renderText(page, prefs, thumbSet), {
            parse_mode: "HTML",
            reply_markup: buildKeyboard(page, prefs, thumbSet),
        });
    } catch {
        // "message is not modified" or the source message is gone.
    }
    await ctx.answerCallbackQuery();
}
