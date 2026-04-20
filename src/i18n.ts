/**
 * Lightweight i18n module. Each supported locale maps to the same set of
 * string keys. Functions that accept a dynamic argument take a callback
 * so callers can do `t(lang, "downloading")(0.42)` → "📥 Downloading: 42%".
 */

export type Lang = "ar" | "en" | "tr" | "fr" | "es";

export const SUPPORTED_LANGS: readonly Lang[] = ["ar", "en", "tr", "fr", "es"];

export const LANG_FLAG: Record<Lang, string> = {
    ar: "🇸🇦",
    en: "🇬🇧",
    tr: "🇹🇷",
    fr: "🇫🇷",
    es: "🇪🇸",
};

export const LANG_NATIVE: Record<Lang, string> = {
    ar: "العربية",
    en: "English",
    tr: "Türkçe",
    fr: "Français",
    es: "Español",
};

interface Strings {
    // Menu / welcome
    welcome: (name: string) => string;
    menu_settings: string;
    menu_help: string;
    menu_about: string;
    menu_close: string;
    menu_back: string;
    menu_language: string;
    menu_platforms: string;
    menu_stats: string;

    // Help
    help_title: string;
    help_commands: string;
    help_platforms: string;
    help_features: string;

    // About
    about_text: string;

    // Settings
    settings_title: string;
    settings_summary: string;
    settings_upload: string;
    settings_rename: string;
    settings_media: string;
    settings_choose_section: string;
    settings_back: string;

    // Settings: upload page
    upload_as_document: string;
    spoiler: string;
    upload_page_desc: string;

    // Settings: rename page
    rename_prefix: string;
    rename_suffix: string;
    rename_clear_prefix: string;
    rename_clear_suffix: string;
    rename_page_desc: (maxLen: number) => string;
    rename_prompt_prefix: (maxLen: number) => string;
    rename_prompt_suffix: (maxLen: number) => string;
    rename_too_long: (maxLen: number) => string;
    rename_saved: string;

    // Settings: media page
    screenshots_label: (count: number) => string;
    thumb_set: string;
    thumb_change: string;
    thumb_delete: string;
    thumb_disabled: string;
    media_page_desc: (scCount: number, thumbSet: boolean) => string;
    thumb_prompt: string;
    thumb_saved: string;
    thumb_save_error: (detail: string) => string;

    // Upload flow
    processing: string;
    extracting: string;
    downloading: (p: number) => string;
    uploading: (p: number) => string;
    success: string;
    error: string;
    invalid_url: string;
    already_in_flight: string;
    duplicate_ignored: string;
    screenshots_caption: (n: number) => string;
    screenshots_single: string;
    screenshots_fail: (detail: string) => string;
    screenshots_none: string;

    // Cancel
    cancel_done: string;
    cancel_text: string;

    // Language picker
    pick_language: string;

    // Misc
    saved: string;
    enabled: string;
    disabled: string;
    set_: string;
    not_set: string;

    // Quick commands
    cmd_doc_toggled: (on: boolean) => string;
    cmd_spoiler_toggled: (on: boolean) => string;
    cmd_prefix_set: (value: string) => string;
    cmd_prefix_cleared: string;
    cmd_prefix_current: (value: string) => string;
    cmd_prefix_none: string;
    cmd_suffix_set: (value: string) => string;
    cmd_suffix_cleared: string;
    cmd_suffix_current: (value: string) => string;
    cmd_suffix_none: string;
    cmd_screenshots_set: (n: number) => string;
    cmd_screenshots_usage: string;
    cmd_thumb_clear_done: string;
    cmd_thumb_not_set: string;
    cmd_reset_done: string;
    platforms_text: string;
    stats_text: (uploads: number, joined: string, lang: string) => string;
    id_text: (chatId: number, userId: number) => string;
    pong: (uptimeSec: number) => string;
    stats_never: string;

    // AI intent follow-ups
    ai_no_last_url: string;
    ai_daily_limit: (limit: number) => string;
    ai_intent_unknown: string;
    ai_audio_extracting: string;
    ai_audio_uploading: (p: number) => string;
    ai_audio_success: string;
    ai_audio_error: (detail: string) => string;
    ai_retrying: string;
    ai_reupload_document: string;
    ai_reupload_video: string;
}

