import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
    ...base,
    testMatch: ['**/poultry.browser.ts', '**/management.spec.ts'],
});
