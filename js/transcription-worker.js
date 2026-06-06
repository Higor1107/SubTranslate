/**
 * Web Worker para transcrição com Whisper via Transformers.js.
 * /* eslint-disable no-console */
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
        if (!transcriber) {
            self.postMessage({ type: 'error', payload: 'Modelo não carregado.' });
            return;
        }
        try {
            const startTime = performance.now();
            self.postMessage({ type: 'log', payload: `[Worker] Iniciando transcrição de ${payload.audio.length} samples.` });

            const chunk_duration_s = 30;
            const step_s = 28; // Avança 28s por vez (Gera 2s de sobreposição para não cortar palavras ao meio!)
            const sample_rate = 16000;
            const chunk_samples = chunk_duration_s * sample_rate;
            const step_samples = step_s * sample_rate;
            
            const total_chunks = Math.ceil(payload.audio.length / step_samples);
            
            const all_chunks = [];
            let full_text = "";
            
            for (let i = 0; i < total_chunks; i++) {
                const start_sample = i * step_samples;
                const end_sample = Math.min(start_sample + chunk_samples, payload.audio.length);
                const chunk_audio = payload.audio.slice(start_sample, end_sample);
                const start_time = start_sample / sample_rate;
                
                // Executa a IA na fatia com sobreposição
                const result = await transcriber(chunk_audio, {
                    language: payload.language || 'en',
                    task: 'transcribe',
                    return_timestamps: true,
                    temperature: [0.0, 0.2, 0.4], // Menos margem para alucinações
                    no_speech_threshold: 0.6, // Mais sensível para rejeitar música e ruído
                    condition_on_previous_text: false 
                });

                // Mapeia os chunks corrigindo o timestamp global e aplicando o Stride Stitching
                if (result.chunks && result.chunks.length > 0) {
                    for (const c of result.chunks) {
                        const t0 = c.timestamp[0];
                        const t1 = c.timestamp[1];

                        // Stride Stitching: Se a palavra começa na área de sobreposição (> 28s), 
                        // nós a descartamos aqui, pois o próximo chunk vai pegá-la no segundo 0 perfeitamente!
                        if (t0 !== null && t0 >= step_s && i < total_chunks - 1) {
                            continue;
                        }

                        const seg_start = t0 !== null ? t0 + start_time : start_time;
                        const seg_end = t1 !== null ? t1 + start_time : (end_sample / sample_rate);
                        
                        all_chunks.push({ 
                            text: c.text, 
                            timestamp: [seg_start, seg_end] 
                        });
                        full_text += c.text + " ";
                    }
                }
                
                // PROGRESSO ABSOLUTO REAL
                const progressPct = (i + 1) / total_chunks;
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
