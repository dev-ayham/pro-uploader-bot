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
import { getAdminIds } from "../services/admin";

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/** The "home" inline keyboard shown by /start and /menu. */
function mainMenuKeyboard(lang: Lang): InlineKeyboard {
    const s = t(lang);
    return new InlineKeyboard()
        .text(s.menu_settings, "menu:settings")
        .text(s.menu_help, "menu:help")
        .row()
        .text(`${LANG_FLAG[lang]} ${s.menu_language}`, "menu:lang:pick")
        .text(s.menu_platforms, "menu:platforms")
        .row()
        .text(s.menu_stats, "menu:stats");
}

function helpKeyboard(lang: Lang): InlineKeyboard {
    const s = t(lang);
    return new InlineKeyboard()
        .text(s.menu_settings, "menu:settings")
        .text(s.menu_back, "menu:home");
}

function simpleBackKeyboard(lang: Lang): InlineKeyboard {
    const s = t(lang);
    return new InlineKeyboard().text(s.menu_back, "menu:home");
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
 * /cancel, /lang) plus the inline navigation that ties them together.
 * Also exposes publishBotCommands for the startup hook.
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

    bot.callbackQuery("menu:platforms", async (ctx) => {
        const lang = ctx.chat ? getUserPrefs(ctx.chat.id).language : "ar";
        await safeEdit(ctx, t(lang).platforms_text, simpleBackKeyboard(lang));
    });

    bot.callbackQuery("menu:stats", async (ctx) => {
        if (!ctx.chat) {
            await ctx.answerCallbackQuery();
            return;
        }
        const prefs = getUserPrefs(ctx.chat.id);
        const { formatJoinedDate } = await import("../i18n");
        const s = t(prefs.language);
        const joined = formatJoinedDate(prefs.createdAt, prefs.language);
        await safeEdit(
            ctx,
            s.stats_text(prefs.uploadsCount, joined, `${LANG_FLAG[prefs.language]} ${LANG_NATIVE[prefs.language]}`),
            simpleBackKeyboard(prefs.language),
        );
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
        .text(s.menu_back, "menu:home");
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
    // A single row in `cmds` has the command name plus its description in
    // every supported language. Keeping everything as one matrix (instead
    // of one hand-edited array per locale) makes it far easier to add new
    // commands without missing a translation.
    const cmds: Array<{
        command: string;
        desc: Record<Lang, string>;
    }> = [
        {
            command: "start",
            desc: {
                ar: "بدء البوت",
                en: "Start the bot",
                tr: "Botu baslat",
                fr: "Demarrer le bot",
                es: "Iniciar el bot",
            },
        },
        {
            command: "menu",
            desc: {
                ar: "القائمة الرئيسية",
                en: "Main menu",
                tr: "Ana menu",
                fr: "Menu principal",
                es: "Menu principal",
            },
        },
        {
            command: "settings",
            desc: {
                ar: "الإعدادات",
                en: "Settings",
                tr: "Ayarlar",
                fr: "Parametres",
                es: "Ajustes",
            },
        },
        {
            command: "help",
            desc: {
                ar: "المساعدة",
                en: "Help",
                tr: "Yardim",
                fr: "Aide",
                es: "Ayuda",
            },
        },
        {
            command: "lang",
            desc: {
                ar: "تغيير اللغة",
                en: "Change language",
                tr: "Dil degistir",
                fr: "Changer la langue",
                es: "Cambiar idioma",
            },
        },
        {
            command: "platforms",
            desc: {
                ar: "المنصّات المدعومة",
                en: "Supported platforms",
                tr: "Desteklenen platformlar",
                fr: "Plateformes prises en charge",
                es: "Plataformas compatibles",
            },
        },
        {
            command: "stats",
            desc: {
                ar: "إحصائياتي",
                en: "My stats",
                tr: "Istatistiklerim",
                fr: "Mes stats",
                es: "Mis estadisticas",
            },
        },
        {
            command: "doc",
            desc: {
                ar: "تبديل الرفع كملف",
                en: "Toggle upload-as-document",
                tr: "Dosya olarak yukle (ac/kapa)",
                fr: "Envoyer comme document (bascule)",
                es: "Enviar como documento (alternar)",
            },
        },
        {
            command: "prefix",
            desc: {
                ar: "ضبط/مسح بادئة الاسم",
                en: "Set/clear filename prefix",
                tr: "Ad onekini ayarla/temizle",
                fr: "Definir/effacer prefixe du nom",
                es: "Definir/borrar prefijo del nombre",
            },
        },
        {
            command: "suffix",
            desc: {
                ar: "ضبط/مسح لاحقة الاسم",
                en: "Set/clear filename suffix",
                tr: "Ad sonekini ayarla/temizle",
                fr: "Definir/effacer suffixe du nom",
                es: "Definir/borrar sufijo del nombre",
            },
        },
        {
            command: "screenshots",
            desc: {
                ar: "ضبط عدد اللقطات 0|3|5|10",
                en: "Set screenshots count 0|3|5|10",
                tr: "Ekran goruntulu sayisi 0|3|5|10",
                fr: "Nombre de captures 0|3|5|10",
                es: "Numero de capturas 0|3|5|10",
            },
        },
        {
            command: "thumb",
            desc: {
                ar: "ضبط الصورة المصغّرة",
                en: "Set custom thumbnail",
                tr: "Kucuk resim ayarla",
                fr: "Definir la miniature",
                es: "Definir miniatura",
            },
        },
        {
            command: "thumb_clear",
            desc: {
                ar: "حذف الصورة المصغّرة",
                en: "Delete custom thumbnail",
                tr: "Kucuk resmi sil",
                fr: "Supprimer la miniature",
                es: "Eliminar miniatura",
            },
        },
        {
            command: "reset",
            desc: {
                ar: "استرجاع الإعدادات الافتراضية",
                en: "Restore default settings",
                tr: "Varsayilan ayarlara don",
                fr: "Reinitialiser les reglages",
                es: "Restaurar ajustes por defecto",
            },
        },
        {
            command: "id",
            desc: {
                ar: "عرض المعرّفات",
                en: "Show chat/user IDs",
                tr: "Chat/kullanici kimlikleri",
                fr: "Afficher les identifiants",
                es: "Mostrar identificadores",
            },
        },
        {
            command: "ping",
            desc: {
                ar: "فحص اتصال البوت",
                en: "Health check",
                tr: "Baglanti kontrolu",
                fr: "Verification rapide",
                es: "Verificacion rapida",
            },
        },
        {
            command: "cancel",
            desc: {
                ar: "إلغاء الإدخال الحالي",
                en: "Cancel current input",
                tr: "Mevcut girisi iptal et",
                fr: "Annuler la saisie",
                es: "Cancelar entrada",
            },
        },
    ];
    const perLang = {} as Record<Lang, Array<{ command: string; description: string }>>;
    for (const l of SUPPORTED_LANGS) {
        perLang[l] = cmds.map((c) => ({
            command: c.command,
            description: c.desc[l],
        }));
    }
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

    // Admin-only command surface. We publish this per-chat using
    // BotCommandScopeChat so the extra commands appear in the "/" menu for
    // the admin's private chat only — regular users never see them. Each
    // admin id comes from the ADMIN_CHAT_IDS env var (plus the hard-coded
    // baseline owner).
    const adminCmds: Array<{ command: string; description: string }> = [
        { command: "admin", description: "Admin menu" },
        { command: "ai_status", description: "OpenAI health check" },
        { command: "stats_all", description: "Global stats" },
        { command: "broadcast", description: "Send message to all users" },
        { command: "user", description: "Inspect a user by chat_id" },
        { command: "ban", description: "Ban a chat_id" },
        { command: "unban", description: "Unban a chat_id" },
        { command: "bans", description: "List banned chat_ids" },
    ];
    // We merge the default user commands with the admin commands so the
    // admin still sees everything normal users see. Order: user commands
    // first (most common), admin commands last (flagged with 🔒 prefix in
    // description for clarity).
    const adminFull = [
        ...perLang.en,
        ...adminCmds.map((c) => ({
            command: c.command,
            description: `🔒 ${c.description}`,
        })),
    ];
    for (const adminId of getAdminIds()) {
        try {
            await bot.api.setMyCommands(adminFull, {
                scope: { type: "chat", chat_id: adminId },
            });
        } catch (err) {
            // Most common failure: the admin has never opened a DM with
            // the bot, so Telegram doesn't let us set a scope against
            // that chat yet. It'll succeed after their first /start.
            console.warn(
                `setMyCommands(chat=${adminId}) failed:`,
                err instanceof Error ? err.message : err,
            );
        }
    }
}
