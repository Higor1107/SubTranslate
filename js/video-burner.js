/**
 * Video Burner — Embutir legendas no vídeo usando WebCodecs + mp4-muxer.
 *
 * Estratégia: Frame-by-frame seeking (não é real-time, é mais rápido e confiável).
 *
 * Pipeline:
 * 1. Carrega vídeo em <video> para extração de frames
 * 2. Extrai áudio com AudioContext.decodeAudioData()
 * 3. Para cada frame: seek → drawImage + legenda no Canvas → VideoFrame → VideoEncoder
 * 4. Áudio: AudioBuffer → AudioData (planar f32) → AudioEncoder (AAC)
 * 5. mp4-muxer combina as tracks em MP4 final (H.264 + AAC)
 *
 * Resultado: MP4 com H.264 Baseline — compatível com qualquer celular/player.
 */

import { Muxer, ArrayBufferTarget } from 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm';

// ─── Configuração Visual das Legendas ───────────────────────

const SUB_STYLE = {
    fontFamily: 'Inter, Arial, sans-serif',
    fontWeight: '700',
    sizeRatio: 0.045,       // 4.5% da altura do vídeo
    minSize: 20,
    maxSize: 52,
    color: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 5,        // Mais grosso para legibilidade sem fundo
    marginBottom: 0.06,
    maxWidthRatio: 0.88,
    lineSpacing: 1.4,
};

// ─── Ponto de Entrada Principal ─────────────────────────────

/**
 * Grava o vídeo com legendas embutidas permanentemente.
 *
 * @param {string}   videoURL   – blob URL do vídeo original
 * @param {Array}    segments   – [{ start: number, end: number, text: string }]
 * @param {Function} onProgress – callback({ percent: 0-1, label: string })
 * @returns {Promise<{ blob: Blob, format: string }>}
 */
