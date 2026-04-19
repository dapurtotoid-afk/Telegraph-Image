import { errorHandling, telemetryData } from "./utils/middleware";

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const clonedRequest = request.clone();
        const formData = await clonedRequest.formData();

        await errorHandling(context);
        telemetryData(context);

        const uploadFile = formData.get('file');
        if (!uploadFile) {
            throw new Error('No file uploaded');
        }

        const fileName = uploadFile.name;
        const fileExtension = fileName.split('.').pop().toLowerCase();

        // List of supported image formats
        const supportedImageFormats = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'heif', 'apng', 'avif', 'jfif', 'pjpeg', 'pjp'];
        
        const isImage = uploadFile.type.startsWith('image/') || supportedImageFormats.includes(fileExtension);
        
        if (!isImage) {
            throw new Error(`Format ${fileExtension} tidak didukung`);
        }

        const telegramFormData = new FormData();
        telegramFormData.append("chat_id", env.TG_Chat_ID);

        let apiEndpoint = 'sendDocument';
        let fileKey = 'document';
        
        // Untuk webp, lebih baik pakai sendSticker karena lebih ringan dan didukung penuh
        if (fileExtension === 'webp') {
            apiEndpoint = 'sendSticker';
            fileKey = 'sticker';
        }
        
        telegramFormData.append(fileKey, uploadFile);

        const result = await sendToTelegram(telegramFormData, apiEndpoint, env);

        if (!result.success) {
            // Jika sendSticker gagal untuk webp, coba fallback ke sendDocument
            if (fileExtension === 'webp' && apiEndpoint === 'sendSticker') {
                console.log('sendSticker gagal, mencoba sendDocument untuk webp');
                const fallbackFormData = new FormData();
                fallbackFormData.append("chat_id", env.TG_Chat_ID);
                fallbackFormData.append("document", uploadFile);
                const fallbackResult = await sendToTelegram(fallbackFormData, 'sendDocument', env);
                if (fallbackResult.success) {
                    const fileId = getFileId(fallbackResult.data);
                    if (fileId) {
                        await saveToKV(env, fileId, fileExtension, fileName, uploadFile.size);
                        return new Response(
                            JSON.stringify([{ 'src': `/file/${fileId}.${fileExtension}` }]),
                            { status: 200, headers: { 'Content-Type': 'application/json' } }
                        );
                    }
                }
                throw new Error(result.error);
            }
            throw new Error(result.error);
        }

        const fileId = getFileId(result.data);

        if (!fileId) {
            throw new Error('Failed to get file ID');
        }

        await saveToKV(env, fileId, fileExtension, fileName, uploadFile.size);

        return new Response(
            JSON.stringify([{ 'src': `/file/${fileId}.${fileExtension}` }]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('Upload error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

async function saveToKV(env, fileId, fileExtension, fileName, fileSize) {
    if (env.img_url) {
        await env.img_url.put(`${fileId}.${fileExtension}`, "", {
            metadata: {
                TimeStamp: Date.now(),
                ListType: "None",
                Label: "None",
                liked: false,
                fileName: fileName,
                fileSize: fileSize,
            }
        });
    }
}

function getFileId(response) {
    if (!response.ok || !response.result) return null;

    const result = response.result;
    if (result.photo) {
        return result.photo.reduce((prev, current) =>
            (prev.file_size > current.file_size) ? prev : current
        ).file_id;
    }
    if (result.document) return result.document.file_id;
    if (result.sticker) return result.sticker.file_id; // tambahkan untuk sticker
    if (result.video) return result.video.file_id;
    if (result.audio) return result.audio.file_id;

    return null;
}

async function sendToTelegram(formData, apiEndpoint, env, retryCount = 0) {
    const MAX_RETRIES = 2;
    const apiUrl = `https://api.telegram.org/bot${env.TG_Bot_Token}/${apiEndpoint}`;

    try {
        const response = await fetch(apiUrl, { method: "POST", body: formData });
        const responseData = await response.json();

        if (response.ok) {
            return { success: true, data: responseData };
        }

        // Log error detail untuk debugging
        console.error('Telegram API error:', responseData);
        return {
            success: false,
            error: responseData.description || 'Upload to Telegram failed'
        };
    } catch (error) {
        console.error('Network error:', error);
        if (retryCount < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            return await sendToTelegram(formData, apiEndpoint, env, retryCount + 1);
        }
        return { success: false, error: 'Network error occurred' };
    }
}
