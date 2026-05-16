# SubTranslate — Documentação Técnica

> Documento detalhado descrevendo arquitetura, tecnologias, fluxo de processamento e implementação de cada módulo do SubTranslate.

---

## 1. Visão Geral

O **SubTranslate** é uma aplicação web 100% client-side que transcreve, traduz e legenda vídeos automaticamente no navegador. Nenhum dado sai do dispositivo do usuário — todo o processamento acontece localmente.

### Stack Tecnológica

| Camada | Tecnologia | Versão/Origem | Função |
|--------|-----------|---------------|--------|
| **Interface** | HTML5 + CSS3 + JavaScript (ES Modules) | Vanilla | UI com glassmorphism, tema claro/escuro |
| **Tipografia** | Google Fonts (Inter) | 300–800 | Fonte moderna e legível |
| **IA/Transcrição** | Transformers.js + Whisper | `@xenova/transformers@2.17.2` via CDN | Speech-to-text com timestamps |
| **Thread Separada** | Web Workers | Nativo | Inferência Whisper off-thread |
| **Extração de Áudio** | Web Audio API | Nativo | Decodificação e reamostragem para 16kHz mono |
| **Tradução** | Google Translate API | `translate.googleapis.com` | Tradução contextual por blocos |
| **Geração de Legendas** | JavaScript puro | — | Formatação SRT e VTT |
| **Gravação de Legendas** | WebCodecs API | `VideoEncoder` + `AudioEncoder` | Codificação H.264 + AAC |
| **Muxing MP4** | mp4-muxer | `@5.2.2` via CDN | Empacotamento das tracks em container MP4 |
| **Hospedagem** | GitHub Pages | — | Deploy estático automático |

---

## 2. Estrutura de Arquivos

```
SubTranslate/
├── index.html                       → Página principal (SPA)
├── css/
│   └── styles.css                   → Design system completo (variáveis CSS, temas)
├── js/
│   ├── app.js                       → Orquestrador do pipeline
│   ├── audio-extractor.js           → Extração de áudio (Web Audio API)
│   ├── transcriber.js               → Interface com o Web Worker
│   ├── transcription-worker.js      → Whisper AI em thread separada
│   ├── translator.js                → Tradução contextual (Google Translate)
│   ├── timing-refiner.js            → Refinamento de sincronização
│   ├── subtitle-generator.js        → Geração de SRT e VTT
│   └── video-burner.js              → Gravação de legendas no vídeo (WebCodecs + mp4-muxer)
├── .gitignore
└── README.md
```

---

## 3. Pipeline de Processamento

O fluxo de processamento segue 7 etapas sequenciais, orquestradas pelo `app.js`:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  1. Upload   │───▶│  2. Modelo  │───▶│  3. Áudio   │───▶│ 4. Whisper  │
│   (vídeo)    │    │  (Whisper)  │    │ (extração)  │    │(transcrição)│
└─────────────┘    └─────────────┘    └─────────────┘    └──────┬──────┘
                                                                │
                                                                ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  7. Burn-in  │◀──│ 6. Legendas │◀──│ 5. Tradução │◀──│  4b. Timing │
│  (opcional)  │    │  (SRT/VTT)  │    │  (Google)   │    │ (refiner)   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

---

## 4. Detalhamento de Cada Módulo

### 4.1. `app.js` — Orquestrador Principal

**Responsabilidade**: Gerencia todo o ciclo de vida da aplicação.

**Estado global** (`state`):
```javascript
{
    videoFile: File,          // Arquivo de vídeo original
    videoURL: string,         // Blob URL do vídeo
    subtitles: {
        original: [],         // Segmentos com texto no idioma original
        translated: []        // Segmentos com texto traduzido
    },
    srt: { original, translated },  // Conteúdo SRT gerado
    vtt: { original, translated },  // Conteúdo VTT gerado
    processing: boolean
}
```