export async function burnSubtitles(videoURL, segments, onProgress) {
    const report = (pct, label) => onProgress?.({ percent: pct, label, phase: 'burn' });

    // ── 0. Verificação de suporte ───────────────────────────
    if (!('VideoEncoder' in window)) {
        throw new Error('WebCodecs não suportado. Use Chrome 94+ ou Edge 94+.');
    }

    report(0, 'Carregando vídeo...');

    // ── 1. Carregar vídeo para extração de frames ───────────
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.muted = true;
    video.preload = 'auto';
    video.src = videoURL;

    await waitFor(video, 'loadedmetadata');
    // Espera ter dados suficientes
    if (video.readyState < 2) {
        await waitFor(video, 'canplay');
    }

    // H.264 exige dimensões pares — arredondar para baixo
    const W = video.videoWidth & ~1;
    const H = video.videoHeight & ~1;
    const duration = video.duration;
    const fps = 30;
    const totalFrames = Math.ceil(duration * fps);

    console.log(`[Burner] Vídeo: ${W}×${H}, ${duration.toFixed(1)}s, ${totalFrames} frames`);

    // ── 2. Extrair áudio ────────────────────────────────────
    report(0.02, 'Extraindo áudio...');
    const audioBuffer = await extractAudio(videoURL);
    const hasAudio = audioBuffer !== null;
    console.log(`[Burner] Áudio: ${hasAudio ? `${audioBuffer.numberOfChannels}ch, ${audioBuffer.sampleRate}Hz` : 'nenhum'}`);

    // ── 3. Criar Canvas de renderização ─────────────────────
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // ── 4. Validar suporte do codec de vídeo ────────────────
    report(0.04, 'Verificando codificadores...');
    const videoBitrate = calcBitrate(W, H);
    const codecString = getCodecString(W, H);

    console.log(`[Burner] Codec: ${codecString}, Bitrate: ${(videoBitrate / 1e6).toFixed(1)} Mbps`);

    const videoConfig = {
        codec: codecString,
        width: W,
        height: H,
        bitrate: videoBitrate,
        framerate: fps,
        avc: { format: 'avc' },
    };

    const videoSupport = await VideoEncoder.isConfigSupported(videoConfig);
    if (!videoSupport.supported) {
        throw new Error(`H.264 não suportado para ${W}×${H}. Tente reduzir a resolução do vídeo.`);
    }

    // ── 5. Configurar mp4-muxer ─────────────────────────────
    const target = new ArrayBufferTarget();
    const muxerConfig = {
        target,
        video: { codec: 'avc', width: W, height: H },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
    };

    if (hasAudio) {
        muxerConfig.audio = {
            codec: 'aac',
            numberOfChannels: audioBuffer.numberOfChannels,
            sampleRate: audioBuffer.sampleRate,
        };
    }

    const muxer = new Muxer(muxerConfig);

    // ── 6. Configurar VideoEncoder (com error tracking) ─────
    let fatalError = null;

    const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => {
            try { muxer.addVideoChunk(chunk, meta); }
            catch (e) { fatalError = e; }
        },
        error: (e) => {
            console.error('[VideoEncoder ERRO]', e);
            fatalError = e;
        },
    });

    videoEncoder.configure(videoSupport.config);

    // Aguardar um tick para erros assíncronos de configuração
    await yieldToUI();
    if (fatalError) {
        throw new Error(`Encoder de vídeo falhou: ${fatalError.message}`);
    }
    if (videoEncoder.state === 'closed') {
        throw new Error('Encoder de vídeo fechou durante configuração. Tente recarregar a página.');
    }

    // ── 7. Configurar AudioEncoder ──────────────────────────
    let audioEncoder = null;

    if (hasAudio) {
        audioEncoder = new AudioEncoder({
            output: (chunk, meta) => {
                try { muxer.addAudioChunk(chunk, meta); }
                catch (e) { fatalError = e; }
            },
            error: (e) => {
                console.error('[AudioEncoder ERRO]', e);
                fatalError = e;
            },
        });

        const audioConfig = {
            codec: 'mp4a.40.2', // AAC-LC
            numberOfChannels: audioBuffer.numberOfChannels,
            sampleRate: audioBuffer.sampleRate,
            bitrate: 128_000,
        };

        const audioSupport = await AudioEncoder.isConfigSupported(audioConfig);
        if (!audioSupport.supported) {
            console.warn('[Burner] AAC não suportado, vídeo será gerado sem áudio');
            audioEncoder = null;
        } else {
            audioEncoder.configure(audioSupport.config);
        }
    }

    // ── 8. Codificar áudio (rápido, faz primeiro) ───────────
    if (audioEncoder) {
        report(0.06, 'Codificando áudio AAC...');
        encodeFullAudio(audioEncoder, audioBuffer);
        await audioEncoder.flush();
        console.log('[Burner] Áudio codificado');
    }

    if (fatalError) throw new Error(`Erro na codificação de áudio: ${fatalError.message}`);

    // ── 9. Processar frames de vídeo ────────────────────────
    report(0.10, 'Processando frames de vídeo...');

    const keyframeInterval = 60; // Keyframe a cada ~2s (30fps × 2)

    if ('requestVideoFrameCallback' in video) {
        // RÁPIDO: playback acelerado + captura sequencial
        await captureViaPlayback(video, canvas, ctx, segments, videoEncoder, keyframeInterval, duration, fatalError, report);
    } else {
        // FALLBACK: seeking frame-a-frame (mais lento)
        await captureViaSeeking(video, canvas, ctx, segments, videoEncoder, keyframeInterval, fps, totalFrames, duration, fatalError, report);
    }

    // ── 10. Finalizar ───────────────────────────────────────
    report(0.96, 'Finalizando MP4...');

    await videoEncoder.flush();
    videoEncoder.close();

    if (audioEncoder) audioEncoder.close();

    muxer.finalize();

    // ── 10. Gerar Blob MP4 ──────────────────────────────────
    const mp4Buffer = target.buffer;
    const blob = new Blob([mp4Buffer], { type: 'video/mp4' });

    const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
    console.log(`[Burner] Concluído: ${sizeMB} MB`);

    report(1.0, `✓ Vídeo gerado (${sizeMB} MB)`);

    return { blob, format: 'mp4' };
}

// ─── Captura via Playback (com Backpressure) ────────────────

