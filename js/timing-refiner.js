/**
 * TimingRefiner — Refinamento de sincronização de legendas.
 *
 * Com sentence-level timestamps do Whisper:
 *   1. adjustDuration    → Ajusta duração baseada no comprimento do texto
 *   2. resolveOverlaps   → Remove sobreposição entre segmentos
 *   3. trimInvalid       → Remove segmentos inválidos
 *
 * Usa abordagem simples: confia nos timestamps do Whisper como base,
 * ajusta apenas casos extremos (muito longo/curto).
 */

const MIN_GAP = 0.04;             // Gap mínimo entre legendas (40ms)
const MIN_DISPLAY = 0.5;          // Tempo mínimo de exibição (500ms)
const MAX_DURATION = 5.0;         // Duração máxima absoluta
const CHARS_PER_SEC = 15;         // Velocidade de fala

// Reverted splitLongSegments

// ─── Pass 1: Ajustar duração ────────────────────────────────

function adjustDuration(segments) {
    return segments.map(seg => {
        const duration = seg.end - seg.start;
        const textLen = seg.text.length;

        // Estimar duração ideal baseada no texto
        const idealDuration = Math.max(textLen / CHARS_PER_SEC, MIN_DISPLAY);

        // Se duração do Whisper é muito longa comparada ao texto, encurtar
        // (mas só se for mais que 50% acima do ideal — respeitar o Whisper)
        if (duration > idealDuration * 1.8 && duration > MAX_DURATION) {
            return { ...seg, end: +(seg.start + Math.min(idealDuration * 1.3, MAX_DURATION)).toFixed(3) };
        }

        // Se muito curta para ser legível
        if (duration < MIN_DISPLAY && textLen > 3) {
            return { ...seg, end: +(seg.start + MIN_DISPLAY).toFixed(3) };
        }

        // Cap de duração máxima
        if (duration > MAX_DURATION) {
            return { ...seg, end: +(seg.start + MAX_DURATION).toFixed(3) };
        }

        return { ...seg };
    });
}

// ─── Pass 2: Resolver sobreposições ─────────────────────────

function resolveOverlaps(segments) {
    if (segments.length < 2) return segments;
    const out = [{ ...segments[0] }];

    for (let i = 1; i < segments.length; i++) {
        const prev = out[out.length - 1];
        const curr = { ...segments[i] };

        // Se há sobreposição
        if (prev.end > curr.start - MIN_GAP) {
            const newEnd = curr.start - MIN_GAP;

            if (newEnd - prev.start >= MIN_DISPLAY * 0.5) {
                prev.end = +newEnd.toFixed(3);
            } else {
                // Comprimir ambos
                const mid = (prev.end + curr.start) / 2;
                prev.end = +(mid - MIN_GAP / 2).toFixed(3);
                curr.start = +(mid + MIN_GAP / 2).toFixed(3);

                if (prev.end <= prev.start) prev.end = +(prev.start + 0.2).toFixed(3);
                if (curr.start >= curr.end) curr.end = +(curr.start + 0.2).toFixed(3);
            }
        }
        out.push(curr);
    }
    return out;
}

// ─── Pass 3: Limpeza de Texto e Remover inválidos ────────────────

function cleanText(text) {
    if (!text) return '';
    
    // 1. Remover tags de ruído/música como [Música], (Música), [risos], ♪
    let cleaned = text.replace(/\[.*?\]|\(.*?\)|♪/g, '').trim();
    
    // 2. Resolver repetições dentro do mesmo segmento (ex: "Haverá perda. Haverá perda.")
    // Divide por pontuação ou por vírgula se for muito longo
    const parts = cleaned.split(/(?<=[.!?])\s+/);
    if (parts.length >= 2) {
        // Verifica se a última parte é igual à anterior
        const last = parts[parts.length - 1].trim().toLowerCase();
        const prev = parts[parts.length - 2].trim().toLowerCase();
        if (last === prev) {
            parts.pop(); // Remove a repetição
            cleaned = parts.join(' ').trim();
        }
    }
    
    // 3. Verifica repetição exata da string dividida ao meio (sem pontuação)
    const len = cleaned.length;
    if (len > 10) {
        const half = Math.floor(len / 2);
        const firstHalf = cleaned.substring(0, half).trim().toLowerCase();
        const secondHalf = cleaned.substring(half).trim().toLowerCase();
        // Permite 1 caracter de diferença (espaço extra, ponto final)
        if (firstHalf === secondHalf || firstHalf + '.' === secondHalf || firstHalf === secondHalf + '.') {
            cleaned = cleaned.substring(0, half).trim();
        }
    }

    return cleaned;
}

function trimInvalid(segments) {
    return segments.map(seg => ({
        ...seg,
        text: cleanText(seg.text)
    })).filter(seg => {
        const duration = seg.end - seg.start;
        return seg.text.length > 0 && duration > 0.1;
    });
}

// ─── Pass 4: Remover Hallucinations/Duplicatas (Entre Segmentos) ──────

function filterHallucinations(segments) {
    if (!segments.length) return segments;
    const out = [];
    let lastText = "";

    for (let i = 0; i < segments.length; i++) {
        const curr = segments[i];
        const text = curr.text.toLowerCase().replace(/[.,!?]/g, '');

        // Se é idêntico ao anterior, e está muito próximo no tempo, descarta
        if (text === lastText && text.length > 0) {
            const prev = out[out.length - 1];
            if (curr.start - prev.end < 2.0) {
                // Expande o tempo do anterior se fizer sentido
                if (curr.end - prev.start <= MAX_DURATION) {
                    prev.end = Math.max(prev.end, curr.end);
                }
                continue;
            }
        }
        
        lastText = text;
        out.push(curr);
    }
    return out;
}

// ─── Pipeline Principal ─────────────────────────────────────

export function refineTimings(segments) {
    if (!segments.length) return segments;

    let s = adjustDuration(segments);
    s = resolveOverlaps(s);
    s = trimInvalid(s);
    s = filterHallucinations(s);

    // Re-indexar
    s.forEach((seg, i) => seg.index = i + 1);

    console.log(`[TimingRefiner] ${segments.length} → ${s.length} segmentos refinados`);
    return s;
}
