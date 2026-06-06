/**
 * Translator — Integração com múltiplas APIs de tradução (Stack 2026).
 * Ordem de Fallback: ChatGPT -> DeepL -> Google Translate (scraper).
 */

class MultiEngineTranslator {
    constructor(apiKeys = {}, preferredEngine = 'chatgpt') {
        this.keys = {
            openai: apiKeys.openai || null,
            deepl: apiKeys.deepl || null
        };
        this.preferredEngine = preferredEngine;
        this.cache = new Map(); // Cache em memória para evitar requests redundantes
    }

    /**
     * Traduz uma lista de segmentos de legenda em Lotes Contextuais (Janelas).
     * Isso preserva o contexto do roteiro e aumenta a velocidade exponencialmente.
     * 
     * @param {Array<{start: number, end: number, text: string, index: number}>} segments 
     * @param {string} sourceLang 
     * @param {string} targetLang 
     * @param {Function} [onProgress] 
     * @param {AbortSignal} [signal]
     * @returns {Promise<Array>}
     */
    async translateSegments(segments, sourceLang, targetLang, onProgress, signal) {
        if (!segments.length) return [];
        
        const totalSegs = segments.length;
        let processedSegs = 0;
        const result = [];
        const BATCH_SIZE = 15; // Janela de contexto ideal para roteiros

        console.log(`[Translator] Iniciando tradução CONTEXTUAL de ${totalSegs} segmentos (Janelas de ${BATCH_SIZE}) - Engine: ${this.preferredEngine}`);

        for (let i = 0; i < totalSegs; i += BATCH_SIZE) {
            if (signal?.aborted) throw new Error('Processamento abortado.');
            const batch = segments.slice(i, i + BATCH_SIZE);
            
            try {
                const translatedTexts = await this.translateBatch(batch, sourceLang, targetLang, signal);
                for (let j = 0; j < batch.length; j++) {
                    result.push({ ...batch[j], text: translatedTexts[j] || batch[j].text });
                }
            } catch (err) {
                console.warn(`[Translator] Falha no lote ${i} a ${i+BATCH_SIZE}. Usando fallback original.`, err);
                for (let j = 0; j < batch.length; j++) {
                    result.push({ ...batch[j] }); 
                }
            }
            
            processedSegs += batch.length;
            if (onProgress) {
                onProgress({
                    percent: Math.min(processedSegs / totalSegs, 1),
                    label: `Traduzindo cenas... ${Math.min(processedSegs, totalSegs)}/${totalSegs}`,
                });
            }
            
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }

        return result;
    }

    /**
     * Tenta traduzir um LOTE de textos utilizando os engines disponíveis.
     */
    async translateBatch(batch, sourceLang, targetLang, signal) {
        let translations = null;
        const enginesToTry = [this.preferredEngine];
        if (this.preferredEngine !== 'chatgpt') enginesToTry.push('chatgpt');
        if (this.preferredEngine !== 'deepl') enginesToTry.push('deepl');
        if (this.preferredEngine !== 'google') enginesToTry.push('google');

        for (const engine of enginesToTry) {
            if (translations) break;

            try {
                if (engine === 'chatgpt' && this.keys.openai) {
                    translations = await this.translateBatchChatGPT(batch, sourceLang, targetLang, signal);
                } else if (engine === 'deepl' && this.keys.deepl) {
                    translations = await this.translateBatchDeepL(batch, sourceLang, targetLang, signal);
                } else if (engine === 'google') {
                    translations = await this.translateBatchGoogle(batch, sourceLang, targetLang, signal);
                }
            } catch (e) {
                console.warn(`[Translator] Lote falhou na engine ${engine}:`, e.message);
            }
        }

        if (!translations || translations.length !== batch.length) {
            throw new Error('Todas as engines de tradução falharam para este lote.');
        }

        return translations.map(t => this.preserveMarkers(t));
    }

    async translateBatchChatGPT(batch, sourceLang, targetLang, signal) {
        const promptBlock = batch.map((seg, i) => `[${i}] ${seg.text}`).join('\n');
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: signal,
            headers: {
                'Authorization': `Bearer ${this.keys.openai}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{
                    role: 'system',
                    content: `You are a professional Netflix subtitle translator. Translate the scene dialogue from ${sourceLang} to ${targetLang}. Use context from the whole block to decide gender, pronouns, and tone. STRICT RULES: Return the EXACT same number of lines. Start every translated line with the exact [ID] marker provided. Do not add explanations.`
                }, {
                    role: 'user',
                    content: promptBlock
                }],
                temperature: 0.3,
                max_tokens: 1500
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'OpenAI error');
        
        const output = data.choices[0].message.content.trim().split('\n');
        return this.parseBatchResponse(output, batch.length);
    }

    async translateBatchDeepL(batch, sourceLang, targetLang, signal) {
        const texts = batch.map(seg => seg.text);
        const response = await fetch('https://api-free.deepl.com/v2/translate', {
            method: 'POST',
            signal: signal,
            headers: {
                'Authorization': `DeepL-Auth-Key ${this.keys.deepl}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: texts,
                source_lang: sourceLang.toUpperCase(),
                target_lang: this.mapToDeepLLang(targetLang),
                formality: 'prefer_more'
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'DeepL error');
        
        return data.translations.map(t => t.text);
    }

    async translateBatchGoogle(batch, sourceLang, targetLang, signal) {
        // Google free tier API chokes on large arrays, we translate individually in parallel but with rate limiting
        const translations = [];
        for (const seg of batch) {
            if (signal?.aborted) throw new Error('Processamento abortado.');
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(seg.text)}`;
            const response = await fetch(url, { signal });
            if (!response.ok) throw new Error('Google Translate request failed');
            const data = await response.json();
            translations.push(data[0].map(item => item[0]).join('').trim());
            await new Promise(r => setTimeout(r, 200)); // Rate limit
        }
        return translations;
    }

    parseBatchResponse(lines, expectedLength) {
        const results = new Array(expectedLength).fill('');
        for (const line of lines) {
            const match = line.match(/^\[(\d+)\]\s*(.*)$/);
            if (match) {
                const idx = parseInt(match[1]);
                if (idx >= 0 && idx < expectedLength) {
                    results[idx] = match[2].trim();
                }
            }
        }
        // Fallback for missing lines
        return results;
    }

    mapToDeepLLang(lang) {
        const mapping = {
            'pt': 'PT-BR',
            'pt-br': 'PT-BR',
            'en': 'EN-US',
            'es': 'ES',
            'fr': 'FR',
            'de': 'DE',
            'it': 'IT',
            'ja': 'JA'
        };
        return mapping[lang.toLowerCase()] || lang.toUpperCase();
    }

    preserveMarkers(text) {
        return text.replace(/⟦\d+⟧/g, (match) => match);
    }
}

export { MultiEngineTranslator };
