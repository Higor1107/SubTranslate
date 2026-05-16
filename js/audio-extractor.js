/**
 * AudioExtractor — Extração de áudio usando Web Audio API (nativo do navegador).
 * Usa FileReader para leitura não-bloqueante e retorna dados direto sem cópia.
 */

function readFileNonBlocking(file, onProgress) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (e) => {
            if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Erro ao ler o arquivo de vídeo.'));
        reader.readAsArrayBuffer(file);
    });
}

function yieldToUI() {
    return new Promise((r) => setTimeout(r, 50));
}

/**
 * Extrai áudio de um arquivo de vídeo como Float32Array 16kHz mono.
 * @param {File} videoFile - Arquivo de vídeo.
 * @param {Function} onProgress - Callback(0-1).
 * @returns {Float32Array} Amostras de áudio 16kHz mono.
 */
export async function extractAudio(videoFile, onProgress) {
    if (onProgress) onProgress(0.05);

    // Lê arquivo sem bloquear a UI
    const arrayBuffer = await readFileNonBlocking(videoFile, (p) => {
        if (onProgress) onProgress(0.05 + p * 0.35);
    });

    if (onProgress) onProgress(0.4);
    await yieldToUI();

    // Decodifica áudio nativamente
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
    });

    let audioBuffer;
    try {
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } catch (err) {
        audioContext.close();
        throw new Error(
            'Não foi possível decodificar o áudio. ' +
            'Formatos suportados: MP4, WebM, OGG, WAV, MP3. ' +
            'Se seu arquivo é MKV ou AVI, converta para MP4 primeiro.'
        );
    }

    if (onProgress) onProgress(0.9);

    // Retorna canal mono DIRETO — sem copiar (economiza centenas de MB de RAM)
    const channelData = audioBuffer.getChannelData(0);
    audioContext.close();

    if (onProgress) onProgress(1.0);
    console.log(`[AudioExtractor] ${channelData.length} amostras (${(channelData.length / 16000).toFixed(1)}s)`);
    return channelData;
}
