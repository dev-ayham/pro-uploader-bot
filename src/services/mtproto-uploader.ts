import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { CustomFile } from "telegram/client/uploads";
import { HTMLParser } from "telegram/extensions/html";
import { generateRandomLong } from "telegram/Helpers";
import * as fs from "fs";
import * as mime from "mime-types";
import {
    DownloadResult,
    downloadDirect,
    downloadWithYtDlp,
    shouldUseYtDlp,
    YtDlpOptions,
} from "./downloader";

const TEMP_DIR = "/tmp";

export interface UploadProgress {
    phase: "download" | "upload";
    fraction: number;
}

export interface UploadOptions {
    /** Force the file to be sent as a generic document (no video preview). */
    asDocument?: boolean;
    /** Send the media with Telegram's spoiler ("click to reveal") overlay. */
    spoiler?: boolean;
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
        this.client = new TelegramClient(new StringSession(""), apiId, apiHash, {
            connectionRetries: 5,
        });
        this.readyPromise = this.client
            .start({ botAuthToken: botToken })
            .then(() => undefined);
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
                    this.ytDlpOptions,
                );
            } else {
                // Plain direct URL (.mp4, .pdf, ...). yt-dlp's generic
                // extractor could also handle this but `axios` stream is
                // faster and avoids the subprocess overhead for the common
                // case.
                downloaded = await downloadDirect(url, TEMP_DIR);
                onProgress?.({ phase: "download", fraction: 1 });
            }

            const stats = fs.statSync(downloaded.filePath);
            const toUpload = new CustomFile(
                downloaded.filename,
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
                    downloaded.filename,
                    caption,
                    options.asDocument === true,
                    onProgress,
                );
            } else {
                await this.client.sendFile(chatId, {
                    file: toUpload,
                    caption,
                    parseMode: "html",
                    forceDocument: options.asDocument === true,
                    workers: 4,
                    progressCallback: (progress) => {
                        onProgress?.({ phase: "upload", fraction: progress });
                    },
                });
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

    private async sendWithSpoiler(
        chatId: number | string,
        file: CustomFile,
        filename: string,
        captionHtml: string,
        forceFile: boolean,
        onProgress?: (progress: UploadProgress) => void,
    ): Promise<void> {
        const mimeType =
            (mime.lookup(filename) as string) || "application/octet-stream";

        const uploadedFile = await this.client.uploadFile({
            file,
            workers: 4,
            onProgress: (progress) => {
                // GramJS's raw uploadFile reports progress as a BigInteger-ish
                // fraction in [0,1].
                const fraction =
                    typeof progress === "number" ? progress : Number(progress);
                onProgress?.({ phase: "upload", fraction });
            },
        });

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
