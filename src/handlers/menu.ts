import { Bot, Context, InlineKeyboard } from "grammy";
import { clearPendingInput } from "../services/pending-input";

const WELCOME = (username: string) =>
    `👋 <b>أهلاً ${escapeHtml(username)}!</b>\n\n` +
    `أنا بوت تحميل ورفع ملفات متطوّر. أرسل لي رابطاً (مباشر أو من Instagram / YouTube / TikTok / Twitter / Facebook / Reddit…) وأرفعه لك إلى تيليجرام.\n\n` +
    `اضغط الأزرار أدناه لاستعراض الأوامر والإعدادات.`;

const HELP_TEXT =
    `📖 <b>طريقة الاستخدام</b>\n\n` +
    `<b>الأوامر الأساسية:</b>\n` +
    `• /start — بدء البوت والترحيب\n` +
    `• /menu — القائمة الرئيسية\n` +
    `• /settings — تعديل الإعدادات\n` +
    `• /help — هذه الشاشة\n` +
    `• /about — معلومات عن البوت\n` +
    `• /cancel — إلغاء الإجراء الحالي (إدخال نص/صورة بانتظار البوت)\n\n` +
    `<b>ما يدعمه:</b>\n` +
    `• روابط مباشرة (.mp4, .mp3, .pdf, …)\n` +
    `• Instagram Reels / Posts (قد يتطلّب كوكيز)\n` +
    `• YouTube / YouTube Shorts\n` +
    `• TikTok, Twitter/X, Facebook, Reddit, Vimeo, Twitch, SoundCloud\n\n` +
    `<b>ميزات مهمّة:</b>\n` +
    `• رفع كفيديو أو كملف (Document)\n` +
    `• سبويلر (إخفاء + زر كشف)\n` +
    `• بادئة/لاحقة لاسم الملف قبل الرفع\n` +
    `• لقطات شاشة من الفيديو تُرسل كألبوم\n` +
    `• صورة مصغّرة مخصّصة\n\n` +
    `اضغط ⚙️ لضبط الإعدادات.`;

const ABOUT_TEXT =
    `ℹ️ <b>عن البوت</b>\n\n` +
    `• <b>الاسم:</b> Pro Uploader\n` +
    `• <b>المكتبة:</b> Node.js + grammy + GramJS MTProto\n` +
    `• <b>الاستخراج:</b> yt-dlp\n` +
    `• <b>المعالجة:</b> ffmpeg (لقطات + مصغّرات)\n` +
    `• <b>التخزين:</b> SQLite على Railway Volume\n\n` +
    `<b>لماذا MTProto؟</b> لتجاوز حدود Bot API (رفع حتى 2GB بدل 50MB).\n\n` +
    `للدعم أو الإبلاغ عن خلل، تواصل مع صاحب البوت.`;

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function mainMenuKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text("⚙️ الإعدادات", "menu:settings")
        .text("📖 المساعدة", "menu:help")
        .row()
        .text("ℹ️ حول", "menu:about")
        .text("❌ إغلاق", "menu:close");
}

function helpKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text("⚙️ الإعدادات", "menu:settings")
        .text("🔙 القائمة", "menu:home")
        .row()
        .text("❌ إغلاق", "menu:close");
}

function aboutKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text("🔙 القائمة", "menu:home")
        .text("❌ إغلاق", "menu:close");
}

/**
 * Register all user-facing entry-point commands (/start, /menu, /help,
 * /about, /cancel) and the inline navigation that ties them together.
 * Also publishes the command list to Telegram so users see a clickable
 * menu under the "/" button in the chat composer.
 */