const ar: Strings = {
    welcome: (name) =>
        `👋 <b>أهلاً ${name}!</b>\n\n` +
        `أنا بوت تحميل ورفع ملفات متطوّر.\n` +
        `أرسل لي رابطاً وأرفعه لك إلى تيليجرام.\n\n` +
        `<b>المنصّات المدعومة:</b>\n` +
        `Instagram / YouTube / TikTok / Twitter\n` +
        `Facebook / Reddit / Vimeo / SoundCloud\n` +
        `+ أي رابط مباشر لملف\n\n` +
        `<b>الميزات:</b>\n` +
        `• رفع حتى 2GB عبر MTProto\n` +
        `• رفع كفيديو أو كملف\n` +
        `• سبويلر، إعادة تسمية، لقطات\n` +
        `• صورة مصغّرة مخصّصة\n\n` +
        `اضغط الأزرار أدناه للبدء.`,
    menu_settings: "⚙️ الإعدادات",
    menu_help: "📖 المساعدة",
    menu_about: "ℹ️ حول",
    menu_close: "❌ إغلاق",
    menu_back: "🔙 رجوع",
    menu_language: "🌐 اللغة",
    menu_platforms: "🌐 المنصّات",
    menu_stats: "📊 إحصائياتي",

    help_title: "📖 <b>المساعدة</b>",
    help_commands:
        `<b>الأوامر:</b>\n` +
        `/start — بدء البوت\n` +
        `/menu — القائمة الرئيسية\n` +
        `/settings — الإعدادات\n` +
        `/help — المساعدة\n` +
        `/about — عن البوت\n` +
        `/cancel — إلغاء الإدخال\n` +
        `/lang — تغيير اللغة`,
    help_platforms:
        `\n\n<b>المنصّات:</b>\n` +
        `روابط مباشرة, Instagram, YouTube, TikTok,\n` +
        `Twitter/X, Facebook, Reddit, Vimeo,\nTwitch, SoundCloud`,
    help_features:
        `\n\n<b>الميزات:</b>\n` +
        `• رفع كملف / فيديو\n• سبويلر\n• بادئة / لاحقة\n` +
        `• لقطات شاشة\n• صورة مصغّرة\n• رفع حتى 2GB`,

    about_text:
        `ℹ️ <b>عن البوت</b>\n\n` +
        `<b>Pro Uploader</b> — بوت رفع ملفات متطوّر\n` +
        `Node.js + grammy + GramJS MTProto\n` +
        `yt-dlp للاستخراج | ffmpeg للمعالجة\n` +
        `SQLite للتخزين الدائم\n\n` +
        `<b>لماذا MTProto؟</b>\nلتجاوز حدود Bot API (رفع حتى 2GB بدل 50MB).`,

    settings_title: "⚙️ <b>الإعدادات</b>",
    settings_summary: "<b>الملخّص:</b>",
    settings_upload: "📤 إعدادات الرفع",
    settings_rename: "✏️ إعادة التسمية",
    settings_media: "🖼️ الوسائط",
    settings_choose_section: "<i>اختر قسماً للتعديل.</i>",
    settings_back: "🔙 رجوع",

    upload_as_document: "الرفع كملف (Document)",
    spoiler: "وضع السبويلر (Spoiler)",
    upload_page_desc: "📤 <b>إعدادات الرفع</b>\n• شكل الإرسال (فيديو أم ملف)\n• إخفاء المحتوى بسبويلر.",

    rename_prefix: "✏️ بادئة",
    rename_suffix: "✏️ لاحقة",
    rename_clear_prefix: "🗑️ مسح البادئة",
    rename_clear_suffix: "🗑️ مسح اللاحقة",
    rename_page_desc: (max) =>
        `✏️ <b>إعادة تسمية الملفات</b>\nالبادئة قبل الاسم، واللاحقة بعده.\nالحد الأقصى ${max} حرفاً.`,
    rename_prompt_prefix: (max) => `✏️ أرسل البادئة (حتى ${max} حرفاً). أرسل /cancel للإلغاء.`,
    rename_prompt_suffix: (max) => `✏️ أرسل اللاحقة (حتى ${max} حرفاً). أرسل /cancel للإلغاء.`,
    rename_too_long: (max) => `⚠️ النص طويل (الحد الأقصى ${max} حرفاً). حاول مرة أخرى.`,
    rename_saved: "✅ تم الحفظ. استخدم /settings لرؤية الإعدادات.",

    screenshots_label: (c) => `🖼️ لقطات: ${c || "معطّل"}`,
    thumb_set: "🖼️ ضبط المصغّرة",
    thumb_change: "🖼️ تغيير المصغّرة",
    thumb_delete: "🗑️ حذف المصغّرة",
    thumb_disabled: "—",
    media_page_desc: (sc, th) =>
        `🖼️ <b>الوسائط</b>\n• لقطات = ${sc > 0 ? sc : "معطّل"}\n• المصغّرة = ${th ? "مضبوطة" : "غير مضبوطة"}`,
    thumb_prompt: "🖼️ أرسل صورة الآن لاستخدامها كصورة مصغّرة. أرسل /cancel للإلغاء.",
    thumb_saved: "✅ تم حفظ الصورة المصغّرة. ستُستخدم لجميع الملفات القادمة.",
    thumb_save_error: (d) => `❌ تعذّر حفظ الصورة المصغّرة: <code>${d}</code>`,

    processing: "⏳ جاري المعالجة...",
    extracting: "🔍 جاري استخراج الفيديو...",
    downloading: (p) => `📥 جاري التحميل: ${Math.round(p * 100)}%`,
    uploading: (p) => `📤 جاري الرفع: ${Math.round(p * 100)}%`,
    success: "✅ تم الرفع بنجاح!",
    error: "❌ حدث خطأ أثناء الرفع.",
    invalid_url: "⚠️ لم أجد رابطاً صالحاً في الرسالة.",
    already_in_flight: "⏳ لديك رفع قيد التنفيذ. انتظر حتى ينتهي.",
    duplicate_ignored: "ℹ️ تم تجاهل رابط مكرر.",
    screenshots_caption: (n) => `🖼️ ${n} لقطات من الفيديو`,
    screenshots_single: "🖼️ لقطة من الفيديو",
    screenshots_fail: (d) => `⚠️ فشل استخراج اللقطات: <code>${d}</code>`,
    screenshots_none: "⚠️ تعذّر استخراج لقطات من الفيديو.",

    cancel_done: "✅ تم إلغاء أي إدخال معلّق.",
    cancel_text: "تم الإلغاء.",

    pick_language: "🌐 <b>اختر اللغة:</b>",

    saved: "✅ تم الحفظ",
    enabled: "✅",
    disabled: "⬜",
    set_: "مضبوطة",
    not_set: "—",

    cmd_doc_toggled: (on) => `📤 الرفع كملف: ${on ? "مُفعّل ✅" : "مُعطّل ⬜"}`,
    cmd_spoiler_toggled: (on) => `🫣 السبويلر: ${on ? "مُفعّل ✅" : "مُعطّل ⬜"}`,
    cmd_prefix_set: (v) => `✏️ تم ضبط البادئة: <code>${v}</code>`,
    cmd_prefix_cleared: "✏️ تم مسح البادئة.",
    cmd_prefix_current: (v) => `✏️ البادئة الحالية: <code>${v}</code>
للتغيير: <code>/prefix النص</code>
للمسح: <code>/prefix clear</code>`,
    cmd_prefix_none: "ℹ️ لا توجد بادئة. استخدم <code>/prefix النص</code> لضبطها.",
    cmd_suffix_set: (v) => `✏️ تم ضبط اللاحقة: <code>${v}</code>`,
    cmd_suffix_cleared: "✏️ تم مسح اللاحقة.",
    cmd_suffix_current: (v) => `✏️ اللاحقة الحالية: <code>${v}</code>
للتغيير: <code>/suffix النص</code>
للمسح: <code>/suffix clear</code>`,
    cmd_suffix_none: "ℹ️ لا توجد لاحقة. استخدم <code>/suffix النص</code> لضبطها.",
    cmd_screenshots_set: (n) => `🖼️ عدد اللقطات: ${n === 0 ? "معطّل" : n}`,
    cmd_screenshots_usage: "استخدام: <code>/screenshots 0|3|5|10</code>",
    cmd_thumb_clear_done: "🗑️ تم حذف الصورة المصغّرة.",
    cmd_thumb_not_set: "ℹ️ لا توجد صورة مصغّرة محفوظة.",
    cmd_reset_done: "♻️ تم استرجاع الإعدادات الافتراضية.",
    platforms_text:
        "<b>🌐 المنصّات المدعومة</b>\n\n" +
        "• روابط مباشرة (mp4 / mkv / pdf / zip / …)\n" +
        "• Instagram (Reels / Posts / Stories)\n" +
        "• YouTube + YouTube Shorts\n" +
        "• TikTok\n" +
        "• Twitter / X\n" +
        "• Facebook\n" +
        "• Reddit\n" +
        "• Vimeo\n" +
        "• Twitch\n" +
        "• SoundCloud\n\n" +
        "<i>حد أقصى للرفع: 2GB عبر MTProto</i>",
    stats_text: (uploads, joined, lang) =>
        "<b>📊 إحصائياتك</b>\n\n" +
        `• عدد الرفعات الناجحة: <b>${uploads}</b>\n` +
        `• اللغة: <b>${lang}</b>\n` +
        `• انضممت: ${joined}`,
    id_text: (chatId, userId) =>
        `🆔 <b>المعرّفات</b>\n\n` +
        `• Chat ID: <code>${chatId}</code>\n` +
        `• User ID: <code>${userId}</code>`,
    pong: (u) => `🏓 pong — يعمل منذ ${formatUptime(u, "ar")}`,
    stats_never: "—",

    ai_no_last_url: "ℹ️ لم أستلم رابطاً بعد. أرسل رابطاً أولاً، ثم اكتبلي ماذا تريد منه.",
    ai_daily_limit: (limit) =>
        `⏳ وصلت إلى الحد اليومي من طلبات الذكاء الاصطناعي (${limit}). جرّب غداً أو أرسل رابطاً جديداً.`,
    ai_intent_unknown:
        "🤖 لم أفهم طلبك. جرّب أن تكتب: «بدي ياه صوت» أو «كملف» أو «كفيديو» أو «أعد المحاولة».",
    ai_audio_extracting: "🎵 جاري استخراج الصوت...",
    ai_audio_uploading: (p) => `📤 رفع الصوت: ${Math.round(p * 100)}%`,
    ai_audio_success: "✅ تم رفع الصوت بنجاح!",
    ai_audio_error: (d) => `❌ فشل استخراج الصوت: <code>${d}</code>`,
    ai_retrying: "🔄 إعادة المحاولة على الرابط السابق...",
    ai_reupload_document: "📄 إعادة الرفع كملف...",
    ai_reupload_video: "🎬 إعادة الرفع كفيديو...",
};

