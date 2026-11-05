import { test, expect } from '@playwright/test';
import { createWebAuthFixture, closeWebAuthDatabase } from '../../api/test/web-auth-fixture.js';

test('posts mortality and feed with authoritative refresh, safe reset and farm-scoped history', async ({
    page,
    request,
}) => {
    test.setTimeout(60000);
    const account = await createWebAuthFixture();
    try {
        const farm = await account.addFarm('Poultry North', 'NORTH');
        const other = await account.addFarm('Poultry South', 'SOUTH');
        const login = await request.post('http://127.0.0.1:4310/api/auth/login', {
            data: { email: account.email, password: account.password },
        });
        expect(login.ok()).toBe(true);
        const token = (await login.json()).accessToken;
        const api = async (path: string, data: object) => {
            const response = await request.post(
                `http://127.0.0.1:4310/api/organizations/${account.organizationId}/${path}`,
                { headers: { Authorization: 'Bearer ' + token }, data },
            );
            expect(response.ok()).toBe(true);
            return (await response.json()).data;
        };
        const flock = await api(`farms/${farm.id}/flocks`, {
            name: 'North layers',
            placementDate: '2026-10-01',
            startingBirdCount: 100,
        });
        const item = await api('inventory-items', {
            name: 'Layer feed',
            category: 'FEED',
            unit: 'KG',
        });
        await api(`farms/${farm.id}/inventory/movements`, {
            inventoryItemId: item.id,
            quantity: 10,
            reason: 'RECEIPT',
            occurredAt: '2026-11-03T08:00:00.000Z',
        });
        await account.setRole('STAFF');
        await page.goto('/login');
        await page.getByLabel('Email', { exact: true }).fill(account.email);
        await page.getByLabel('Password', { exact: true }).fill(account.password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
        const detail = `/app/flocks/${flock.id}?organization=${account.organizationId}&farm=${farm.id}&historyPageSize=1`;
        await page.goto(detail);
        await page.setViewportSize({ width: 375, height: 812 });
        const mortality = page.getByRole('form', { name: 'Record mortality', exact: true });
        await mortality.getByLabel('Death count', { exact: true }).fill('2');
        await mortality
            .getByLabel('Occurred at (local time)', { exact: true })
            .fill('2026-11-03T09:30');
        await mortality.getByLabel('Cause', { exact: true }).fill('Unknown');
        await mortality.getByLabel('Reference', { exact: true }).fill('MORT-ONE');
        await mortality.getByRole('button', { name: 'Record mortality', exact: true }).click();
        await expect(mortality.getByRole('status')).toHaveText('Mortality recorded.');
        await expect(mortality.getByLabel('Death count', { exact: true })).toHaveValue('');
        await expect(
            page.getByRole('region', { name: 'Flock details', exact: true }),
        ).toContainText('Live population98');
        await expect(
            page.getByRole('region', { name: 'Mortality history', exact: true }),
        ).toContainText('MORT-ONE');
        // A second success must reset even when the success text is unchanged.
        await mortality.getByLabel('Death count', { exact: true }).fill('1');
        await mortality
            .getByLabel('Occurred at (local time)', { exact: true })
            .fill('2026-11-03T10:30');
        await mortality.getByLabel('Reference', { exact: true }).fill('MORT-TWO');
        await mortality.getByRole('button', { name: 'Record mortality', exact: true }).click();
        await expect(mortality.getByLabel('Death count', { exact: true })).toHaveValue('');
        const history = page.getByRole('region', { name: 'Mortality history', exact: true });
        await expect(history).toContainText('MORT-TWO');
        await history.getByRole('link', { name: 'Next', exact: true }).click();
        await expect(history).toContainText('MORT-ONE');
        const feed = page.getByRole('form', { name: 'Record feed usage', exact: true });
        await expect(feed.getByRole('option', { name: /Layer feed \(KG\)/ })).toBeAttached();
        await feed.getByLabel('Feed item', { exact: true }).selectOption(item.id);
        await feed.getByLabel('Consumption quantity', { exact: true }).fill('100');
        await feed.getByLabel('Occurred at (local time)', { exact: true }).fill('2026-11-03T10:45');
        await feed.getByRole('button', { name: 'Record feed usage', exact: true }).click();
        await expect(feed.getByRole('alert')).toHaveText(
            'There is not enough feed stock at this farm for that quantity.',
        );
        await expect(feed.getByLabel('Consumption quantity', { exact: true })).toHaveValue('100');
        await feed.getByLabel('Consumption quantity', { exact: true }).fill('1.125');
        await feed.getByLabel('Reference', { exact: true }).fill('FEED-ONE');
        await feed.getByRole('button', { name: 'Record feed usage', exact: true }).click();
        await expect(feed.getByRole('status')).toHaveText('Feed usage recorded.');
        await expect(feed.getByLabel('Consumption quantity', { exact: true })).toHaveValue('');
        await expect(
            page.getByRole('region', { name: 'Feed usage history', exact: true }),
        ).toContainText('Layer feed');
        await expect(
            page.getByRole('region', { name: 'Feed usage history', exact: true }),
        ).toContainText('1.125 KG');
        await expect(
            page.getByRole('region', { name: 'Flock details', exact: true }),
        ).toContainText('1.125 KG');
        await expect(feed.getByRole('option', { name: /8.875 available/ })).toBeAttached();
        for (const width of [375, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            expect(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= window.innerWidth,
                ),
            ).toBe(true);
        }
        await page.getByLabel('Farm', { exact: true }).selectOption(other.id);
        await page.getByRole('button', { name: 'Use farm', exact: true }).click();
        await expect(page.getByText('No flocks yet.', { exact: true })).toBeVisible();
        await expect(page.getByText('FEED-ONE', { exact: true })).toHaveCount(0);
        await account.setFarmAccess(farm.id, false);
        await page.goto(detail);
        await expect(
            page.getByRole('heading', { name: 'Workspace unavailable', exact: true }),
        ).toBeVisible();
    } finally {
        // The launcher disposes this entire temporary database, preserving ledger protections.
        await closeWebAuthDatabase();
    }
});
