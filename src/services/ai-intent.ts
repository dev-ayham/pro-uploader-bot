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
        action: "audio",
        phrases: [
            // Arabic
            "صوت",
            "صوتي",
            "صوتيه",
            "صوتي بس",
            "اغنيه",
            "اغنية",
            "mp3",
            "بدون فيديو",
            "استخرج الصوت",
            "استخراج الصوت",
            "ابعت الصوت",
            "ابعتلي الصوت",
            "ارسل الصوت",
            "اريد الصوت",
            "بدي الصوت",
            "بدي ياه صوت",
            "بدي اياه صوت",
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
    const model = options.model ?? "gpt-4o-mini";
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
                max_tokens: 32,
                messages: [
                    {
                        role: "system",
                        content:
                            'You classify a short message from a Telegram file-uploader bot user. The user already sent a URL earlier; this message is a follow-up instruction. Respond with ONLY a JSON object of shape {"action": "audio"|"document"|"video"|"retry"|"unknown"}. Pick "audio" for requests to get the audio/sound/mp3/song. Pick "document" for requests to send as file/document/uncompressed. Pick "video" for requests to send as video. Pick "retry" for requests to try again / re-do. Pick "unknown" when the message is clearly something else.',
                    },
                    {
                        role: "user",
                        content: message.slice(0, 500),
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

function tryParseActionJson(raw: string): IntentAction {
    try {
        const obj = JSON.parse(raw) as { action?: string };
        switch (obj.action) {
            case "audio":
            case "document":
            case "video":
            case "retry":
                return obj.action;
            default:
                return "unknown";
        }
    } catch {
        return "unknown";
    }
}