const en: Strings = {
    welcome: (name) =>
        `👋 <b>Hello ${name}!</b>\n\n` +
        `I'm an advanced file upload bot.\n` +
        `Send me a link and I'll upload it to Telegram.\n\n` +
        `<b>Supported platforms:</b>\n` +
        `Instagram / YouTube / TikTok / Twitter\n` +
        `Facebook / Reddit / Vimeo / SoundCloud\n` +
        `+ any direct file URL\n\n` +
        `<b>Features:</b>\n` +
        `• Upload up to 2GB via MTProto\n` +
        `• Upload as video or document\n` +
        `• Spoiler, rename, screenshots\n` +
        `• Custom thumbnail\n\n` +
        `Tap the buttons below to get started.`,
    menu_settings: "⚙️ Settings",
    menu_help: "📖 Help",
    menu_about: "ℹ️ About",
    menu_close: "❌ Close",
    menu_back: "🔙 Back",
    menu_language: "🌐 Language",
    menu_platforms: "🌐 Platforms",
    menu_stats: "📊 My stats",

    help_title: "📖 <b>Help</b>",
    help_commands:
        `<b>Commands:</b>\n` +
        `/start — Start the bot\n` +
        `/menu — Main menu\n` +
        `/settings — Settings\n` +
        `/help — Help\n` +
        `/about — About\n` +
        `/cancel — Cancel input\n` +
        `/lang — Change language`,
    help_platforms:
        `\n\n<b>Platforms:</b>\n` +
        `Direct URLs, Instagram, YouTube, TikTok,\n` +
        `Twitter/X, Facebook, Reddit, Vimeo,\nTwitch, SoundCloud`,
    help_features:
        `\n\n<b>Features:</b>\n` +
        `• Upload as document / video\n• Spoiler\n• Prefix / suffix rename\n` +
        `• Video screenshots\n• Custom thumbnail\n• Up to 2GB uploads`,

    about_text:
        `ℹ️ <b>About</b>\n\n` +
        `<b>Pro Uploader</b> — Advanced upload bot\n` +
        `Node.js + grammy + GramJS MTProto\n` +
        `yt-dlp for extraction | ffmpeg for processing\n` +
        `SQLite for persistent storage\n\n` +
        `<b>Why MTProto?</b>\nTo bypass Bot API limits (upload up to 2GB instead of 50MB).`,

    settings_title: "⚙️ <b>Settings</b>",
    settings_summary: "<b>Summary:</b>",
    settings_upload: "📤 Upload settings",
    settings_rename: "✏️ Rename",
    settings_media: "🖼️ Media",
    settings_choose_section: "<i>Choose a section to edit.</i>",
    settings_back: "🔙 Back",

    upload_as_document: "Upload as document",
    spoiler: "Spoiler mode",
    upload_page_desc: "📤 <b>Upload Settings</b>\n• Send as video or document.",

    rename_prefix: "✏️ Prefix",
    rename_suffix: "✏️ Suffix",
    rename_clear_prefix: "🗑️ Clear prefix",
    rename_clear_suffix: "🗑️ Clear suffix",
    rename_page_desc: (max) =>
        `✏️ <b>File Rename</b>\nPrefix goes before the name, suffix after.\nMax ${max} characters.`,
    rename_prompt_prefix: (max) => `✏️ Send the prefix (up to ${max} chars). Send /cancel to abort.`,
    rename_prompt_suffix: (max) => `✏️ Send the suffix (up to ${max} chars). Send /cancel to abort.`,
    rename_too_long: (max) => `⚠️ Text too long (max ${max} characters). Try again.`,
    rename_saved: "✅ Saved. Use /settings to view current settings.",

    screenshots_label: (c) => `🖼️ Screenshots: ${c || "off"}`,
    thumb_set: "🖼️ Set thumbnail",
    thumb_change: "🖼️ Change thumbnail",
    thumb_delete: "🗑️ Delete thumbnail",
    thumb_disabled: "—",
    media_page_desc: (sc, th) =>
        `🖼️ <b>Media</b>\n• Screenshots = ${sc > 0 ? sc : "off"}\n• Thumbnail = ${th ? "set" : "not set"}`,
    thumb_prompt: "🖼️ Send a photo now to use as thumbnail. Send /cancel to abort.",
    thumb_saved: "✅ Thumbnail saved. It will be used for all future uploads.",
    thumb_save_error: (d) => `❌ Failed to save thumbnail: <code>${d}</code>`,

    processing: "⏳ Processing...",
    extracting: "🔍 Extracting video...",
    downloading: (p) => `📥 Downloading: ${Math.round(p * 100)}%`,
    uploading: (p) => `📤 Uploading: ${Math.round(p * 100)}%`,
    success: "✅ Upload complete!",
    error: "❌ Upload failed.",
    invalid_url: "⚠️ No valid URL found in your message.",
    already_in_flight: "⏳ You already have an upload in progress. Please wait.",
    duplicate_ignored: "ℹ️ Duplicate link ignored.",
    screenshots_caption: (n) => `🖼️ ${n} screenshots from the video`,
    screenshots_single: "🖼️ Screenshot from the video",
    screenshots_fail: (d) => `⚠️ Screenshot extraction failed: <code>${d}</code>`,
    screenshots_none: "⚠️ Could not extract screenshots from the video.",

    cancel_done: "✅ Pending input cancelled.",
    cancel_text: "Cancelled.",

    pick_language: "🌐 <b>Choose language:</b>",

    saved: "✅ Saved",
    enabled: "✅",
    disabled: "⬜",
    set_: "set",
    not_set: "—",

    cmd_doc_toggled: (on) => `📤 Upload as document: ${on ? "ON ✅" : "OFF ⬜"}`,
    cmd_spoiler_toggled: (on) => `🫣 Spoiler mode: ${on ? "ON ✅" : "OFF ⬜"}`,
    cmd_prefix_set: (v) => `✏️ Prefix set to: <code>${v}</code>`,
    cmd_prefix_cleared: "✏️ Prefix cleared.",
    cmd_prefix_current: (v) => `✏️ Current prefix: <code>${v}</code>
Change: <code>/prefix your-text</code>
Clear: <code>/prefix clear</code>`,
    cmd_prefix_none: "ℹ️ No prefix is set. Use <code>/prefix your-text</code> to set one.",
    cmd_suffix_set: (v) => `✏️ Suffix set to: <code>${v}</code>`,
    cmd_suffix_cleared: "✏️ Suffix cleared.",
    cmd_suffix_current: (v) => `✏️ Current suffix: <code>${v}</code>
Change: <code>/suffix your-text</code>
Clear: <code>/suffix clear</code>`,
    cmd_suffix_none: "ℹ️ No suffix is set. Use <code>/suffix your-text</code> to set one.",
    cmd_screenshots_set: (n) => `🖼️ Screenshots count: ${n === 0 ? "disabled" : n}`,
    cmd_screenshots_usage: "Usage: <code>/screenshots 0|3|5|10</code>",
    cmd_thumb_clear_done: "🗑️ Thumbnail deleted.",
    cmd_thumb_not_set: "ℹ️ No thumbnail is currently set.",
    cmd_reset_done: "♻️ Settings restored to defaults.",
    platforms_text:
        "<b>🌐 Supported platforms</b>\n\n" +
        "• Direct links (mp4 / mkv / pdf / zip / …)\n" +
        "• Instagram (Reels / Posts / Stories)\n" +
        "• YouTube + YouTube Shorts\n" +
        "• TikTok\n" +
        "• Twitter / X\n" +
        "• Facebook\n" +
        "• Reddit\n" +
        "• Vimeo\n" +
        "• Twitch\n" +
        "• SoundCloud\n\n" +
        "<i>Upload size limit: 2 GB via MTProto</i>",
    stats_text: (uploads, joined, lang) =>
        "<b>📊 Your stats</b>\n\n" +
        `• Successful uploads: <b>${uploads}</b>\n` +
        `• Language: <b>${lang}</b>\n` +
        `• Joined: ${joined}`,
    id_text: (chatId, userId) =>
        `🆔 <b>Identifiers</b>\n\n` +
        `• Chat ID: <code>${chatId}</code>\n` +
        `• User ID: <code>${userId}</code>`,
    pong: (u) => `🏓 pong — up for ${formatUptime(u, "en")}`,
    stats_never: "—",

    ai_no_last_url:
        "ℹ️ I haven't received a URL yet. Send a link first, then tell me what you want done with it.",
    ai_daily_limit: (limit) =>
        `⏳ You've hit your daily AI limit (${limit}). Try again tomorrow or send a fresh URL.`,
    ai_intent_unknown:
        "🤖 I didn't understand. Try: 'audio' / 'as document' / 'as video' / 'retry'.",
    ai_audio_extracting: "🎵 Extracting audio...",
    ai_audio_uploading: (p) => `📤 Uploading audio: ${Math.round(p * 100)}%`,
    ai_audio_success: "✅ Audio uploaded!",
    ai_audio_error: (d) => `❌ Audio extraction failed: <code>${d}</code>`,
    ai_retrying: "🔄 Retrying the previous URL...",
    ai_reupload_document: "📄 Re-uploading as document...",
    ai_reupload_video: "🎬 Re-uploading as video...",
};

