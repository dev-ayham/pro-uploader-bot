import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { CustomFile } from "telegram/client/uploads";
import { HTMLParser } from "telegram/extensions/html";
import { generateRandomLong } from "telegram/Helpers";
import * as fs from "fs";
import * as path from "path";
import * as mime from "mime-types";
import {
    DownloadResult,
    downloadAudioWithYtDlp,
    downloadDirect,
    downloadWithYtDlp,
    shouldUseYtDlp,
    YtDlpOptions,
} from "./downloader";
import { resolveDataDir } from "./db";

const TEMP_DIR = "/tmp";

/**
 * Number of parallel upload workers used by GramJS's `uploadFile`. GramJS
 * splits the file into ~512 KB parts and uploads this many at once. The
 * library's default is 1; pushing it to 16 typically cuts wall-clock
 * upload time on Railway by 3-4x without observable throttling from
 * Telegram's MTProto DC. Override via the `MTPROTO_UPLOAD_WORKERS`
 * env var if you need to back off (e.g. on a very constrained network).
 */
const MTPROTO_UPLOAD_WORKERS = (() => {
    const raw = process.env.MTPROTO_UPLOAD_WORKERS;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 16;
})();

export interface UploadProgress {
    phase: "download" | "upload";
    fraction: number;
}

export interface UploadOptions {
    /** Force the file to be sent as a generic document (no video preview). */
    asDocument?: boolean;
    /** Send the media with Telegram's spoiler ("click to reveal") overlay. */
    spoiler?: boolean;
    /** String to prepend to the visible filename before the extension. */
    renamePrefix?: string;
    /** String to append to the visible filename before the extension. */
    renameSuffix?: string;
    /**
     * Cap the selected video stream height (e.g. 720 for "720p or lower").
     * Forwarded to yt-dlp's format selector. Ignored for direct-download
     * URLs (there's nothing to transcode on our side).
     */
    maxHeight?: number;
    /**
     * Absolute path to a JPEG (≤ 320x320, ≤ 200 KB) to use as the document /
     * video thumbnail. When unset the media is uploaded without a custom
     * thumb and Telegram generates one from the first frame.
     */
    thumbnailPath?: string;
    /**
     * Hook called after a successful upload but *before* the downloaded
     * file is deleted. Used by callers that want to do additional work on
     * the local file (e.g. extract screenshots, compute a hash) without
     * having to re-download. Throws are logged but don't fail the upload.
     */
    postUpload?: (filePath: string, filename: string) => Promise<void>;
}

/**
 * Apply optional prefix/suffix around the base name, keeping the extension
 * intact. `"my video.mp4"` with prefix `"[PRO] "` and suffix `" (final)"`
 * becomes `"[PRO] my video (final).mp4"`. Passes the original through when
 * both strings are empty.
 */
export function applyRename(
    original: string,
    prefix?: string,
    suffix?: string,
): string {
    if (!prefix && !suffix) return original;
    const dot = original.lastIndexOf(".");
    const hasExt = dot > 0 && dot < original.length - 1;
    const base = hasExt ? original.slice(0, dot) : original;
    const ext = hasExt ? original.slice(dot) : "";
    return `${prefix ?? ""}${base}${suffix ?? ""}${ext}`;
}

/**
 * Absolute path to the persisted GramJS session string. Lives on the
 * Railway volume (`/data/mtproto.session`) alongside the SQLite file so
 * the MTProto sign-in survives container restarts. Without persistence
 * every redeploy issues a fresh `auth.ImportBotAuthorization` and
 * Telegram rate-limits the bot token with a multi-minute flood-wait
 * after a handful of consecutive sign-ins.
 */
function sessionFilePath(): string {
    return path.join(resolveDataDir(), "mtproto.session");
}

function loadSessionString(): string {
    try {
        return fs.readFileSync(sessionFilePath(), "utf8").trim();
    } catch {
        return "";
    }
}

function saveSessionString(s: string): void {
    try {
        const file = sessionFilePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, s, { mode: 0o600 });
    } catch (err) {
        console.error("Failed to persist MTProto session:", err);
    }
}

export class MTProtoUploader {
    private client: TelegramClient;
    private readyPromise: Promise<void>;
    private ytDlpOptions: YtDlpOptions;

