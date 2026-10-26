import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createClient } from 'redis';
import { createWebAuthFixture, closeWebAuthDatabase } from '../../api/test/web-auth-fixture.js';
import type { StoredSession } from '../lib/auth/session-store';

const proxy = 'http://127.0.0.1:4311';
const redis = createClient({
    url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    socket: { reconnectStrategy: false },
});
const prefix = process.env.WEB_SESSION_PREFIX!;
const cookieName = 'ancastle-session';
const test = base.extend<{ account: Awaited<ReturnType<typeof createWebAuthFixture>> }>({
    account: async ({ context }, provide) => {
        const account = await createWebAuthFixture();
        await provide(account);
        await context.clearCookies();
        await account.cleanup();
    },
});

test.beforeAll(async () => {
    await redis.connect();
});
test.beforeEach(async ({ request }) => {
    await request.post(proxy + '/_fixture/reset');
});
test.afterEach(async () => {
    for await (const keys of redis.scanIterator({ MATCH: prefix + '*', COUNT: 100 })) {
        if (keys.length) await redis.del(keys);
    }
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
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

async function expectSignedInAs(page: Page, email: string) {
    await expect(page.getByRole('complementary').locator('summary')).toContainText(
        email.slice(0, 20),
    );
}

async function session(context: BrowserContext) {
    const cookie = (await context.cookies()).find((entry) => entry.name === cookieName);
    if (!cookie) throw new Error('Expected an opaque session cookie');
    const key = prefix + createHash('sha256').update(cookie.value).digest('hex');
    const raw = await redis.get(key);
    if (!raw) throw new Error('Expected server-side session state');
    return { cookie, key, record: JSON.parse(raw) as StoredSession };
}

test('redirects unauthenticated protected and legacy routes', async ({ page }) => {
    for (const path of ['/app/dashboard', '/app', '/dashboard']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/login$/);
        await expect(
            page.getByRole('heading', { name: 'Sign in to your workspace' }),
        ).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toHaveCount(0);
    }
});

test('signs in, survives navigation/reload, and keeps tokens off the browser', async ({
    page,
    context,
    account,
}) => {
    const bodies: Promise<string>[] = [];
    const consoleMessages: string[] = [];
    page.on('response', (response) => {
        if (['document', 'fetch'].includes(response.request().resourceType()))
            bodies.push(response.text().catch(() => ''));
    });
    page.on('console', (message) => consoleMessages.push(message.text()));
    await signIn(page, account);
    const { cookie, record } = await session(context);
    expect(/^[a-zA-Z0-9_-]{43}$/.test(cookie.value)).toBe(true);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');
    expect(cookie.value === record.accessToken || cookie.value === record.refreshToken).toBe(false);
    expect((await page.evaluate(() => document.cookie)).includes(cookieName)).toBe(false);
    await page.reload();
    await expectSignedInAs(page, account.email);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    const storage = await page.evaluate(() =>
        JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
    );
    const content = [
        await page.content(),
        storage,
        ...(await Promise.all(bodies)),
        ...consoleMessages,
    ].join('\n');
    expect(content.includes(record.accessToken)).toBe(false);
    expect(content.includes(record.refreshToken)).toBe(false);
});

test('shows pending and authentication error states without exposing backend details', async ({
    page,
    request,
    account,
}) => {
    await request.post(proxy + '/_fixture/mode', { data: { loginDelay: 1500 } });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill('incorrect-test-input');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    await expect(
        page.getByRole('form', { name: 'Sign in', exact: true }).getByRole('alert'),
    ).toHaveText('Invalid email or password.');
    await request.post(proxy + '/_fixture/mode', { data: { unavailable: true, loginDelay: 0 } });
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
        page.getByRole('form', { name: 'Sign in', exact: true }).getByRole('alert'),
    ).toHaveText('Sign-in is temporarily unavailable. Please try again.');
    expect((await page.content()).includes('private upstream error')).toBe(false);
});

test('validates server-side fields when native form validation is bypassed', async ({ page }) => {
    await page.goto('/login');
    await page
        .getByRole('form', { name: 'Sign in', exact: true })
        .evaluate((form) => form.setAttribute('novalidate', ''));
    await page.getByLabel('Email', { exact: true }).fill('invalid');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('#email-error')).toHaveText('Enter a valid email address.');
    await expect(page.locator('#password-error')).toHaveText('Enter your password.');
});

