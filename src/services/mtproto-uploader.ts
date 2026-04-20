import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { CustomFile } from "telegram/client/uploads";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";

export class MTProtoUploader {
    private client: TelegramClient;
    private readyPromise: Promise<void>;

    constructor(apiId: number, apiHash: string, botToken: string) {
        this.client = new TelegramClient(new StringSession(""), apiId, apiHash, {
            connectionRetries: 5,
        });
        this.readyPromise = this.client
            .start({ botAuthToken: botToken })
            .then(() => undefined);
    }

    async ready(): Promise<void> {
        await this.readyPromise;
    }

    async uploadFromUrl(
        chatId: number | string,
        url: string,
        caption: string,
        progressCallback?: (progress: number) => void,
    ): Promise<void> {
        await this.readyPromise;

        const filename = path.basename(new URL(url).pathname) || "file";
        const tempPath = path.join("/tmp", `${Date.now()}_${filename}`);

        try {
            const response = await axios({
                url,
                method: "GET",
                responseType: "stream",
            });

            const writer = fs.createWriteStream(tempPath);
            response.data.pipe(writer);

            await new Promise<void>((resolve, reject) => {
                writer.on("finish", () => resolve());
                writer.on("error", reject);
            });

            const stats = fs.statSync(tempPath);
            const toUpload = new CustomFile(filename, stats.size, tempPath);

            await this.client.sendFile(chatId, {
                file: toUpload,
                caption,
                parseMode: "html",
                workers: 4,
                progressCallback: (progress) => {
                    if (progressCallback) progressCallback(progress);
                },
            });
        } finally {
            try {
                fs.unlinkSync(tempPath);
            } catch {
                // best-effort cleanup
            }
        }
    }
}
