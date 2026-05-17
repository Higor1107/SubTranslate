<div align="center">

# 🌐 SubTranslate

### Tradução e Legendagem de Vídeos 100% Local com IA
**Whisper AI + WebCodecs — Sem Servidor, Sem FFmpeg**

<br>

<a href="https://higor1107.github.io/SubTranslate/">
  <img src="https://img.shields.io/badge/▶️_ACESSAR_APLICAÇÃO_ONLINE-6366f1?style=for-the-badge&logo=googlechrome&logoColor=white" height="50">
</a>

<br><br>

[![GitHub Repo](https://img.shields.io/badge/GitHub-Repositório-181717?style=for-the-badge&logo=github)](https://github.com/Higor1107/SubTranslate)
[![License: MIT](https://img.shields.io/badge/Licença-MIT-green?style=for-the-badge)](LICENSE)
[![Transformers.js](https://img.shields.io/badge/Transformers.js-FF6F00?style=for-the-badge&logo=huggingface&logoColor=white)](https://huggingface.co/docs/transformers.js)
[![WebCodecs](https://img.shields.io/badge/WebCodecs-Native-0058A0?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)

</div>

---

## 🚀 Sobre o Projeto

O **SubTranslate** é uma ferramenta open-source que permite **transcrever, traduzir e embutir (burn-in)** legendas em vídeos de forma totalmente automática, executada inteiramente dentro do seu navegador.

A arquitetura utiliza a **WebCodecs API** nativa do navegador para a renderização de legendas, garantindo um processo até 10x mais rápido que abordagens tradicionais baseadas em FFmpeg, sem erros de memória e com aceleração de hardware (GPU) ativa de fábrica.

### ✨ Destaques

| Feature | Descrição |
|---------|-----------|
| 🧠 **IA Local (Whisper)** | Usa o `Transformers.js` para rodar o Whisper (OpenAI) diretamente no seu PC via WebGPU/WASM. |
| ⚡ **WebCodecs Nativo** | A gravação de legendas (burn-in) é feita nativamente pelo navegador, sem travamentos. |
| 🛡️ **Privacidade Absoluta** | O arquivo de vídeo nunca sai do seu computador. Todo o processamento é client-side. |
| 🌍 **Multi-Engine de Tradução** | Suporte a ChatGPT, DeepL e Google Translate com fallback automático. |
| 📥 **Exportação Flexível** | Baixe o `.mp4` com legenda gravada na imagem ou os arquivos brutos em `.srt` / `.vtt`. |
| 🔄 **Fallback Inteligente** | Se o modelo principal falhar por falta de memória, o sistema tenta automaticamente um modelo menor. |

---

## ⚙️ Arquitetura Tecnológica

| Camada | Tecnologia | Função |
|--------|-----------|--------|
| **Transcrição** | [Transformers.js](https://huggingface.co/docs/transformers.js) (Whisper) | Speech-to-text gerando tempos exatos das falas |
| **Pipeline Core** | Web Workers | Inferência off-thread para manter a interface fluida |
| **Tradução** | ChatGPT / DeepL / Google Translate | Tradução com fallback multi-engine |
| **Burn-in** | WebCodecs + mp4-muxer + Canvas | Desenha o texto frame-a-frame usando aceleração gráfica |
| **Interface** | Vanilla JS / CSS Moderno | Design System limpo com suporte nativo a Tema Escuro |

> 📖 **Para desenvolvedores:** Veja o [ARCHITECTURE.md](ARCHITECTURE.md) para documentação técnica detalhada de cada módulo.

---

## 🔌 Motores de Tradução (API Keys)

O SubTranslate suporta **três motores de tradução** com fallback automático. Ao abrir a aplicação, você pode configurar as API Keys diretamente na interface (seção de Configurações).

### Google Translate (Padrão — Sem API Key)

O Google Translate funciona **sem necessidade de API Key**. Ele utiliza o endpoint público `translate.googleapis.com`, que é gratuito e funciona imediatamente. Este é o engine padrão quando nenhuma chave é configurada.

### ChatGPT (OpenAI) — Recomendado para Qualidade

Para usar o ChatGPT como motor de tradução (maior qualidade e contexto):

1. Acesse [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Crie uma nova API Key
3. Na interface do SubTranslate, clique no ícone ⚙️ **Configurações**
4. Cole sua chave no campo **"OpenAI API Key"**
5. Selecione **"ChatGPT"** como engine preferido

> **Modelo utilizado:** `gpt-4o-mini` — rápido, barato e com excelente qualidade de tradução contextual.
> **Custo estimado:** ~$0.01 por vídeo de 5 minutos.

### DeepL — Alta Precisão para Idiomas Europeus

Para usar o DeepL como motor:

1. Acesse [deepl.com/pro-api](https://www.deepl.com/pro-api) e crie uma conta **DeepL API Free**
2. Copie sua **Authentication Key** no painel do DeepL
3. Na interface do SubTranslate, cole a chave no campo **"DeepL API Key"**
4. Selecione **"DeepL"** como engine preferido

> **Plano Free:** 500.000 caracteres/mês gratuitamente.
> O DeepL é especialmente forte para traduções EN↔DE, EN↔FR, EN↔ES.

### Ordem de Fallback

Se o engine preferido falhar, o sistema tenta automaticamente o próximo:

```
Engine Preferido → ChatGPT → DeepL → Google Translate
```

As chaves são salvas localmente no `localStorage` do seu navegador e **nunca são enviadas para nossos servidores**.

---

## 🛠️ Como Usar

### Versão Online (Mais Fácil)

Acesse diretamente: **[higor1107.github.io/SubTranslate](https://higor1107.github.io/SubTranslate/)**

### Versão Local (Para Desenvolvimento)

```bash
# Clone o repositório
git clone https://github.com/Higor1107/SubTranslate.git
cd SubTranslate

# Instale as dependências de desenvolvimento
npm install

# Sirva os arquivos com qualquer servidor estático
npx serve . -l 3000

# Acesse no seu navegador: http://localhost:3000
```

> **Nota:** Devido às regras de segurança de Módulos ES (`import`/`export`) do navegador, você não pode simplesmente abrir o `index.html` com um clique duplo. Um servidor local HTTP é obrigatório.

### Comandos de Desenvolvimento

```bash
npm run lint       # Verificação de qualidade de código (ESLint)
npm run test       # Testes unitários (Jest)
npm run test:e2e   # Testes end-to-end (Playwright)
```

---

## 🌐 Idiomas Suportados

A ferramenta detecta automaticamente o idioma falado se você usar a detecção do Whisper, mas para tradução direta suporta:

| Idioma | Código |
|--------|--------|
| 🇺🇸 Inglês | `en` |
| 🇧🇷 Português (BR) | `pt` |
| 🇪🇸 Espanhol | `es` |
| 🇫🇷 Francês | `fr` |
| 🇩🇪 Alemão | `de` |
| 🇮🇹 Italiano | `it` |
| 🇯🇵 Japonês | `ja` |

---

## 📋 Requisitos de Sistema

| Requisito | Detalhes |
|-----------|----------|
| **Navegador** | Chrome 94+ ou Edge 94+ (WebCodecs) |
| **RAM** | Mínimo 4 GB. Recomendado 8 GB+ (para Whisper Small) |
| **Internet** | Apenas na primeira execução (download do modelo ~75–500 MB) e para tradução |
| **GPU (opcional)** | WebGPU acelera a transcrição significativamente |

---

## 📄 Licença

Este projeto está licenciado sob a [MIT License](LICENSE).

---

<div align="center">

Feito com 💜 por <a href="https://github.com/Higor1107">Higor</a>

</div>