**Fluxo de execução** (`processVideo()`):
1. Valida seleção de arquivo
2. Chama `loadModel()` → carrega Whisper no Worker
3. Chama `extractAudio()` → obtém Float32Array 16kHz mono
4. Chama `transcribe()` → obtém segmentos com timestamps
5. Chama `refineTimings()` → ajusta sincronização
6. Chama `translateSegments()` → traduz todos os segmentos
7. Chama `generateSRT()` / `generateVTT()` → gera arquivos de legenda
8. Exibe resultados e habilita downloads

**Gerenciamento de UI**:
- Sistema de seções (upload → settings → processing → results)
- Pipeline visual com ícones de status (pending → active → done)
- Barra de progresso com porcentagem e label descritivo
- Tema claro/escuro com persistência em `localStorage`

---

### 4.2. `audio-extractor.js` — Extração de Áudio

**Tecnologia**: Web Audio API (`AudioContext`)

**Como funciona**:
1. `FileReader.readAsArrayBuffer()` lê o arquivo de vídeo sem bloquear a UI
2. `AudioContext({ sampleRate: 16000 })` cria contexto com taxa de 16kHz (requisito do Whisper)
3. `audioContext.decodeAudioData()` decodifica qualquer formato suportado pelo navegador (MP4, WebM, OGG, WAV)
4. `audioBuffer.getChannelData(0)` extrai canal mono direto — **sem cópia** (economiza RAM)

**Otimização de memória**: Retorna referência direta ao canal 0 do AudioBuffer, evitando duplicação de arrays que poderiam consumir centenas de MB em vídeos longos.

**Formatos suportados**: Qualquer formato que o navegador decodifique nativamente. Chrome suporta MP4 (AAC/MP3), WebM (Opus/Vorbis), OGG, WAV.

---

### 4.3. `transcription-worker.js` — Web Worker do Whisper

**Tecnologia**: Transformers.js (`@xenova/transformers@2.17.2`)

**Por que Web Worker?**: A inferência do Whisper é CPU-intensiva. Rodá-la na thread principal travaria a UI completamente. O Web Worker executa em thread separada.

**Modelos disponíveis**:
| Modelo | Tamanho | Velocidade | Qualidade |
|--------|---------|-----------|-----------|
| Tiny | ~75 MB | Mais rápido | Básica |
| Base | ~150 MB | Equilibrado | Boa |
| Small | ~500 MB | Mais lento | Alta |

**Configuração do Whisper**:
```javascript
transcriber(audio, {
    language: 'en',
    task: 'transcribe',
    chunk_length_s: 15,       // Processa 15 segundos por vez
    stride_length_s: 3,       // 3 segundos de sobreposição entre chunks
    return_timestamps: true,  // Retorna timestamps por chunk
});
```

- **`chunk_length_s: 15`**: Chunks menores produzem timestamps mais granulares (melhor sincronização)
- **`stride_length_s: 3`**: Sobreposição entre chunks evita cortes no meio de palavras
- **`return_timestamps: true`**: Retorna `[start, end]` para cada chunk de texto

**Comunicação Worker ↔ Main thread**:
```
Main → Worker:  { type: 'load', payload: { modelId } }
Worker → Main:  { type: 'model-progress', payload: { status, progress } }
Worker → Main:  { type: 'model-loaded' }
Main → Worker:  { type: 'transcribe', payload: { audio, language } }
Worker → Main:  { type: 'transcription-done', payload: result }
```

---

### 4.4. `transcriber.js` — Interface com o Worker

**Responsabilidade**: Ponte entre `app.js` e o Worker. Converte chunks do Transformers.js em segmentos de legenda.

**`convertChunksToSegments()`**: Normaliza a saída do Whisper:
- Trata chunks com timestamps `null` (último segmento)
- Valida que `end > start`
- Estima duração quando timestamps são ausentes (`text.length / 10`)
- Gera segmentos com `{ index, start, end, text }`

---

### 4.5. `timing-refiner.js` — Refinamento de Sincronização

**Pipeline de 6 passes** (aplicados em sequência):

#### Pass 1: `splitLongSegments`
- **Problema**: Whisper frequentemente agrupa múltiplas frases em um único chunk
- **Solução**: Divide segmentos longos (>60 caracteres) em sentenças individuais usando pontuação (`.!?`) e vírgulas
- **Timing**: Distribui o tempo original proporcionalmente pelo número de caracteres de cada parte

