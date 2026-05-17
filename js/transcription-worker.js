/**
 * Web Worker para transcrição com Whisper via Transformers.js.
 * Atualizado para Stack 2026: Suporte a WebGPU para inferência hiper-rápida.
 */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// Configurações do ambiente
env.allowLocalModels = false;

let transcriber = null;

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'load') {
        try {
            // Verifica suporte a WebGPU
            const hasWebGPU = navigator.gpu !== undefined;
            const device = hasWebGPU ? 'webgpu' : 'wasm';
            console.log(`[Worker] Inicializando modelo ${payload.modelId} usando device: ${device}`);

            transcriber = await pipeline(
                'automatic-speech-recognition',
                payload.modelId,
                {
                    device: device,
                    progress_callback: (data) => {
                        self.postMessage({ type: 'model-progress', payload: data });
                    },
                }
            );
            self.postMessage({ type: 'model-loaded', payload: { device } });
        } catch (err) {
            console.error('[Worker] Erro ao carregar modelo:', err);
            // Fallback para wasm se falhar ao tentar webgpu
            try {
                 transcriber = await pipeline(
                    'automatic-speech-recognition',
                    payload.modelId,
                    {
                        device: 'wasm',
                        progress_callback: (data) => {
                            self.postMessage({ type: 'model-progress', payload: data });
                        },
                    }
                );
                self.postMessage({ type: 'model-loaded', payload: { device: 'wasm (fallback)' } });
            } catch (fallbackErr) {
                console.warn('[Worker] Falha no wasm para o modelo original. Tentando fallback para modelo Tiny...', fallbackErr);
                try {
                    const fallbackModel = 'Xenova/whisper-tiny';
                    transcriber = await pipeline(
                        'automatic-speech-recognition',
                        fallbackModel,
                        {
                            device: 'wasm',
                            progress_callback: (data) => {
                                self.postMessage({ type: 'model-progress', payload: data });
                            },
                        }
                    );
                    self.postMessage({ type: 'model-loaded', payload: { device: 'wasm (fallback tiny)' } });
                } catch (tinyErr) {
                    self.postMessage({ type: 'error', payload: 'Falha fatal: Não foi possível carregar nenhum modelo. ' + tinyErr.message });
                }
            }
        }
    }

    if (type === 'transcribe') {
        if (!transcriber) {
            self.postMessage({ type: 'error', payload: 'Modelo não carregado.' });
            return;
        }
        try {
            const result = await transcriber(payload.audio, {
                language: payload.language || 'en',
                task: 'transcribe',
                chunk_length_s: 15,
                stride_length_s: 3,
                return_timestamps: true, // sentence-level
                temperature: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0], // fallback parameters to reduce hallucinations
                no_speech_threshold: 0.6,
                condition_on_previous_text: false, // Prevents hallucination loops on noisy audio/music
            });
            self.postMessage({ type: 'transcription-done', payload: result });
        } catch (err) {
            self.postMessage({ type: 'error', payload: err.message });
        }
    }
};
