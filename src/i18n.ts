/**
 * Lightweight i18n module. Each supported locale maps to the same set of
 * string keys. Functions that accept a dynamic argument take a callback
 * so callers can do `t(lang, "downloading")(info)` → a multi-line block
 * with percent, bar, bytes, speed, and ETA.
 */

import {
    formatBytes,
    formatEta,
    formatSpeed,
    renderBar,
    RichProgress,
} from "./services/progress";

/**
 * Payload accepted by the `downloading` / `uploading` / `ai_audio_uploading`
 * locale strings. Only `fraction` is required; the rest are included when
 * available (for direct HTTP downloads we know bytes + speed; for the
 * external-URL fast path we only know `fraction` 0 or 1). Locales degrade
 * gracefully — rows whose data is missing are simply omitted.
 */
export type ProgressInfo = RichProgress;

/**
 * Locale-specific labels fed into {@link buildProgressBlock} so the helper
 * can centralise the multi-line format without duplicating it 5 × 3 times.
 */
interface ProgressLabels {
    speed: string;
    eta: string;
}

/**
 * Format a rich progress tick as the multi-line block the user asked for
 * in the v38 redesign:
 *
 *   📥 Downloading: 53.79%
 *   [▓▓▓▓▓▓░░░░]
 *   1012.55 MB / 1.84 GB
 *   Speed: 13.12 MB/s
 *   ETA: 1m 7s
 *
 * Rows for bytes / speed / ETA are omitted when the underlying download /
 * upload layer could not produce them (e.g. chunked transfer encoding
 * without Content-Length, first 250 ms before the first speed sample).
 */
