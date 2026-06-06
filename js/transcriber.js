/* eslint-disable no-console */
/**
 * Transcriber — Interface com o Web Worker de transcrição.
 * Atualizado para Stack 2026: Pipeline WebGPU integrado e formatador Netflix.
 */

import { formatSubtitles } from './subtitle-formatter.js';

let worker = null;
let currentReject = null;

export class CohereTranscriber {
    constructor() {
        this.device = 'unknown';
    }

    abort() {
        if (worker) {
            worker.postMessage({ type: 'abort' });
        }
        if (currentReject) {
            currentReject(new Error('Processamento abortado.'));
            currentReject = null;
        }
    }

    async loadModel(modelSize = 'base', onProgress) {
        // Usa os novos modelos otimizados da comunidade para WebGPU v3
        const MODEL_MAP = {
            'tiny': 'onnx-community/whisper-tiny',
            'base': 'onnx-community/whisper-base',
            'small': 'onnx-community/whisper-small',
        };
        const modelId = MODEL_MAP[modelSize] || MODEL_MAP['base'];

        return new Promise((resolve, reject) => {
            currentReject = reject;
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
                    currentReject = null;
                    resolve(this.device);
                }
                if (type === 'error') {
                    worker.removeEventListener('message', handler);
                    currentReject = null;
                    reject(new Error(payload));
                }
            };

            worker.addEventListener('message', handler);
            worker.postMessage({ type: 'load', payload: { modelId } });
        });
    }

    async transcribe(audioData, language, onProgress) {
        return new Promise((resolve, reject) => {
            currentReject = reject;
            if (!worker) {
                currentReject = null;
                reject(new Error('Worker não inicializado.'));
                return;
            }

            const durationSecs = audioData.length / 16000;
            console.log(`[CohereTranscriber] Áudio: ${audioData.length} amostras (${durationSecs.toFixed(1)}s)`);


            const handler = (e) => {
                const { type, payload } = e.data;

                if (type === 'log') {
                    console.log(payload);
                }

                if (type === 'transcription-progress') {
                    if (onProgress) {
                        onProgress(payload.progress, null);
                    }
                }

                if (type === 'transcription-done') {
                    worker.removeEventListener('message', handler);
                    const words = payload.chunks || [];
                    if (words.length === 0 && payload.text) {
                         words.push({ text: payload.text, timestamp: [0, Math.min(durationSecs, 30)] });
                    }
                    const segments = formatSubtitles(words);
                    currentReject = null;
                    resolve({ text: payload.text, segments });
                }
                if (type === 'error') {
                    worker.removeEventListener('message', handler);
                    currentReject = null;
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


}

export function getAvailableModels() {
    return [
        { id: 'tiny', name: 'Tiny', size: '~75 MB', speed: 'Mais rápido', quality: 'Básica' },
        { id: 'base', name: 'Base', size: '~150 MB', speed: 'Equilibrado', quality: 'Boa' },
        { id: 'small', name: 'Small', size: '~500 MB', speed: 'Mais lento', quality: 'Alta' },
    ];
}
