/**
 * SubTranslate Web — Aplicação principal.
 * Stack 2026: Orquestração WebGPU + MultiEngine + FFmpeg.wasm
 */

import { extractAudio } from './audio-extractor.js';
import { CohereTranscriber, getAvailableModels } from './transcriber.js';
import { MultiEngineTranslator } from './translator.js';
import { refineTimings } from './timing-refiner.js';
import { generateSRT, generateVTT, createBlobURL, downloadFile } from './subtitle-generator.js';
import { burnSubtitles } from './video-burner.js';
import { ConfigManager } from './config.js';

// ─── Instâncias e Estado ──────────────────────────────────────────────
const configManager = new ConfigManager();
const transcriber = new CohereTranscriber();
let translator = null;

const state = {
    videoFile: null,
    videoURL: null,
    subtitles: { original: [], translated: [] },
    srt: { original: '', translated: '' },
    vtt: { original: '', translated: '' },
    processing: false,
};

// ─── DOM ────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const dom = {
    heroSection: $('#hero-section'),
    uploadSection: $('#upload-section'),
    settingsSection: $('#settings-section'),
    processingSection: $('#processing-section'),
    resultsSection: $('#results-section'),
    uploadZone: $('#upload-zone'),
    fileInput: $('#file-input'),
    uploadInfo: $('#upload-info'),
    fileName: $('#file-name'),
    fileSize: $('#file-size'),
    modelSelect: $('#whisper-model'),
    sourceLang: $('#source-lang'),
    targetLang: $('#target-lang'),
    engineSelect: $('#translation-engine'),
    btnProcess: $('#btn-process'),
    progressBar: $('#processing-bar'),
    progressLabel: $('#progress-label'),
    progressPercent: $('#progress-percent'),
    modelProgress: $('#model-progress'),
    modelProgressBar: $('#model-progress-bar'),
    modelProgressText: $('#model-progress-text'),
    videoPlayer: $('#video-player'),
    subtitleList: $('#subtitle-list'),
    btnNew: $('#btn-new'),
    burnSection: $('#burn-section'),
    btnBurn: $('#btn-burn'),
    burnProgress: $('#burn-progress'),
    burnBar: $('#burn-bar'),
    burnLabel: $('#burn-label'),
    burnPercent: $('#burn-percent'),
};

// ─── Inicialização ─────────────────────────────────────────────
function init() {
    setupUpload();
    setupSettings();
    setupResultTabs();
    setupNewButton();
    setupBurn();
    initUI();
}

function initUI() {
    // Carrega preferência de motor de tradução e preenche o form
    if (dom.engineSelect) {
        dom.engineSelect.value = configManager.config.preferredEngine;
    }

    // Configura listeners para os campos de API Key que adicionaremos no HTML
    const btnSaveKeys = $('#save-keys');
    if (btnSaveKeys) {
        btnSaveKeys.addEventListener('click', () => {
            const openaiKey = $('#openai-key').value;
            const deeplKey = $('#deepl-key').value;
            const engine = dom.engineSelect.value;
            
            if (openaiKey !== undefined) configManager.setOpenAIKey(openaiKey);
            if (deeplKey !== undefined) configManager.setDeepLKey(deeplKey);
            if (engine) configManager.setPreferredEngine(engine);
            
            alert('Configurações salvas!');
        });
    }

    // Preenche com chaves salvas caso existam
    if ($('#openai-key')) $('#openai-key').value = configManager.config.openaiApiKey || '';
    if ($('#deepl-key')) $('#deepl-key').value = configManager.config.deeplApiKey || '';
}

// ─── Lógica de Upload ───────────────────────────────────────────────
function setupUpload() {
    dom.uploadZone.addEventListener('click', () => dom.fileInput.click());

    dom.uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.uploadZone.classList.add('dragover');
    });
    dom.uploadZone.addEventListener('dragleave', () => {
        dom.uploadZone.classList.remove('dragover');
    });
    dom.uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
    });

    dom.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) selectFile(e.target.files[0]);
    });
}

