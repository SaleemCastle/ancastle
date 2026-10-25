import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { createWebAuthFixture, closeWebAuthDatabase } from '../../api/test/web-auth-fixture.js';

const test = base.extend<{ account: Awaited<ReturnType<typeof createWebAuthFixture>> }>({
    account: async ({ context }, provide) => {
        const account = await createWebAuthFixture({ role: 'STAFF' });
        try {
            await provide(account);
        } finally {
            await context.clearCookies();
            await account.cleanup();
        }
    },
});
const redis = createClient({
    url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    socket: { reconnectStrategy: false },
});
const proxy = 'http://127.0.0.1:4311';
test.beforeAll(async () => {
    await redis.connect();
});
test.beforeEach(async ({ request }) => {
    await request.post(proxy + '/_fixture/reset');
});
test.afterEach(async () => {
    for await (const keys of redis.scanIterator({
        MATCH: process.env.WEB_SESSION_PREFIX! + '*',
        COUNT: 100,
    }))
        if (keys.length) await redis.del(keys);
});
test.afterAll(async () => {
    await redis.close();
    await closeWebAuthDatabase();
});

async function signIn(page: Page, account: { email: string; password: string }) {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}
const selectedUrl = (organization: string, farm?: string) =>
    '/app/dashboard?organization=' + organization + (farm ? '&farm=' + farm : '');

