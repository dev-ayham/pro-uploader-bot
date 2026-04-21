/**
 * AI intent parser.
 *
 * The bot's message handler only knows how to react to a message that
 * contains a URL. For free-text follow-ups like "as audio" / "بدي ياه صوت"
 * we need a very small natural language layer that maps the message to one
 * of a fixed set of actions.
 *
 * Strategy:
 *   1. Regex / keyword pass (covers the common phrases in 5 languages, is
 *      free and synchronous, and handles 70-90% of real world phrasings).
 *   2. OpenAI `gpt-4o-mini` fallback when the regex pass is inconclusive
 *      AND the user still has budget on the per-chat daily limit AND an
 *      `OPENAI_API_KEY` is configured.
 *
 * The module is side-effect free: it never touches the DB or issues the
 * action, it only *classifies* the message. The caller is responsible for
 * applying the result.
 */
export type IntentAction =
    | "audio"
    | "document"
    | "video"
    | "retry"
    | "cancel"
    | "unknown";

export interface Intent {
    action: IntentAction;
    /** "regex" | "openai" — surfaced for logging / debugging only. */
    source: "regex" | "openai";
    /** Raw model output for openai path, empty otherwise. Never shown to users. */
    raw?: string;
}

/**
 * Normalise Arabic diacritics and common variations so the keyword lists
 * below can stay short. We remove tashkeel (U+064B..U+0652, U+0670) and
 * collapse the alif variants into plain alif. This is intentionally lossy
 * but fine for intent classification.
 */
function normaliseArabic(s: string): string {
    return s
        .replace(/[\u064B-\u0652\u0670]/g, "")
        .replace(/[\u0622\u0623\u0625]/g, "\u0627")
        .replace(/[\u0649]/g, "\u064A")
        .replace(/[\u0629]/g, "\u0647");
}

function normalise(s: string): string {
    return normaliseArabic(s.toLowerCase().trim());
}

/**
 * Intent keywords per action. Each entry is matched against the normalised
 * message as a substring (regex-escape free: we pre-normalise both sides so
 * plain includes() is enough). Order matters — the first matching action
 * wins, so the more specific "audio" list is checked before the generic
 * "retry".
 */
const KEYWORDS: Array<{ action: IntentAction; phrases: string[] }> = [
    {
        // Checked first so phrases like "الغي العمليتين" / "stop it" /
        // "ايقاف" never get misclassified as "retry" or fall through to
        // the OpenAI fallback where the model has been observed to
        // guess "retry" and kick off a brand-new (expensive) upload.
        action: "cancel",
        phrases: [
            // Arabic
            "الغ",
            "الغي",
            "الغاء",
            "إلغاء",
            "الغي العمليه",
            "الغي العمليات",
            "الغي العمليتين",
            "ايقاف",
            "إيقاف",
            "ايقافهم",
            "ايقافها",
            "ايقافه",
            "اوقف",
            "أوقف",
            "توقف",
            "وقف",
            "بطل",
            "بطله",
            "كنسل",
            // English
            "cancel",
            "stop",
            "abort",
            "kill it",
            "stop it",
            // Turkish
            "iptal",
            "durdur",
            // French
            "annule",
            "annuler",
            "arrete",
            "arrêter",
            "stoppe",
            // Spanish
            "cancela",
            "cancelar",
            "detener",
            "parar",
            "para",
        ],
    },
    {
        action: "audio",
        phrases: [
            // Arabic
            "صوت",
            "صوتي",
            "صوتيه",
            "صوتي بس",
            "صوت فقط",
            "اغنيه",
            "اغنية",
            "اغنيه فقط",
            "موسيقى",
            "موسيقا",
            "مقطع صوتي",
            "mp3",
            "wav",
            "m4a",
            "بدون فيديو",
            "استخرج الصوت",
            "استخراج الصوت",
            "استخرج له الصوت",
            "حولها صوت",
            "حوله صوت",
            "ابعت الصوت",
            "ابعتلي الصوت",
            "ابعت لي الصوت",
            "ارسل الصوت",
            "ارسلي الصوت",
            "اريد الصوت",
            "بدي الصوت",
            "بدي ياه صوت",
            "بدي اياه صوت",
            "اعطني الصوت",
            // English
            "audio",
            "as audio",
            "only audio",
            "audio only",
            "extract audio",
            "music",
            "song",
            // Turkish
            "ses",
            "ses olarak",
            "sadece ses",
            "sarki",
            // French
            "audio seul",
            "juste audio",
            "son",
            "musique",
            "chanson",
            // Spanish
            "solo audio",
            "cancion",
            "canción",
            "musica",
            "música",
        ],
    },
    {
        action: "document",
        phrases: [
            // Arabic
            "كملف",
            "ملف",
            "وثيقه",
            "ارسل كملف",
            "ابعت كملف",
            "ابعتلي كملف",
            "بدون ضغط",
            // English
            "as document",
            "as file",
            "document",
            "uncompressed",
            // Turkish
            "belge olarak",
            "dosya olarak",
            "belge",
            "dosya",
            // French
            "en document",
            "fichier",
            "sans compression",
            // Spanish
            "como documento",
            "como archivo",
            "archivo",
            "documento",
            "sin comprimir",
        ],
    },
    {
        action: "video",
        phrases: [
            // Arabic
            "فيديو",
            "كفيديو",
            "بدون ضغط فيديو",
            "ارسل فيديو",
            "ابعتلي فيديو",
            // English
            "as video",
            "video",
            // Turkish
            "video olarak",
            "video",
            // French
            "en video",
            "en vidéo",
            "vidéo",
            "video",
            // Spanish
            "como video",
            "video",
            "vídeo",
        ],
    },
    {
        action: "retry",
        phrases: [
            // Arabic
            "اعد",
            "اعاده",
            "اعده",
            "جربي مره ثانيه",
            "مره ثانيه",
            "مره تانيه",
            "مجددا",
            "من جديد",
            // English
            "retry",
            "again",
            "try again",
            "redo",
            "once more",
            // Turkish
            "tekrar",
            "tekrar dene",
            "yeniden",
            // French
            "réessayer",
            "reessayer",
            "encore",
            "à nouveau",
            "a nouveau",
            // Spanish
            "reintentar",
            "otra vez",
            "de nuevo",
        ],
    },
];