function selectFile(file) {
    const allowed = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
        alert(`Formato não suportado: ${ext}\nUse: ${allowed.join(', ')}`);
        return;
    }

    state.videoFile = file;
    state.videoURL = URL.createObjectURL(file);

    dom.fileName.textContent = file.name;
    dom.fileSize.textContent = formatSize(file.size);
    dom.uploadInfo.style.display = 'flex';
    dom.uploadZone.querySelector('.upload-icon').style.display = 'none';
    dom.uploadZone.querySelector('.upload-title').textContent = file.name;
    dom.uploadZone.querySelector('.upload-hint').textContent = formatSize(file.size);
    dom.uploadZone.querySelector('.upload-limit').style.display = 'none';
    dom.uploadZone.classList.add('file-selected');

    dom.settingsSection.style.display = 'block';
    dom.settingsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setupSettings() {
    dom.btnProcess.addEventListener('click', startPipeline);
}

// ─── Pipeline ───────────────────────────────────────────────────
const STEP_RANGES = {
    model:      [0, 15],
    extract:    [15, 20],
    transcribe: [20, 50],
    timing:     [50, 52],
    translate:  [52, 95],
    generate:   [95, 100],
};

function stepProgress(step, fraction) {
    const [min, max] = STEP_RANGES[step];
    return Math.round(min + fraction * (max - min));
}

async function startPipeline() {
    if (state.processing || !state.videoFile) return;
    state.processing = true;

    dom.btnProcess.disabled = true;
    dom.settingsSection.style.display = 'none';
    dom.heroSection.style.display = 'none';
    dom.uploadSection.style.display = 'none';
    dom.processingSection.style.display = 'block';
    dom.processingSection.scrollIntoView({ behavior: 'smooth' });

    const modelSize = dom.modelSelect.value;
    const sourceLang = dom.sourceLang.value;
    const targetLang = dom.targetLang.value;
    const engine = dom.engineSelect ? dom.engineSelect.value : configManager.config.preferredEngine;
    configManager.setPreferredEngine(engine);

    // Initialize Translator
    translator = new MultiEngineTranslator(
        { openai: configManager.config.openaiApiKey, deepl: configManager.config.deeplApiKey },
        configManager.config.preferredEngine
    );

    try {
        // ── Step 1: Carregar modelo Whisper (WebGPU) ──
        updateStep('step-model', 'active');
        updateProgress('Baixando modelo Whisper AI...', stepProgress('model', 0));
        dom.modelProgress.style.display = 'block';

        const device = await transcriber.loadModel(modelSize, (info) => {
            if (info.status === 'downloading') {
                const pct = Math.round(info.progress);
                dom.modelProgressBar.style.width = pct + '%';
                dom.modelProgressText.textContent = `${info.file?.split('/').pop() || ''} ${pct}%`;
                updateProgress(`Baixando modelo... ${pct}%`, stepProgress('model', pct / 100));
            }
            if (info.status === 'ready') {
                dom.modelProgressBar.style.width = '100%';
                dom.modelProgressText.textContent = 'Modelo carregado ✓';
            }
        });
        console.log(`Pipeline usará backend: ${device}`);

        dom.modelProgress.style.display = 'none';
        updateStep('step-model', 'done');

        // ── Step 2: Extrair áudio ──
        updateStep('step-extract', 'active');
        updateProgress('Extraindo áudio...', stepProgress('extract', 0));

        const audioData = await extractAudio(state.videoFile, (p) => {
            updateProgress(`Extraindo áudio... ${Math.round(p * 100)}%`, stepProgress('extract', p));
        });
        updateStep('step-extract', 'done');

        // ── Step 3: Transcrever ──
        updateStep('step-transcribe', 'active');
        updateProgress('Transcrevendo via IA...', stepProgress('transcribe', 0));

        const { segments: rawSegments } = await transcriber.transcribe(audioData, sourceLang, (p) => {
            updateProgress(`Transcrevendo... ${Math.round(p * 100)}%`, stepProgress('transcribe', p));
        });

        if (!rawSegments || !rawSegments.length) {
            throw new Error('Nenhuma fala detectada no vídeo.');
        }
        updateStep('step-transcribe', 'done');

        // ── Step 4: Refinar timing ──
        updateStep('step-timing', 'active');
        updateProgress('Refinando sincronização...', stepProgress('timing', 0));

        const refinedSegments = refineTimings(rawSegments);
        state.subtitles.original = refinedSegments;
        updateStep('step-timing', 'done');

        // ── Step 5: Traduzir ──
        updateStep('step-translate', 'active');
        updateProgress('Traduzindo legendas...', stepProgress('translate', 0));

        const translatedSegments = await translator.translateSegments(
            refinedSegments, sourceLang, targetLang,
            (info) => {
                updateProgress(`Traduzindo... ${Math.round(info.percent * 100)}%`, stepProgress('translate', info.percent));
            }
        );

        state.subtitles.translated = translatedSegments;
        updateStep('step-translate', 'done');

        // ── Step 6: Gerar legendas ──
        updateStep('step-generate', 'active');
        updateProgress('Gerando arquivos SRT e VTT...', stepProgress('generate', 0));

        state.srt.original = generateSRT(refinedSegments);
        state.srt.translated = generateSRT(translatedSegments);
        state.vtt.original = generateVTT(refinedSegments);
        state.vtt.translated = generateVTT(translatedSegments);

        updateStep('step-generate', 'done');
        updateProgress('✓ Processamento concluído!', 100);

        setTimeout(() => showResults(), 800);

    } catch (err) {
        console.error('Pipeline error:', err);
        updateProgress(`Erro: ${err.message}`, -1);
        dom.progressBar.style.background = 'var(--error)';

        setTimeout(() => {
            state.processing = false;
            dom.btnProcess.disabled = false;
            dom.processingSection.style.display = 'none';
            dom.heroSection.style.display = 'block';
            dom.uploadSection.style.display = 'block';
            dom.settingsSection.style.display = 'block';
            dom.progressBar.style.background = '';
        }, 5000);
    }
}

