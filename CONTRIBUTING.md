# Como Contribuir para o SubTranslate

Obrigado por se interessar em contribuir para o SubTranslate! Nosso objetivo é manter o projeto leve, rápido e 100% Client-Side.

## Arquitetura Principal

Este projeto **não usa Webpack, Vite ou React**. Todo o código é Vanilla JS para rodar nativamente no navegador usando ES Modules.
Por favor, **não adicione dependências de build** para o código em produção.

## Configurando o Ambiente de Desenvolvimento

Para rodar testes e linting, você precisará do Node.js instalado (v18+).

1. Clone o repositório:
   ```bash
   git clone https://github.com/Higor1107/SubTranslate.git
   cd SubTranslate
   ```

2. Instale as dependências de desenvolvimento:
   ```bash
   npm install
   ```

3. Sirva o projeto localmente:
   ```bash
   npx serve . -l 3000
   ```

## Regras de Código

1. **JSDoc rigoroso:** Sempre documente funções complexas com `@param` e `@returns`.
2. **ES6+:** Use módulos (`import`/`export`), `async/await` e desestruturação, mas sem exageros.
3. **Sem frameworks JS:** A UI deve permanecer em Vanilla JS/CSS.
4. **Linting e Testes:** Antes de abrir um Pull Request, certifique-se de que o código passa nas checagens:
   ```bash
   npm run lint
   npm run test
   ```

## Estrutura de Pull Requests

Forneça um bom título e uma descrição clara do que o seu PR conserta ou adiciona. Se for uma funcionalidade grande, abra uma Issue primeiro para discutirmos a implementação.
