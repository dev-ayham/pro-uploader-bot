import { Bot, Context, InlineKeyboard } from "grammy";
import { getUserPrefs, updateUserPrefs, UserPrefs } from "../services/db";
import {
    clearPendingInput,
    getPendingInput,
    setPendingInput,
} from "../services/pending-input";
import { deleteThumbnail, hasThumbnail } from "../services/thumbnails";

const MAX_RENAME_LEN = 64;

type Page = "main" | "upload" | "rename" | "media";

/**
 * Render the /settings home page. We now split configuration into three
 * sub-pages (Upload / Rename / Media) so each screen fits comfortably on a
 * phone without the keyboard becoming a scroll-soup. The root page just
 * shows navigation + the current summary.
 */
function buildHomeKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text("📤 إعدادات الرفع", "settings:page:upload")
        .text("✏️ إعادة التسمية", "settings:page:rename")
        .row()
        .text("🖼️ الوسائط", "settings:page:media")
        .text("🌐 اللغة", "settings:toggle:language")
        .row()
        .text("❌ إغلاق", "settings:close");
}

function buildUploadKeyboard(prefs: UserPrefs): InlineKeyboard {
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
        .text("🔙 رجوع", "settings:page:main");
}

function buildRenameKeyboard(prefs: UserPrefs): InlineKeyboard {
    return new InlineKeyboard()
        .text("✏️ بادئة", "settings:rename:prefix:set")
        .text(
            prefs.renamePrefix ? "🗑️ مسح البادئة" : "—",
            prefs.renamePrefix ? "settings:rename:prefix:clear" : "settings:noop",
        )
        .row()
        .text("✏️ لاحقة", "settings:rename:suffix:set")
        .text(
            prefs.renameSuffix ? "🗑️ مسح اللاحقة" : "—",
            prefs.renameSuffix ? "settings:rename:suffix:clear" : "settings:noop",
        )
        .row()
        .text("🔙 رجوع", "settings:page:main");
}

function buildMediaKeyboard(prefs: UserPrefs, thumbSet: boolean): InlineKeyboard {
    return new InlineKeyboard()
        .text(
            `🖼️ لقطات الفيديو: ${prefs.screenshotsCount || "معطّل"}`,
            "settings:screenshots:cycle",
        )
        .row()
        .text(
            thumbSet ? "🖼️ تغيير المصغّرة" : "🖼️ ضبط المصغّرة",
            "settings:thumb:set",
        )
        .text(
            thumbSet ? "🗑️ حذف المصغّرة" : "—",
            thumbSet ? "settings:thumb:clear" : "settings:noop",
        )
        .row()
        .text("🔙 رجوع", "settings:page:main");
}

function renderText(page: Page, prefs: UserPrefs, thumbSet: boolean): string {
    const yes = "✅";
    const no = "⬜";
    const header = "<b>⚙️ الإعدادات</b>";
    const summary =
        `\n\n<b>الملخّص:</b>\n` +
        `${prefs.uploadAsDocument ? yes : no} الرفع كملف\n` +
        `${prefs.spoiler ? yes : no} سبويلر\n` +
        `🌐 اللغة: ${prefs.language === "ar" ? "العربية" : "English"}\n` +
        `✏️ بادئة: ${prefs.renamePrefix ? `<code>${escapeHtml(prefs.renamePrefix)}</code>` : "—"}\n` +
        `✏️ لاحقة: ${prefs.renameSuffix ? `<code>${escapeHtml(prefs.renameSuffix)}</code>` : "—"}\n` +
        `🖼️ لقطات: ${prefs.screenshotsCount > 0 ? prefs.screenshotsCount : "—"}\n` +
        `🖼️ مصغّرة مخصّصة: ${thumbSet ? "مضبوطة" : "—"}`;

    switch (page) {
        case "upload":
            return `${header}\n\n📤 <b>إعدادات الرفع</b>\n• شكل الإرسال (فيديو أم ملف)\n• إخفاء المحتوى بسبويلر.`;
        case "rename":
            return (
                `${header}\n\n✏️ <b>إعادة تسمية الملفات</b>\n` +
                `البادئة تضاف قبل الاسم، واللاحقة بعده وقبل الامتداد.\n` +
                `الحد الأقصى ${MAX_RENAME_LEN} حرفاً.\n\n` +
                `• البادئة: ${prefs.renamePrefix ? `<code>${escapeHtml(prefs.renamePrefix)}</code>` : "—"}\n` +
                `• اللاحقة: ${prefs.renameSuffix ? `<code>${escapeHtml(prefs.renameSuffix)}</code>` : "—"}`
            );
        case "media":
            return (
                `${header}\n\n🖼️ <b>الوسائط</b>\n` +
                `• لقطات الفيديو: يُرفق ألبوم بعد كل فيديو. القيم: 0 / 3 / 5 / 10.\n` +
                `• المصغّرة: صورة ثابتة تُستخدم كـ thumbnail لكل رفع.\n\n` +
                `• الحالة: لقطات = ${prefs.screenshotsCount > 0 ? prefs.screenshotsCount : "معطّل"}, المصغّرة = ${thumbSet ? "مضبوطة" : "غير مضبوطة"}`
            );
        default:
            return `${header}${summary}\n\n<i>اختر قسماً للتعديل.</i>`;
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
            return buildHomeKeyboard();
    }
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
            case "spoiler":
                updateUserPrefs(chatId, { spoiler: !current.spoiler });
                await updateSettingsMessage(ctx, "upload");
                return;
            case "language":
                updateUserPrefs(chatId, {
                    language: current.language === "ar" ? "en" : "ar",
                });
                await updateSettingsMessage(ctx, "main");
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
        const prompt =
            which === "prefix"
                ? "✏️ أرسل البادئة التي تريد إضافتها قبل اسم كل ملف (حتى 64 حرفاً). أرسل /cancel للإلغاء."
                : "✏️ أرسل اللاحقة التي تريد إضافتها بعد اسم كل ملف وقبل الامتداد (حتى 64 حرفاً). أرسل /cancel للإلغاء.";
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
        await ctx.reply(
            "🖼️ أرسل الآن صورة لاستخدامها كصورة مصغّرة لجميع الملفات القادمة. أرسل /cancel للإلغاء.",
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
    // Any /command cancels the flow so commands keep working mid-prompt.
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
    } else {
        // thumbnail_photo is handled by message:photo, not message:text.
        return false;
    }
    clearPendingInput(chatId);
    await ctx.reply("✅ تم الحفظ. استخدم /settings لرؤية الإعدادات الحالية.");
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
        // "message is not modified" or the source message is gone — harmless.
    }
    await ctx.answerCallbackQuery();
}