// ─── UI de Progresso ────────────────────────────────────────────────
function updateProgress(label, percent) {
    dom.progressLabel.textContent = label;
    if (percent >= 0) {
        const p = Math.min(Math.round(percent), 100);
        dom.progressBar.style.width = p + '%';
        dom.progressPercent.textContent = p + '%';
    }
}

function updateStep(stepId, status) {
    const el = $(`#${stepId}`);
    if (!el) return;
    el.dataset.status = status;
    const badge = el.querySelector('.step-badge');
    if (badge) {
        const labels = { pending: 'Aguardando', active: 'Processando...', done: 'Concluído' };
        badge.textContent = labels[status] || status;
    }
}

// ─── Resultados ────────────────────────────────────────────────────
function showResults() {
    dom.processingSection.style.display = 'none';
    dom.resultsSection.style.display = 'block';
    dom.resultsSection.scrollIntoView({ behavior: 'smooth' });

    dom.videoPlayer.src = state.videoURL;
    const vttBlob = createBlobURL(state.vtt.translated, 'text/vtt');
    const track = dom.videoPlayer.querySelector('track');
    if (track) {
        track.src = vttBlob;
        track.default = true;
    }

    renderSubtitles('translated');
    setupDownloads();
}

function renderSubtitles(tab) {
    const subs = state.subtitles[tab] || [];
    dom.subtitleList.innerHTML = subs.map(seg => `
        <div class="subtitle-item" data-start="${seg.start}">
            <div class="subtitle-time">${formatTime(seg.start)}</div>
            <div class="subtitle-text">${escapeHTML(seg.text)}</div>
        </div>
    `).join('');

    dom.subtitleList.querySelectorAll('.subtitle-item').forEach(item => {
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
            dom.videoPlayer.currentTime = parseFloat(item.dataset.start);
            dom.videoPlayer.play();
        });
    });

    $$('.tab[data-tab]').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
}

function setupResultTabs() {
    $$('.tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', () => renderSubtitles(tab.dataset.tab));
    });
}

function setupDownloads() {
    const bind = (id, content, filename) => {
        const btn = $(`#${id}`);
        if (btn) btn.addEventListener('click', () => downloadFile(content, filename));
    };
    const baseName = state.videoFile?.name.replace(/\.[^.]+$/, '') || 'subtitles';
    bind('btn-dl-srt-translated', state.srt.translated, `${baseName}_pt.srt`);
    bind('btn-dl-vtt-translated', state.vtt.translated, `${baseName}_pt.vtt`);
    bind('btn-dl-srt-original', state.srt.original, `${baseName}_en.srt`);
    bind('btn-dl-vtt-original', state.vtt.original, `${baseName}_en.vtt`);
}