const tr: Strings = {
    welcome: (name) =>
        `👋 <b>Merhaba ${name}!</b>\n\n` +
        `Gelismis dosya yukleme botuyum.\n` +
        `Bana bir link gonder, Telegram'a yukleyeyim.\n\n` +
        `<b>Desteklenen platformlar:</b>\n` +
        `Instagram / YouTube / TikTok / Twitter\n` +
        `Facebook / Reddit / Vimeo / SoundCloud\n` +
        `+ herhangi bir dogrudan dosya linki\n\n` +
        `<b>Ozellikler:</b>\n` +
        `• MTProto ile 2GB'a kadar yukleme\n` +
        `• Video veya belge olarak yukleme\n` +
        `• Spoiler, yeniden adlandirma, ekran goruntusu\n` +
        `• Ozel kucuk resim\n\n` +
        `Baslamak icin asagidaki butonlara basin.`,
    menu_settings: "⚙️ Ayarlar",
    menu_help: "📖 Yardim",
    menu_about: "ℹ️ Hakkinda",
    menu_close: "❌ Kapat",
    menu_back: "🔙 Geri",
    menu_language: "🌐 Dil",
    menu_platforms: "🌐 Platformlar",
    menu_stats: "📊 İstatistiklerim",

    help_title: "📖 <b>Yardim</b>",
    help_commands:
        `<b>Komutlar:</b>\n` +
        `/start — Botu baslat\n` +
        `/menu — Ana menu\n` +
        `/settings — Ayarlar\n` +
        `/help — Yardim\n` +
        `/about — Hakkinda\n` +
        `/cancel — Girisi iptal et\n` +
        `/lang — Dil degistir`,
    help_platforms:
        `\n\n<b>Platformlar:</b>\n` +
        `Dogrudan URL, Instagram, YouTube, TikTok,\n` +
        `Twitter/X, Facebook, Reddit, Vimeo,\nTwitch, SoundCloud`,
    help_features:
        `\n\n<b>Ozellikler:</b>\n` +
        `• Belge / video olarak yukleme\n• Spoiler\n• On ek / son ek\n` +
        `• Video ekran goruntuleri\n• Ozel kucuk resim\n• 2GB'a kadar yukleme`,

    about_text:
        `ℹ️ <b>Hakkinda</b>\n\n` +
        `<b>Pro Uploader</b> — Gelismis yukleme botu\n` +
        `Node.js + grammy + GramJS MTProto\n` +
        `yt-dlp | ffmpeg\n` +
        `SQLite kalici depolama\n\n` +
        `<b>Neden MTProto?</b>\nBot API sinirlarini asmak icin (50MB yerine 2GB).`,

    settings_title: "⚙️ <b>Ayarlar</b>",
    settings_summary: "<b>Ozet:</b>",
    settings_upload: "📤 Yukleme ayarlari",
    settings_rename: "✏️ Yeniden adlandir",
    settings_media: "🖼️ Medya",
    settings_choose_section: "<i>Duzenlemek icin bir bolum secin.</i>",
    settings_back: "🔙 Geri",

    upload_as_document: "Belge olarak yukle",
    spoiler: "Spoiler modu",
    upload_page_desc: "📤 <b>Yukleme Ayarlari</b>\n• Video veya belge\n• Spoiler ile gizle.",

    rename_prefix: "✏️ On ek",
    rename_suffix: "✏️ Son ek",
    rename_clear_prefix: "🗑️ On eki temizle",
    rename_clear_suffix: "🗑️ Son eki temizle",
    rename_page_desc: (max) =>
        `✏️ <b>Dosya Yeniden Adlandirma</b>\nOn ek adin onune, son ek arkasina eklenir.\nMaks ${max} karakter.`,
    rename_prompt_prefix: (max) => `✏️ On eki gonderin (maks ${max} karakter). /cancel ile iptal.`,
    rename_prompt_suffix: (max) => `✏️ Son eki gonderin (maks ${max} karakter). /cancel ile iptal.`,
    rename_too_long: (max) => `⚠️ Metin cok uzun (maks ${max} karakter). Tekrar deneyin.`,
    rename_saved: "✅ Kaydedildi. Ayarlari gormek icin /settings kullanin.",

    screenshots_label: (c) => `🖼️ Ekran goruntusu: ${c || "kapali"}`,
    thumb_set: "🖼️ Kucuk resim ayarla",
    thumb_change: "🖼️ Kucuk resmi degistir",
    thumb_delete: "🗑️ Kucuk resmi sil",
    thumb_disabled: "—",
    media_page_desc: (sc, th) =>
        `🖼️ <b>Medya</b>\n• Ekran goruntusu = ${sc > 0 ? sc : "kapali"}\n• Kucuk resim = ${th ? "ayarli" : "ayarlanmadi"}`,
    thumb_prompt: "🖼️ Simdi kucuk resim olarak kullanmak icin bir fotograf gonderin. /cancel ile iptal.",
    thumb_saved: "✅ Kucuk resim kaydedildi.",
    thumb_save_error: (d) => `❌ Kucuk resim kaydedilemedi: <code>${d}</code>`,

    processing: "⏳ Isleniyor...",
    extracting: "🔍 Video cikariliyor...",
    downloading: (p) => `📥 Indiriliyor: ${Math.round(p * 100)}%`,
    uploading: (p) => `📤 Yukleniyor: ${Math.round(p * 100)}%`,
    success: "✅ Yukleme tamamlandi!",
    error: "❌ Yukleme basarisiz.",
    invalid_url: "⚠️ Mesajinizda gecerli bir URL bulunamadi.",
    already_in_flight: "⏳ Zaten devam eden bir yuklemeniz var. Lutfen bekleyin.",
    duplicate_ignored: "ℹ️ Tekrarlanan link yok sayildi.",
    screenshots_caption: (n) => `🖼️ Videodan ${n} ekran goruntusu`,
    screenshots_single: "🖼️ Videodan ekran goruntusu",
    screenshots_fail: (d) => `⚠️ Ekran goruntusu cikarma basarisiz: <code>${d}</code>`,
    screenshots_none: "⚠️ Videodan ekran goruntusu alinamadi.",

    cancel_done: "✅ Bekleyen giris iptal edildi.",
    cancel_text: "Iptal edildi.",

    pick_language: "🌐 <b>Dil secin:</b>",

    saved: "✅ Kaydedildi",
    enabled: "✅",
    disabled: "⬜",
    set_: "ayarli",
    not_set: "—",

    cmd_doc_toggled: (on) => `📤 Dosya olarak yükle: ${on ? "AÇIK ✅" : "KAPALI ⬜"}`,
    cmd_spoiler_toggled: (on) => `🫣 Spoiler modu: ${on ? "AÇIK ✅" : "KAPALI ⬜"}`,
    cmd_prefix_set: (v) => `✏️ Ön ek ayarlandı: <code>${v}</code>`,
    cmd_prefix_cleared: "✏️ Ön ek silindi.",
    cmd_prefix_current: (v) => `✏️ Geçerli ön ek: <code>${v}</code>
Değiştir: <code>/prefix metniniz</code>
Temizle: <code>/prefix clear</code>`,
    cmd_prefix_none: "ℹ️ Ön ek ayarlanmamış. Ayarlamak için <code>/prefix metin</code>.",
    cmd_suffix_set: (v) => `✏️ Son ek ayarlandı: <code>${v}</code>`,
    cmd_suffix_cleared: "✏️ Son ek silindi.",
    cmd_suffix_current: (v) => `✏️ Geçerli son ek: <code>${v}</code>
Değiştir: <code>/suffix metniniz</code>
Temizle: <code>/suffix clear</code>`,
    cmd_suffix_none: "ℹ️ Son ek ayarlanmamış. Ayarlamak için <code>/suffix metin</code>.",
    cmd_screenshots_set: (n) => `🖼️ Ekran görüntüsü sayısı: ${n === 0 ? "kapalı" : n}`,
    cmd_screenshots_usage: "Kullanım: <code>/screenshots 0|3|5|10</code>",
    cmd_thumb_clear_done: "🗑️ Küçük resim silindi.",
    cmd_thumb_not_set: "ℹ️ Ayarlı küçük resim yok.",
    cmd_reset_done: "♻️ Varsayılan ayarlar geri yüklendi.",
    platforms_text:
        "<b>🌐 Desteklenen platformlar</b>\n\n" +
        "• Doğrudan bağlantılar (mp4 / mkv / pdf / zip / …)\n" +
        "• Instagram (Reels / Posts / Stories)\n" +
        "• YouTube + YouTube Shorts\n" +
        "• TikTok\n" +
        "• Twitter / X\n" +
        "• Facebook\n" +
        "• Reddit\n" +
        "• Vimeo\n" +
        "• Twitch\n" +
        "• SoundCloud\n\n" +
        "<i>Yükleme sınırı: MTProto ile 2 GB</i>",
    stats_text: (uploads, joined, lang) =>
        "<b>📊 İstatistikleriniz</b>\n\n" +
        `• Başarılı yüklemeler: <b>${uploads}</b>\n` +
        `• Dil: <b>${lang}</b>\n` +
        `• Katıldınız: ${joined}`,
    id_text: (chatId, userId) =>
        `🆔 <b>Kimlikler</b>\n\n` +
        `• Chat ID: <code>${chatId}</code>\n` +
        `• User ID: <code>${userId}</code>`,
    pong: (u) => `🏓 pong — çalışma süresi: ${formatUptime(u, "tr")}`,
    stats_never: "—",

    ai_no_last_url:
        "ℹ️ Henüz bir bağlantı almadım. Önce bir bağlantı gönderin, sonra ne yapılmasını istediğinizi yazın.",
    ai_daily_limit: (limit) =>
        `⏳ Günlük AI limitinize ulaştınız (${limit}). Yarın tekrar deneyin veya yeni bir URL gönderin.`,
    ai_intent_unknown:
        "🤖 Anlamadım. Şunları deneyin: 'ses' / 'belge olarak' / 'video olarak' / 'tekrar dene'.",
    ai_audio_extracting: "🎵 Ses çıkarılıyor...",
    ai_audio_uploading: (p) => `📤 Ses yükleniyor: ${Math.round(p * 100)}%`,
    ai_audio_success: "✅ Ses yüklendi!",
    ai_audio_error: (d) => `❌ Ses çıkarılamadı: <code>${d}</code>`,
    ai_retrying: "🔄 Önceki URL yeniden deneniyor...",
    ai_reupload_document: "📄 Belge olarak yeniden yükleniyor...",
    ai_reupload_video: "🎬 Video olarak yeniden yükleniyor...",
};

