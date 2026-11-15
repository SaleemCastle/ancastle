import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createWebAuthFixture, closeWebAuthDatabase } from '../../api/test/web-auth-fixture.js';

async function signIn(page: Page, account: { email: string; password: string }) {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}
async function setupApi(
    request: APIRequestContext,
    account: { email: string; password: string; organizationId: string },
) {
    const login = await request.post('http://127.0.0.1:4310/api/auth/login', {
        data: { email: account.email, password: account.password },
    });
    expect(login.ok()).toBe(true);
    const headers = { Authorization: 'Bearer ' + (await login.json()).accessToken };
    const base = `http://127.0.0.1:4310/api/organizations/${account.organizationId}`;
    return {
        headers,
        base,
        post: async (path: string, data: object) => {
            const response = await request.post(`${base}/${path}`, { headers, data });
            expect(response.ok()).toBe(true);
            return (await response.json()).data;
        },
    };
}

test('manages produce, poultry and per-farm eligibility through real responsive catalog pages', async ({
    page,
    request,
}) => {
    test.setTimeout(90000);
    const account = await createWebAuthFixture();
    try {
        const north = await account.addFarm('Catalog North', 'NORTH');
        const south = await account.addFarm('Catalog South', 'SOUTH');
        const api = await setupApi(request, account);
        const pumpkin = await api.post('inventory-items', {
            name: 'Pumpkin source',
            category: 'PRODUCE',
            unit: 'KG',
        });
        await api.post('inventory-items', { name: 'Feed excluded', category: 'FEED', unit: 'KG' });
        const inactive = await api.post('inventory-items', {
            name: 'Inactive excluded',
            category: 'PRODUCE',
            unit: 'EACH',
        });
        await api.post(`inventory-items/${inactive.id}/deactivate`, {});
        const northFlock = await api.post(`farms/${north.id}/flocks`, {
            name: 'North catalog birds',
            placementDate: '2026-11-01',
            startingBirdCount: 100,
        });
        const southFlock = await api.post(`farms/${south.id}/flocks`, {
            name: 'South catalog birds',
            placementDate: '2026-11-01',
            startingBirdCount: 100,
        });
        await signIn(page, account);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/app/sales-products?organization=${account.organizationId}`);
        await page.getByRole('link', { name: 'Add product', exact: true }).click();
        let productForm = page.getByRole('form', { name: 'Create sales product', exact: true });
        await productForm.getByRole('button', { name: 'Create product', exact: true }).click();
        expect(
            await productForm
                .getByLabel('Product name', { exact: true })
                .evaluate((element) => (element as HTMLInputElement).validity.valueMissing),
        ).toBe(true);
        await productForm.getByLabel('Product name', { exact: true }).fill('Fresh pumpkin');
        await productForm.getByLabel('Product kind', { exact: true }).selectOption('PRODUCE');
        await expect(productForm.getByRole('option', { name: /Pumpkin source/ })).toHaveCount(1);
        await expect(
            productForm.getByRole('option', { name: /Feed excluded|Inactive excluded/ }),
        ).toHaveCount(0);
        await productForm
            .getByLabel('Produce inventory item', { exact: true })
            .selectOption(pumpkin.id);
        await expect(productForm).toContainText('Sale unit: KG');
        await productForm.getByRole('button', { name: 'Create product', exact: true }).click();
        await expect(productForm.getByRole('status')).toHaveText('Product created.');
        await productForm.getByRole('link', { name: 'View product', exact: true }).click();
        await expect(
            page.getByRole('region', { name: 'Product definition', exact: true }),
        ).toContainText('Pumpkin source');
        await page.getByRole('link', { name: 'Edit product', exact: true }).click();
        const edit = page.getByRole('form', { name: 'Edit sales product', exact: true });
        await edit.getByLabel('Product name', { exact: true }).fill('Fresh market pumpkin');
        await edit.getByRole('button', { name: 'Save product', exact: true }).click();
        await expect(edit.getByRole('status')).toHaveText('Product saved.');
        await edit.getByRole('link', { name: 'View product', exact: true }).click();
        await expect(
            page.getByRole('heading', { name: 'Fresh market pumpkin', exact: true }),
        ).toBeVisible();
        const lifecycle = page.getByRole('form', { name: 'Product lifecycle', exact: true });
        await lifecycle.getByRole('button', { name: 'Deactivate product', exact: true }).click();
        await expect(
            lifecycle.getByRole('button', { name: 'Reactivate product', exact: true }),
        ).toBeVisible();
        await lifecycle.getByRole('button', { name: 'Reactivate product', exact: true }).click();
        await expect(
            lifecycle.getByRole('button', { name: 'Deactivate product', exact: true }),
        ).toBeVisible();
        await page.getByRole('link', { name: 'Back to catalog', exact: true }).click();
        await page.getByRole('link', { name: 'Add product', exact: true }).click();
        productForm = page.getByRole('form', { name: 'Create sales product', exact: true });
        await productForm.getByLabel('Product name', { exact: true }).fill('Farm poultry');
        await productForm.getByLabel('Product kind', { exact: true }).selectOption('POULTRY');
        await productForm.getByRole('button', { name: 'Create product', exact: true }).click();
        await expect(productForm.getByLabel('Product name', { exact: true })).toHaveValue('');
        await productForm.getByRole('link', { name: 'View product', exact: true }).click();
        const eligibility = page.getByRole('region', { name: 'Poultry eligibility', exact: true });
        await expect(eligibility).toContainText('Select an accessible farm');
        await eligibility.getByLabel('Source farm', { exact: true }).selectOption(north.id);
        await eligibility.getByRole('button', { name: 'View farm sources', exact: true }).click();
        let attach = page.getByRole('form', { name: 'Attach flock', exact: true });
        await expect(attach.getByRole('option', { name: /South catalog birds/ })).toHaveCount(0);
        await attach.getByLabel('Active flock', { exact: true }).selectOption(northFlock.id);
        await attach.getByRole('button', { name: 'Attach flock', exact: true }).click();
        const source = page.getByRole('form', {
            name: 'Eligibility for North catalog birds',
            exact: true,
        });
        await expect(source).toBeVisible();
        await source.getByRole('button', { name: 'Deactivate eligibility', exact: true }).click();
        await expect(
            source.getByRole('button', { name: 'Reactivate eligibility', exact: true }),
        ).toBeVisible();
        await source.getByRole('button', { name: 'Reactivate eligibility', exact: true }).click();
        await expect(
            source.getByRole('button', { name: 'Deactivate eligibility', exact: true }),
        ).toBeVisible();
        await eligibility.getByLabel('Source farm', { exact: true }).selectOption(south.id);
        await eligibility.getByRole('button', { name: 'View farm sources', exact: true }).click();
        await expect(eligibility).not.toContainText('North catalog birds');
        attach = page.getByRole('form', { name: 'Attach flock', exact: true });
        await attach.getByLabel('Active flock', { exact: true }).selectOption(southFlock.id);
        await attach.getByRole('button', { name: 'Attach flock', exact: true }).click();
        await expect(
            page.getByRole('form', { name: 'Eligibility for South catalog birds', exact: true }),
        ).toBeVisible();
        await eligibility.getByLabel('Source farm', { exact: true }).selectOption(north.id);
        await eligibility.getByRole('button', { name: 'View farm sources', exact: true }).click();
        await expect(source).toBeVisible();
        await expect(eligibility).not.toContainText('South catalog birds');
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.goto(`/app/sales-products?organization=${account.organizationId}&pageSize=1`);
        await expect(page.getByRole('table')).toContainText('Fresh market pumpkin');
        await page.getByRole('link', { name: 'Next products page', exact: true }).click();
        await expect(page.getByRole('table')).toContainText('Farm poultry');
        await page.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('PRODUCE');
        await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
        await expect(page.getByRole('table')).toContainText('Fresh market pumpkin');
        await expect(page.getByRole('table')).not.toContainText('Farm poultry');
    } finally {
        await closeWebAuthDatabase();
    }
});

test('keeps catalog reads available to STAFF while redacting revoked farm and other-organization sources', async ({
    page,
    request,
}) => {
    test.setTimeout(60000);
    const account = await createWebAuthFixture();
    try {
        const north = await account.addFarm('Permitted farm', 'NORTH');
        const south = await account.addFarm('Unassigned farm', 'SOUTH', { assigned: false });
        const otherOrganization = await account.addOrganization(
            'Other sales organization',
            'STAFF',
        );
        const api = await setupApi(request, account);
        const northFlock = await api.post(`farms/${north.id}/flocks`, {
            name: 'Permitted source birds',
            placementDate: '2026-11-01',
            startingBirdCount: 100,
        });
        const southFlock = await api.post(`farms/${south.id}/flocks`, {
            name: 'Hidden south source',
            placementDate: '2026-11-01',
            startingBirdCount: 100,
        });
        const product = await api.post('sales-products', {
            name: 'Read-only poultry',
            kind: 'POULTRY',
        });
        await api.post(`farms/${north.id}/sales-products/${product.id}/poultry-sources`, {
            flockId: northFlock.id,
        });
        await api.post(`farms/${south.id}/sales-products/${product.id}/poultry-sources`, {
            flockId: southFlock.id,
        });
        await account.setRole('STAFF');
        await signIn(page, account);
        await page.goto(
            `/app/sales-products/${product.id}?organization=${account.organizationId}&farm=${north.id}`,
        );
        await expect(
            page.getByRole('heading', { name: 'Read-only poultry', exact: true }),
        ).toBeVisible();
        await expect(
            page.getByRole('region', { name: 'Poultry eligibility', exact: true }),
        ).toContainText('Permitted source birds');
        await expect(page.getByRole('link', { name: 'Edit product', exact: true })).toHaveCount(0);
        await expect(
            page.getByRole('form', { name: 'Product lifecycle', exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole('form', { name: 'Attach flock', exact: true })).toHaveCount(0);
        await expect(
            page.getByRole('option', { name: 'Unassigned farm', exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole('main')).not.toContainText('Hidden south source');
        await page.getByLabel('Organization', { exact: true }).selectOption(otherOrganization);
        await page.getByRole('button', { name: 'Switch organization', exact: true }).click();
        await expect(
            page.getByRole('heading', { name: 'Sales catalog', exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('main')).not.toContainText('Read-only poultry');
        await expect(page.getByRole('main')).not.toContainText('Permitted source birds');
        await page.goto(
            `/app/sales-products/${product.id}?organization=${account.organizationId}&farm=${north.id}`,
        );
        await expect(
            page.getByRole('heading', { name: 'Read-only poultry', exact: true }),
        ).toBeVisible();
        await account.setFarmAccess(north.id, false);
        await page.reload();
        await expect(
            page.getByRole('heading', { name: 'Workspace unavailable', exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('main')).not.toContainText('Permitted source birds');
        await page.goto(`/app/sales-products?organization=${account.organizationId}`);
        await expect(page.getByRole('table')).toContainText('Read-only poultry');
        await expect(page.getByRole('link', { name: 'Add product', exact: true })).toHaveCount(0);
    } finally {
        await closeWebAuthDatabase();
    }
});
