import { Bot, Context, InlineKeyboard } from "grammy";
import { clearPendingInput } from "../services/pending-input";
import { getUserPrefs, updateUserPrefs } from "../services/db";
import { hasThumbnail } from "../services/thumbnails";
import {
    Lang,
    LANG_FLAG,
    LANG_NATIVE,
    SUPPORTED_LANGS,
    t,
} from "../i18n";

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/** The "home" inline keyboard shown by /start and /menu. Two columns on top
 *  (main actions), language switch row, then close. */
function mainMenuKeyboard(lang: Lang): InlineKeyboard {
    const s = t(lang);
    return new InlineKeyboard()
        .text(s.menu_settings, "menu:settings")
        .text(s.menu_help, "menu:help")
        .row()
        .text(s.menu_about, "menu:about")
        .text(`${LANG_FLAG[lang]} ${s.menu_language}`, "menu:lang:pick")
        .row()
        .text(s.menu_close, "menu:close");
}

function helpKeyboard(lang: Lang): InlineKeyboard {
    const s = t(lang);
    return new InlineKeyboard()
        .text(s.menu_settings, "menu:settings")
        .text(s.menu_back, "menu:home")
        .row()
        .text(s.menu_close, "menu:close");
}

function aboutKeyboard(lang: Lang): InlineKeyboard {
    const s = t(lang);
    return new InlineKeyboard()
        .text(s.menu_back, "menu:home")
        .text(s.menu_close, "menu:close");
}

/** Picker that swaps the chat's locale. One row per language. */
function languagePickerKeyboard(current: Lang): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const l of SUPPORTED_LANGS) {
        const marker = l === current ? "✅ " : "";
        kb.text(`${marker}${LANG_FLAG[l]} ${LANG_NATIVE[l]}`, `menu:lang:set:${l}`).row();
    }
    kb.text(t(current).menu_back, "menu:home");
    return kb;
}

function buildHelpText(lang: Lang): string {
    const s = t(lang);
    return s.help_title + "\n\n" + s.help_commands + s.help_platforms + s.help_features;
}

function buildWelcome(lang: Lang, name: string): string {
    return t(lang).welcome(escapeHtml(name));
}

/**
 * Register all user-facing entry-point commands (/start, /menu, /help,
 * /about, /cancel, /lang) plus the inline navigation that ties them
 * together. Also exposes publishBotCommands for the startup hook.
 */
export function registerMenuHandlers(bot: Bot): void {
    // /start and /menu both land on the main menu.
    const openMenu = async (ctx: Context) => {
        const name = ctx.from?.first_name || ctx.from?.username || "";
        if (ctx.chat) clearPendingInput(ctx.chat.id);
        const lang: Lang = ctx.chat
            ? getUserPrefs(ctx.chat.id).language
            : inferLangFromTelegram(ctx);
        await ctx.reply(buildWelcome(lang, name), {
            parse_mode: "HTML",
            reply_markup: mainMenuKeyboard(lang),
            link_preview_options: { is_disabled: true },
        });
    };
    bot.command("start", openMenu);
    bot.command("menu", openMenu);

    bot.command("help", async (ctx) => {
        const lang = ctx.chat ? getUserPrefs(ctx.chat.id).language : "ar";
        await ctx.reply(buildHelpText(lang), {
            parse_mode: "HTML",
            reply_markup: helpKeyboard(lang),
            link_preview_options: { is_disabled: true },
        });
    });

    bot.command("about", async (ctx) => {
        const lang = ctx.chat ? getUserPrefs(ctx.chat.id).language : "ar";
        await ctx.reply(t(lang).about_text, {
            parse_mode: "HTML",
            reply_markup: aboutKeyboard(lang),
        });
    });

    bot.command("cancel", async (ctx) => {
        if (!ctx.chat) return;
        clearPendingInput(ctx.chat.id);
        const lang = getUserPrefs(ctx.chat.id).language;
        await ctx.reply(t(lang).cancel_done);
    });

    // /lang opens the language picker directly.
    bot.command("lang", async (ctx) => {
        const lang = ctx.chat ? getUserPrefs(ctx.chat.id).language : "ar";
        await ctx.reply(t(lang).pick_language, {
            parse_mode: "HTML",
            reply_markup: languagePickerKeyboard(lang),
        });
    });

    bot.callbackQuery("menu:home", async (ctx) => {
        const name = ctx.from?.first_name || ctx.from?.username || "";
        const lang = ctx.chat ? getUserPrefs(ctx.chat.id).language : "ar";
        await safeEdit(ctx, buildWelcome(lang, name), mainMenuKeyboard(lang));
    });

    bot.callbackQuery("menu:help", async (ctx) => {
        const lang = ctx.chat ? getUserPrefs(ctx.chat.id).language : "ar";
        await safeEdit(ctx, buildHelpText(lang), helpKeyboard(lang));
    });

    bot.callbackQuery("menu:about", async (ctx) => {
        const lang = ctx.chat ? getUserPrefs(ctx.chat.id).language : "ar";
        await safeEdit(ctx, t(lang).about_text, aboutKeyboard(lang));
    });

    bot.callbackQuery("menu:settings", async (ctx) => {
        await handleSettingsFromCallback(ctx);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery("menu:lang:pick", async (ctx) => {
        const lang = ctx.chat ? getUserPrefs(ctx.chat.id).language : "ar";
        await safeEdit(ctx, t(lang).pick_language, languagePickerKeyboard(lang));
    });

    bot.callbackQuery(/^menu:lang:set:(ar|en|tr|fr|es)$/, async (ctx) => {
        if (!ctx.chat) {
            await ctx.answerCallbackQuery();
            return;
        }
        const next = ctx.match?.[1] as Lang;
        updateUserPrefs(ctx.chat.id, { language: next });
        const name = ctx.from?.first_name || ctx.from?.username || "";
        await safeEdit(ctx, buildWelcome(next, name), mainMenuKeyboard(next));
    });

    bot.callbackQuery("menu:close", async (ctx) => {
        try {
            await ctx.deleteMessage();
        } catch {
            // best-effort
        }
        await ctx.answerCallbackQuery();
    });
}

async function safeEdit(
    ctx: Context,
    text: string,
    keyboard: InlineKeyboard,
): Promise<void> {
    try {
        await ctx.editMessageText(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
            link_preview_options: { is_disabled: true },
        });
    } catch {
        await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
            link_preview_options: { is_disabled: true },
        });
    }
    await ctx.answerCallbackQuery();
}

