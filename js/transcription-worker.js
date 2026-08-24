/* eslint-disable no-console */
/**
 * Web Worker para transcrição com Whisper via Transformers.js.
 * Atualizado para Stack 2026: Suporte a WebGPU para inferência hiper-rápida.
 */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.0';

// Configurações do ambiente
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);

// Força o navegador a utilizar a GPU dedicada (ex: RTX 4050) em vez da integrada
if (!env.backends.onnx.webgpu) {
    env.backends.onnx.webgpu = {};
}
env.backends.onnx.webgpu.powerPreference = 'high-performance';

let transcriber = null;
let isCancelled = false;

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'abort') {
        isCancelled = true;
        return;
    }

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
                    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8', // fp32 no encoder previne crashes nas placas, q4 voa no decoder
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
                        dtype: 'q8',
                        progress_callback: (data) => {
                            self.postMessage({ type: 'model-progress', payload: data });
                        },
                    }
                );
                self.postMessage({ type: 'model-loaded', payload: { device: 'wasm (fallback)' } });
            } catch (fallbackErr) {
                console.warn('[Worker] Falha no wasm para o modelo original. Tentando fallback para modelo Tiny...', fallbackErr);
                try {
                    const fallbackModel = 'onnx-community/whisper-tiny';
                    transcriber = await pipeline(
                        'automatic-speech-recognition',
                        fallbackModel,
                        {
                            device: 'wasm',
                            dtype: 'q8',
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
        isCancelled = false;
        if (!transcriber) {
            self.postMessage({ type: 'error', payload: 'Modelo não carregado.' });
            return;
        }
        try {
            const startTime = performance.now();
            self.postMessage({ type: 'log', payload: `[Worker] Iniciando transcrição de ${payload.audio.length} samples.` });

            const chunk_duration_s = 30;
            const sample_rate = 16000;
            const chunk_samples = chunk_duration_s * sample_rate;
            
            const total_samples = payload.audio.length;
            const all_chunks = [];
            let full_text = "";
            
            let current_start_sample = 0;
            let current_start_time = 0;
            
            while (current_start_sample < total_samples) {
                if (isCancelled) {
                    self.postMessage({ type: 'log', payload: '[Worker] Loop de transcrição abortado graciosamente.' });
                    return;
                }

                const end_sample = Math.min(current_start_sample + chunk_samples, total_samples);
                const chunk_audio = payload.audio.slice(current_start_sample, end_sample);
                
                const result = await transcriber(chunk_audio, {
                    language: payload.language || 'en',
                    task: 'transcribe',
                    return_timestamps: true, // Revertido para true pois 'word' exige output_attentions=True no modelo
                    temperature: [0.0, 0.2, 0.4],
                    no_speech_threshold: 0.4, // Mais sensível (reduzido de 0.6 para não perder falas baixas)
                    condition_on_previous_text: false 
                });

                // Limite seguro para aceitar palavras (1 segundo de margem do final do chunk para evitar palavras cortadas ao meio)
                const is_last_chunk = end_sample >= total_samples;
                const safe_end_time = is_last_chunk ? chunk_duration_s : chunk_duration_s - 1.0; 
                
                let max_accepted_time = 0;

                if (result.chunks && result.chunks.length > 0) {
                    for (const c of result.chunks) {
                        const t0 = c.timestamp[0];
                        const t1 = c.timestamp[1];

                        // Se a palavra termina depois da margem de segurança (e não é o último chunk), nós a ignoramos e deixamos pro próximo
                        if (t1 !== null && t1 > safe_end_time && !is_last_chunk) {
                            continue;
                        }

                        const seg_start = t0 !== null ? t0 + current_start_time : current_start_time;
                        const seg_end = t1 !== null ? t1 + current_start_time : (end_sample / sample_rate);
                        
                        all_chunks.push({ 
                            text: c.text, 
                            timestamp: [seg_start, seg_end] 
                        });
                        full_text += c.text;
                        
                        if (t1 !== null && t1 > max_accepted_time) {
                            max_accepted_time = t1;
                        }
                    }
                }
                
                // Se não aceitamos nenhuma palavra (ou silêncio total, ou todas passaram da margem), avançamos quase o chunk todo
                if (max_accepted_time === 0) {
                    max_accepted_time = chunk_duration_s - 2.0; 
                }

                if (is_last_chunk) {
                    break;
                }

                // O próximo chunk começa EXATAMENTE onde a última palavra aceita terminou!
                current_start_time += max_accepted_time;
                current_start_sample = Math.floor(current_start_time * sample_rate);
                
                // PROGRESSO ABSOLUTO REAL
                const progressPct = Math.min(current_start_sample / total_samples, 1.0);
                self.postMessage({ 
                    type: 'transcription-progress', 
                    payload: { progress: progressPct } 
                });
            }

            const endTime = performance.now();
            self.postMessage({ type: 'log', payload: `[Worker] Transcrição concluída em ${((endTime - startTime) / 1000).toFixed(2)}s` });
            self.postMessage({ 
                type: 'transcription-done', 
                payload: { text: full_text.trim(), chunks: all_chunks } 
            });
        } catch (err) {
            self.postMessage({ type: 'error', payload: err.message });
        }
    }
};
