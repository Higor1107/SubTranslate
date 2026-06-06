/**
 * Subtitle Formatter — Construção de legendas padrão Netflix/Broadcast.
 * Agrupa palavras individuais (com timestamps) em blocos de legenda 
 * respeitando os limites da indústria de cinema/TV.
 */

const MAX_CHARS_PER_LINE = 42;
const MAX_LINES_PER_SUB = 2;
const MIN_DURATION = 0.8;
const MAX_DURATION = 7.0;

/**
 * Constrói blocos de legenda a partir de uma lista de palavras.
 * @param {Array<{text: string, timestamp: [number, number]}>} words 
 * @returns {Array<{start: number, end: number, text: string}>}
 */
export function formatSubtitles(chunks) {
    if (!chunks || !chunks.length) return [];

    // Expande os chunks (sentences) em palavras virtuais proporcionalmente
    const words = [];
    let fallbackEnd = 0;
    
    for (const chunk of chunks) {
        let text = chunk.text || "";
        
        // FILTRO DE ONOMATOPEIAS E RUÍDOS (Closed Captions Puros)
        // Remove tudo que estiver entre [colchetes], (parênteses), *asteriscos* ou ♪ notas musicais ♪
        text = text.replace(/\[.*?\]/g, "");
        text = text.replace(/\(.*?\)/g, "");
        text = text.replace(/\*.*?\*/g, "");
        text = text.replace(/♪.*?♪/g, "");
        text = text.replace(/♪/g, "");
        text = text.trim();

        if (!text) continue; // Se a IA alucinou só um ruído, descartamos este chunk completamente!
        
        let cStart = fallbackEnd;
        let cEnd = fallbackEnd + 1.0;
        
        if (chunk.timestamp && chunk.timestamp.length >= 2) {
            cStart = chunk.timestamp[0] !== null ? chunk.timestamp[0] : fallbackEnd;
            cEnd = chunk.timestamp[1] !== null ? chunk.timestamp[1] : (cStart + Math.max(text.length / 15, 1.0));
        }

        const subWords = text.trim().split(/\s+/);
        if (subWords.length <= 1) {
            words.push({ text: " " + subWords[0], timestamp: [cStart, cEnd] });
        } else {
            const totalChars = subWords.reduce((acc, w) => acc + w.length, 0);
            const duration = cEnd - cStart;
            let currentStart = cStart;
            
            for (const w of subWords) {
                const ratio = w.length / totalChars;
                const wDur = duration * ratio;
                words.push({ 
                    text: " " + w, 
                    timestamp: [currentStart, currentStart + wDur] 
                });
                currentStart += wDur;
            }
        }
        fallbackEnd = cEnd;
    }

    const subtitles = [];
    let currentLines = [];
    let currentLine = "";
    let currentStart = null;
    let lastEnd = null;

    const commitSubtitle = () => {
        if (currentLine.trim()) {
            currentLines.push(currentLine.trim());
        }
        if (currentLines.length > 0 && currentStart !== null && lastEnd !== null) {
            const start = currentStart;
            let end = lastEnd;
            
            // Força duração mínima (evita flash rápido na tela)
            if (end - start < MIN_DURATION) {
                end = start + MIN_DURATION;
            }

            subtitles.push({
                start: Number(start.toFixed(3)),
                end: Number(end.toFixed(3)),
                text: currentLines.join('\n')
            });
        }
        currentLines = [];
        currentLine = "";
        currentStart = null;
        lastEnd = null;
    };

    for (let i = 0; i < words.length; i++) {
        const wordObj = words[i];
        let wordText = wordObj.text || "";
        const ts = wordObj.timestamp || [lastEnd || 0, (lastEnd || 0) + 0.3];
        
        // As vezes o Transformers.js retorna null se não conseguir alinhar perfeitamente
        const wStart = ts[0] !== null ? ts[0] : (lastEnd !== null ? lastEnd : 0);
        const wEnd = ts[1] !== null ? ts[1] : (wStart + 0.3);

        if (currentStart === null) currentStart = wStart;

        // Limpa espaços extras iniciais da palavra
        if (wordText.startsWith(' ')) {
            if (currentLine.length > 0 && !currentLine.endsWith(' ')) {
                currentLine += ' ';
            }
            wordText = wordText.trimStart();
        }

        const punctuationMatch = wordText.match(/([.!?]+)(["']?)$/);
        const hasPunctuation = !!punctuationMatch;

        // Se adicionar a palavra exceder o limite da linha
        if ((currentLine.length + wordText.length) > MAX_CHARS_PER_LINE) {
            currentLines.push(currentLine.trim());
            currentLine = wordText;
            
            // Se já tem 2 linhas completas, fecha o bloco de legenda e inicia outro
            if (currentLines.length >= MAX_LINES_PER_SUB) {
                // A palavra atual vaza para o PRÓXIMO bloco, então a gente remove ela e comita.
                currentLine = "";
                commitSubtitle();
                currentStart = wStart;
                currentLine = wordText;
            }
        } else {
            currentLine += wordText;
        }

        lastEnd = wEnd;

        // Se tem pontuação forte (fim de frase) ou ultrapassou a duração máxima
        if (hasPunctuation || (wEnd - currentStart >= MAX_DURATION)) {
            commitSubtitle();
        } else if (i < words.length - 1) {
            // Se o silêncio entre esta palavra e a próxima for muito grande (> 1s), quebra a legenda
            const nextTs = words[i+1].timestamp;
            const nextStart = nextTs && nextTs[0] !== null ? nextTs[0] : wEnd;
            if (nextStart - wEnd > 1.0) {
                commitSubtitle();
            }
        }
    }

    commitSubtitle(); // Flush final

    return resolveOverlaps(subtitles);
}

/**
 * Garante que blocos não se sobreponham no tempo.
 */
function resolveOverlaps(subtitles) {
    if (!subtitles.length) return [];
    
    // Ordena por início
    subtitles.sort((a, b) => a.start - b.start);
    
    for (let i = 0; i < subtitles.length - 1; i++) {
        const curr = subtitles[i];
        const next = subtitles[i + 1];
        
        // Se houver sobreposição, recua o final do atual para antes do próximo
        if (curr.end > next.start) {
            curr.end = next.start - 0.001;
            
            // Se a correção esmagar o bloco, recua o início (desde que não cruze o anterior)
            if (curr.end <= curr.start) {
                const prevEnd = i > 0 ? subtitles[i - 1].end : 0;
                curr.start = Math.max(prevEnd + 0.001, curr.end - MIN_DURATION);
                if (curr.end <= curr.start) {
                     curr.end = curr.start + 0.1; // Fallback extremo
                }
            }
        }
    }
    
    // Adiciona o index
    return subtitles.map((s, index) => ({
        index: index + 1,
        start: s.start,
        end: s.end,
        text: s.text
    }));
}
