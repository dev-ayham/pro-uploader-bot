import { Bot, Context } from "grammy";
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
                    response_format: { type: "json_object" },
                    temperature: 0,
                    max_tokens: 8,
                    messages: [
                        {
                            role: "system",
                            content:
                                'Reply ONLY with {"action":"audio"}.',
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
 * Register the admin-only command surface:
 *
 *   /admin          — show this menu
 *   /ai_status      — OpenAI env + live reachability
 *   /stats_all      — aggregate bot stats
 *   /broadcast ...  — send a message to every chat that ever used the bot
 *   /user <id>      — inspect a user's stored prefs
 *   /ban <id> [r]   — add a chat_id to the banlist
 *   /unban <id>     — remove a chat_id from the banlist
 *   /bans           — list currently banned chat_ids
 *
 * Every handler short-circuits with a silent return for non-admins so
 * casual users who guess a command name see nothing.
 */
export function registerAdminHandlers(bot: Bot): void {
    bot.command("admin", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        const ids = getAdminIds();
        const lines = [
            "🛠 <b>Admin menu</b>",
            "",
            "/ai_status — فحص مفتاح OpenAI + الاتصال الحيّ",
            "/stats_all — إحصائيات كل المستخدمين",
            "/broadcast &lt;نص&gt; — إرسال رسالة لجميع المستخدمين",
            "/user &lt;id&gt; — فحص إعدادات مستخدم محدد",
            "/ban &lt;id&gt; [سبب] — حظر مستخدم",
            "/unban &lt;id&gt; — رفع الحظر",
            "/bans — قائمة المحظورين",
            "",
            `<b>Admins:</b> <code>${ids.join(", ")}</code>`,
        ];
        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    });

    bot.command("ai_status", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        const apiKey = process.env.OPENAI_API_KEY || "";
        const model = process.env.OPENAI_MODEL || "gpt-4.1-nano";
        const limit = parseInt(
            process.env.AI_DAILY_LIMIT_PER_USER || "20",
            10,
        );
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
                    `<i>error:</i> <code>${ping.message
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")}</code>`,
                );
            }
        } else {
            lines.push(
                "OpenAI ping: <i>skipped (no key)</i>",
            );
        }

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    });

    bot.command("stats_all", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        const s = aggregateStats();
        const langs = s.perLanguage.length > 0
            ? s.perLanguage
                  .map((r) => `${r.language}=${r.count}`)
                  .join(", ")
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
    });

    bot.command("bans", async (ctx) => {
        if (!requireAdmin(ctx)) return;
        const rows = listBannedUsers();
        if (rows.length === 0) {
            await ctx.reply("لا يوجد محظورون حالياً.");
            return;
        }
        const body = rows
            .slice(0, 50)
            .map((r) => {
                const d = new Date(r.at * 1000)
                    .toISOString()
                    .slice(0, 10);
                return `<code>${r.chatId}</code> — ${d}${
                    r.reason ? ` — ${escapeHtml(r.reason)}` : ""
                }`;
            })
            .join("\n");
        const header = `🚫 <b>Banned (${rows.length})</b>\n\n`;
        await ctx.reply(header + body, { parse_mode: "HTML" });
    });
}

export { formatSeconds };