/**
 * Render a fresh /settings message when the user tapped "Settings" from the
 * main menu. We import DB / thumbnail modules lazily so menu.ts does not
 * form a cycle with settings.ts (they live in the same ./handlers dir and
 * settings.ts already imports from ../services/db).
 */
async function handleSettingsFromCallback(ctx: Context): Promise<void> {
    if (!ctx.chat) return;
    const prefs = getUserPrefs(ctx.chat.id);
    const thumbSet = hasThumbnail(ctx.chat.id);
    const s = t(prefs.language);
    const text =
        `${s.settings_title}\n\n${s.settings_summary}\n` +
        `${prefs.uploadAsDocument ? s.enabled : s.disabled} ${s.upload_as_document}\n` +
        `${prefs.spoiler ? s.enabled : s.disabled} ${s.spoiler}\n` +
        `${LANG_FLAG[prefs.language]} ${LANG_NATIVE[prefs.language]}\n` +
        `${s.screenshots_label(prefs.screenshotsCount)}\n` +
        `🖼️ ${thumbSet ? s.set_ : s.not_set}\n\n` +
        `${s.settings_choose_section}`;
    const kb = new InlineKeyboard()
        .text(s.settings_upload, "settings:page:upload")
        .text(s.settings_rename, "settings:page:rename")
        .row()
        .text(s.settings_media, "settings:page:media")
        .text(`${LANG_FLAG[prefs.language]} ${s.menu_language}`, "menu:lang:pick")
        .row()
        .text(s.menu_close, "settings:close");
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
}

/**
 * Best-effort guess of the user's language from the Telegram user object
 * on the very first interaction (before we've persisted any preference).
 * Used only as a default on a fresh `/start`.
 */
function inferLangFromTelegram(ctx: Context): Lang {
    const code = ctx.from?.language_code?.toLowerCase() ?? "";
    if (code.startsWith("ar")) return "ar";
    if (code.startsWith("tr")) return "tr";
    if (code.startsWith("fr")) return "fr";
    if (code.startsWith("es")) return "es";
    if (code.startsWith("en")) return "en";
    return "ar";
}

/**
 * Publish the bot's command list so Telegram renders a "/" menu in the
 * composer. We publish one variant per supported language using the
 * `language_code` scope so the user sees labels in their Telegram UI
 * language automatically.
 */
export async function publishBotCommands(bot: Bot): Promise<void> {
    const perLang: Record<Lang, Array<{ command: string; description: string }>> = {
        ar: [
            { command: "start", description: "بدء البوت" },
            { command: "menu", description: "القائمة الرئيسية" },
            { command: "settings", description: "الإعدادات" },
            { command: "help", description: "المساعدة" },
            { command: "about", description: "عن البوت" },
            { command: "lang", description: "تغيير اللغة" },
            { command: "cancel", description: "إلغاء الإدخال" },
        ],
        en: [
            { command: "start", description: "Start the bot" },
            { command: "menu", description: "Main menu" },
            { command: "settings", description: "Settings" },
            { command: "help", description: "Help" },
            { command: "about", description: "About the bot" },
            { command: "lang", description: "Change language" },
            { command: "cancel", description: "Cancel current input" },
        ],
        tr: [
            { command: "start", description: "Botu baslat" },
            { command: "menu", description: "Ana menu" },
            { command: "settings", description: "Ayarlar" },
            { command: "help", description: "Yardim" },
            { command: "about", description: "Hakkinda" },
            { command: "lang", description: "Dil degistir" },
            { command: "cancel", description: "Girisi iptal et" },
        ],
        fr: [
            { command: "start", description: "Demarrer le bot" },
            { command: "menu", description: "Menu principal" },
            { command: "settings", description: "Parametres" },
            { command: "help", description: "Aide" },
            { command: "about", description: "A propos" },
            { command: "lang", description: "Changer la langue" },
            { command: "cancel", description: "Annuler la saisie" },
        ],
        es: [
            { command: "start", description: "Iniciar el bot" },
            { command: "menu", description: "Menu principal" },
            { command: "settings", description: "Ajustes" },
            { command: "help", description: "Ayuda" },
            { command: "about", description: "Acerca de" },
            { command: "lang", description: "Cambiar idioma" },
            { command: "cancel", description: "Cancelar entrada" },
        ],
    };
    try {
        // Default set (shown when Telegram has no localisation match).
        await bot.api.setMyCommands(perLang.en);
        // Per-locale sets. Telegram falls back to the default when the
        // user's UI language doesn't match any of these.
        for (const l of SUPPORTED_LANGS) {
            await bot.api.setMyCommands(perLang[l], {
                language_code: l,
            });
        }
    } catch (err) {
        console.error("setMyCommands failed:", err);
    }
}
