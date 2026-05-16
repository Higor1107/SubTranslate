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

    async translateSegments(segments, sourceLang, targetLang, onProgress) {
        if (!segments.length) return [];
        
        const totalSegs = segments.length;
        let processedSegs = 0;
        const result = [];

        console.log(`[Translator] Iniciando tradução de ${totalSegs} segmentos (Engine: ${this.preferredEngine})`);

        for (const seg of segments) {
            try {
                const translatedText = await this.translate(seg.text, sourceLang, targetLang);
                result.push({ ...seg, text: translatedText });
            } catch (err) {
                console.warn(`[Translator] Falha na tradução do segmento ${seg.index}:`, err);
                result.push({ ...seg }); // Mantém original se tudo falhar
            }
            
            processedSegs++;
            if (onProgress) {
                onProgress({
                    percent: processedSegs / totalSegs,
                    label: `Traduzindo... ${processedSegs}/${totalSegs} segmentos`,
                });
            }
            
            // Rate limiting amigável para APIs gratuitas
            await new Promise(resolve => setTimeout(resolve, 200)); 
        }

        return result;
    }

    async translate(text, sourceLang, targetLang) {
        if (!text || text.trim() === '') return text;
        
        const cacheKey = `${sourceLang}|${targetLang}|${text}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        let translation = null;
        let engineUsed = null;

        // Ordem baseada na preferência e disponibilidade de chave
        const enginesToTry = [this.preferredEngine];
        if (this.preferredEngine !== 'chatgpt') enginesToTry.push('chatgpt');
        if (this.preferredEngine !== 'deepl') enginesToTry.push('deepl');
        if (this.preferredEngine !== 'google') enginesToTry.push('google');

        for (const engine of enginesToTry) {
            if (translation) break;

            if (engine === 'chatgpt' && this.keys.openai) {
                try {
                    translation = await this.translateWithChatGPT(text, sourceLang, targetLang);
                    engineUsed = 'chatgpt';
                } catch (e) {
                    console.warn('[Translator] ChatGPT falhou:', e.message);
                }
            } else if (engine === 'deepl' && this.keys.deepl) {
                try {
                    translation = await this.translateWithDeepL(text, sourceLang, targetLang);
                    engineUsed = 'deepl';
                } catch (e) {
                    console.warn('[Translator] DeepL falhou:', e.message);
                }
            } else if (engine === 'google') {
                try {
                    translation = await this.translateWithGoogle(text, sourceLang, targetLang);
                    engineUsed = 'google';
                } catch (e) {
                    console.warn('[Translator] Google falhou:', e.message);
                }
            }
        }

        if (!translation) {
            throw new Error('Todas as engines de tradução falharam.');
        }

        translation = this.preserveMarkers(translation);
        this.cache.set(cacheKey, translation);
        
        return translation;
    }

    async translateWithChatGPT(text, sourceLang, targetLang) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.keys.openai}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{
                    role: 'system',
                    content: `You are a professional translator. Translate from ${sourceLang} to ${targetLang}. Preserve the original meaning, tone, and style. Keep any markers like ⟦N⟧ exactly as they are. Output ONLY the translation, no explanations.`
                }, {
                    role: 'user',
                    content: text
                }],
                temperature: 0.3,
                max_tokens: 1000
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'OpenAI error');
        
        return data.choices[0].message.content.trim();
    }

    async translateWithDeepL(text, sourceLang, targetLang) {
        const response = await fetch('https://api-free.deepl.com/v2/translate', {
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${this.keys.deepl}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: [text],
                source_lang: sourceLang.toUpperCase(),
                target_lang: this.mapToDeepLLang(targetLang),
                formality: 'prefer_more'
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'DeepL error');
        
        return data.translations[0].text;
    }

    async translateWithGoogle(text, sourceLang, targetLang) {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Google Translate request failed');
        const data = await response.json();
        
        if (!data || !data[0]) throw new Error('Google Translate invalid response');
        return data[0].map(item => item[0]).join('').trim();
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
