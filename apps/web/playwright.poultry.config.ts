import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Run via node e2e/run-poultry.mjs so posted history lives only in an owned test database.
export default defineConfig({ ...base, testMatch: '**/poultry.browser.ts' });