#### Pass 2: `refineWithWords`
- Ajusta `start` e `end` usando word-level timestamps (quando disponíveis)
- Aplica margem de 0.03s antes da primeira palavra e 0.12s após a última

#### Pass 3: `capDuration`
- Limita duração máxima de cada legenda baseado na velocidade de leitura (17 chars/segundo)
- Máximo absoluto: 4.5 segundos

#### Pass 4: `resolveOverlaps`
- Remove sobreposições entre segmentos adjacentes
- Divide o tempo disputado igualmente entre os dois segmentos

#### Pass 5: `enforceGap`
- Garante gap mínimo de 0.12s entre legendas consecutivas
- Permite que o olho do espectador registre a transição

#### Pass 6: `trimSilence`
- Remove segmentos com texto vazio ou duração < 0.3s

**Constantes de timing**:
```javascript
MIN_GAP = 0.12        // Gap mínimo entre legendas
MAX_DURATION = 4.5    // Duração máxima de uma legenda
MIN_DURATION = 0.4    // Duração mínima
MAX_CHARS = 60        // Máximo de caracteres por legenda
CHARS_PER_SEC = 17.0  // Velocidade de leitura
END_MARGIN = 0.12     // Margem após última palavra
START_MARGIN = 0.03   // Margem antes da primeira palavra
```

---

### 4.6. `translator.js` — Tradução Contextual

**Tecnologia**: Google Translate API (gratuita, endpoint `gtx`)

**Arquitetura de tradução em blocos**:

1. **Janelas de Contexto**: Agrupa segmentos em blocos de até 4.500 caracteres
2. **Marcadores Unicode**: Cada segmento é prefixado com `⟦N⟧` (ex: `⟦1⟧ Hello world`)
3. **Tradução em bloco**: O bloco inteiro é enviado de uma vez ao Google Translate, preservando contexto entre frases
4. **Parsing de marcadores**: Após tradução, os marcadores são usados para separar cada segmento traduzido

**Fallback em 4 níveis**:
```
1. parseByMarkers → Parseia marcadores Unicode ⟦N⟧
       ↓ falha
2. fillMissing → Completa segmentos faltantes individualmente
       ↓ falha
3. parseByLines → Tenta dividir por quebras de linha
       ↓ falha
4. Individual → Traduz cada segmento separadamente
```

**Preservação de marcas/nomes**:
- Detecta PascalCase (`iPhone`, `YouTube`), ALLCAPS (`NASA`, `GPU`), e nomes próprios
- Compara texto traduzido com original e restaura nomes que foram traduzidos incorretamente
- Filtra palavras comuns em inglês que começam com maiúscula (`The`, `This`, `What`)

**Pós-processamento**:
1. Remove marcadores Unicode residuais
2. Restaura nomes de marcas
3. Limpa espaços duplicados
4. Capitaliza primeira letra de cada segmento

**Rate limiting**: 350ms entre requisições para evitar bloqueio (HTTP 429)

---

### 4.7. `subtitle-generator.js` — Geração de Legendas

**Formatos gerados**:

**SRT**:
```
1
00:00:00,000 --> 00:00:02,500
Texto da legenda aqui
```

**VTT** (WebVTT):
```
WEBVTT

1
00:00:00.000 --> 00:00:02.500
Texto da legenda aqui
```

**`createBlobURL()`**: Cria Blob URLs para download e para a tag `<track>` do video player.

---

### 4.8. `video-burner.js` — Gravação de Legendas no Vídeo

**Tecnologias**: WebCodecs API (`VideoEncoder`, `AudioEncoder`) + mp4-muxer v5.2.2

**Por que não usar MediaRecorder?**: O `MediaRecorder` produz WebM (incompatível com iOS), tem problemas de sincronização de áudio, e opera em tempo real (lento). A abordagem WebCodecs é mais rápida, mais confiável, e gera MP4 nativo.

#### Pipeline de Gravação