    constructor(
        apiId: number,
        apiHash: string,
        botToken: string,
        ytDlpOptions: YtDlpOptions = {},
    ) {
        // Rehydrate a previously-saved session so Railway redeploys do
        // not trigger a fresh auth.ImportBotAuthorization each time,
        // which Telegram throttles with a 4-5 minute flood-wait after
        // a few consecutive sign-ins.
        const storedSession = loadSessionString();
        this.client = new TelegramClient(
            new StringSession(storedSession),
            apiId,
            apiHash,
            { connectionRetries: 5 },
        );
        this.readyPromise = this.client
            .start({ botAuthToken: botToken })
            .then(() => {
                // Persist whatever session the client settled on. Safe to
                // call repeatedly — the string is idempotent once signed
                // in, so later invocations just overwrite with the same
                // bytes.
                try {
                    // GramJS types .save() as void but StringSession
                    // actually returns the serialised string — treat it
                    // as unknown and narrow at runtime.
                    const saved: unknown = (
                        this.client.session as unknown as {
                            save: () => unknown;
                        }
                    ).save();
                    if (typeof saved === "string" && saved.length > 0) {
                        saveSessionString(saved);
                    }
                } catch (err) {
                    console.error("Session save after start() failed:", err);
                }
            });
        // Attach a no-op catch so an early failure (bad token, network) does
        // not crash the process via Node's unhandled-rejection handler before
        // any caller has a chance to await and handle the error.
        this.readyPromise.catch(() => {});
        this.ytDlpOptions = ytDlpOptions;
    }

    async ready(): Promise<void> {
        await this.readyPromise;
    }

    async uploadFromUrl(
        chatId: number | string,
        url: string,
        caption: string,
        onProgress?: (progress: UploadProgress) => void,
        options: UploadOptions = {},
    ): Promise<void> {
        await this.readyPromise;

        // `downloaded` is set as soon as the download call returns *or* throws
        // partway through having written to /tmp. Keep it out of the try so
        // we can still clean up in the finally even if download itself fails.
        let downloaded: DownloadResult | undefined;
        try {
            if (shouldUseYtDlp(url)) {
                downloaded = await downloadWithYtDlp(
                    url,
                    TEMP_DIR,
                    (fraction) => {
                        onProgress?.({ phase: "download", fraction });
                    },
                    // Merge per-call overrides (max height) on top of the
                    // instance-wide cookies / user-agent / size-cap defaults.
                    { ...this.ytDlpOptions, maxHeight: options.maxHeight },
                );
            } else {
                // Plain direct URL (.mp4, .pdf, ...). yt-dlp's generic
                // extractor could also handle this but `axios` stream is
                // faster and avoids the subprocess overhead for the common
                // case.
                downloaded = await downloadDirect(url, TEMP_DIR, {
                    maxFileSizeMb: this.ytDlpOptions.maxFileSizeMb,
                });
                onProgress?.({ phase: "download", fraction: 1 });
            }

            const stats = fs.statSync(downloaded.filePath);
            // Apply the user's rename prefix/suffix to the *visible* filename
            // only. We never rename the file on disk — it's deleted in the
            // finally a few lines down.
            const visibleName = applyRename(
                downloaded.filename,
                options.renamePrefix,
                options.renameSuffix,
            );
            const toUpload = new CustomFile(
                visibleName,
                stats.size,
                downloaded.filePath,
            );

            if (options.spoiler) {
                // GramJS's high-level sendFile() does not expose the spoiler
                // flag, so we drop to raw API: upload the bytes, build an
                // InputMediaUploadedDocument with spoiler (+forceFile when
                // asDocument is also requested), then messages.SendMedia it.
                await this.sendWithSpoiler(
                    chatId,
                    toUpload,
                    visibleName,
                    caption,
                    options.asDocument === true,
                    onProgress,
                    options.thumbnailPath,
                );
            } else {
                await this.client.sendFile(chatId, {
                    file: toUpload,
                    caption,
                    parseMode: "html",
                    forceDocument: options.asDocument === true,
                    thumb: options.thumbnailPath,
                    workers: MTPROTO_UPLOAD_WORKERS,
                    progressCallback: (progress) => {
                        onProgress?.({ phase: "upload", fraction: progress });
                    },
                });
            }

            if (options.postUpload) {
                try {
                    await options.postUpload(
                        downloaded.filePath,
                        downloaded.filename,
                    );
                } catch (err) {
                    // Never let a post-upload side-effect (screenshots, etc.)
                    // fail the primary operation the user asked for.
                    console.error("postUpload hook threw:", err);
                }
            }
        } finally {
            if (downloaded) {
                try {
                    fs.unlinkSync(downloaded.filePath);
                } catch {
                    // best-effort cleanup
                }
            }
        }
    }