const fr: Strings = {
    welcome: (name) =>
        `👋 <b>Bonjour ${name} !</b>\n\n` +
        `Je suis un bot d'upload avance.\n` +
        `Envoyez-moi un lien et je l'uploade sur Telegram.\n\n` +
        `<b>Plateformes :</b>\n` +
        `Instagram / YouTube / TikTok / Twitter\n` +
        `Facebook / Reddit / Vimeo / SoundCloud\n` +
        `+ tout lien direct\n\n` +
        `<b>Fonctionnalites :</b>\n` +
        `• Upload jusqu'a 2 Go via MTProto\n` +
        `• Upload video ou document\n` +
        `• Spoiler, renommage, captures\n` +
        `• Miniature personnalisee\n\n` +
        `Appuyez sur les boutons ci-dessous.`,
    menu_settings: "⚙️ Parametres",
    menu_help: "📖 Aide",
    menu_about: "ℹ️ A propos",
    menu_close: "❌ Fermer",
    menu_back: "🔙 Retour",
    menu_language: "🌐 Langue",
    menu_platforms: "🌐 Plateformes",
    menu_stats: "📊 Mes stats",

    help_title: "📖 <b>Aide</b>",
    help_commands:
        `<b>Commandes :</b>\n` +
        `/start — Demarrer le bot\n` +
        `/menu — Menu principal\n` +
        `/settings — Parametres\n` +
        `/help — Aide\n` +
        `/about — A propos\n` +
        `/cancel — Annuler la saisie\n` +
        `/lang — Changer la langue`,
    help_platforms:
        `\n\n<b>Plateformes :</b>\n` +
        `URL directes, Instagram, YouTube, TikTok,\n` +
        `Twitter/X, Facebook, Reddit, Vimeo,\nTwitch, SoundCloud`,
    help_features:
        `\n\n<b>Fonctionnalites :</b>\n` +
        `• Upload document / video\n• Spoiler\n• Prefixe / suffixe\n` +
        `• Captures video\n• Miniature perso\n• Upload jusqu'a 2 Go`,

    about_text:
        `ℹ️ <b>A propos</b>\n\n` +
        `<b>Pro Uploader</b> — Bot d'upload avance\n` +
        `Node.js + grammy + GramJS MTProto\n` +
        `yt-dlp | ffmpeg\nSQLite\n\n` +
        `<b>Pourquoi MTProto ?</b>\nPour depasser la limite de 50 Mo (jusqu'a 2 Go).`,

    settings_title: "⚙️ <b>Parametres</b>",
    settings_summary: "<b>Resume :</b>",
    settings_upload: "📤 Upload",
    settings_rename: "✏️ Renommage",
    settings_media: "🖼️ Medias",
    settings_choose_section: "<i>Choisissez une section.</i>",
    settings_back: "🔙 Retour",

    upload_as_document: "Upload en document",
    spoiler: "Mode spoiler",
    upload_page_desc: "📤 <b>Parametres d'upload</b>\n• Video ou document.",

    rename_prefix: "✏️ Prefixe",
    rename_suffix: "✏️ Suffixe",
    rename_clear_prefix: "🗑️ Effacer prefixe",
    rename_clear_suffix: "🗑️ Effacer suffixe",
    rename_page_desc: (max) =>
        `✏️ <b>Renommage</b>\nLe prefixe va avant le nom, le suffixe apres.\nMax ${max} caracteres.`,
    rename_prompt_prefix: (max) => `✏️ Envoyez le prefixe (max ${max} car.). /cancel pour annuler.`,
    rename_prompt_suffix: (max) => `✏️ Envoyez le suffixe (max ${max} car.). /cancel pour annuler.`,
    rename_too_long: (max) => `⚠️ Texte trop long (max ${max} caracteres). Reessayez.`,
    rename_saved: "✅ Enregistre. /settings pour voir les parametres.",

    screenshots_label: (c) => `🖼️ Captures : ${c || "desactive"}`,
    thumb_set: "🖼️ Definir miniature",
    thumb_change: "🖼️ Changer miniature",
    thumb_delete: "🗑️ Supprimer miniature",
    thumb_disabled: "—",
    media_page_desc: (sc, th) =>
        `🖼️ <b>Medias</b>\n• Captures = ${sc > 0 ? sc : "desactive"}\n• Miniature = ${th ? "definie" : "non definie"}`,
    thumb_prompt: "🖼️ Envoyez une photo pour la miniature. /cancel pour annuler.",
    thumb_saved: "✅ Miniature enregistree.",
    thumb_save_error: (d) => `❌ Echec d'enregistrement : <code>${d}</code>`,

    processing: "⏳ Traitement...",
    extracting: "🔍 Extraction video...",
    downloading: (p) => `📥 Telechargement : ${Math.round(p * 100)}%`,
    uploading: (p) => `📤 Upload : ${Math.round(p * 100)}%`,
    success: "✅ Upload termine !",
    error: "❌ Erreur lors de l'upload.",
    invalid_url: "⚠️ Aucun URL valide trouve.",
    already_in_flight: "⏳ Un upload est deja en cours. Veuillez patienter.",
    duplicate_ignored: "ℹ️ Lien en double ignore.",
    screenshots_caption: (n) => `🖼️ ${n} captures de la video`,
    screenshots_single: "🖼️ Capture de la video",
    screenshots_fail: (d) => `⚠️ Echec des captures : <code>${d}</code>`,
    screenshots_none: "⚠️ Impossible d'extraire des captures.",

    cancel_done: "✅ Saisie annulee.",
    cancel_text: "Annule.",

    pick_language: "🌐 <b>Choisissez la langue :</b>",

    saved: "✅ Enregistre",
    enabled: "✅",
    disabled: "⬜",
    set_: "definie",
    not_set: "—",

    cmd_doc_toggled: (on) => `📤 Envoyer comme document: ${on ? "ACTIVÉ ✅" : "DÉSACTIVÉ ⬜"}`,
    cmd_spoiler_toggled: (on) => `🫣 Mode spoiler: ${on ? "ACTIVÉ ✅" : "DÉSACTIVÉ ⬜"}`,
    cmd_prefix_set: (v) => `✏️ Préfixe défini: <code>${v}</code>`,
    cmd_prefix_cleared: "✏️ Préfixe effacé.",
    cmd_prefix_current: (v) => `✏️ Préfixe actuel: <code>${v}</code>
Modifier: <code>/prefix votre-texte</code>
Effacer: <code>/prefix clear</code>`,
    cmd_prefix_none: "ℹ️ Aucun préfixe défini. Utilisez <code>/prefix votre-texte</code>.",
    cmd_suffix_set: (v) => `✏️ Suffixe défini: <code>${v}</code>`,
    cmd_suffix_cleared: "✏️ Suffixe effacé.",
    cmd_suffix_current: (v) => `✏️ Suffixe actuel: <code>${v}</code>
Modifier: <code>/suffix votre-texte</code>
Effacer: <code>/suffix clear</code>`,
    cmd_suffix_none: "ℹ️ Aucun suffixe défini. Utilisez <code>/suffix votre-texte</code>.",
    cmd_screenshots_set: (n) => `🖼️ Nombre de captures: ${n === 0 ? "désactivé" : n}`,
    cmd_screenshots_usage: "Usage: <code>/screenshots 0|3|5|10</code>",
    cmd_thumb_clear_done: "🗑️ Miniature supprimée.",
    cmd_thumb_not_set: "ℹ️ Aucune miniature enregistrée.",
    cmd_reset_done: "♻️ Paramètres réinitialisés par défaut.",
    platforms_text:
        "<b>🌐 Plateformes prises en charge</b>\n\n" +
        "• Liens directs (mp4 / mkv / pdf / zip / …)\n" +
        "• Instagram (Reels / Posts / Stories)\n" +
        "• YouTube + YouTube Shorts\n" +
        "• TikTok\n" +
        "• Twitter / X\n" +
        "• Facebook\n" +
        "• Reddit\n" +
        "• Vimeo\n" +
        "• Twitch\n" +
        "• SoundCloud\n\n" +
        "<i>Taille max: 2 Go via MTProto</i>",
    stats_text: (uploads, joined, lang) =>
        "<b>📊 Vos statistiques</b>\n\n" +
        `• Envois réussis: <b>${uploads}</b>\n` +
        `• Langue: <b>${lang}</b>\n` +
        `• Inscrit: ${joined}`,
    id_text: (chatId, userId) =>
        `🆔 <b>Identifiants</b>\n\n` +
        `• Chat ID: <code>${chatId}</code>\n` +
        `• User ID: <code>${userId}</code>`,
    pong: (u) => `🏓 pong — actif depuis ${formatUptime(u, "fr")}`,
    stats_never: "—",

    ai_no_last_url:
        "ℹ️ Je n'ai pas encore reçu de lien. Envoyez d'abord une URL, puis dites-moi ce que vous voulez en faire.",
    ai_daily_limit: (limit) =>
        `⏳ Vous avez atteint la limite quotidienne d'IA (${limit}). Réessayez demain ou envoyez une nouvelle URL.`,
    ai_intent_unknown:
        "🤖 Je n'ai pas compris. Essayez : 'audio' / 'en document' / 'en vidéo' / 'réessayer'.",
    ai_audio_extracting: "🎵 Extraction de l'audio...",
    ai_audio_uploading: (p) => `📤 Envoi audio : ${Math.round(p * 100)}%`,
    ai_audio_success: "✅ Audio envoyé !",
    ai_audio_error: (d) => `❌ Échec de l'extraction audio : <code>${d}</code>`,
    ai_retrying: "🔄 Nouvelle tentative sur l'URL précédente...",
    ai_reupload_document: "📄 Renvoi en document...",
    ai_reupload_video: "🎬 Renvoi en vidéo...",
};

