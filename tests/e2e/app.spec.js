import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('SubTranslate E2E', () => {
    test('A página inicial carrega corretamente os elementos', async ({ page }) => {
        // Assume static server running on localhost:3000
        await page.goto('http://localhost:3000');

        // Verifica Título
        await expect(page.locator('h1')).toHaveText('SubTranslate');

        // Verifica o botão de upload
        const uploadArea = page.locator('#dropArea');
        await expect(uploadArea).toBeVisible();

        // Verifica idioma
        const sourceLang = page.locator('#sourceLang');
        await expect(sourceLang).toHaveValue('auto');
    });

    test('Deve alternar entre tema claro e escuro', async ({ page }) => {
        await page.goto('http://localhost:3000');
        
        const themeToggle = page.locator('#themeToggle');
        await expect(themeToggle).toBeVisible();
        
        // Verifica se clicando altera o data-theme
        await themeToggle.click();
        const html = page.locator('html');
        // By default it checks OS preference, clicking it should explicitly set the opposite
        const initialTheme = await html.getAttribute('data-theme');
        await themeToggle.click();
        const newTheme = await html.getAttribute('data-theme');
        expect(initialTheme).not.toBe(newTheme);
    });
});