function buildProgressBlock(
    heading: string,
    info: ProgressInfo,
    labels: ProgressLabels,
): string {
    const pctNum = Math.max(0, Math.min(1, info.fraction)) * 100;
    // 2 decimals for fractional progress to match the reference
    // screenshot; integer for the clean 100% final state so the user sees
    // "100%" not "100.00%".
    const pct = pctNum >= 100 ? "100" : pctNum.toFixed(2);
    const lines = [`${heading}: ${pct}%`, renderBar(info.fraction)];
    if (
        typeof info.doneBytes === "number" &&
        typeof info.totalBytes === "number" &&
        info.totalBytes > 0
    ) {
        lines.push(
            `${formatBytes(info.doneBytes)} / ${formatBytes(info.totalBytes)}`,
        );
    }
    if (typeof info.speedBps === "number" && info.speedBps > 0) {
        lines.push(`${labels.speed}: ${formatSpeed(info.speedBps)}`);
    }
    if (typeof info.etaSec === "number" && info.etaSec > 0) {
        lines.push(`${labels.eta}: ${formatEta(info.etaSec)}`);
    }
    return lines.join("\n");
}

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
    downloading: (p: ProgressInfo) => string;
    uploading: (p: ProgressInfo) => string;
    success: string;
    error: string;
    url_not_found: string;
    invalid_url: string;
    profile_link_not_supported: string;
    unsupported_url: string;
    already_in_flight: string;
    queue_full: (max: number) => string;
    file_too_large: (limitMb: number) => string;
    upload_stalled: string;
    duplicate_ignored: string;
    /** "Cancel" label on the inline button next to the progress message. */
    upload_cancel_button: string;
    /** Shown once the user clicks the cancel button and the abort lands. */
    upload_cancelled: string;
    /** Rejection shown when a user tries to start a new upload while the
     *  per-user cooldown after the last completion is still active. This
     *  message is edited in place every ~10 seconds with the decreasing
     *  countdown so the user sees it tick down rather than a static time. */
    cooldown_active: (minutes: number, seconds: number) => string;
    /** Final state of the cooldown message once the window elapses —
     *  edited in place over `cooldown_active` so the user knows they
     *  can send a new task now. */
    cooldown_ready: string;
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
    ai_audio_uploading: (p: ProgressInfo) => string;
    ai_audio_success: string;
    ai_audio_error: (detail: string) => string;
    ai_retrying: string;
    ai_reupload_document: string;
    ai_reupload_video: string;

    // Quality-selection menu shown on URL receipt
    quality_menu_title: string;
    quality_btn_audio: string;
    quality_btn_best: string;
    quality_btn_1080: string;
    quality_btn_720: string;
    quality_btn_480: string;
    quality_btn_360: string;
    quality_btn_document: string;
    quality_btn_cancel: string;
    quality_cancelled: string;
    quality_expired: string;
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
    downloading: (p) =>
        buildProgressBlock("📥 جاري التحميل", p, {
            speed: "السرعة",
            eta: "المتبقي",
        }),
    uploading: (p) =>
        buildProgressBlock("📤 جاري الرفع", p, {
            speed: "السرعة",
            eta: "المتبقي",
        }),
    success: "✅ تم الرفع بنجاح!",
    error: "❌ حدث خطأ أثناء الرفع.",
    url_not_found: "❌ الرابط خاطئ - الملف غير موجود",
    invalid_url: "⚠️ لم أجد رابطاً صالحاً في الرسالة.",
    profile_link_not_supported:
        "📷 هذا رابط حساب انستغرام وليس منشوراً.\n\n" +
        "أرسل رابط منشور ( /p/… )، ريل ( /reel/… )، أو IGTV ( /tv/… ) وسأقوم بتحميله.",
    unsupported_url:
        "⚠️ هذا الرابط غير مدعوم حالياً.\n\n" +
        "المنصّات المدعومة: Instagram / YouTube / TikTok / Twitter / Facebook / Reddit / Vimeo / SoundCloud — أو أي رابط مباشر لملف.",
    already_in_flight: "⏳ لديك رفع قيد التنفيذ. انتظر حتى ينتهي.",
    queue_full: (max) =>
        `⏳ السيرفر مشغول الآن (${max} عمليات متزامنة). حاول بعد دقيقة.`,
    file_too_large: (mb) =>
        `❌ الملف أكبر من الحد المسموح (${mb} ميجابايت). اختر جودة أقل أو رابطاً أصغر.`,
    upload_stalled:
        "⚠️ الرفع توقف عن التقدّم (غالباً تحديد سرعة من تيليجرام). جرّب مرة أخرى، أو جودة أقل.",
    duplicate_ignored: "ℹ️ تم تجاهل رابط مكرر.",
    upload_cancel_button: "❌ إلغاء العملية",
    upload_cancelled: "🛑 تم إلغاء العملية.",
    cooldown_active: (m, sec) =>
        `⏳️ يمكنك إرسال مهمة جديدة بعد ${m}د ${sec}ث`,
    cooldown_ready: "✅ يمكنك الآن إرسال عملية جديدة.",
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
    ai_audio_uploading: (p) =>
        buildProgressBlock("📤 رفع الصوت", p, {
            speed: "السرعة",
            eta: "المتبقي",
        }),
    ai_audio_success: "✅ تم رفع الصوت بنجاح!",
    ai_audio_error: (d) => `❌ فشل استخراج الصوت: <code>${d}</code>`,
    ai_retrying: "🔄 إعادة المحاولة على الرابط السابق...",
    ai_reupload_document: "📄 إعادة الرفع كملف...",
    ai_reupload_video: "🎬 إعادة الرفع كفيديو...",
    quality_menu_title: "اختر طريقة التحميل:",
    quality_btn_audio: "🎵 صوت فقط (MP3)",
    quality_btn_best: "🎬 أفضل جودة",
    quality_btn_1080: "📺 1080p",
    quality_btn_720: "📺 720p",
    quality_btn_480: "📺 480p",
    quality_btn_360: "📺 360p",
    quality_btn_document: "📄 كملف",
    quality_btn_cancel: "❌ إلغاء",
    quality_cancelled: "تم الإلغاء.",
    quality_expired: "انتهت صلاحية الخيار. أرسل الرابط من جديد.",
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
    downloading: (p) =>
        buildProgressBlock("📥 Downloading", p, {
            speed: "Speed",
            eta: "ETA",
        }),
    uploading: (p) =>
        buildProgressBlock("📤 Uploading", p, {
            speed: "Speed",
            eta: "ETA",
        }),
    success: "✅ Upload complete!",
    error: "❌ Upload failed.",
    url_not_found: "❌ Invalid link — file not found",
    invalid_url: "⚠️ No valid URL found in your message.",
    profile_link_not_supported:
        "📷 That's an Instagram profile link, not a post.\n\n" +
        "Send a post ( /p/… ), reel ( /reel/… ), or IGTV ( /tv/… ) URL and I'll download it.",
    unsupported_url:
        "⚠️ This URL isn't supported yet.\n\n" +
        "Supported platforms: Instagram / YouTube / TikTok / Twitter / Facebook / Reddit / Vimeo / SoundCloud — or any direct file URL.",
    already_in_flight: "⏳ You already have an upload in progress. Please wait.",
    queue_full: (max) =>
        `⏳ The server is busy right now (${max} concurrent uploads). Try again in a minute.`,
    file_too_large: (mb) =>
        `❌ File is larger than the allowed limit (${mb} MB). Pick a lower quality or a smaller URL.`,
    upload_stalled:
        "⚠️ Upload stopped making progress (likely a Telegram rate-limit). Try again, or pick a lower quality.",
    duplicate_ignored: "ℹ️ Duplicate link ignored.",
    upload_cancel_button: "❌ Cancel",
    upload_cancelled: "🛑 Upload cancelled.",
    cooldown_active: (m, sec) =>
        `⏳️ You can send a new task after ${m}m ${sec}s`,
    cooldown_ready: "✅ You can send a new task now.",
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
    ai_audio_uploading: (p) =>
        buildProgressBlock("📤 Uploading audio", p, {
            speed: "Speed",
            eta: "ETA",
        }),
    ai_audio_success: "✅ Audio uploaded!",
    ai_audio_error: (d) => `❌ Audio extraction failed: <code>${d}</code>`,
    ai_retrying: "🔄 Retrying the previous URL...",
    ai_reupload_document: "📄 Re-uploading as document...",
    ai_reupload_video: "🎬 Re-uploading as video...",
    quality_menu_title: "Choose how to download:",
    quality_btn_audio: "🎵 Audio only (MP3)",
    quality_btn_best: "🎬 Best quality",
    quality_btn_1080: "📺 1080p",
    quality_btn_720: "📺 720p",
    quality_btn_480: "📺 480p",
    quality_btn_360: "📺 360p",
    quality_btn_document: "📄 As document",
    quality_btn_cancel: "❌ Cancel",
    quality_cancelled: "Cancelled.",
    quality_expired: "This choice expired. Please send the link again.",
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
    downloading: (p) =>
        buildProgressBlock("📥 Indiriliyor", p, {
            speed: "Hiz",
            eta: "Kalan",
        }),
    uploading: (p) =>
        buildProgressBlock("📤 Yukleniyor", p, {
            speed: "Hiz",
            eta: "Kalan",
        }),
    success: "✅ Yukleme tamamlandi!",
    error: "❌ Yukleme basarisiz.",
    url_not_found: "❌ Gecersiz link — dosya bulunamadi",
    invalid_url: "⚠️ Mesajinizda gecerli bir URL bulunamadi.",
    profile_link_not_supported:
        "📷 Bu bir Instagram profil linki, gönderi değil.\n\n" +
        "Bir gönderi ( /p/… ), reel ( /reel/… ) veya IGTV ( /tv/… ) linki gönder, indirebilirim.",
    unsupported_url:
        "⚠️ Bu URL şu anda desteklenmiyor.\n\n" +
        "Desteklenen platformlar: Instagram / YouTube / TikTok / Twitter / Facebook / Reddit / Vimeo / SoundCloud — veya herhangi bir doğrudan dosya bağlantısı.",
    already_in_flight: "⏳ Zaten devam eden bir yuklemeniz var. Lutfen bekleyin.",
    queue_full: (max) =>
        `⏳ Sunucu su an mesgul (${max} es zamanli yukleme). Bir dakika sonra tekrar deneyin.`,
    file_too_large: (mb) =>
        `❌ Dosya izin verilen sinirdan buyuk (${mb} MB). Daha dusuk kalite veya daha kucuk bir URL secin.`,
    upload_stalled:
        "⚠️ Yukleme ilerlemiyor (Telegram hiz siniri). Tekrar deneyin veya daha dusuk kalite secin.",
    duplicate_ignored: "ℹ️ Tekrarlanan link yok sayildi.",
    upload_cancel_button: "❌ Iptal",
    upload_cancelled: "🛑 Yukleme iptal edildi.",
    cooldown_active: (m, sec) =>
        `⏳️ ${m}dk ${sec}sn sonra yeni bir gorev gonderebilirsiniz`,
    cooldown_ready: "✅ Artik yeni bir gorev gonderebilirsiniz.",
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
    ai_audio_uploading: (p) =>
        buildProgressBlock("📤 Ses yükleniyor", p, {
            speed: "Hiz",
            eta: "Kalan",
        }),
    ai_audio_success: "✅ Ses yüklendi!",
    ai_audio_error: (d) => `❌ Ses çıkarılamadı: <code>${d}</code>`,
    ai_retrying: "🔄 Önceki URL yeniden deneniyor...",
    ai_reupload_document: "📄 Belge olarak yeniden yükleniyor...",
    ai_reupload_video: "🎬 Video olarak yeniden yükleniyor...",
    quality_menu_title: "İndirme şeklini seçin:",
    quality_btn_audio: "🎵 Sadece ses (MP3)",
    quality_btn_best: "🎬 En iyi kalite",
    quality_btn_1080: "📺 1080p",
    quality_btn_720: "📺 720p",
    quality_btn_480: "📺 480p",
    quality_btn_360: "📺 360p",
    quality_btn_document: "📄 Belge olarak",
    quality_btn_cancel: "❌ İptal",
    quality_cancelled: "İptal edildi.",
    quality_expired: "Bu seçim sona erdi. Lütfen bağlantıyı tekrar gönderin.",
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
    downloading: (p) =>
        buildProgressBlock("📥 Telechargement", p, {
            speed: "Vitesse",
            eta: "Restant",
        }),
    uploading: (p) =>
        buildProgressBlock("📤 Upload", p, {
            speed: "Vitesse",
            eta: "Restant",
        }),
    success: "✅ Upload termine !",
    error: "❌ Erreur lors de l'upload.",
    url_not_found: "❌ Lien invalide — fichier introuvable",
    invalid_url: "⚠️ Aucun URL valide trouve.",
    profile_link_not_supported:
        "📷 C'est un lien de profil Instagram, pas une publication.\n\n" +
        "Envoyez l'URL d'une publication ( /p/… ), d'un reel ( /reel/… ) ou d'un IGTV ( /tv/… ) et je la téléchargerai.",
    unsupported_url:
        "⚠️ Cette URL n'est pas prise en charge pour le moment.\n\n" +
        "Plateformes prises en charge : Instagram / YouTube / TikTok / Twitter / Facebook / Reddit / Vimeo / SoundCloud — ou tout lien direct vers un fichier.",
    already_in_flight: "⏳ Un upload est deja en cours. Veuillez patienter.",
    queue_full: (max) =>
        `⏳ Le serveur est occupe (${max} uploads simultanes). Reessayez dans une minute.`,
    file_too_large: (mb) =>
        `❌ Fichier plus grand que la limite (${mb} Mo). Choisissez une qualite inferieure ou une URL plus petite.`,
    upload_stalled:
        "⚠️ L'upload n'avance plus (probablement une limite de debit Telegram). Reessayez, ou choisissez une qualite inferieure.",
    duplicate_ignored: "ℹ️ Lien en double ignore.",
    upload_cancel_button: "❌ Annuler",
    upload_cancelled: "🛑 Upload annule.",
    cooldown_active: (m, sec) =>
        `⏳️ Vous pouvez envoyer une nouvelle tache dans ${m}m ${sec}s`,
    cooldown_ready: "✅ Vous pouvez envoyer une nouvelle tache maintenant.",
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
    ai_audio_uploading: (p) =>
        buildProgressBlock("📤 Envoi audio", p, {
            speed: "Vitesse",
            eta: "Restant",
        }),
    ai_audio_success: "✅ Audio envoyé !",
    ai_audio_error: (d) => `❌ Échec de l'extraction audio : <code>${d}</code>`,
    ai_retrying: "🔄 Nouvelle tentative sur l'URL précédente...",
    ai_reupload_document: "📄 Renvoi en document...",
    ai_reupload_video: "🎬 Renvoi en vidéo...",
    quality_menu_title: "Choisissez le mode de téléchargement :",
    quality_btn_audio: "🎵 Audio seul (MP3)",
    quality_btn_best: "🎬 Meilleure qualité",
    quality_btn_1080: "📺 1080p",
    quality_btn_720: "📺 720p",
    quality_btn_480: "📺 480p",
    quality_btn_360: "📺 360p",
    quality_btn_document: "📄 En document",
    quality_btn_cancel: "❌ Annuler",
    quality_cancelled: "Annulé.",
    quality_expired: "Ce choix a expiré. Veuillez renvoyer le lien.",
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
    downloading: (p) =>
        buildProgressBlock("📥 Descargando", p, {
            speed: "Velocidad",
            eta: "Restante",
        }),
    uploading: (p) =>
        buildProgressBlock("📤 Subiendo", p, {
            speed: "Velocidad",
            eta: "Restante",
        }),
    success: "✅ Carga completada!",
    error: "❌ Error en la carga.",
    url_not_found: "❌ Enlace invalido — archivo no encontrado",
    invalid_url: "⚠️ No se encontro un URL valido.",
    profile_link_not_supported:
        "📷 Ese es un enlace de perfil de Instagram, no una publicación.\n\n" +
        "Envía la URL de una publicación ( /p/… ), reel ( /reel/… ) o IGTV ( /tv/… ) y la descargaré.",
    unsupported_url:
        "⚠️ Esta URL aún no es compatible.\n\n" +
        "Plataformas compatibles: Instagram / YouTube / TikTok / Twitter / Facebook / Reddit / Vimeo / SoundCloud — o cualquier enlace directo a un archivo.",
    already_in_flight: "⏳ Ya tienes una carga en curso. Espera.",
    queue_full: (max) =>
        `⏳ El servidor esta ocupado (${max} cargas simultaneas). Intenta en un minuto.`,
    file_too_large: (mb) =>
        `❌ El archivo supera el limite permitido (${mb} MB). Elige una calidad menor o una URL mas pequena.`,
    upload_stalled:
        "⚠️ La carga dejo de avanzar (probablemente un limite de Telegram). Reintenta, o elige una calidad menor.",
    duplicate_ignored: "ℹ️ Enlace duplicado ignorado.",
    upload_cancel_button: "❌ Cancelar",
    upload_cancelled: "🛑 Carga cancelada.",
    cooldown_active: (m, sec) =>
        `⏳️ Puedes enviar una nueva tarea en ${m}m ${sec}s`,
    cooldown_ready: "✅ Ya puedes enviar una nueva tarea.",
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
    ai_audio_uploading: (p) =>
        buildProgressBlock("📤 Subiendo audio", p, {
            speed: "Velocidad",
            eta: "Restante",
        }),
    ai_audio_success: "✅ ¡Audio subido!",
    ai_audio_error: (d) => `❌ Fallo al extraer audio: <code>${d}</code>`,
    ai_retrying: "🔄 Reintentando la URL anterior...",
    ai_reupload_document: "📄 Reenviando como documento...",
    ai_reupload_video: "🎬 Reenviando como video...",
    quality_menu_title: "Elige cómo descargar:",
    quality_btn_audio: "🎵 Solo audio (MP3)",
    quality_btn_best: "🎬 Mejor calidad",
    quality_btn_1080: "📺 1080p",
    quality_btn_720: "📺 720p",
    quality_btn_480: "📺 480p",
    quality_btn_360: "📺 360p",
    quality_btn_document: "📄 Como documento",
    quality_btn_cancel: "❌ Cancelar",
    quality_cancelled: "Cancelado.",
    quality_expired: "Esta opción caducó. Vuelve a enviar el enlace.",
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
