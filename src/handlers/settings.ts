import { Bot, Context, InlineKeyboard } from "grammy";
import { getUserPrefs, updateUserPrefs, UserPrefs } from "../services/db";
import {
    clearPendingInput,
    getPendingInput,
    setPendingInput,
} from "../services/pending-input";
import { deleteThumbnail, hasThumbnail } from "../services/thumbnails";

const MAX_RENAME_LEN = 64;

/**
 * Render the current preferences as an inline keyboard. Each button shows
 * a ✅ / ⬜ indicator next to the label so the user can see the current
 * state at a glance. Tapping a toggle flips it and re-renders in place.
 */
function buildKeyboard(prefs: UserPrefs, thumbSet: boolean): InlineKeyboard {
    const check = (on: boolean): string => (on ? "✅" : "⬜");
    const kb = new InlineKeyboard()
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
        .text(
            `🖼️ لقطات الفيديو: ${prefs.screenshotsCount || "معطّل"}`,
            "settings:screenshots:cycle",
        )
        .row()
        .text("✏️ بادئة التسمية", "settings:rename:prefix:set")
        .text(
            prefs.renamePrefix ? "🗑️ مسح البادئة" : "—",
            prefs.renamePrefix ? "settings:rename:prefix:clear" : "settings:noop",
        )
        .row()
        .text("✏️ لاحقة التسمية", "settings:rename:suffix:set")
        .text(
            prefs.renameSuffix ? "🗑️ مسح اللاحقة" : "—",
            prefs.renameSuffix ? "settings:rename:suffix:clear" : "settings:noop",
        )
        .row()
        .text(
            thumbSet
                ? "🖼️ تغيير الصورة المصغّرة"
                : "🖼️ ضبط الصورة المصغّرة",
            "settings:thumb:set",
        )
        .text(
            thumbSet ? "🗑️ حذف المصغّرة" : "—",
            thumbSet ? "settings:thumb:clear" : "settings:noop",
        )
        .row()
        .text("❌ إغلاق", "settings:close");
    return kb;
}

function renderSettingsText(prefs: UserPrefs, thumbSet: boolean): string {
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
        `• لاحقة إعادة التسمية: ${suffix}\n` +
        `• لقطات الفيديو: ${prefs.screenshotsCount > 0 ? prefs.screenshotsCount : no}\n` +
        `• الصورة المصغّرة: ${thumbSet ? "✅ مضبوطة" : no}\n\n` +
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
        // Cancel any stale "awaiting input" state so /settings always lands
        // in a known-good state.
        clearPendingInput(ctx.chat.id);
        const prefs = getUserPrefs(ctx.chat.id);
        const thumbSet = hasThumbnail(ctx.chat.id);
        await ctx.reply(renderSettingsText(prefs, thumbSet), {
            parse_mode: "HTML",
            reply_markup: buildKeyboard(prefs, thumbSet),
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

    bot.callbackQuery("settings:screenshots:cycle", async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.answerCallbackQuery();
            return;
        }
        // Cycle: 0 -> 3 -> 5 -> 10 -> 0 ...
        const cycle = [0, 3, 5, 10];
        const current = getUserPrefs(chatId).screenshotsCount;
        const idx = cycle.indexOf(current);
        const nextCount = cycle[(idx + 1) % cycle.length];
        const next = updateUserPrefs(chatId, { screenshotsCount: nextCount });
        await updateSettingsMessage(ctx, next);
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
            const next = updateUserPrefs(chatId, {
                [which === "prefix" ? "renamePrefix" : "renameSuffix"]: "",
            });
            await updateSettingsMessage(ctx, next);
            return;
        }
        // set: park state, ask for text in the next message.
        setPendingInput(chatId, {
            kind: which === "prefix" ? "rename_prefix" : "rename_suffix",
        });
        const prompt =
            which === "prefix"
                ? "✏️ أرسل البادئة التي تريد إضافتها قبل اسم كل ملف (حتى 64 حرفاً). أرسل / للإلغاء."
                : "✏️ أرسل اللاحقة التي تريد إضافتها بعد اسم كل ملف وقبل الامتداد (حتى 64 حرفاً). أرسل / للإلغاء.";
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
            await updateSettingsMessage(ctx, getUserPrefs(chatId), false);
            return;
        }
        setPendingInput(chatId, { kind: "thumbnail_photo" });
        await ctx.reply(
            "🖼️ أرسل الآن صورة لاستخدامها كصورة مصغّرة لجميع الملفات القادمة. أرسل / للإلغاء.",
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery("settings:close", async (ctx) => {
        if (ctx.chat) clearPendingInput(ctx.chat.id);
        try {
            await ctx.deleteMessage();
        } catch {
            // best-effort
        }
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
    // "/" alone cancels; any /command also cancels to avoid swallowing them.
    if (text === "/" || text.startsWith("/")) {
        clearPendingInput(chatId);
        await ctx.reply("تم الإلغاء.");
        return true;
    }
    if (text.length > MAX_RENAME_LEN) {
        await ctx.reply(
            `⚠️ النص طويل (الحد الأقصى ${MAX_RENAME_LEN} حرفاً). حاول مرة أخرى.`,
        );
        return true;
    }
    if (pending.kind === "rename_prefix") {
        updateUserPrefs(chatId, { renamePrefix: text });
    } else if (pending.kind === "rename_suffix") {
        updateUserPrefs(chatId, { renameSuffix: text });
    }
    clearPendingInput(chatId);
    await ctx.reply("✅ تم الحفظ. استخدم /settings لرؤية الإعدادات الحالية.");
    return true;
}

async function updateSettingsMessage(
    ctx: Context,
    prefs: UserPrefs,
    thumbSet: boolean = ctx.chat ? hasThumbnail(ctx.chat.id) : false,
): Promise<void> {
    try {
        await ctx.editMessageText(renderSettingsText(prefs, thumbSet), {
            parse_mode: "HTML",
            reply_markup: buildKeyboard(prefs, thumbSet),
        });
    } catch {
        // Most likely "message is not modified" — harmless.
    }
    await ctx.answerCallbackQuery({ text: "تم الحفظ ✅" });
}