/**
 * First pass: keyword lookup. Returns a confident action when any phrase
 * matches the normalised message as a substring, or "unknown" when nothing
 * fires. The function is deterministic, zero-cost and runs on every
 * candidate message.
 */
export function parseIntentByKeywords(message: string): IntentAction {
    const n = normalise(message);
    if (!n) return "unknown";
    for (const { action, phrases } of KEYWORDS) {
        for (const phrase of phrases) {
            if (n.includes(normalise(phrase))) return action;
        }
    }
    return "unknown";
}

/**
 * OpenAI fallback. Only called when the keyword pass returned "unknown"
 * AND `OPENAI_API_KEY` is set AND the caller says the per-chat rate
 * limit has budget. Uses the Chat Completions JSON mode for a
 * strictly-shaped response so we never have to worry about free-form
 * prose leaking to the user.
 */
export async function parseIntentWithOpenAI(
    message: string,
    options: {
        apiKey: string;
        model?: string;
        timeoutMs?: number;
    },
): Promise<Intent> {
    const model = options.model ?? "gpt-4.1-nano";
    const timeoutMs = options.timeoutMs ?? 8_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${options.apiKey}`,
            },
            body: JSON.stringify({
                model,
                // Force JSON mode so the response is guaranteed to be an
                // object we can parse.
                response_format: { type: "json_object" },
                temperature: 0,
                // The expected reply is `{"action":"audio"}` = ~6 tokens. We
                // allow 12 for a bit of slack without letting the model
                // waffle.
                max_tokens: 12,
                messages: [
                    {
                        role: "system",
                        // Terse system prompt (~35 tokens vs the earlier
                        // ~120) to keep the per-call cost low. The JSON
                        // schema is enforced by response_format so we
                        // don't need to describe it at length.
                        content:
                            'Classify the user message into one action. Reply ONLY with JSON {"action":"audio"|"document"|"video"|"retry"|"cancel"|"unknown"}. audio=get sound/mp3. document=as file. video=as video. retry=try again. cancel=stop/abort the current upload.',
                    },
                    {
                        role: "user",
                        // Short follow-ups are the norm; truncate
                        // aggressively to bound input cost.
                        content: message.slice(0, 200),
                    },
                ],
            }),
            signal: controller.signal,
        });
        if (!res.ok) {
            return {
                action: "unknown",
                source: "openai",
                raw: `HTTP ${res.status}`,
            };
        }
        const payload = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = payload.choices?.[0]?.message?.content?.trim() ?? "";
        const parsed = tryParseActionJson(raw);
        return { action: parsed, source: "openai", raw };
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { action: "unknown", source: "openai", raw: detail };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Tiny in-process LRU of recent classifications keyed by
 * `chatId|normalisedMessage`. The intent for a given short phrase is
 * deterministic, so when the same chat asks the same thing twice in quick
 * succession we return the cached result and skip the OpenAI round-trip.
 * TTL is bounded; entries expire after 10 minutes so a later message with
 * the same text still gets a fresh decision if the product evolves.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const intentCache = new Map<string, { action: IntentAction; at: number }>();

function cacheKey(chatId: number, message: string): string {
    return `${chatId}|${normalise(message)}`;
}

export function getCachedIntent(
    chatId: number,
    message: string,
): IntentAction | null {
    const key = cacheKey(chatId, message);
    const hit = intentCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
        intentCache.delete(key);
        return null;
    }
    // Refresh LRU position so hot entries stay warm.
    intentCache.delete(key);
    intentCache.set(key, hit);
    return hit.action;
}

export function setCachedIntent(
    chatId: number,
    message: string,
    action: IntentAction,
): void {
    if (action === "unknown") return;
    const key = cacheKey(chatId, message);
    intentCache.set(key, { action, at: Date.now() });
    if (intentCache.size > CACHE_MAX) {
        const oldest = intentCache.keys().next().value;
        if (oldest !== undefined) intentCache.delete(oldest);
    }
}

/**
 * Conversational fallback. Called when both the regex pass and the intent
 * classifier returned "unknown" and the message is not a URL. Uses the
 * same OpenAI model but with a chat-style prompt so the bot can answer
 * generic questions like "مرحبا" or "شو بتقدر تحمل؟" with something
 * useful instead of "لم أفهم طلبك".
 *
 * Cost control: capped to ~120 output tokens, single turn, no history
 * kept — every call is stateless. Caller is responsible for enforcing
 * the daily budget.
 */
export async function chatWithOpenAI(
    message: string,
    options: {
        apiKey: string;
        model?: string;
        timeoutMs?: number;
        language?: string;
    },
): Promise<string | null> {
    const model = options.model ?? "gpt-4.1-nano";
    const timeoutMs = options.timeoutMs ?? 8_000;
    const language = options.language ?? "ar";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${options.apiKey}`,
            },
            body: JSON.stringify({
                model,
                temperature: 0.3,
                // Enough for a friendly 2-3 sentence reply; keeps cost
                // bounded at roughly $0.00005 per turn on gpt-4.1-nano.
                max_tokens: 180,
                messages: [
                    {
                        role: "system",
                        content:
                            // The assistant persona is narrow on purpose:
                            // the bot's only job is to download media from
                            // URLs, so the chat reply should always nudge
                            // the user back toward sending a link.
                            "You are the helpful assistant embedded in a " +
                            "Telegram bot called 'File Uploader'. The bot " +
                            "downloads videos/audio/files from URLs " +
                            "(YouTube, Instagram, TikTok, Twitter, and " +
                            "direct links). Answer briefly (max ~60 words), " +
                            "conversationally, in the user's language " +
                            `(reply language code: ${language}). Always end ` +
                            "by inviting the user to send a link or ask a " +
                            "follow-up. Do NOT invent features the bot " +
                            "doesn't have. If the user asks what you can " +
                            "do, list: download videos, extract audio, " +
                            "send as document, 1080p/720p/480p/360p " +
                            "quality choice, custom thumbnail, filename " +
                            "prefix/suffix, screenshots, /settings menu. " +
                            "Never ask for personal data. Never output " +
                            "URLs yourself.",
                    },
                    {
                        role: "user",
                        content: message.slice(0, 400),
                    },
                ],
            }),
            signal: controller.signal,
        });
        if (!res.ok) return null;
        const payload = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = payload.choices?.[0]?.message?.content?.trim() ?? "";
        if (!raw) return null;
        // Hard cap in case the model ignores max_tokens and produces a
        // very long reply. We keep the first ~500 chars which is enough
        // for a normal Telegram message bubble.
        return raw.slice(0, 500);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function tryParseActionJson(raw: string): IntentAction {
    try {
        const obj = JSON.parse(raw) as { action?: string };
        switch (obj.action) {
            case "audio":
            case "document":
            case "video":
            case "retry":
            case "cancel":
                return obj.action;
            default:
                return "unknown";
        }
    } catch {
        return "unknown";
    }
}
