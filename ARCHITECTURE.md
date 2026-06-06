# Architecture Overview: SubTranslate

This document provides a comprehensive, deep-dive analysis of the SubTranslate application's architectural design, underlying algorithms, and technology stack. It is intended for software engineers, contributors, and technical reviewers.

---

## 1. High-Level System Architecture

SubTranslate is a fully client-side Progressive Web App (PWA) designed to process large media files (video and audio), transcribe speech to text using neural networks, format subtitles according to industry readability standards, and contextually translate them.

Because the processing happens in the browser, the architecture heavily relies on asynchronous operations, `Web Workers` for non-blocking UI threads, and hardware acceleration mechanisms like `WebGPU`.

The pipeline executes sequentially through the following modules:
1. **Audio Extraction** (`audio-extractor.js`)
2. **Transcription Orchestration & Web Worker** (`transcriber.js`, `transcription-worker.js`)
3. **Word-Level Subtitle Formatting** (`subtitle-formatter.js`)
4. **Context-Aware Batch Translation** (`translator.js`)
5. **Subtitle Generation** (`subtitle-generator.js`)

---

## 2. Pipeline Deep Dive

### A. Audio Extraction (`audio-extractor.js`)
The extraction module leverages the `AudioContext` API to decode binary media streams (MP4, MP3, WAV, WebM) into raw floating-point waveforms.

- **Process:** The file is ingested as an `ArrayBuffer` and decoded via `AudioContext.decodeAudioData()`.
- **Downsampling:** The raw audio is resampled specifically to **16,000 Hz** (16kHz) as required by the Whisper AI model's input tensor constraints.
- **Normalization:** The waveform is extracted into a mono-channel `Float32Array`.

### B. Whisper WebGPU Inference (`transcription-worker.js`)
The core transcription engine runs entirely on a background thread (`Web Worker`) to prevent UI lockups during heavy tensor computations. It utilizes `Transformers.js` V3 to interface with ONNX-compiled models.

- **Hardware Acceleration:** The system defaults to `WebGPU` for execution. This accesses the user's dedicated or integrated GPU, dramatically accelerating matrix multiplications. If `WebGPU` is unavailable or fails (e.g., driver issues), it falls back to WebAssembly (`WASM`) with `q8` quantization.
- **Tensor Types:** When using `WebGPU`, the pipeline uses `fp32` for the encoder model to prevent compatibility crashes across different GPU vendors, and `q4` (4-bit quantization) for the decoder to maximize VRAM throughput.

### C. Stride Stitching Algorithm (Manual Chunking)
Processing a 1-hour audio file in a single forward pass would exceed browser VRAM limits. Therefore, the audio array is sliced into smaller chunks. The native `chunk_length_s` of Transformers.js obscures precise progress tracking during silent periods, so a manual striding approach is implemented:

- **Mathematical Slicing:** The 16kHz `Float32Array` is sliced into exactly 30-second intervals (`chunk_duration_s = 30`).
- **Overlap (Stride):** The iteration steps forward by 28 seconds (`step_s = 28`), creating a 2-second overlap window between consecutive chunks.
- **Word Stitching Logic:** 
  - If the model predicts a word timestamp starting at or after the 28.0s mark within a chunk, that word is programmatically **discarded**.
  - Since the next chunk begins exactly at the 28.0s global mark, the discarded word will naturally fall into the 0.0s relative position of the next chunk.
  - This guarantees that words split exactly on the boundary are fully reassembled by the model's acoustic context in the subsequent chunk, eliminating hallucination loops and sync loss typical in basic chunking.

### D. Industry-Standard Subtitle Formatting (`subtitle-formatter.js`)
The raw word-level output from the model requires restructuring into human-readable subtitle blocks.

- **Noise & OOA Filtering:** The Whisper model (especially the Base variant) often hallucinates closed captions or onomatopoeias (e.g., `[laughs]`, `(music)`). A strict Regex engine parses all incoming strings, stripping any content enclosed in brackets, parentheses, asterisks, or musical notes.
- **Block Construction:**
  - **Character Limits:** A block is hard-capped at a maximum of 42 characters per line (`MAX_CHARS_PER_LINE`) and 2 lines per block (`MAX_LINES_PER_SUB`).
  - **Punctuation Triggers:** If a word ends with a terminal punctuation mark (`.`, `!`, `?`), the block is immediately flushed to the screen.
  - **Temporal Duration limits:** Subtitles must remain on screen for a minimum of `0.8` seconds (to prevent flashes) and a maximum of `7.0` seconds (to prevent static fatigue).
- **Overlap Resolution:** A linear pass ensures no two subtitle blocks share the same `[start, end]` timeframe. If block $A$ overlaps with block $B$, block $A$'s end time is clamped to block $B$'s start time minus `1ms`.

### E. Context-Aware Batch Translation (`translator.js`)
Line-by-line translation inherently destroys context, gender agreements, and narrative tone. The `MultiEngineTranslator` solves this through batch processing.

- **Batching Strategy:** Subtitles are grouped into arrays of 15 sequential blocks.
- **Payload Structure:** Each text string is concatenated with an ID prefix (e.g., `[1] Text... \n [2] Text...`). This ensures the Large Language Model understands exactly how many lines it received and maps them back uniquely.
- **API Connectivity:**
  - **ChatGPT (`gpt-4o-mini`):** Receives a specific system prompt configuring it as an expert subtitle translator.
  - **DeepL:** Uses XML-based tagging (`<line id="1">Text</line>`) to protect IDs from being incorrectly translated.
- **Fault Tolerance:** If the translated batch returns a mismatched number of lines, or the network fails, the system safely falls back to preserving the original text for that specific batch to prevent application crashes.

### F. Subtitle Generation (`subtitle-generator.js`)
The finalized object array is parsed into standardized `.srt` (SubRip) and `.vtt` (WebVTT) text string formats, complete with sequential ID indices and properly formatted timestamp headers (e.g., `HH:MM:SS,ms`).
The output strings are converted to `Blob` objects, enabling native, offline browser downloads.

---

## 3. Technology Stack

- **Core UI & Logic:** Vanilla JavaScript (ES2022+), Modular ES Imports.
- **AI Ecosystem:** `@huggingface/transformers` V3.
- **Runtimes:** `ONNX Runtime Web`, `WebGPU`, `WebAssembly`.
- **Styling:** Vanilla CSS3, Grid/Flexbox Layouts, Native CSS Variables (Custom Properties) for Theming.
- **Module Bundling:** None. The application operates securely under a standard static file server to maximize portability and avoid compilation overhead.