    /**
     * Download audio only from a URL via yt-dlp (`-x --audio-format mp3`)
     * and send it as a Telegram audio message (native audio player, not a
     * generic document). Intended for AI intents of the form "give me the
     * audio" / "بدي ياه صوت" where the user has already received the full
     * video and now wants just the soundtrack.
     */
    async uploadAudioFromUrl(
        chatId: number | string,
        url: string,
        caption: string,
        onProgress?: (progress: UploadProgress) => void,
        options: Pick<UploadOptions, "renamePrefix" | "renameSuffix"> = {},
    ): Promise<void> {
        await this.readyPromise;

        let downloaded: DownloadResult | undefined;
        try {
            downloaded = await downloadAudioWithYtDlp(
                url,
                TEMP_DIR,
                (fraction) => {
                    onProgress?.({ phase: "download", fraction });
                },
                this.ytDlpOptions,
            );

            const stats = fs.statSync(downloaded.filePath);
            const visibleName = applyRename(
                downloaded.filename,
                options.renamePrefix,
                options.renameSuffix,
            );
            const toUpload = new CustomFile(
                visibleName,
                stats.size,
                downloaded.filePath,
            );

            // Native Telegram audio message: mime=audio/mpeg + the Audio
            // attribute so Telegram renders the inline player rather than a
            // generic document tile.
            await this.client.sendFile(chatId, {
                file: toUpload,
                caption,
                parseMode: "html",
                forceDocument: false,
                voiceNote: false,
                attributes: [
                    new Api.DocumentAttributeAudio({
                        duration: 0,
                        voice: false,
                        title: visibleName.replace(/\.mp3$/i, ""),
                    }),
                ],
                workers: MTPROTO_UPLOAD_WORKERS,
                progressCallback: (progress) => {
                    onProgress?.({ phase: "upload", fraction: progress });
                },
            });
        } finally {
            if (downloaded) {
                try {
                    fs.unlinkSync(downloaded.filePath);
                } catch {
                    // best-effort cleanup
                }
            }
        }
    }

    private async sendWithSpoiler(
        chatId: number | string,
        file: CustomFile,
        filename: string,
        captionHtml: string,
        forceFile: boolean,
        onProgress?: (progress: UploadProgress) => void,
        thumbnailPath?: string,
    ): Promise<void> {
        const mimeType =
            (mime.lookup(filename) as string) || "application/octet-stream";

        const uploadedFile = await this.client.uploadFile({
            file,
            workers: MTPROTO_UPLOAD_WORKERS,
            onProgress: (progress) => {
                // GramJS's raw uploadFile reports progress as a BigInteger-ish
                // fraction in [0,1].
                const fraction =
                    typeof progress === "number" ? progress : Number(progress);
                onProgress?.({ phase: "upload", fraction });
            },
        });

        // Custom thumbnail (if any) is uploaded as a separate InputFile so we
        // can attach it to the InputMediaUploadedDocument below. Failures
        // here degrade gracefully to "no thumb" so the main upload is not
        // sabotaged by a bad thumbnail.
        let uploadedThumb: Api.TypeInputFile | undefined;
        if (thumbnailPath) {
            try {
                const thumbStats = fs.statSync(thumbnailPath);
                const thumbFile = new CustomFile(
                    "thumb.jpg",
                    thumbStats.size,
                    thumbnailPath,
                );
                uploadedThumb = await this.client.uploadFile({
                    file: thumbFile,
                    workers: 1,
                });
            } catch (err) {
                console.error("thumbnail upload failed, continuing without:", err);
            }
        }

        const attributes: Api.TypeDocumentAttribute[] = [
            new Api.DocumentAttributeFilename({ fileName: filename }),
        ];
        if (!forceFile && mimeType.startsWith("video/")) {
            // Keep video playable inside Telegram. Real dimensions / duration
            // would require probing with ffprobe; 0s are accepted and the
            // client computes them on demand.
            attributes.push(
                new Api.DocumentAttributeVideo({
                    duration: 0,
                    w: 0,
                    h: 0,
                    supportsStreaming: true,
                }),
            );
        }

        const media = new Api.InputMediaUploadedDocument({
            file: uploadedFile,
            thumb: uploadedThumb,
            mimeType,
            attributes,
            spoiler: true,
            forceFile,
        });

        // HTML entities must be pre-parsed because messages.SendMedia doesn't
        // take a parseMode of its own.
        const [parsedText, entities] = HTMLParser.parse(captionHtml);

        const peer = await this.client.getInputEntity(chatId);
        await this.client.invoke(
            new Api.messages.SendMedia({
                peer,
                media,
                message: parsedText,
                entities,
                randomId: generateRandomLong(),
            }),
        );
    }
}