```
┌───────────────┐     ┌──────────────┐     ┌──────────────┐
│ Vídeo Original│────▶│  AudioContext │────▶│ AudioEncoder │──┐
│  (blob URL)   │     │ decodeAudio  │     │   (AAC-LC)   │  │
└───────────────┘     └──────────────┘     └──────────────┘  │
        │                                                     │
        ▼                                                     ▼
┌───────────────┐     ┌──────────────┐     ┌──────────────┐  ┌──────────┐
│  <video> play │────▶│    Canvas    │────▶│ VideoEncoder │──▶│mp4-muxer │──▶ MP4
│   (2x speed)  │     │ draw + sub   │     │   (H.264)    │  │          │
└───────────────┘     └──────────────┘     └──────────────┘  └──────────┘
```

#### Etapa 1: Extração de Áudio
```javascript
const response = await fetch(videoURL);
const arrayBuffer = await response.arrayBuffer();
const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
```
- Extrai áudio completo como Float32 PCM via AudioContext
- Suporta qualquer formato que o navegador decodifique

#### Etapa 2: Codificação de Áudio
```javascript
const audioData = new AudioData({
    format: 'f32-planar',
    sampleRate,
    numberOfFrames: frameCount,
    numberOfChannels,
    timestamp,
    data: planarData,
});
audioEncoder.encode(audioData);
```
- Converte AudioBuffer em chunks de 1 segundo
- Formato planar: `[canal0_amostras][canal1_amostras]`
- Codec: AAC-LC (`mp4a.40.2`) a 128 kbps

#### Etapa 3: Captura de Frames
**Método rápido** (`requestVideoFrameCallback`):
```javascript
video.playbackRate = 2;  // 2x velocidade
video.requestVideoFrameCallback(function processFrame(now, metadata) {
    ctx.drawImage(video, 0, 0, W, H);
    drawSubtitle(ctx, subtitle, W, H);
    const frame = new VideoFrame(canvas, { timestamp });
    encoder.encode(frame, { keyFrame });
    frame.close();
    video.requestVideoFrameCallback(processFrame);
});
video.play();
```
- Captura sequencial é **3-5x mais rápida** que seeking random-access
- A cada frame, desenha o frame original + legenda no Canvas
- Cria `VideoFrame` do Canvas e codifica

**Método fallback** (seeking):
- Para navegadores sem `requestVideoFrameCallback`
- `video.currentTime = t; await seeked;` para cada frame

#### Etapa 4: Renderização de Legendas
```javascript
ctx.font = '700 86px Inter, Arial, sans-serif';
ctx.strokeStyle = '#000000';
ctx.lineWidth = 5;
ctx.strokeText(text, x, y);  // Contorno preto
ctx.fillStyle = '#FFFFFF';
ctx.fillText(text, x, y);    // Texto branco
```
- Texto branco com contorno preto grosso (5px) — sem fundo
- Tamanho: 4.5% da altura do vídeo (20–52px)
- Word wrap automático a 88% da largura
- Posição: 6% acima da borda inferior

#### Etapa 5: Seleção de Codec H.264
```javascript
function getCodecString(w, h) {
    const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
    if (mbs <= 3_600)  return 'avc1.4d001f'; // Main 3.1 (720p)
    if (mbs <= 8_192)  return 'avc1.4d0028'; // Main 4.0 (1080p)
    if (mbs <= 22_080) return 'avc1.4d0032'; // Main 5.0 (4K)
    return 'avc1.4d0033';                     // Main 5.1
}
```
- Calcula nível H.264 correto baseado em macroblocks (16×16 px)
- Profile Main para boa compressão com compatibilidade
- `VideoEncoder.isConfigSupported()` valida antes de configurar

#### Etapa 6: Muxing Final
```javascript
const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    audio: { codec: 'aac', numberOfChannels, sampleRate },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
});
```
- `fastStart: 'in-memory'` coloca o atom `moov` no início do arquivo (playback instantâneo)
- Resultado: MP4 com H.264 + AAC — compatível com qualquer player/celular

---

### 4.9. `styles.css` — Design System