const es: Strings = {
    welcome: (name) =>
        `👋 <b>Hola ${name}!</b>\n\n` +
        `Soy un bot de carga avanzado.\n` +
        `Enviame un enlace y lo subire a Telegram.\n\n` +
        `<b>Plataformas:</b>\n` +
        `Instagram / YouTube / TikTok / Twitter\n` +
        `Facebook / Reddit / Vimeo / SoundCloud\n` +
        `+ cualquier enlace directo\n\n` +
        `<b>Funciones:</b>\n` +
        `• Carga hasta 2GB via MTProto\n` +
        `• Subir como video o documento\n` +
        `• Spoiler, renombrar, capturas\n` +
        `• Miniatura personalizada\n\n` +
        `Pulsa los botones de abajo para empezar.`,
    menu_settings: "⚙️ Ajustes",
    menu_help: "📖 Ayuda",
    menu_about: "ℹ️ Acerca de",
    menu_close: "❌ Cerrar",
    menu_back: "🔙 Volver",
    menu_language: "🌐 Idioma",
    menu_platforms: "🌐 Plataformas",
    menu_stats: "📊 Mis estadísticas",

    help_title: "📖 <b>Ayuda</b>",
    help_commands:
        `<b>Comandos:</b>\n` +
        `/start — Iniciar el bot\n` +
        `/menu — Menu principal\n` +
        `/settings — Ajustes\n` +
        `/help — Ayuda\n` +
        `/about — Acerca de\n` +
        `/cancel — Cancelar entrada\n` +
        `/lang — Cambiar idioma`,
    help_platforms:
        `\n\n<b>Plataformas:</b>\n` +
        `URL directas, Instagram, YouTube, TikTok,\n` +
        `Twitter/X, Facebook, Reddit, Vimeo,\nTwitch, SoundCloud`,
    help_features:
        `\n\n<b>Funciones:</b>\n` +
        `• Subir como documento / video\n• Spoiler\n• Prefijo / sufijo\n` +
        `• Capturas de video\n• Miniatura personalizada\n• Carga hasta 2GB`,

    about_text:
        `ℹ️ <b>Acerca de</b>\n\n` +
        `<b>Pro Uploader</b> — Bot de carga avanzado\n` +
        `Node.js + grammy + GramJS MTProto\n` +
        `yt-dlp | ffmpeg\nSQLite\n\n` +
        `<b>¿Por que MTProto?</b>\nPara superar el limite de 50MB (hasta 2GB).`,

    settings_title: "⚙️ <b>Ajustes</b>",
    settings_summary: "<b>Resumen:</b>",
    settings_upload: "📤 Carga",
    settings_rename: "✏️ Renombrar",
    settings_media: "🖼️ Medios",
    settings_choose_section: "<i>Elige una seccion para editar.</i>",
    settings_back: "🔙 Volver",

    upload_as_document: "Subir como documento",
    spoiler: "Modo spoiler",
    upload_page_desc: "📤 <b>Ajustes de carga</b>\n• Video o documento.",

    rename_prefix: "✏️ Prefijo",
    rename_suffix: "✏️ Sufijo",
    rename_clear_prefix: "🗑️ Borrar prefijo",
    rename_clear_suffix: "🗑️ Borrar sufijo",
    rename_page_desc: (max) =>
        `✏️ <b>Renombrar archivos</b>\nPrefijo antes del nombre, sufijo despues.\nMax ${max} caracteres.`,
    rename_prompt_prefix: (max) => `✏️ Envia el prefijo (max ${max} car.). /cancel para abortar.`,
    rename_prompt_suffix: (max) => `✏️ Envia el sufijo (max ${max} car.). /cancel para abortar.`,
    rename_too_long: (max) => `⚠️ Texto demasiado largo (max ${max}). Intentalo de nuevo.`,
    rename_saved: "✅ Guardado. Usa /settings para ver los ajustes.",

    screenshots_label: (c) => `🖼️ Capturas: ${c || "desactivado"}`,
    thumb_set: "🖼️ Poner miniatura",
    thumb_change: "🖼️ Cambiar miniatura",
    thumb_delete: "🗑️ Borrar miniatura",
    thumb_disabled: "—",
    media_page_desc: (sc, th) =>
        `🖼️ <b>Medios</b>\n• Capturas = ${sc > 0 ? sc : "desactivado"}\n• Miniatura = ${th ? "puesta" : "no puesta"}`,
    thumb_prompt: "🖼️ Envia una foto para usarla como miniatura. /cancel para abortar.",
    thumb_saved: "✅ Miniatura guardada.",
    thumb_save_error: (d) => `❌ Error al guardar miniatura: <code>${d}</code>`,

    processing: "⏳ Procesando...",
    extracting: "🔍 Extrayendo video...",
    downloading: (p) => `📥 Descargando: ${Math.round(p * 100)}%`,
    uploading: (p) => `📤 Subiendo: ${Math.round(p * 100)}%`,
    success: "✅ Carga completada!",
    error: "❌ Error en la carga.",
    invalid_url: "⚠️ No se encontro un URL valido.",
    already_in_flight: "⏳ Ya tienes una carga en curso. Espera.",
    duplicate_ignored: "ℹ️ Enlace duplicado ignorado.",
    screenshots_caption: (n) => `🖼️ ${n} capturas del video`,
    screenshots_single: "🖼️ Captura del video",
    screenshots_fail: (d) => `⚠️ Fallo al extraer capturas: <code>${d}</code>`,
    screenshots_none: "⚠️ No se pudieron extraer capturas.",

    cancel_done: "✅ Entrada cancelada.",
    cancel_text: "Cancelado.",

    pick_language: "🌐 <b>Elige idioma:</b>",

    saved: "✅ Guardado",
    enabled: "✅",
    disabled: "⬜",
    set_: "puesta",
    not_set: "—",

    cmd_doc_toggled: (on) => `📤 Enviar como documento: ${on ? "ACTIVADO ✅" : "DESACTIVADO ⬜"}`,
    cmd_spoiler_toggled: (on) => `🫣 Modo spoiler: ${on ? "ACTIVADO ✅" : "DESACTIVADO ⬜"}`,
    cmd_prefix_set: (v) => `✏️ Prefijo establecido: <code>${v}</code>`,
    cmd_prefix_cleared: "✏️ Prefijo borrado.",
    cmd_prefix_current: (v) => `✏️ Prefijo actual: <code>${v}</code>
Cambiar: <code>/prefix tu-texto</code>
Borrar: <code>/prefix clear</code>`,
    cmd_prefix_none: "ℹ️ No hay prefijo. Usa <code>/prefix tu-texto</code> para definirlo.",
    cmd_suffix_set: (v) => `✏️ Sufijo establecido: <code>${v}</code>`,
    cmd_suffix_cleared: "✏️ Sufijo borrado.",
    cmd_suffix_current: (v) => `✏️ Sufijo actual: <code>${v}</code>
Cambiar: <code>/suffix tu-texto</code>
Borrar: <code>/suffix clear</code>`,
    cmd_suffix_none: "ℹ️ No hay sufijo. Usa <code>/suffix tu-texto</code> para definirlo.",
    cmd_screenshots_set: (n) => `🖼️ Número de capturas: ${n === 0 ? "desactivado" : n}`,
    cmd_screenshots_usage: "Uso: <code>/screenshots 0|3|5|10</code>",
    cmd_thumb_clear_done: "🗑️ Miniatura eliminada.",
    cmd_thumb_not_set: "ℹ️ No hay miniatura guardada.",
    cmd_reset_done: "♻️ Ajustes restaurados a valores por defecto.",
    platforms_text:
        "<b>🌐 Plataformas compatibles</b>\n\n" +
        "• Enlaces directos (mp4 / mkv / pdf / zip / …)\n" +
        "• Instagram (Reels / Posts / Stories)\n" +
        "• YouTube + YouTube Shorts\n" +
        "• TikTok\n" +
        "• Twitter / X\n" +
        "• Facebook\n" +
        "• Reddit\n" +
        "• Vimeo\n" +
        "• Twitch\n" +
        "• SoundCloud\n\n" +
        "<i>Límite de subida: 2 GB vía MTProto</i>",
    stats_text: (uploads, joined, lang) =>
        "<b>📊 Tus estadísticas</b>\n\n" +
        `• Subidas exitosas: <b>${uploads}</b>\n` +
        `• Idioma: <b>${lang}</b>\n` +
        `• Registrado: ${joined}`,
    id_text: (chatId, userId) =>
        `🆔 <b>Identificadores</b>\n\n` +
        `• Chat ID: <code>${chatId}</code>\n` +
        `• User ID: <code>${userId}</code>`,
    pong: (u) => `🏓 pong — activo desde hace ${formatUptime(u, "es")}`,
    stats_never: "—",

    ai_no_last_url:
        "ℹ️ Aún no he recibido una URL. Envía un enlace primero y luego dime qué quieres hacer con él.",
    ai_daily_limit: (limit) =>
        `⏳ Has alcanzado el límite diario de IA (${limit}). Inténtalo mañana o envía una URL nueva.`,
    ai_intent_unknown:
        "🤖 No te entendí. Prueba: 'audio' / 'como documento' / 'como video' / 'reintentar'.",
    ai_audio_extracting: "🎵 Extrayendo audio...",
    ai_audio_uploading: (p) => `📤 Subiendo audio: ${Math.round(p * 100)}%`,
    ai_audio_success: "✅ ¡Audio subido!",
    ai_audio_error: (d) => `❌ Fallo al extraer audio: <code>${d}</code>`,
    ai_retrying: "🔄 Reintentando la URL anterior...",
    ai_reupload_document: "📄 Reenviando como documento...",
    ai_reupload_video: "🎬 Reenviando como video...",
};

