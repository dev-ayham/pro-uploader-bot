import { Bot, Context, InlineKeyboard } from "grammy";
import { getUserPrefs, updateUserPrefs, UserPrefs } from "../services/db";

/**
 * Render the current preferences as an inline keyboard. Each button shows
 * a ✅ / ⬜ indicator next to the label so the user can see the current
 * state at a glance. Tapping a toggle flips it and re-renders in place.
 */
function buildKeyboard(prefs: UserPrefs): InlineKeyboard {
    const check = (on: boolean): string => (on ? "✅" : "⬜");
    return new InlineKeyboard()
        .text(
            `${check(prefs.uploadAsDocument)} الرفع كملف (Document)`,
            "settings:toggle:uploadAsDocument",
        )
        .row()
        .text(
            `${check(prefs.spoiler)} وضع السبويلر (Spoiler)`,
            "settings:toggle:spoiler",
        )
        .row()
        .text(
            `🌐 اللغة: ${prefs.language === "ar" ? "العربية" : "English"}`,
            "settings:toggle:language",
        )
        .row()
        .text("❌ إغلاق", "settings:close");
}

function renderSettingsText(prefs: UserPrefs): string {
    const yes = "✅ مفعّل";
    const no = "⬜ معطّل";
    const prefix = prefs.renamePrefix
        ? `<code>${escapeHtml(prefs.renamePrefix)}</code>`
        : "—";
    const suffix = prefs.renameSuffix
        ? `<code>${escapeHtml(prefs.renameSuffix)}</code>`
        : "—";
    return (
        `<b>⚙️ الإعدادات</b>\n\n` +
        `• الرفع كملف: ${prefs.uploadAsDocument ? yes : no}\n` +
        `• السبويلر: ${prefs.spoiler ? yes : no}\n` +
        `• اللغة: ${prefs.language === "ar" ? "العربية" : "English"}\n` +
        `• بادئة إعادة التسمية: ${prefix}\n` +
        `• لاحقة إعادة التسمية: ${suffix}\n\n` +
        `<i>اضغط على أي خيار لتغييره.</i>`
    );
}

function escapeHtml(s: string): string {
    return s
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
        const prefs = getUserPrefs(ctx.chat.id);
        await ctx.reply(renderSettingsText(prefs), {
            parse_mode: "HTML",
            reply_markup: buildKeyboard(prefs),
        });
    });

    bot.callbackQuery(/^settings:toggle:(.+)$/, async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.answerCallbackQuery();
            return;
        }
        const field = ctx.match?.[1];
        const current = getUserPrefs(chatId);
        let next: UserPrefs;
        switch (field) {
            case "uploadAsDocument":
                next = updateUserPrefs(chatId, {
                    uploadAsDocument: !current.uploadAsDocument,
                });
                break;
            case "spoiler":
                next = updateUserPrefs(chatId, { spoiler: !current.spoiler });
                break;
            case "language":
                next = updateUserPrefs(chatId, {
                    language: current.language === "ar" ? "en" : "ar",
                });
                break;
            default:
                await ctx.answerCallbackQuery();
                return;
        }
        await updateSettingsMessage(ctx, next);
    });

    bot.callbackQuery("settings:close", async (ctx) => {
        try {
            await ctx.deleteMessage();
        } catch {
            // best-effort
        }
        await ctx.answerCallbackQuery();
    });
}

async function updateSettingsMessage(
    ctx: Context,
    prefs: UserPrefs,
): Promise<void> {
    try {
        await ctx.editMessageText(renderSettingsText(prefs), {
            parse_mode: "HTML",
            reply_markup: buildKeyboard(prefs),
        });
    } catch {
        // Most likely "message is not modified" — harmless.
    }
    await ctx.answerCallbackQuery({ text: "تم الحفظ ✅" });
}