async function captureViaPlayback(video, canvas, ctx, segments, encoder, kfInterval, duration, fatalErrorRef, report) {
    const W = canvas.width;
    const H = canvas.height;

    return new Promise((resolve, reject) => {
        let frameCount = 0;
        let lastReportTime = 0;
        let resolved = false;
        let lastProgressTime = performance.now();

        video.currentTime = 0;
        video.muted = true;
        video.playbackRate = 2;

        function finish() {
            if (resolved) return;
            resolved = true;
            video.pause();
            clearInterval(watchdog);
            console.log(`[Burner] Playback: ${frameCount} frames capturados`);
            resolve();
        }

        function processFrame(now, metadata) {
            if (resolved) return;
            if (encoder.state === 'closed') {
                resolved = true;
                clearInterval(watchdog);
                reject(new Error('Encoder fechou durante a gravação'));
                return;
            }

            const timeSec = metadata.mediaTime;
            lastProgressTime = performance.now();

            // Desenhar frame + legenda
            ctx.drawImage(video, 0, 0, W, H);
            const activeSub = findActiveSubtitle(segments, timeSec);
            if (activeSub) drawSubtitle(ctx, activeSub, W, H);

            // Codificar frame
            const frame = new VideoFrame(canvas, {
                timestamp: Math.round(timeSec * 1_000_000),
            });
            encoder.encode(frame, { keyFrame: frameCount % kfInterval === 0 });
            frame.close();
            frameCount++;

            // Progresso
            const wallNow = performance.now();
            if (wallNow - lastReportTime > 150) {
                lastReportTime = wallNow;
                const pct = 0.10 + 0.85 * Math.min(timeSec / duration, 1);
                report(pct, `Gravando: ${fmtTime(timeSec)} / ${fmtTime(duration)} (${frameCount} frames)`);
            }

            // Vídeo acabou?
            if (video.ended || timeSec >= duration - 0.05) {
                finish();
                return;
            }

            // BACKPRESSURE: se a fila do encoder está cheia, pausar vídeo
            if (encoder.encodeQueueSize > 8) {
                video.pause();
                drainQueue(encoder, 4).then(() => {
                    if (resolved) return;
                    video.requestVideoFrameCallback(processFrame);
                    video.play().catch(() => finish());
                });
            } else {
                video.requestVideoFrameCallback(processFrame);
            }
        }

        // Watchdog: detecta stall (sem progresso por 8s)
        const watchdog = setInterval(() => {
            if (resolved) return;
            const staleMs = performance.now() - lastProgressTime;
            if (staleMs > 8000) {
                console.warn(`[Burner] Watchdog: sem progresso por ${(staleMs / 1000).toFixed(1)}s, finalizando`);
                finish();
            }
        }, 2000);

        video.requestVideoFrameCallback(processFrame);
        video.onended = finish;
        video.play().catch(reject);
    });
}

/**
 * Espera até que a fila do encoder drene para o nível desejado.
 */
function drainQueue(encoder, targetSize) {
    return new Promise(resolve => {
        function check() {
            if (encoder.state === 'closed' || encoder.encodeQueueSize <= targetSize) {
                resolve();
            } else {
                setTimeout(check, 5);
            }
        }
        check();
    });
}

// ─── Captura via Seeking (FALLBACK) ─────────────────────────

async function captureViaSeeking(video, canvas, ctx, segments, encoder, kfInterval, fps, totalFrames, duration, fatalErrorRef, report) {
    const W = canvas.width;
    const H = canvas.height;
    let lastReport = 0;

    for (let i = 0; i < totalFrames; i++) {
        if (encoder.state === 'closed') {
            throw new Error('Encoder fechou durante a gravação');
        }

        const timeSec = i / fps;
        video.currentTime = timeSec;
        await waitFor(video, 'seeked');

        ctx.drawImage(video, 0, 0, W, H);
        const activeSub = findActiveSubtitle(segments, timeSec);
        if (activeSub) drawSubtitle(ctx, activeSub, W, H);

        const frame = new VideoFrame(canvas, {
            timestamp: Math.round(timeSec * 1_000_000),
        });
        encoder.encode(frame, { keyFrame: i % kfInterval === 0 });
        frame.close();

        // Backpressure
        while (encoder.encodeQueueSize > 15) {
            await yieldToUI();
        }

        // Progresso (a cada 200ms)
        const now = performance.now();
        if (now - lastReport > 200) {
            lastReport = now;
            const pct = 0.10 + 0.85 * (i / totalFrames);
            report(pct, `Frame ${i + 1}/${totalFrames} — ${fmtTime(timeSec)} / ${fmtTime(duration)}`);
        }

        // Yield de UI a cada 15 frames
        if (i % 15 === 0) await yieldToUI();
    }
}

// ─── Extração de Áudio ──────────────────────────────────────

async function extractAudio(videoURL) {
    try {
        const response = await fetch(videoURL);
        const arrayBuffer = await response.arrayBuffer();
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        await audioCtx.close();
        return decoded;
    } catch (err) {
        console.warn('[Burner] Sem áudio ou erro na extração:', err.message);
        return null;
    }
}

// ─── Codificação de Áudio ───────────────────────────────────

function encodeFullAudio(encoder, audioBuffer) {
    const { numberOfChannels, sampleRate, length } = audioBuffer;
    const chunkDuration = sampleRate; // 1 segundo de amostras por chunk

    for (let offset = 0; offset < length; offset += chunkDuration) {
        const frameCount = Math.min(chunkDuration, length - offset);

        // Formato planar: [canal0_samples][canal1_samples]...
        const planarData = new Float32Array(frameCount * numberOfChannels);

        for (let ch = 0; ch < numberOfChannels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            const channelSlice = channelData.subarray(offset, offset + frameCount);
            planarData.set(channelSlice, ch * frameCount);
        }

        const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate,
            numberOfFrames: frameCount,
            numberOfChannels,
            timestamp: Math.round((offset / sampleRate) * 1_000_000),
            data: planarData,
        });

        encoder.encode(audioData);
        audioData.close();
    }
}