test('automatically uses the single accessible farm, retains navigation and provides user-menu logout', async ({
    page,
    account,
}) => {
    await account.addFarm('Single Farm', 'SINGLE');
    await account.addFarm('Unassigned Farm', 'UNASSIGNED', { assigned: false });
    await signIn(page, account);
    await expect(page.getByRole('region', { name: 'Farm context' })).toContainText(
        'Farm: Single Farm (SINGLE)',
    );
    await expect(page.getByLabel('Farm', { exact: true })).toHaveCount(0);
    await page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Dashboard', exact: true })
        .click();
    await expect(page).toHaveURL(/farm=/);
    await page.reload();
    await expect(page.getByText('Working in Single Farm', { exact: true })).toBeVisible();
    await page.locator('summary').filter({ hasText: 'User menu' }).click();
    await expect(page.getByText('STAFF', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
});

test('selects among multiple assigned farms and retains the choice across reload/navigation', async ({
    page,
    account,
}) => {
    await account.addFarm('First Farm', 'FIRST');
    const second = await account.addFarm('Second Farm', 'SECOND');
    await account.addFarm('Inactive Farm', 'INACTIVE', { isActive: false });
    await signIn(page, account);
    await expect(
        page.getByText('Choose a farm to view farm operations.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Farm', { exact: true }).locator('option')).toHaveText([
        'Choose a farm',
        'First Farm (FIRST)',
        'Second Farm (SECOND)',
    ]);
    await page.getByLabel('Farm', { exact: true }).selectOption(second.id);
    await page.getByRole('button', { name: 'Use farm', exact: true }).click();
    await expect(page.getByText('Working in Second Farm', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Farm', { exact: true })).toHaveValue(second.id);
    await page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Dashboard', exact: true })
        .click();
    await expect(page.getByText('Working in Second Farm', { exact: true })).toBeVisible();
});

test('switches organizations without carrying stronger permissions or another organization’s farm', async ({
    page,
    account,
}) => {
    await account.setRole('ADMIN');
    const first = await account.addFarm('Admin Farm', 'ADMIN', { assigned: false });
    const otherOrg = await account.addOrganization('Second Organization', 'STAFF');
    const second = await account.addFarm('Assigned Farm', 'ASSIGNED', { organizationId: otherOrg });
    await account.addFarm('Other Unassigned Farm', 'OTHER', {
        organizationId: otherOrg,
        assigned: false,
    });
    await signIn(page, account);
    await page.getByLabel('Organization', { exact: true }).selectOption(otherOrg);
    await page.getByRole('button', { name: 'Switch organization', exact: true }).click();
    await expect(page.getByText('Working in Assigned Farm', { exact: true })).toBeVisible();
    await page.locator('summary').filter({ hasText: 'User menu' }).click();
    await expect(page.getByText('STAFF', { exact: true })).toBeVisible();
    await expect(page.getByText('ADMIN', { exact: true })).toHaveCount(0);
    await page.goto(selectedUrl(otherOrg, first.id));
    await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
    await page.goto(selectedUrl(otherOrg, second.id));
    await expect(page.getByText('Working in Assigned Farm', { exact: true })).toBeVisible();
});

test('rejects client URL/DOM manipulation, foreign, unassigned and inactive farm IDs', async ({
    page,
    account,
}) => {
    const own = await account.addFarm('Own Farm', 'OWN');
    await account.addFarm('Second Allowed Farm', 'SECOND');
    const unassigned = await account.addFarm('Private Farm', 'PRIVATE', { assigned: false });
    const inactive = await account.addFarm('Inactive Farm', 'INACTIVE', { isActive: false });
    await signIn(page, account);
    for (const farm of [unassigned.id, inactive.id, randomUUID(), 'invalid']) {
        await page.goto(selectedUrl(account.organizationId, farm));
        await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
        await expect(page.getByText('Working in Own Farm', { exact: true })).toHaveCount(0);
    }
    await page.goto(selectedUrl(randomUUID(), own.id));
    await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
    await page.goto(selectedUrl(account.organizationId, own.id) + '&farm=' + unassigned.id);
    await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
    await page.goto(selectedUrl(account.organizationId, own.id));
    await expect(page.getByText('Working in Own Farm', { exact: true })).toBeVisible();
    await page.getByLabel('Farm', { exact: true }).evaluate((select, id) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = 'Injected farm';
        select.appendChild(option);
    }, unassigned.id);
    await page.getByLabel('Farm', { exact: true }).selectOption(unassigned.id);
    await page.getByRole('button', { name: 'Use farm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
    await expect(page.getByText('Private Farm', { exact: false })).toHaveCount(0);
});

test('revalidates revoked farm grants, farm lifecycle and inactive memberships on each request', async ({
    page,
    account,
}) => {
    const farm = await account.addFarm('Working Farm', 'WORKING');
    await signIn(page, account);
    await page.goto(selectedUrl(account.organizationId, farm.id));
    await account.setFarmAccess(farm.id, false);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
    await account.setFarmAccess(farm.id, true);
    await page.reload();
    await expect(page.getByText('Working in Working Farm', { exact: true })).toBeVisible();
    await account.setFarmActive(farm.id, false);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
    await account.setMembershipActive(false);
    await page.goto('/app/dashboard');
    await expect(
        page.getByText('No active organizations are available. Contact an administrator.', {
            exact: true,
        }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Farm context' })).toHaveCount(0);
});

test('handles empty farm access and preserves a usable shell on mobile and desktop', async ({
    page,
    account,
}) => {
    await signIn(page, account);
    await expect(
        page.getByText('No farms available. Contact an administrator for access.', { exact: true }),
    ).toBeVisible();
    for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 812 });
        await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
        await page.locator('summary').filter({ hasText: 'User menu' }).click();
        await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
        await page.locator('summary').filter({ hasText: 'User menu' }).click();
    }
});

test('shows context loading and safe retry when discovery fails without losing authentication', async ({
    page,
    request,
    account,
}) => {
    await account.addFarm('Available Farm', 'AVAILABLE');
    await signIn(page, account);
    await request.post(proxy + '/_fixture/mode', { data: { contextDelay: 1800 } });
    await page.reload({ waitUntil: 'commit' });
    await expect(
        page.getByRole('status').filter({ hasText: 'Loading your workspace' }),
    ).toBeVisible();
    await expect(page.getByText('Working in Available Farm', { exact: true })).toBeVisible();
    await request.post(proxy + '/_fixture/mode', {
        data: { contextDelay: 0, contextUnavailable: true },
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Unable to check your session' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toHaveCount(0);
    await request.post(proxy + '/_fixture/reset');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('Working in Available Farm', { exact: true })).toBeVisible();
});
