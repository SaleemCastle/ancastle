import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
    createWebAuthFixture,
    closeWebAuthDatabase,
    webAuthPrisma,
} from '../../api/test/web-auth-fixture.js';

const apiOrigin = process.env.ANCASTLE_E2E_API_ORIGIN ?? 'http://127.0.0.1:4310';

test('explains that issuance remains disabled when the server gate is off', async ({ page }) => {
    test.skip(
        process.env.ANCASTLE_E2E_INVOICE_ISSUANCE === '1',
        'This scenario requires the disabled gate.',
    );
    const account = await createWebAuthFixture();
    try {
        const farm = await account.addFarm('Disabled Invoice Farm', 'INVOICE-DISABLED');
        await page.goto('/login');
        await page.getByLabel('Email', { exact: true }).fill(account.email);
        await page.getByLabel('Password', { exact: true }).fill(account.password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
        await page.goto(`/app/invoices?organization=${account.organizationId}&farm=${farm.id}`);
        await expect(page.getByRole('status')).toContainText(
            'Invoice issuance is not enabled for this deployment.',
        );
        await page.screenshot({
            path: resolve(
                process.cwd(),
                '../../docs/screenshots/m6-07-invoice-issuance-disabled.png',
            ),
            fullPage: true,
        });
    } finally {
        await closeWebAuthDatabase();
    }
});

async function organizationApi(
    request: APIRequestContext,
    account: { email: string; password: string; organizationId: string },
) {
    const login = await request.post(`${apiOrigin}/api/auth/login`, {
        data: { email: account.email, password: account.password },
    });
    expect(login.ok()).toBe(true);
    const headers = { Authorization: 'Bearer ' + (await login.json()).accessToken };
    const base = `${apiOrigin}/api/organizations/${account.organizationId}`;
    return {
        post: async (path: string, data: object, extraHeaders: Record<string, string> = {}) => {
            const response = await request.post(`${base}/${path}`, {
                headers: { ...headers, ...extraHeaders },
                data,
            });
            if (!response.ok()) throw new Error(await response.text());
            return (await response.json()).data;
        },
    };
}

test('lists and issues a fulfilment-backed invoice with exact JMD totals', async ({
    page,
    request,
}) => {
    test.skip(
        process.env.ANCASTLE_E2E_INVOICE_ISSUANCE !== '1',
        'Invoice activation is enabled only in the disposable E2E database.',
    );
    test.setTimeout(90000);
    const account = await createWebAuthFixture();
    try {
        const farm = await account.addFarm('Invoice Farm', 'INVOICE');
        const customer = await account.addCustomer('Invoice Buyer');
        const api = await organizationApi(request, account);
        const item = await api.post('inventory-items', {
            name: 'Invoice pumpkins',
            category: 'PRODUCE',
            unit: 'KG',
        });
        const product = await api.post('sales-products', {
            name: 'Pumpkins',
            kind: 'PRODUCE',
            inventoryItemId: item.id,
            expectedInventoryUnit: 'KG',
        });
        await api.post(`farms/${farm.id}/inventory/movements`, {
            inventoryItemId: item.id,
            expectedInventoryUnit: 'KG',
            quantity: '5',
            reason: 'RECEIPT',
            occurredAt: new Date().toISOString(),
        });
        const order = await api.post('orders', {
            customerId: customer.id,
            currency: 'JMD',
            terms: { saleType: 'CASH', creditTermDays: null },
            lines: [
                {
                    productId: product.id,
                    expectedProduct: { kind: 'PRODUCE', unit: 'KG', inventoryItemId: item.id },
                    quantity: '2',
                    unitPrice: '12.3456',
                },
            ],
        });
        const confirmed = await api.post(`orders/${order.id}/confirm`, {
            expectedOrderVersion: order.version,
        });
        const occurredAt = new Date().toISOString();
        const posted = await api.post(
            `farms/${farm.id}/orders/${order.id}/fulfilments`,
            {
                expectedOrderVersion: confirmed.version,
                occurredAt,
                allocations: [
                    {
                        orderLineId: confirmed.lines[0].id,
                        kind: 'PRODUCE',
                        inventoryItemId: item.id,
                        quantity: '2',
                    },
                ],
            },
            { 'Idempotency-Key': randomUUID() },
        );

        await page.goto('/login');
        await page.getByLabel('Email', { exact: true }).fill(account.email);
        await page.getByLabel('Password', { exact: true }).fill(account.password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`/app/invoices?organization=${account.organizationId}&farm=${farm.id}`);
        await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Invoice summary' })).toContainText(
            'JMD 0.00',
        );
        await expect(page.getByLabel('Eligible fulfilment')).toContainText(posted.fulfilment.code);
        await page.getByLabel('Eligible fulfilment').selectOption(posted.fulfilment.id);
        await page.getByRole('button', { name: 'Review issuance' }).click();
        const dialog = page.getByRole('dialog', { name: 'Confirm invoice issuance' });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel(/I have reviewed this fulfilment/).check();
        await dialog.getByRole('button', { name: 'Issue invoice' }).click();
        await expect(page.getByRole('status')).toContainText('Invoice issued successfully.');
        await expect(page.getByRole('region', { name: 'Invoice summary' })).toContainText(
            'JMD 24.69',
        );
        await expect(page.getByRole('table')).toContainText('INV-00000001');
        await expect(page.getByRole('table')).toContainText('JMD 24.69');

        const screenshotDirectory = resolve(process.cwd(), '../../docs/screenshots');
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
            path: resolve(screenshotDirectory, 'm6-07-invoice-list.png'),
            fullPage: true,
        });
        await page.getByRole('link', { name: 'INV-00000001' }).click();
        await expect(
            page.getByRole('heading', { name: 'INV-00000001', exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Customer snapshot' })).toBeVisible();
        await expect(page.getByText('JMD 12.3456')).toBeVisible();
        await page.screenshot({
            path: resolve(screenshotDirectory, 'm6-07-invoice-details.png'),
            fullPage: true,
        });
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(`/app/invoices?organization=${account.organizationId}&farm=${farm.id}`);
        await expect(page.getByText('JMD 24.69').first()).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.screenshot({
            path: resolve(screenshotDirectory, 'm6-07-invoice-list-mobile.png'),
            fullPage: true,
        });
        expect(
            await webAuthPrisma().invoice.count({
                where: { organizationId: account.organizationId },
            }),
        ).toBe(1);
    } finally {
        await closeWebAuthDatabase();
    }
});
