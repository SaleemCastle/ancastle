import { defineConfig } from '@playwright/test';
import base from './playwright.config';
// Reuse the disposable database runner: node e2e/run-poultry.mjs playwright.catalog.config.ts
export default defineConfig({ ...base, testMatch: '**/catalog.browser.ts' });
