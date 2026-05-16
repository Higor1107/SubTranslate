class ConfigManager {
    constructor() {
        this.storageKey = 'subtranslate_config';
        this.config = this.load();
    }

    load() {
        const saved = localStorage.getItem(this.storageKey);
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                return this.getDefaults();
            }
        }
        return this.getDefaults();
    }

    getDefaults() {
        return {
            openaiApiKey: null,
            deeplApiKey: null,
            preferredEngine: 'chatgpt', // 'chatgpt', 'deepl', 'google'
            cacheTranslations: true,
            webgpuEnabled: true
        };
    }

    save() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.config));
    }

    setOpenAIKey(key) {
        this.config.openaiApiKey = key;
        this.save();
    }

    setDeepLKey(key) {
        this.config.deeplApiKey = key;
        this.save();
    }

    setPreferredEngine(engine) {
        this.config.preferredEngine = engine;
        this.save();
    }

    hasValidKeys() {
        return {
            openai: this.config.openaiApiKey && this.config.openaiApiKey.length > 0,
            deepl: this.config.deeplApiKey && this.config.deeplApiKey.length > 0
        };
    }

    clear() {
        this.config = this.getDefaults();
        this.save();
    }
}

export { ConfigManager };
