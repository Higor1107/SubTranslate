/**
 * Transcriber — Interface com o Web Worker de transcrição.
 * Atualizado para Stack 2026: Pipeline WebGPU integrado.
 */

let worker = null;

export class CohereTranscriber {
    constructor() {
        this.device = 'unknown';
    }

    async loadModel(modelSize = 'base', onProgress) {
        // Usa os modelos oficiais mantidos pela comunidade que suportam WebGPU
        const MODEL_MAP = {
            'tiny': 'Xenova/whisper-tiny',
            'base': 'Xenova/whisper-base',
            'small': 'Xenova/whisper-small',
        };
        const modelId = MODEL_MAP[modelSize] || MODEL_MAP['base'];

        return new Promise((resolve, reject) => {
            if (!worker) {
                worker = new Worker('js/transcription-worker.js', { type: 'module' });
            }

            const handler = (e) => {
                const { type, payload } = e.data;

                if (type === 'model-progress' && onProgress) {
                    if (payload.status === 'progress') {
                        onProgress({
                            status: 'downloading',
                            file: payload.file || '',
                            progress: payload.progress || 0,
                        });
                    }
                    if (payload.status === 'ready') {
                        onProgress({ status: 'ready', progress: 100 });
                    }
                }
                if (type === 'model-loaded') {
                    this.device = payload.device;
                    console.log(`[CohereTranscriber] Modelo carregado via ${this.device}`);
                    worker.removeEventListener('message', handler);
                    resolve(this.device);
                }
                if (type === 'error') {
                    worker.removeEventListener('message', handler);
                    reject(new Error(payload));
                }
            };

            worker.addEventListener('message', handler);
            worker.postMessage({ type: 'load', payload: { modelId } });
        });
    }

    async transcribe(audioData, language, onProgress) {
        return new Promise((resolve, reject) => {
            if (!worker) {
                reject(new Error('Worker não inicializado.'));
                return;
            }

            const durationSecs = audioData.length / 16000;
            console.log(`[CohereTranscriber] Áudio: ${audioData.length} amostras (${durationSecs.toFixed(1)}s)`);

            const handler = (e) => {
                const { type, payload } = e.data;

                if (type === 'transcription-done') {
                    worker.removeEventListener('message', handler);
                    const segments = this.buildSegments(payload, durationSecs);
                    resolve({ text: payload.text, segments });
                }
                if (type === 'error') {
                    worker.removeEventListener('message', handler);
                    reject(new Error(payload));
                }
            };

            worker.addEventListener('message', handler);

            const copy = new Float32Array(audioData);
            worker.postMessage(
                { type: 'transcribe', payload: { audio: copy, language } },
                [copy.buffer]
            );
        });
    }

    // ─── Lógica de Segmentação (Herança da v1) ────────────────────────────────

    buildSegments(result, audioDuration) {
        const MAX_CHARS = 50;              
        const MIN_DURATION = 0.5;          
        const CHARS_PER_SEC = 15;          

        if (!result?.chunks?.length) {
            if (result?.text?.trim()) {
                return [{ index: 1, start: 0, end: Math.min(audioDuration, 30), text: result.text.trim() }];
            }
            return [];
        }

        const rawSegs = [];
        for (const chunk of result.chunks) {
            const text = (chunk.text || '').trim();
            if (!text) continue;

            const ts = chunk.timestamp;
            let start;
            let end;

            if (ts && Array.isArray(ts)) {
                start = (ts[0] !== null) ? Number(ts[0]) : 0;
                end = (ts[1] !== null) ? Number(ts[1]) : null;

                if (end === null || isNaN(end) || end <= start) {
                    end = start + Math.max(text.length / CHARS_PER_SEC, MIN_DURATION);
                    end = Math.min(end, audioDuration);
                }
            } else {
                start = rawSegs.length > 0 ? rawSegs[rawSegs.length - 1].end + 0.1 : 0;
                end = start + Math.max(text.length / CHARS_PER_SEC, MIN_DURATION);
            }

            if (isNaN(start)) start = 0;
            if (isNaN(end) || end <= start) end = start + 1;

            rawSegs.push({ start, end, text });
        }

        const segments = [];
        for (const seg of rawSegs) {
            if (seg.text.length <= MAX_CHARS) {
                segments.push({
                    index: segments.length + 1,
                    start: +seg.start.toFixed(3),
                    end: +seg.end.toFixed(3),
                    text: seg.text,
                });
            } else {
                const parts = this.splitSentence(seg.text, MAX_CHARS);
                this.spreadTiming(parts, seg.start, seg.end, segments, MIN_DURATION);
            }
        }
        return segments;
    }

    splitSentence(text, maxChars) {
        const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
        const result = [];
        for (const part of parts) {
            if (part.length > maxChars) {
                const subParts = part.split(/(?<=,)\s+/).filter(Boolean);
                for (const sub of subParts) {
                    if (sub.length > maxChars) {
                        result.push(...this.splitByWords(sub, maxChars));
                    } else {
                        result.push(sub.trim());
                    }
                }
            } else {
                result.push(part.trim());
            }
        }
        return result.filter(Boolean);
    }

    splitByWords(text, maxChars) {
        const words = text.split(/\s+/);
        const parts = [];
        let current = '';
        for (const word of words) {
            const test = current ? `${current} ${word}` : word;
            if (test.length > maxChars && current) {
                parts.push(current);
                current = word;
            } else {
                current = test;
            }
        }
        if (current) parts.push(current);
        return parts;
    }

    spreadTiming(parts, totalStart, totalEnd, segments, minDuration) {
        if (parts.length === 0) return;
        const totalChars = parts.reduce((s, p) => s + p.length, 0);
        const totalDuration = totalEnd - totalStart;
        let cursor = totalStart;

        for (const part of parts) {
            const ratio = part.length / totalChars;
            const duration = Math.max(totalDuration * ratio, minDuration);
            const end = Math.min(cursor + duration, totalEnd);

            segments.push({
                index: segments.length + 1,
                start: +cursor.toFixed(3),
                end: +end.toFixed(3),
                text: part,
            });
            cursor = end;
        }
    }
}

export function getAvailableModels() {
    return [
        { id: 'tiny', name: 'Tiny', size: '~75 MB', speed: 'Mais rápido', quality: 'Básica' },
        { id: 'base', name: 'Base', size: '~150 MB', speed: 'Equilibrado', quality: 'Boa' },
        { id: 'small', name: 'Small', size: '~500 MB', speed: 'Mais lento', quality: 'Alta' },
    ];
}