/**
 * Format a process uptime expressed in seconds to a compact, localised
 * "Xd Yh Zm" style string. Used by /ping to give the user a quick sense
 * of how long the current container has been alive.
 */
function formatUptime(totalSec: number, lang: Lang): string {
    const sec = Math.max(0, Math.floor(totalSec));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const LABELS: Record<Lang, { d: string; h: string; m: string; s: string }> = {
        ar: { d: "ي", h: "س", m: "د", s: "ث" },
        en: { d: "d", h: "h", m: "m", s: "s" },
        tr: { d: "g", h: "s", m: "dk", s: "sn" },
        fr: { d: "j", h: "h", m: "m", s: "s" },
        es: { d: "d", h: "h", m: "m", s: "s" },
    };
    const L = LABELS[lang];
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}${L.d}`);
    if (h > 0) parts.push(`${h}${L.h}`);
    if (m > 0) parts.push(`${m}${L.m}`);
    if (parts.length === 0 || s > 0) parts.push(`${s}${L.s}`);
    return parts.join(" ");
}

/**
 * Format a unix timestamp (seconds) to a locale-aware short date. Used by
 * /stats to show the "joined" date. Falls back to an ISO-ish format if
 * Intl.DateTimeFormat is not available for the given locale.
 */
export function formatJoinedDate(unixSec: number | null, lang: Lang): string {
    if (!unixSec) return "—";
    const d = new Date(unixSec * 1000);
    const tag: Record<Lang, string> = {
        ar: "ar-SA",
        en: "en-GB",
        tr: "tr-TR",
        fr: "fr-FR",
        es: "es-ES",
    };
    try {
        return new Intl.DateTimeFormat(tag[lang], {
            year: "numeric",
            month: "short",
            day: "numeric",
        }).format(d);
    } catch {
        return d.toISOString().slice(0, 10);
    }
}

const ALL: Record<Lang, Strings> = { ar, en, tr, fr, es };

/**
 * Look up a localised string set.
 * Falls back to Arabic if the key is somehow not a recognised Lang.
 */
export function t(lang: Lang): Strings {
    return ALL[lang] ?? ALL.ar;
}