test('coordinates parallel refreshes through Redis and preserves the cookie handle', async ({
    page,
    context,
    request,
    account,
}) => {
    await signIn(page, account);
    const initial = await session(context);
    await redis.set(initial.key, JSON.stringify({ ...initial.record, accessExpiresAt: 1 }), {
        XX: true,
        KEEPTTL: true,
    });
    await request.post(proxy + '/_fixture/reset');
    const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
            context.request.get('/app/dashboard?request=' + index),
        ),
    );
    expect(responses.every((response) => response.ok())).toBe(true);
    const refreshed = await session(context);
    expect(refreshed.record.version !== initial.record.version).toBe(true);
    expect(refreshed.cookie.value === initial.cookie.value).toBe(true);
    expect(refreshed.record.expiresAt).toBe(initial.record.expiresAt);
    const metrics = (await (await request.get(proxy + '/_fixture/metrics')).json()) as {
        refresh: number;
    };
    expect(metrics.refresh).toBe(1);
    await page.reload();
    await expectSignedInAs(page, account.email);
});

test('rejects expired Redis sessions and forged browser handles', async ({
    page,
    context,
    account,
}) => {
    await signIn(page, account);
    const current = await session(context);
    await redis.pExpire(current.key, 50);
    await expect.poll(() => redis.exists(current.key)).toBe(0);
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    await context.addCookies([
        {
            name: cookieName,
            value: 'a'.repeat(43),
            domain: '127.0.0.1',
            path: '/',
            httpOnly: true,
            sameSite: 'Lax',
        },
    ]);
    await page.goto('/app/dashboard');
    await expect(page).toHaveURL(/\/login$/);
});

test('rejects a revoked backend refresh session', async ({ page, context, account }) => {
    await signIn(page, account);
    const current = await session(context);
    await account.revokeSessions();
    await redis.set(current.key, JSON.stringify({ ...current.record, accessExpiresAt: 1 }), {
        XX: true,
        KEEPTTL: true,
    });
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    expect(await redis.exists(current.key)).toBe(0);
});

test('rejects an inactive user on the next protected request', async ({
    page,
    context,
    account,
}) => {
    await signIn(page, account);
    const current = await session(context);
    await account.deactivateUser();
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    expect(await redis.exists(current.key)).toBe(0);
});

test('logs out, revokes the API refresh session, and rejects replay of the old cookie', async ({
    page,
    context,
    account,
}) => {
    await signIn(page, account);
    const current = await session(context);
    await page.locator('summary').filter({ hasText: 'User menu' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).some((cookie) => cookie.name === cookieName)).toBe(false);
    expect(await redis.exists(current.key)).toBe(0);
    expect(await account.sessionCounts()).toEqual({ total: 1, revoked: 1 });
    await context.addCookies([{ ...current.cookie, expires: -1 }]);
    await page.goto('/app/dashboard');
    await expect(page).toHaveURL(/\/login$/);
});

test('recovers from a temporary upstream outage without destroying a valid session', async ({
    page,
    context,
    request,
    account,
}) => {
    await signIn(page, account);
    const current = await session(context);
    await request.post(proxy + '/_fixture/mode', { data: { unavailable: true } });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Unable to check your session' })).toBeVisible();
    expect(await redis.exists(current.key)).toBe(1);
    await request.post(proxy + '/_fixture/mode', { data: { unavailable: false } });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expectSignedInAs(page, account.email);
});

test('rejects cross-origin action requests without mutating the session', async ({
    page,
    context,
    account,
}) => {
    const actionRequest = page.waitForRequest(
        (entry) => entry.method() === 'POST' && Boolean(entry.headers()['next-action']),
    );
    await signIn(page, account);
    const actionId = (await actionRequest).headers()['next-action'];
    const current = await session(context);
    const response = await context.request.post('/app/dashboard', {
        headers: {
            origin: 'https://attacker.invalid',
            'next-action': actionId,
            'content-type': 'text/plain;charset=UTF-8',
        },
        data: '[]',
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(await redis.exists(current.key)).toBe(1);
    await page.reload();
    await expectSignedInAs(page, account.email);
});

test('keeps the login form usable on mobile and desktop', async ({ page }) => {
    for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 812 });
        await page.goto('/login');
        await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
    }
});