**Sistema de Temas** via CSS Custom Properties:
```css
[data-theme="dark"] {
    --bg-primary: #0a0a0f;
    --text-primary: #e8e8ed;
    --gradient: linear-gradient(135deg, #7c3aed, #a855f7);
}
[data-theme="light"] {
    --bg-primary: #f5f3ff;
    --text-primary: #1a1a2e;
    --gradient: linear-gradient(135deg, #7c3aed, #9333ea);
}
```

**Elementos visuais**:
- Glassmorphism (`backdrop-filter: blur()` + transparência)
- Grid animado no background
- Glows pulsantes em roxo/índigo
- Micro-animações em hover (translate, scale, glow)
- Pipeline visual com status por etapa

---

## 5. APIs do Navegador Utilizadas

| API | Uso | Requisito |
|-----|-----|-----------|
| `Web Audio API` | Decodificação e reamostragem de áudio | Todos os browsers |
| `Web Workers` | Thread separada para Whisper | Todos os browsers |
| `FileReader` | Leitura assíncrona de arquivos | Todos os browsers |
| `Fetch API` | Requisições HTTP (tradução, CDN) | Todos os browsers |
| `URL.createObjectURL` | Blob URLs para preview e download | Todos os browsers |
| `VideoEncoder` | Codificação H.264 via WebCodecs | Chrome 94+ |
| `AudioEncoder` | Codificação AAC via WebCodecs | Chrome 94+ |
| `VideoFrame` | Frames de vídeo para codificação | Chrome 94+ |
| `AudioData` | Dados de áudio para codificação | Chrome 94+ |
| `requestVideoFrameCallback` | Captura sincronizada de frames | Chrome 83+ |
| `localStorage` | Persistência de preferência de tema | Todos os browsers |
| `matchMedia` | Detecção de preferência do sistema | Todos os browsers |

---

## 6. Dependências Externas (via CDN)

| Biblioteca | CDN | Propósito |
|-----------|-----|-----------|
| `@xenova/transformers@2.17.2` | jsdelivr | Inferência Whisper no navegador |
| `mp4-muxer@5.2.2` | jsdelivr | Empacotamento de streams em MP4 |
| `Inter` (Google Fonts) | fonts.googleapis.com | Tipografia da interface |

> **Nenhuma dependência local.** Todo o projeto é estático, sem `node_modules`, sem build step.

---

## 7. Requisitos do Navegador

| Funcionalidade | Chrome | Edge | Firefox | Safari |
|----------------|--------|------|---------|--------|
| Transcrição + Tradução + SRT/VTT | ✅ 90+ | ✅ 90+ | ✅ 90+ | ✅ 15+ |
| Gravação de Legendas (burn-in) | ✅ 94+ | ✅ 94+ | ❌ | ❌ |

O burn-in de legendas requer WebCodecs (Chrome/Edge only). As demais funcionalidades funcionam em qualquer navegador moderno.

---

## 8. Fluxo Completo do Usuário

1. **Upload**: Usuário arrasta ou seleciona um arquivo de vídeo
2. **Configuração**: Escolhe modelo Whisper, idioma de origem e destino
3. **Processamento**:
   - Modelo Whisper é baixado (cache no IndexedDB)
   - Áudio é extraído e reamostrado para 16kHz mono
   - Whisper transcreve em chunks de 15 segundos
   - Timing é refinado (6 passes de otimização)
   - Texto é traduzido via Google Translate (em blocos com contexto)
   - Arquivos SRT e VTT são gerados
4. **Resultado**:
   - Preview do vídeo com legendas sincronizadas (via `<track>`)
   - Download de SRT/VTT (traduzido e original)
   - Opção de gravar legendas permanentemente no vídeo (MP4)

---

## 9. Considerações de Segurança e Privacidade

- **Zero servidor**: Nenhum dado é enviado para backend próprio
- **Tradução**: A única comunicação externa é com `translate.googleapis.com` (API pública do Google Translate)
- **Modelo Whisper**: Baixado uma vez e cacheado localmente no IndexedDB
- **Processamento local**: Toda transcrição, refinamento, e gravação acontecem no CPU/GPU do usuário
- **Blob URLs**: Vídeos e arquivos gerados existem apenas na memória do navegador
- **Limpeza de memória**: `URL.revokeObjectURL()` é chamado ao resetar a aplicação
