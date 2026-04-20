import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { CustomFile } from "telegram/client/uploads";
import * as fs from "fs";
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

            await this.client.sendFile(chatId, {
                file: toUpload,
                caption,
                parseMode: "html",
                workers: 4,
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
}
