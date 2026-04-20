import { execSync } from "child_process";
import * as os from "os";
import { Bot, Context, InlineKeyboard } from "grammy";
import {
    aggregateStats,
    getAllChatIds,
    getAiCallsToday,
    getUserPrefs,
    isBanned,
    listBannedUsers,
    setBanned,
} from "../services/db";
import { getAdminIds, isAdmin } from "../services/admin";
import {
    clearPendingInput,
    getPendingInput,
    setPendingInput,
} from "../services/pending-input";

function requireAdmin(ctx: Context): boolean {
    return isAdmin(ctx.chat?.id);
}

function argsAfterCommand(ctx: Context): string {
    const text = ctx.message?.text ?? "";
    const firstSpace = text.indexOf(" ");
    if (firstSpace < 0) return "";
    return text.slice(firstSpace + 1).trim();
}

/**
 * Minimal HTML escaping for Telegram's HTML parse_mode. Call on any
 * user-supplied string (ban reason, URLs, etc.) before interpolating
 * into a message template; otherwise a `&` or `<` in the input causes
 * Telegram to reject the entire message with a parse error.
 */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function formatSeconds(s: number): string {
    if (!Number.isFinite(s) || s <= 0) return "—";
    const d = Math.floor(s / 86_400);
    const h = Math.floor((s % 86_400) / 3_600);
    const m = Math.floor((s % 3_600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

async function pingOpenAI(apiKey: string, model: string): Promise<{
    ok: boolean;
    status: number;
    latencyMs: number;
    message: string;
}> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const started = Date.now();
    try {
        const res = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    // No response_format here: we only care whether the
                    // API is reachable and the key/quota are valid. When
                    // response_format is "json_object", OpenAI requires
                    // the literal word "json" somewhere in the messages
                    // and otherwise rejects the call with HTTP 400, which
                    // made /ai_status always appear broken.
                    temperature: 0,
                    max_tokens: 4,
                    messages: [
                        {
                            role: "system",
                            content: "Reply with the single word: ok",
                        },
                        { role: "user", content: "ping" },
                    ],
                }),
                signal: controller.signal,
            },
        );
        const latencyMs = Date.now() - started;
        if (res.ok) {
            return { ok: true, status: res.status, latencyMs, message: "OK" };
        }
        const body = (await res.text()).slice(0, 200);
        return { ok: false, status: res.status, latencyMs, message: body };
    } catch (err) {
        return {
            ok: false,
            status: 0,
            latencyMs: Date.now() - started,
            message:
                err instanceof Error ? err.message : String(err),
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Inline keyboard shown by /admin and reused as the "return to menu"
 * target after each action. Two columns per row so each button stays
 * wide enough to read comfortably on mobile.
 */
function buildAdminMenu(): InlineKeyboard {
    return new InlineKeyboard()
        .text("🤖 AI status", "admin:ai_status")
        .text("📊 Stats", "admin:stats_all").row()
        .text("🔎 User lookup", "admin:user")
        .text("📢 Broadcast", "admin:broadcast").row()
        .text("🚫 Ban", "admin:ban")
        .text("✅ Unban", "admin:unban").row()
        .text("📋 Bans list", "admin:bans")
        .text("📟 Resources", "admin:resources");
}

function adminMenuHeader(): string {
    const ids = getAdminIds();
    return [
        "🛠 <b>Admin menu</b>",
        "",
        `<b>Admins:</b> <code>${ids.join(", ")}</code>`,
        "",
        "اختر إجراءً من الأزرار:",
    ].join("\n");
}

async function renderAdminMenu(ctx: Context): Promise<void> {
    await ctx.reply(adminMenuHeader(), {
        parse_mode: "HTML",
        reply_markup: buildAdminMenu(),
    });
}

// --- Action implementations ---------------------------------------------
//
// Each runXxx function is the single source of truth for an admin action.
// Command handlers and callback-query handlers both delegate here so the
// two surfaces can never drift.

async function runAiStatus(ctx: Context): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY || "";
    const model = process.env.OPENAI_MODEL || "gpt-4.1-nano";
    const limit = parseInt(process.env.AI_DAILY_LIMIT_PER_USER || "20", 10);
    const chatId = ctx.chat?.id ?? 0;
    const usedToday = chatId ? getAiCallsToday(chatId) : 0;

    const keyPresent = apiKey.trim().length > 0;
    const keyDisplay = keyPresent
        ? `${apiKey.slice(0, 7)}…${apiKey.slice(-4)} (len=${apiKey.length})`
        : "❌ غير موجود";

    const lines = [
        "<b>AI status</b>",
        "",
        `OPENAI_API_KEY: ${keyPresent ? "✅" : "❌"} <code>${keyDisplay}</code>`,
        `Model: <code>${model}</code>`,
        `Daily limit: <code>${limit}</code>`,
        `Your usage today: <code>${usedToday}/${limit}</code>`,
    ];

    if (keyPresent) {
        const ping = await pingOpenAI(apiKey, model);
        lines.push(
            `OpenAI ping: ${ping.ok ? "✅" : "❌"} <code>HTTP ${ping.status}</code> (${ping.latencyMs}ms)`,
        );
        if (!ping.ok) {
            lines.push(
                `<i>error:</i> <code>${escapeHtml(ping.message)}</code>`,
            );
        }
    } else {
        lines.push("OpenAI ping: <i>skipped (no key)</i>");
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

async function runStatsAll(ctx: Context): Promise<void> {
    const s = aggregateStats();
    const langs = s.perLanguage.length > 0
        ? s.perLanguage.map((r) => `${r.language}=${r.count}`).join(", ")
        : "—";
    const lines = [
        "📊 <b>Global stats</b>",
        "",
        `Users: <code>${s.totalUsers}</code>`,
        `Banned: <code>${s.bannedUsers}</code>`,
        `Total uploads: <code>${s.totalUploads}</code>`,
        `AI calls today: <code>${s.aiCallsToday}</code>`,
        `Active today (≥1 AI call): <code>${s.activeToday}</code>`,
        `Languages: <code>${langs}</code>`,
    ];
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

async function runBroadcast(ctx: Context, msg: string): Promise<void> {
    const ids = getAllChatIds();
    if (ids.length === 0) {
        await ctx.reply("لا يوجد مستخدمون محفوظون بعد.");
        return;
    }
    await ctx.reply(
        `📣 جاري البث إلى <code>${ids.length}</code> مستخدم...`,
        { parse_mode: "HTML" },
    );
    let ok = 0;
    let failed = 0;
    // Serial with small delay to stay well under Telegram's 30 msg/sec
    // global rate limit. For a few thousand users this takes a couple
    // of minutes at most and is simpler than a scheduler.
    for (const id of ids) {
        if (isBanned(id)) continue;
        try {
            await ctx.api.sendMessage(id, msg, {
                link_preview_options: { is_disabled: true },
            });
            ok++;
        } catch (err) {
            failed++;
            console.warn(
                `broadcast failed for ${id}:`,
                err instanceof Error ? err.message : err,
            );
        }
        await new Promise((r) => setTimeout(r, 40));
    }
    await ctx.reply(
        `✅ انتهى البث. نجاح: <code>${ok}</code> / فشل: <code>${failed}</code>`,
        { parse_mode: "HTML" },
    );
}

async function runUserLookup(ctx: Context, id: number): Promise<void> {
    const prefs = getUserPrefs(id);
    const calls = getAiCallsToday(id);
    const banned = isBanned(id);
    const joined = prefs.createdAt
        ? new Date(prefs.createdAt * 1000).toISOString().slice(0, 10)
        : "—";
    const lines = [
        `👤 <b>User <code>${id}</code></b>`,
        "",
        `Banned: ${banned ? "✅" : "❌"}`,
        `Language: <code>${prefs.language}</code>`,
        `Upload-as-doc: ${prefs.uploadAsDocument ? "on" : "off"}`,
        `Screenshots: <code>${prefs.screenshotsCount}</code>`,
        `Prefix: <code>${escapeHtml(prefs.renamePrefix || "—")}</code>`,
        `Suffix: <code>${escapeHtml(prefs.renameSuffix || "—")}</code>`,
        `Uploads: <code>${prefs.uploadsCount}</code>`,
        `AI calls today: <code>${calls}</code>`,
        `Joined: <code>${joined}</code>`,
        `Last URL: <code>${escapeHtml((prefs.lastUrl || "—").slice(0, 80))}</code>`,
    ];
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

async function runBan(
    ctx: Context,
    id: number,
    reason: string,
): Promise<void> {
    if (isAdmin(id)) {
        await ctx.reply("لا يمكن حظر مشرف آخر.");
        return;
    }
    setBanned(id, true, reason);
    const safeReason = escapeHtml(reason);
    await ctx.reply(
        `🚫 تم حظر <code>${id}</code>${safeReason ? ` — السبب: ${safeReason}` : ""}`,
        { parse_mode: "HTML" },
    );
}

async function runUnban(ctx: Context, id: number): Promise<void> {
    if (!isBanned(id)) {
        await ctx.reply(
            `<code>${id}</code> غير موجود في قائمة الحظر.`,
            { parse_mode: "HTML" },
        );
        return;
    }
    setBanned(id, false);
    await ctx.reply(`✅ تم رفع الحظر عن <code>${id}</code>.`, {
        parse_mode: "HTML",
    });
}

/**
 * Best-effort disk-usage for the filesystem hosting `target` (by default
 * the OS tmpdir where downloads are staged). We shell out to `df -Pk` so
 * the result is accurate across volumes — Node has no built-in statvfs.
 * Returns `null` when `df` is unavailable or its output is unexpected.
 */
function getDiskUsage(
    target: string,
): { totalBytes: number; usedBytes: number; freeBytes: number } | null {
    try {
        const out = execSync(`df -Pk ${target}`, {
            encoding: "utf8",
            timeout: 2_000,
        });
        const lines = out.trim().split("\n");
        if (lines.length < 2) return null;
        const parts = lines[lines.length - 1].trim().split(/\s+/);
        // Posix df: Filesystem 1024-blocks Used Available Capacity Mounted
        const totalKb = Number.parseInt(parts[1], 10);
        const usedKb = Number.parseInt(parts[2], 10);
        const freeKb = Number.parseInt(parts[3], 10);
        if (!Number.isFinite(totalKb)) return null;
        return {
            totalBytes: totalKb * 1024,
            usedBytes: usedKb * 1024,
            freeBytes: freeKb * 1024,
        };
    } catch {
        return null;
    }
}

function formatBytes(n: number): string {
    if (!Number.isFinite(n) || n < 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Live snapshot of the container's resource usage so admins can tell at a
 * glance whether the bot is close to saturation before publicly announcing
 * or onboarding more users. All values come from Node's `os` / `process`
 * modules plus a `df` shell call; no external dependency required.
 */
async function runResources(ctx: Context): Promise<void> {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPct = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;

    const cpus = os.cpus();
    const load = os.loadavg();
    // 1-minute load normalised to CPU count — >1.0 means the scheduler has
    // more runnable work than cores, which on our workload usually means
    // concurrent yt-dlp + ffmpeg runs are contending.
    const normalizedLoad = cpus.length > 0 ? load[0] / cpus.length : load[0];

    const tmpDir = os.tmpdir();
    const disk = getDiskUsage(tmpDir);

    const uptimeSec = process.uptime();

    const lines = [
        "📟 <b>Resources</b>",
        "",
        "<b>Memory</b>",
        `  RSS: <code>${formatBytes(mem.rss)}</code>`,
        `  Heap: <code>${formatBytes(mem.heapUsed)}</code> / <code>${formatBytes(mem.heapTotal)}</code>`,
        `  Host: <code>${formatBytes(usedMem)}</code> / <code>${formatBytes(totalMem)}</code> (${memPct}%)`,
        "",
        "<b>CPU</b>",
        `  Cores: <code>${cpus.length}</code>`,
        `  Load avg: <code>${load.map((n) => n.toFixed(2)).join(" / ")}</code> (1m norm: <code>${normalizedLoad.toFixed(2)}</code>)`,
        "",
        "<b>Disk (tmp)</b>",
        disk
            ? `  <code>${tmpDir}</code>: <code>${formatBytes(disk.usedBytes)}</code> / <code>${formatBytes(disk.totalBytes)}</code> (free: <code>${formatBytes(disk.freeBytes)}</code>)`
            : `  <code>${tmpDir}</code>: <i>unavailable</i>`,
        "",
        `<b>Process uptime:</b> <code>${formatSeconds(uptimeSec)}</code>`,
        `<b>Node:</b> <code>${process.version}</code>`,
        `<b>Platform:</b> <code>${process.platform}/${process.arch}</code>`,
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

async function runBans(ctx: Context): Promise<void> {
    const rows = listBannedUsers();
    if (rows.length === 0) {
        await ctx.reply("لا يوجد محظورون حالياً.");
        return;
    }
    const body = rows
        .slice(0, 50)
        .map((r) => {
            const d = new Date(r.at * 1000).toISOString().slice(0, 10);
            return `<code>${r.chatId}</code> — ${d}${
                r.reason ? ` — ${escapeHtml(r.reason)}` : ""
            }`;
        })
        .join("\n");
    const header = `🚫 <b>Banned (${rows.length})</b>\n\n`;
    await ctx.reply(header + body, { parse_mode: "HTML" });
}

// --- Pending-input handler for admin flows -----------------------------

/**
 * When an admin clicks e.g. "🔎 User lookup" we set a pending-input
 * marker and ask them to type the chat_id. This function is called
 * from the main message:text handler before settings' own pending-input
 * check and consumes the next message as the answer.
 *
 * Returns true when it handled the message so the caller skips URL
 * parsing / intent classification for that text.
 */
export async function handleAdminPendingInputIfAny(
    ctx: Context,
): Promise<boolean> {
    if (!ctx.chat || !ctx.message?.text) return false;
    const chatId = ctx.chat.id;
    if (!isAdmin(chatId)) return false;
    const pending = getPendingInput(chatId);
    if (!pending) return false;
    if (
        pending.kind !== "admin_user_lookup" &&
        pending.kind !== "admin_ban" &&
        pending.kind !== "admin_unban" &&
        pending.kind !== "admin_broadcast"
    ) {
        return false;
    }

    const text = ctx.message.text.trim();

    // Any /command aborts the pending flow so the admin can escape
    // without sending a dummy value.
    if (text.startsWith("/")) {
        clearPendingInput(chatId);
        await ctx.reply("تم الإلغاء.");
        return true;
    }

    clearPendingInput(chatId);

    if (pending.kind === "admin_broadcast") {
        await runBroadcast(ctx, text);
        return true;
    }

    if (pending.kind === "admin_user_lookup") {
        const id = Number.parseInt(text, 10);
        if (!Number.isFinite(id) || id === 0) {
            await ctx.reply("chat_id غير صالح.");
            return true;
        }
        await runUserLookup(ctx, id);
        return true;
    }

    if (pending.kind === "admin_unban") {
        const id = Number.parseInt(text, 10);
        if (!Number.isFinite(id) || id === 0) {
            await ctx.reply("chat_id غير صالح.");
            return true;
        }
        await runUnban(ctx, id);
        return true;
    }

    // admin_ban — format: "<chat_id> [reason...]"
    const firstSpace = text.indexOf(" ");
    const idStr = firstSpace < 0 ? text : text.slice(0, firstSpace);
    const reason = firstSpace < 0 ? "" : text.slice(firstSpace + 1).trim();
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id) || id === 0) {
        await ctx.reply("chat_id غير صالح.");
        return true;
    }
    await runBan(ctx, id, reason);
    return true;
}

/**
 * Register the admin-only command surface:
 *
 *   /admin          — show the inline admin menu
 *   /ai_status      — OpenAI env + live reachability
 *   /stats_all      — aggregate bot stats
 *   /broadcast ...  — send a message to every chat that ever used the bot
 *   /user <id>      — inspect a user's stored prefs
 *   /ban <id> [r]   — add a chat_id to the banlist
 *   /unban <id>     — remove a chat_id from the banlist
 *   /bans           — list currently banned chat_ids
 *
 * Callback queries on `admin:*` trigger the same action functions, so
 * either flow (typed command or button press) behaves identically. The
 * three commands that require an argument also accept a button-driven
 * two-step flow via pending-input when invoked from the inline menu.
 *
 * Every handler short-circuits with a silent return for non-admins so
 * casual users who guess a command name see nothing.
 */
export function registerAdminHandlers(bot: Bot): void {
    bot.command("admin", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        await renderAdminMenu(ctx);
    });

    bot.command("ai_status", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        await runAiStatus(ctx);
    });

    bot.command("stats_all", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        await runStatsAll(ctx);
    });

    bot.command("broadcast", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        const msg = argsAfterCommand(ctx);
        if (!msg) {
            await ctx.reply(
                "Usage: <code>/broadcast &lt;message&gt;</code>",
                { parse_mode: "HTML" },
            );
            return;
        }
        await runBroadcast(ctx, msg);
    });

    bot.command("user", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        const arg = argsAfterCommand(ctx);
        const id = Number.parseInt(arg, 10);
        if (!Number.isFinite(id) || id === 0) {
            await ctx.reply(
                "Usage: <code>/user &lt;chat_id&gt;</code>",
                { parse_mode: "HTML" },
            );
            return;
        }
        await runUserLookup(ctx, id);
    });

    bot.command("ban", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        const arg = argsAfterCommand(ctx);
        const firstSpace = arg.indexOf(" ");
        const idStr = firstSpace < 0 ? arg : arg.slice(0, firstSpace);
        const reason = firstSpace < 0 ? "" : arg.slice(firstSpace + 1).trim();
        const id = Number.parseInt(idStr, 10);
        if (!Number.isFinite(id) || id === 0) {
            await ctx.reply(
                "Usage: <code>/ban &lt;chat_id&gt; [reason]</code>",
                { parse_mode: "HTML" },
            );
            return;
        }
        await runBan(ctx, id, reason);
    });

    bot.command("unban", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        const arg = argsAfterCommand(ctx);
        const id = Number.parseInt(arg, 10);
        if (!Number.isFinite(id) || id === 0) {
            await ctx.reply(
                "Usage: <code>/unban &lt;chat_id&gt;</code>",
                { parse_mode: "HTML" },
            );
            return;
        }
        await runUnban(ctx, id);
    });

    bot.command("bans", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        await runBans(ctx);
    });

    bot.command("resources", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        await runResources(ctx);
    });

    // --- Callback queries from the inline menu --------------------------

    bot.callbackQuery("admin:ai_status", async (ctx) => {
        if (!requireAdmin(ctx)) {
            await ctx.answerCallbackQuery();
            return;
        }
        await ctx.answerCallbackQuery();
        await runAiStatus(ctx);
    });

    bot.callbackQuery("admin:stats_all", async (ctx) => {
        if (!requireAdmin(ctx)) {
            await ctx.answerCallbackQuery();
            return;
        }
        await ctx.answerCallbackQuery();
        await runStatsAll(ctx);
    });

    bot.callbackQuery("admin:bans", async (ctx) => {
        if (!requireAdmin(ctx)) {
            await ctx.answerCallbackQuery();
            return;
        }
        await ctx.answerCallbackQuery();
        await runBans(ctx);
    });

    bot.callbackQuery("admin:resources", async (ctx) => {
        if (!requireAdmin(ctx)) {
            await ctx.answerCallbackQuery();
            return;
        }
        await ctx.answerCallbackQuery();
        await runResources(ctx);
    });

    // Arg-taking actions: arm pending-input and prompt for the value.
    // The actual work runs from handleAdminPendingInputIfAny on the
    // admin's next message. /anything cancels.
    bot.callbackQuery("admin:user", async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId || !requireAdmin(ctx)) {
            await ctx.answerCallbackQuery();
            return;
        }
        setPendingInput(chatId, { kind: "admin_user_lookup" });
        await ctx.answerCallbackQuery();
        await ctx.reply(
            "🔎 أرسل <code>chat_id</code> المستخدم المراد فحصه:\n<i>(أرسل /إلغاء لإيقاف العملية)</i>",
            { parse_mode: "HTML" },
        );
    });

    bot.callbackQuery("admin:ban", async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId || !requireAdmin(ctx)) {
            await ctx.answerCallbackQuery();
            return;
        }
        setPendingInput(chatId, { kind: "admin_ban" });
        await ctx.answerCallbackQuery();
        await ctx.reply(
            "🚫 أرسل <code>chat_id [سبب]</code> — مثال: <code>123456789 spam</code>",
            { parse_mode: "HTML" },
        );
    });

    bot.callbackQuery("admin:unban", async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId || !requireAdmin(ctx)) {
            await ctx.answerCallbackQuery();
            return;
        }
        setPendingInput(chatId, { kind: "admin_unban" });
        await ctx.answerCallbackQuery();
        await ctx.reply(
            "✅ أرسل <code>chat_id</code> الذي تريد رفع الحظر عنه:",
            { parse_mode: "HTML" },
        );
    });

    bot.callbackQuery("admin:broadcast", async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId || !requireAdmin(ctx)) {
            await ctx.answerCallbackQuery();
            return;
        }
        setPendingInput(chatId, { kind: "admin_broadcast" });
        await ctx.answerCallbackQuery();
        await ctx.reply(
            "📢 أرسل نص الرسالة التي سيتم بثّها لكل المستخدمين:\n<i>(أرسل /إلغاء للخروج)</i>",
            { parse_mode: "HTML" },
        );
    });
}

export { formatSeconds };