// ─── Gravação de Vídeo ──────────────────────────────────────────
function setupBurn() {
    if (!dom.btnBurn) return;

    dom.btnBurn.addEventListener('click', async () => {
        if (!state.videoFile || !state.srt.translated) return;

        dom.btnBurn.disabled = true;
        dom.btnBurn.textContent = 'Gravando Legendas (Isso pode demorar)...';
        dom.burnProgress.style.display = 'block';
        dom.burnBar.style.width = '0%';

        try {
            const videoBlobURL = URL.createObjectURL(state.videoFile);
            
            const { blob } = await burnSubtitles(
                videoBlobURL,
                state.subtitles.translated,
                (info) => {
                    const pct = Math.min(Math.round(info.percent * 100), 100);
                    dom.burnBar.style.width = pct + '%';
                    dom.burnLabel.textContent = info.label || `Gravando vídeo...`;
                    dom.burnPercent.textContent = pct + '%';
                }
            );

            // Trigger download automatically
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = state.videoFile.name.replace(/\.[^.]+$/, '') + '_legendado.mp4';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            URL.revokeObjectURL(videoBlobURL);

            dom.burnLabel.textContent = '✓ Vídeo com legenda gerado e baixado!';
            dom.burnPercent.textContent = '100%';
            dom.burnBar.style.width = '100%';

        } catch (err) {
            console.error('[Burn] Error:', err);
            dom.burnLabel.textContent = `Erro: ${err.message}`;
            dom.burnBar.style.width = '0%';
            dom.burnBar.style.background = 'var(--error)';
        } finally {
            dom.btnBurn.disabled = false;
            dom.btnBurn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
                    <line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/>
                    <line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/>
                    <line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>
                    <line x1="17" y1="17" x2="22" y2="17"/>
                </svg>
                Gravar Legendas no Vídeo
            `;
        }
    });
}

// ─── Novo Vídeo ──────────────────────────────────────────────────
function setupNewButton() {
    dom.btnNew.addEventListener('click', resetApp);
}

function resetApp() {
    if (state.videoURL) URL.revokeObjectURL(state.videoURL);
    state.videoFile = null;
    state.videoURL = null;
    state.subtitles = { original: [], translated: [] };
    state.srt = { original: '', translated: '' };
    state.vtt = { original: '', translated: '' };
    state.processing = false;

    dom.resultsSection.style.display = 'none';
    dom.processingSection.style.display = 'none';
    dom.settingsSection.style.display = 'none';
    dom.heroSection.style.display = 'block';
    dom.uploadSection.style.display = 'block';

    dom.uploadZone.classList.remove('file-selected');
    dom.uploadZone.querySelector('.upload-icon').style.display = '';
    dom.uploadZone.querySelector('.upload-title').textContent = 'Arraste seu vídeo aqui';
    dom.uploadZone.querySelector('.upload-hint').textContent = 'ou clique para selecionar • MP4, MKV, AVI, MOV, WebM';
    dom.uploadZone.querySelector('.upload-limit').style.display = '';
    dom.uploadInfo.style.display = 'none';
    dom.fileInput.value = '';

    ['step-model', 'step-extract', 'step-transcribe', 'step-timing', 'step-translate', 'step-generate']
        .forEach(id => updateStep(id, 'pending'));

    dom.progressBar.style.width = '0%';
    dom.progressBar.style.background = '';
    dom.progressPercent.textContent = '0%';
    dom.progressLabel.textContent = 'Preparando...';
    dom.modelProgress.style.display = 'none';

    dom.burnProgress.style.display = 'none';
    dom.burnBar.style.width = '0%';
    dom.burnBar.style.background = '';
    dom.burnLabel.textContent = 'Preparando...';
    dom.burnPercent.textContent = '0%';

    dom.btnProcess.disabled = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatSize(bytes) {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
    return (bytes / 1024 ** 3).toFixed(2) + ' GB';
}

function formatTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const pad = n => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function escapeHTML(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

init();
