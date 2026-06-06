/**
 * SubTranslate Web — Aplicação principal.
 * /* eslint-disable no-console */
 * Stack 2026: Orquestração WebGPU + MultiEngine + FFmpeg.wasm
 */

import { extractAudio } from './audio-extractor.js';
import { CohereTranscriber } from './transcriber.js';
import { MultiEngineTranslator } from './translator.js';
import { generateSRT, generateVTT, createBlobURL, downloadFile } from './subtitle-generator.js';
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
};

// ─── Inicialização ─────────────────────────────────────────────
function init() {
    setupUpload();
    setupSettings();
    setupResultTabs();
    setupNewButton();
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
        console.time('[Pipeline] Total');
        console.time('[Pipeline] 1. Carregamento do Modelo');

        let lastModelPct = 0;
        const device = await transcriber.loadModel(modelSize, (info) => {
            if (info.status === 'downloading') {
                if (typeof info.progress === 'number' && !isNaN(info.progress) && info.progress > 0) {
                    lastModelPct = Math.round(info.progress);
                } else {
                    // Sem content-length do servidor, simula progresso ativo para o usuário não achar que travou
                    lastModelPct = Math.min(99, lastModelPct + 1);
                }
                dom.modelProgressBar.style.width = lastModelPct + '%';
                dom.modelProgressText.textContent = `${info.file?.split('/').pop() || ''} ${lastModelPct}%`;
                updateProgress(`Baixando modelo... ${lastModelPct}%`, stepProgress('model', lastModelPct / 100));
            }
            if (info.status === 'ready') {
                dom.modelProgressBar.style.width = '100%';
                dom.modelProgressText.textContent = 'Modelo carregado ✓';
                updateProgress(`Baixando modelo... 100%`, stepProgress('model', 1));
            }
        });
        console.log(`Pipeline usará backend: ${device}`);

        dom.modelProgress.style.display = 'none';
        updateStep('step-model', 'done');
        console.timeEnd('[Pipeline] 1. Carregamento do Modelo');

        // ── Step 2: Extrair áudio ──
        updateStep('step-extract', 'active');
        updateProgress('Extraindo áudio...', stepProgress('extract', 0));
        console.time('[Pipeline] 2. Extração de Áudio');

        const audioData = await extractAudio(state.videoFile, (p) => {
            updateProgress(`Extraindo áudio... ${Math.round(p * 100)}%`, stepProgress('extract', p));
        });
        updateStep('step-extract', 'done');
        console.timeEnd('[Pipeline] 2. Extração de Áudio');

        // ── Step 3: Transcrever ──
        updateStep('step-transcribe', 'active');
        updateProgress('Transcrevendo via IA...', stepProgress('transcribe', 0));
        console.time('[Pipeline] 3. Transcrição (Whisper)');

        let lastTranscribePct = 0;
        const { segments: rawSegments } = await transcriber.transcribe(audioData, sourceLang, (p, chunkText) => {
            lastTranscribePct = Math.max(lastTranscribePct, Math.round(p * 100));
            const textPreview = chunkText ? ` "${chunkText.substring(0, 35)}..."` : '';
            updateProgress(`Transcrevendo: ${lastTranscribePct}%${textPreview}`, stepProgress('transcribe', p));
        });

        if (!rawSegments || !rawSegments.length) {
            throw new Error('Nenhuma fala detectada no vídeo.');
        }
        updateStep('step-transcribe', 'done');
        console.timeEnd('[Pipeline] 3. Transcrição (Whisper)');

        // ── Step 4: Refinar timing ──
        updateStep('step-timing', 'active');
        updateProgress('Refinando sincronização...', stepProgress('timing', 0));
        console.time('[Pipeline] 4. Refinamento (Timing)');

        // Step 4: Formatting (Acontece internamente no Transcriber, apenas feedback visual)
        updateStep('step-timing', 'active');
        await new Promise(r => setTimeout(r, 500)); 
        updateStep('step-timing', 'done');
        state.subtitles.original = rawSegments;
        console.timeEnd('[Pipeline] 4. Refinamento (Timing)');

        // ── Step 5: Traduzir ──
        updateStep('step-translate', 'active');
        updateProgress('Traduzindo legendas...', stepProgress('translate', 0));
        console.time('[Pipeline] 5. Tradução Textual');

        const translatedSegments = await translator.translateSegments(
            rawSegments, sourceLang, targetLang,
            (info) => {
                updateProgress(`Traduzindo... ${Math.round(info.percent * 100)}%`, stepProgress('translate', info.percent));
            }
        );

        state.subtitles.translated = translatedSegments;
        updateStep('step-translate', 'done');
        console.timeEnd('[Pipeline] 5. Tradução Textual');

        // ── Step 6: Gerar legendas ──
        updateStep('step-generate', 'active');
        updateProgress('Gerando arquivos SRT e VTT...', stepProgress('generate', 0));

        state.srt.original = generateSRT(rawSegments);
        state.srt.translated = generateSRT(translatedSegments);
        state.vtt.original = generateVTT(rawSegments);
        state.vtt.translated = generateVTT(translatedSegments);

        updateStep('step-generate', 'done');
        updateProgress('✓ Processamento concluído!', 100);
        console.timeEnd('[Pipeline] Total');

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
