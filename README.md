<div align="center">

# SubTranslate

**Tradução e Legendagem de Vídeos 100% Local com Inteligência Artificial**

<br>

<a href="https://higor1107.github.io/SubTranslate/">
  <img src="https://img.shields.io/badge/Acessar_Aplicação_Web-000000?style=for-the-badge&logo=vercel&logoColor=white" height="40">
</a>

<br><br>

[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github)](https://github.com/Higor1107/SubTranslate)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Transformers.js](https://img.shields.io/badge/Transformers.js-FF6F00?style=for-the-badge&logo=huggingface&logoColor=white)](https://huggingface.co/docs/transformers.js)

</div>

---

## Sobre

O **SubTranslate** é uma aplicação open-source de alto desempenho projetada para gerar e traduzir legendas de arquivos de vídeo e áudio. Toda a inferência de IA e o processamento de áudio são executados localmente no navegador, utilizando a aceleração de hardware do dispositivo (WebGPU), o que garante privacidade total e custos zero de processamento em nuvem.

### Principais Recursos

- **Inferência Local via WebGPU:** Utiliza a versão V3 do `Transformers.js` para executar modelos da família Whisper diretamente na placa de vídeo do usuário, resultando em velocidades de transcrição de ponta a ponta sem tráfego de rede.
- **Sincronização Absoluta:** O motor de extração de áudio aplica um algoritmo de fatiamento sequencial inteligente (*Stride Stitching*) que preserva a continuidade das ondas sonoras e evita a quebra temporal em frases divididas entre blocos.
- **Formatação de Indústria:** As legendas são geradas obedecendo a padrões rigorosos de legibilidade (máximo de 42 caracteres por linha, máximo de 2 linhas por bloco e regras de tempo mínimo na tela).
- **Tradução Contextual:** Integração nativa com APIs do OpenAI (ChatGPT) e DeepL, realizando traduções em lotes semânticos (blocos contextuais) para preservar concordância, gênero e fluxo narrativo.
- **Exportação Universal:** Geração limpa e estruturada de arquivos `.srt` e `.vtt` com tempos exatos.

---

## Motores de Tradução

O SubTranslate utiliza o Google Translate por padrão (sem necessidade de chaves adicionais), mas oferece integração nativa com os principais motores neurais do mercado para traduções de nível estúdio.

### Configuração: OpenAI (ChatGPT)

Recomendado para traduções em que o contexto narrativo completo da cena é mandatório.

1. Acesse o portal da [OpenAI API](https://platform.openai.com/api-keys) e gere uma chave secreta.
2. Na aplicação SubTranslate, navegue até a engrenagem de **Configurações**.
3. Insira sua chave no campo designado e selecione o modelo ChatGPT como seu motor preferido.
*A API utilizará o modelo `gpt-4o-mini` para aliar velocidade máxima e baixo custo.*

### Configuração: DeepL

Recomendado para altíssima precisão gramatical em idiomas de matriz europeia.

1. Crie uma conta no portal [DeepL API Free](https://www.deepl.com/pro-api) e copie sua *Authentication Key*.
2. Na aplicação SubTranslate, navegue até a engrenagem de **Configurações**.
3. Insira sua chave e selecione DeepL como motor.
*O plano gratuito do DeepL permite a tradução de até 500.000 caracteres mensais.*

---

## Como Utilizar

### Ambiente de Produção

A aplicação é uma PWA (Progressive Web App) totalmente embutida e hospedada diretamente via GitHub Pages. Não é necessária a instalação de softwares de terceiros.
Acesse: [higor1107.github.io/SubTranslate](https://higor1107.github.io/SubTranslate/)

### Desenvolvimento Local

Para clonar e rodar o projeto localmente:

```bash
# Clone o repositório
git clone https://github.com/Higor1107/SubTranslate.git
cd SubTranslate

# Instale as dependências (Testes e Linter)
npm install

# Inicie o servidor local
npx serve . -l 3000
```
Acesse `http://localhost:3000` em um navegador compatível com *WebGPU* (ex: Google Chrome 113+ ou Microsoft Edge 113+).

---

## Idiomas de Tradução

A transcrição inicial do áudio detecta o idioma original automaticamente através do modelo Whisper. A conversão de texto suporta os seguintes idiomas nativos de saída:

- Inglês (en)
- Português - BR (pt)
- Espanhol (es)
- Francês (fr)
- Alemão (de)
- Italiano (it)
- Japonês (ja)

---

## Licença

Este software é distribuído sob a Licença [MIT](LICENSE).

<div align="center">
  <br>
  Desenvolvido e mantido por <a href="https://github.com/Higor1107">Higor</a>.
</div>
