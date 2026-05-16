<div align="center">

# 🌐 SubTranslate V.3

### Tradução e Legendagem de Vídeos 100% Local com IA
**Whisper AI + WebCodecs (Sem Servidor, Sem FFmpeg)**

<br>

<a href="https://higor1107.github.io/SubTranslate/">
  <img src="https://img.shields.io/badge/▶️_ACESSAR_APLICAÇÃO_ONLINE-6366f1?style=for-the-badge&logo=googlechrome&logoColor=white" height="50">
</a>

<br><br>

[![GitHub Repo](https://img.shields.io/badge/GitHub-Repositório-181717?style=for-the-badge&logo=github)](https://github.com/Higor1107/SubTranslate)
[![Transformers.js](https://img.shields.io/badge/Transformers.js-FF6F00?style=for-the-badge&logo=huggingface&logoColor=white)](https://huggingface.co/docs/transformers.js)
[![WebCodecs](https://img.shields.io/badge/WebCodecs-Native-0058A0?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)

</div>

---

## 🚀 Sobre o Projeto (V.3)

O **SubTranslate V.3** é uma ferramenta de código aberto que permite **transcrever, traduzir e embutir (burn-in)** legendas em vídeos de forma totalmente automática, executada inteiramente dentro do seu navegador. 

Nesta versão **V.3**, a dependência instável do `FFmpeg.wasm` foi completamente removida e substituída pela **WebCodecs API** nativa do navegador, garantindo uma renderização até 10x mais rápida, sem erros de memória e com aceleração de hardware (GPU) ativa de fábrica.

### ✨ Destaques
- 🧠 **IA Local (Whisper)**: Usa o `Transformers.js` para rodar o Whisper (OpenAI) diretamente no seu PC via WebGPU/WASM.
- ⚡ **WebCodecs Nativo**: A gravação de legendas (burn-in) agora é feita nativamente pelo navegador, sem travamentos.
- 🛡️ **Privacidade Absoluta**: O arquivo de vídeo nunca sai do seu computador. Todo o processamento é client-side.
- 🌍 **Tradução Contextual Rápida**: Blocos traduzidos em lote pelo Google Translate preservando o tempo da fala.
- 📥 **Exportação Rápida**: Baixe o arquivo `.mp4` com a legenda gravada na imagem ou os arquivos brutos em `.srt` / `.vtt`.

---

## ⚙️ Arquitetura Tecnológica

| Camada | Tecnologia | Função |
|--------|-----------|--------|
| **Transcrição** | [Transformers.js](https://huggingface.co/docs/transformers.js) (Whisper) | Speech-to-text gerando tempos exatos das falas |
| **Pipeline Core** | Web Workers | Inferência off-thread para manter a interface fluida |
| **Tradução** | Google Translate API | Tradução contextual de blocos (evita tradução literal burra) |
| **Burn-in** | WebCodecs + mp4-muxer + Canvas | Desenha o texto frame-a-frame usando aceleração gráfica |
| **Interface** | Vanilla JS / CSS Moderno | Design System limpo com suporte nativo a Tema Escuro |

> 📖 **Para desenvolvedores:** A lógica de sincronização, deduplicação de fragmentos e refinamento de tempos do Whisper fica localizada em `js/timing-refiner.js`.

---

## 🛠️ Como Usar (Local)

Embora a forma mais fácil seja usar a [Versão Online](https://higor1107.github.io/SubTranslate/), você pode rodar o sistema localmente (útil para desenvolvimento):

```bash
# Clone o repositório
git clone https://github.com/Higor1107/SubTranslate.git
cd SubTranslate

# Sirva os arquivos com qualquer servidor estático
npx serve . -l 3000

# Acesse no seu navegador: http://localhost:3000
```
*(Nota: Devido às regras de segurança de Módulos ES (import/export) do navegador, você não pode simplesmente abrir o `index.html` com um clique duplo. Um servidor local HTTP é obrigatório).*

---

## 🌐 Idiomas Suportados

A ferramenta detecta automaticamente o idioma falado se você usar a detecção do Whisper, mas para tradução direta suporta:
- 🇺🇸 Inglês ➔ 🇧🇷 Português (BR)
- 🇪🇸 Espanhol
- 🇫🇷 Francês
- 🇩🇪 Alemão
- 🇮🇹 Italiano
- 🇯🇵 Japonês

---

## 📋 Requisitos de Sistema

- **Navegador Moderno:** Chrome 94+ ou Edge 94+ (Requerido para suporte total a WebCodecs).
- **Memória RAM:** Mínimo 4 GB. Recomendado 8 GB+ (para rodar o modelo Whisper Small com folga).
- **Internet:** Necessária apenas na primeira execução para o download do modelo (aprox. 75MB a 240MB dependendo do modelo) e para chamadas curtas à API do Google Translate.

---

<div align="center">
Feito por <a href="https://github.com/Higor1107">Higor</a> | SubTranslate V.3
</div>