// ─── Busca de Legenda Ativa ─────────────────────────────────

function findActiveSubtitle(segments, timeSec) {
    for (const seg of segments) {
        if (timeSec >= seg.start && timeSec <= seg.end && seg.text?.trim()) {
            return seg.text.trim();
        }
    }
    return null;
}

// ─── Renderização de Legenda no Canvas ──────────────────────

function drawSubtitle(ctx, text, W, H) {
    const s = SUB_STYLE;

    // Calcular tamanho da fonte
    const fontSize = Math.max(s.minSize, Math.min(s.maxSize, Math.round(H * s.sizeRatio)));
    ctx.font = `${s.fontWeight} ${fontSize}px ${s.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Quebrar texto em linhas
    const maxW = W * s.maxWidthRatio;
    const lines = wrapText(ctx, text, maxW);
    const lineH = fontSize * s.lineSpacing;
    const totalH = lines.length * lineH;

    const centerX = W / 2;
    const baseY = H * (1 - s.marginBottom);

    // Desenhar cada linha (outline preta grossa + texto branco)
    ctx.strokeStyle = s.outlineColor;
    ctx.lineWidth = s.outlineWidth;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    for (let i = 0; i < lines.length; i++) {
        const y = baseY - totalH + (i + 1) * lineH;
        ctx.strokeText(lines[i], centerX, y);
        ctx.fillStyle = s.color;
        ctx.fillText(lines[i], centerX, y);
    }
}

function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let current = '';

    for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && current) {
            lines.push(current);
            current = word;
        } else {
            current = test;
        }
    }
    if (current) lines.push(current);
    return lines;
}

// ─── Cálculo de Bitrate ─────────────────────────────────────

function calcBitrate(w, h) {
    const pixels = w * h;
    if (pixels >= 1920 * 1080) return 6_000_000;   // 1080p → 6 Mbps
    if (pixels >= 1280 * 720)  return 4_000_000;    // 720p  → 4 Mbps
    if (pixels >= 854 * 480)   return 2_500_000;    // 480p  → 2.5 Mbps
    return 1_500_000;                                // menor → 1.5 Mbps
}

// ─── Seleção Dinâmica de Codec H.264 ────────────────────────

/**
 * Calcula o codec string H.264 correto baseado nos macroblocks (16×16 px).
 * Formato: avc1.PPCCLL (PP=profile, CC=constraints, LL=level)
 *
 * Levels:
 *   3.1 (1f) → até ~1280×720  (3.600 MBs)
 *   4.0 (28) → até ~1920×1080 (8.192 MBs)
 *   4.2 (2a) → até ~2048×1088 (8.704 MBs)
 *   5.0 (32) → até ~3840×2160 (22.080 MBs)
 *   5.1 (33) → até ~4096×2304 (36.864 MBs)
 */
function getCodecString(w, h) {
    const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);

    // Profile: Main (4d) para boa compressão + compatibilidade
    if (mbs <= 3_600)  return 'avc1.4d001f'; // Main 3.1
    if (mbs <= 8_192)  return 'avc1.4d0028'; // Main 4.0
    if (mbs <= 8_704)  return 'avc1.4d002a'; // Main 4.2
    if (mbs <= 22_080) return 'avc1.4d0032'; // Main 5.0
    return 'avc1.4d0033';                     // Main 5.1
}

// ─── Verificação de Suporte ─────────────────────────────────

/**
 * Verifica se o navegador suporta burn-in via WebCodecs.
 */
export function isBurnSupported() {
    return typeof VideoEncoder !== 'undefined' &&
           typeof AudioEncoder !== 'undefined';
}

/**
 * Retorna informações sobre o formato de saída.
 */
export function getOutputFormat() {
    return {
        format: 'MP4',
        mimeType: 'video/mp4',
        mobile: true,
    };
}

// ─── Utilitários ────────────────────────────────────────────

function waitFor(el, event) {
    return new Promise((resolve, reject) => {
        const onOk = () => { cleanup(); resolve(); };
        const onErr = () => { cleanup(); reject(new Error(`Erro no evento ${event}`)); };
        const cleanup = () => {
            el.removeEventListener(event, onOk);
            el.removeEventListener('error', onErr);
        };
        el.addEventListener(event, onOk, { once: true });
        el.addEventListener('error', onErr, { once: true });
    });
}

function fmtTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function yieldToUI() {
    return new Promise(r => setTimeout(r, 0));
}