export function registerMenuHandlers(bot: Bot): void {
    bot.command("start", async (ctx) => {
        const name =
            ctx.from?.first_name || ctx.from?.username || "صديقي";
        if (ctx.chat) clearPendingInput(ctx.chat.id);
        await ctx.reply(WELCOME(name), {
            parse_mode: "HTML",
            reply_markup: mainMenuKeyboard(),
        });
    });

    bot.command("menu", async (ctx) => {
        const name =
            ctx.from?.first_name || ctx.from?.username || "صديقي";
        if (ctx.chat) clearPendingInput(ctx.chat.id);
        await ctx.reply(WELCOME(name), {
            parse_mode: "HTML",
            reply_markup: mainMenuKeyboard(),
        });
    });

    bot.command("help", async (ctx) => {
        await ctx.reply(HELP_TEXT, {
            parse_mode: "HTML",
            reply_markup: helpKeyboard(),
            link_preview_options: { is_disabled: true },
        });
    });

    bot.command("about", async (ctx) => {
        await ctx.reply(ABOUT_TEXT, {
            parse_mode: "HTML",
            reply_markup: aboutKeyboard(),
        });
    });

    bot.command("cancel", async (ctx) => {
        if (!ctx.chat) return;
        clearPendingInput(ctx.chat.id);
        await ctx.reply("✅ تم إلغاء أي إدخال معلّق.");
    });

    bot.callbackQuery("menu:home", async (ctx) => {
        const name =
            ctx.from?.first_name || ctx.from?.username || "صديقي";
        await safeEdit(ctx, WELCOME(name), mainMenuKeyboard());
    });

    bot.callbackQuery("menu:help", async (ctx) => {
        await safeEdit(ctx, HELP_TEXT, helpKeyboard());
    });

    bot.callbackQuery("menu:about", async (ctx) => {
        await safeEdit(ctx, ABOUT_TEXT, aboutKeyboard());
    });

    bot.callbackQuery("menu:settings", async (ctx) => {
        // Open /settings as a fresh message so the menu message stays put.
        await handleSettingsFromCallback(ctx);
        await ctx.answerCallbackQuery();
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
        // Message may be gone — fall back to a fresh reply.
        await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: keyboard,
            link_preview_options: { is_disabled: true },
        });
    }
    await ctx.answerCallbackQuery();
}

// Import lazily inside the function to avoid a circular import between the
// menu and settings modules.
async function handleSettingsFromCallback(ctx: Context): Promise<void> {
    if (!ctx.chat) return;
    const { getUserPrefs } = await import("../services/db");
    const { hasThumbnail } = await import("../services/thumbnails");
    const prefs = getUserPrefs(ctx.chat.id);
    const thumbSet = hasThumbnail(ctx.chat.id);
    const check = (on: boolean): string => (on ? "✅" : "⬜");
    const text =
        `<b>⚙️ الإعدادات</b>\n\n<b>الملخّص:</b>\n` +
        `${check(prefs.uploadAsDocument)} الرفع كملف\n` +
        `${check(prefs.spoiler)} سبويلر\n` +
        `🌐 اللغة: ${prefs.language === "ar" ? "العربية" : "English"}\n` +
        `🖼️ لقطات: ${prefs.screenshotsCount > 0 ? prefs.screenshotsCount : "—"}\n` +
        `🖼️ مصغّرة: ${thumbSet ? "مضبوطة" : "—"}\n\n` +
        `<i>اختر قسماً للتعديل.</i>`;
    const kb = new InlineKeyboard()
        .text("📤 إعدادات الرفع", "settings:page:upload")
        .text("✏️ إعادة التسمية", "settings:page:rename")
        .row()
        .text("🖼️ الوسائط", "settings:page:media")
        .text("🌐 اللغة", "settings:toggle:language")
        .row()
        .text("❌ إغلاق", "settings:close");
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
}

/**
 * Publish the bot's command list so Telegram renders a "/" menu in the
 * composer. Call this once after the bot has started.
 */
export async function publishBotCommands(bot: Bot): Promise<void> {
    try {
        await bot.api.setMyCommands([
            { command: "start", description: "بدء البوت" },
            { command: "menu", description: "القائمة الرئيسية" },
            { command: "settings", description: "الإعدادات" },
            { command: "help", description: "المساعدة" },
            { command: "about", description: "عن البوت" },
            { command: "cancel", description: "إلغاء الإدخال الحالي" },
        ]);
    } catch (err) {
        console.error("setMyCommands failed:", err);
    }
}
