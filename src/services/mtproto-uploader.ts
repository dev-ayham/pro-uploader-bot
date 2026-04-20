import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { CustomFile } from "telegram/client/uploads";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { Api } from "telegram";

export class MTProtoUploader {
    private client: TelegramClient;

    constructor(apiId: number, apiHash: string, botToken: string) {
        this.client = new TelegramClient(new StringSession(""), apiId, apiHash, {
            connectionRetries: 5,
        });
        this.client.start({
            botAuthToken: botToken,
        });
    }

    async uploadFromUrl(chatId: number | string, url: string, caption: string, progressCallback?: (progress: number) => void) {
        try {
            const filename = path.basename(new URL(url).pathname) || "file";
            const tempPath = path.join("/tmp", `${Date.now()}_${filename}`);

            // Download to temp file
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream'
            });

            const writer = fs.createWriteStream(tempPath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(true));
                writer.on('error', reject);
            });

            const stats = fs.statSync(tempPath);
            const fileSize = stats.size;

            // Upload using MTProto
            const toUpload = new CustomFile(filename, fileSize, tempPath);
            
            await this.client.sendFile(chatId, {
                file: toUpload,
                caption: caption,
                parseMode: "html",
                workers: 4,
                progressCallback: (progress) => {
                    if (progressCallback) progressCallback(progress);
                }
            });

            // Cleanup
            fs.unlinkSync(tempPath);
            return { success: true };
        } catch (error) {
            console.error("MTProto Upload Error:", error);
            return { success: false, error };
        }
    }
}
