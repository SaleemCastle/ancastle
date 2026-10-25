import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { createWebAuthFixture, closeWebAuthDatabase } from '../../api/test/web-auth-fixture.js';

const test = base.extend<{ account: Awaited<ReturnType<typeof createWebAuthFixture>> }>({
    account: async ({ context }, provide) => {
        const account = await createWebAuthFixture();
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
const url = (path: string, organization: string) => path + '?organization=' + organization;
async function fillNewUser(page: Page, email: string, password: string) {
    const form = page.getByRole('form', { name: 'Create user', exact: true });
    await form.getByLabel('Email', { exact: true }).fill(email);
    await form.getByLabel('Initial password', { exact: true }).fill(password);
    return form;
}

test('redirects unauthenticated user administration routes', async ({ page }) => {
    for (const path of ['/app/users', '/app/users/new', '/app/users/' + randomUUID()]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/login$/);
    }
});
test('bootstraps a user with multiple farms, keeps credentials out of responses, and uses existing login', async ({
    page,
    browser,
    account,
}) => {
    const first = await account.addFarm('First Farm', 'FIRST');
    const second = await account.addFarm('Second Farm', 'SECOND');
    const email = 'created-' + randomUUID() + '@example.com';
    const password = 'Created-user-test-input!';
    await signIn(page, account);
    await page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Organization users', exact: true })
        .click();
    await page.getByRole('link', { name: 'Create user', exact: true }).click();
    const bodies: Promise<string>[] = [];
    page.on('response', (response) => {
        if (['document', 'fetch'].includes(response.request().resourceType()))
            bodies.push(response.text().catch(() => ''));
    });
    const form = await fillNewUser(page, email, password);
    await form.getByLabel('Organization display name', { exact: true }).fill('Created Member');
    await expect(form.getByLabel('Initial password', { exact: true })).toHaveAttribute(
        'type',
        'password',
    );
    await form.getByLabel('First Farm (FIRST)', { exact: true }).check();
    await form.getByLabel('Second Farm (SECOND)', { exact: true }).check();
    await form.getByRole('button', { name: 'Create user', exact: true }).click();
    await expect(form.getByRole('status')).toHaveText('User created.');
    await expect(form.getByLabel('Initial password', { exact: true })).toHaveValue('');
    const content = (await Promise.all(bodies)).join('\n');
    expect(content.includes(password)).toBe(false);
    expect(content.includes('passwordHash')).toBe(false);
    await form.getByRole('link', { name: 'View created user', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Created Member', exact: true })).toBeVisible();
    await expect(page.getByTestId('member-farm-summary')).toHaveText('2 assigned farms');
    await expect(
        page.getByRole('main').locator('input[name="password"], input[name="email"]'),
    ).toHaveCount(0);
    const member = await account.memberByEmail(email);
    expect(member?.farmAccessAssignments.map((grant) => grant.farmId).sort()).toEqual(
        [first.id, second.id].sort(),
    );
    const memberContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        const memberPage = await memberContext.newPage();
        await signIn(memberPage, { email, password });
        await expect(memberPage.getByLabel('Farm', { exact: true }).locator('option')).toHaveText([
            'Choose a farm',
            'First Farm (FIRST)',
            'Second Farm (SECOND)',
        ]);
    } finally {
        await memberContext.close();
    }
});
test('edits and clears only the organization-specific profile of a shared identity', async ({
    page,
    account,
}) => {
    const member = await account.addMember({ displayName: 'First Name' });
    const other = await account.addOrganization('Other Organization', 'STAFF');
    await account.attachMember(member.id, other, 'STAFF', 'Other Name');
    await signIn(page, account);
    await page.goto(url('/app/users/' + member.id, account.organizationId));
    const form = page.getByRole('form', { name: 'Organization member profile', exact: true });
    await form.getByLabel('Organization display name', { exact: true }).fill('Updated Name');
    await form.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(form.getByRole('status')).toHaveText('Organization profile saved.');
    await expect(page.getByRole('heading', { name: 'Updated Name', exact: true })).toBeVisible();
    expect(await account.memberByEmail(member.email, other)).toMatchObject({
        displayName: 'Other Name',
        user: { email: member.email, isActive: true },
    });
    await form.getByLabel('Organization display name', { exact: true }).fill('');
    await form.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.getByRole('heading', { name: member.email, exact: true })).toBeVisible();
    expect(await account.memberByEmail(member.email)).toMatchObject({ displayName: null });
});
test('updates roles, replaces multiple/single/zero farm grants and changes membership lifecycle', async ({
    page,
    account,
}) => {
    const first = await account.addFarm('First Farm', 'FIRST');
    const second = await account.addFarm('Second Farm', 'SECOND');
    const member = await account.addMember({ farmIds: [first.id] });
    await signIn(page, account);
    await page.goto(url('/app/users/' + member.id, account.organizationId));
    const role = page.getByRole('form', { name: 'Organization role', exact: true });
    await role.getByLabel('Organization role', { exact: true }).selectOption('MANAGER');
    await role.getByRole('button', { name: 'Save role', exact: true }).click();
    await expect(role.getByRole('status')).toHaveText('Organization role saved.');
    await expect(page.getByTestId('member-role')).toHaveText('MANAGER');
    const grants = page.getByRole('form', { name: 'Member farm access', exact: true });
    await grants.getByLabel('Second Farm (SECOND)', { exact: true }).check();
    await grants.getByRole('button', { name: 'Save farm access', exact: true }).click();
    await expect(grants.getByRole('status')).toHaveText('Farm access saved.');
    await expect(page.getByTestId('member-farm-summary')).toHaveText('2 assigned farms');
    await grants.getByLabel('First Farm (FIRST)', { exact: true }).uncheck();
    await grants.getByRole('button', { name: 'Save farm access', exact: true }).click();
    await expect(page.getByTestId('member-farm-summary')).toHaveText('1 assigned farm');
    expect(await account.memberByEmail(member.email)).toMatchObject({
        farmAccessAssignments: [{ farmId: second.id }],
    });
    await grants.getByLabel('Second Farm (SECOND)', { exact: true }).uncheck();
    await grants.getByRole('button', { name: 'Save farm access', exact: true }).click();
    await expect(page.getByTestId('member-farm-summary')).toHaveText('0 assigned farms');
    const lifecycle = page.getByRole('form', { name: 'Membership lifecycle', exact: true });
    await lifecycle.getByRole('button', { name: 'Deactivate membership', exact: true }).click();
    await expect(page.getByTestId('membership-status')).toHaveText('Inactive');
    await lifecycle.getByRole('button', { name: 'Reactivate membership', exact: true }).click();
    await expect(page.getByTestId('membership-status')).toHaveText('Active');
    expect(await account.memberByEmail(member.email)).toMatchObject({
        role: 'MANAGER',
        isActive: true,
        user: { isActive: true },
    });
});
test('preserves globally inactive identity state when reactivating an organization membership', async ({
    page,
    account,
}) => {
    const member = await account.addMember({ isActive: false, userIsActive: false });
    await signIn(page, account);
    await page.goto(url('/app/users/' + member.id, account.organizationId));
    await page
        .getByRole('form', { name: 'Membership lifecycle', exact: true })
        .getByRole('button', { name: 'Reactivate membership', exact: true })
        .click();
    await expect(page.getByTestId('membership-status')).toHaveText('Active');
    expect(await account.memberByEmail(member.email)).toMatchObject({
        isActive: true,
        user: { isActive: false },
    });
    await expect(
        page
            .getByRole('main')
            .locator('input[name="email"], input[name="password"], input[name="userIsActive"]'),
    ).toHaveCount(0);
});
test('enforces read-only manager access and rejects staff administration access', async ({
    page,
    account,
}) => {
    const member = await account.addMember();
    await account.setRole('MANAGER');
    await signIn(page, account);
    await page.goto(url('/app/users', account.organizationId));
    await expect(
        page.getByRole('table', { name: 'Organization members', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create user', exact: true })).toHaveCount(0);
    await page.goto(url('/app/users/' + member.id, account.organizationId));
    await expect(page.getByRole('heading', { name: member.email, exact: true })).toBeVisible();
    for (const name of [
        'Organization member profile',
        'Organization role',
        'Member farm access',
        'Membership lifecycle',
    ])
        await expect(page.getByRole('form', { name, exact: true })).toHaveCount(0);
    await account.setRole('STAFF');
    await page.goto(url('/app/users', account.organizationId));
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
        'You do not have permission to perform this action.',
    );
    await expect(
        page
            .getByRole('navigation', { name: 'Primary navigation' })
            .getByRole('link', { name: 'Organization users', exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole('table', { name: 'Organization members', exact: true }),
    ).toHaveCount(0);
});
test('rejects cross-organization target users and foreign farm grant injection atomically', async ({
    page,
    account,
}) => {
    const ownFarm = await account.addFarm('Own Farm', 'OWN');
    const member = await account.addMember({ farmIds: [ownFarm.id] });
    const other = await account.addOrganization('Other Organization', 'STAFF');
    const foreignFarm = await account.addFarm('Foreign Farm', 'FOREIGN', { organizationId: other });
    const foreign = await account.addMember({ organizationId: other });
    await signIn(page, account);
    await page.goto(url('/app/users/' + foreign.id, account.organizationId));
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
        'This resource is unavailable.',
    );
    await expect(page.getByRole('heading', { name: foreign.email, exact: true })).toHaveCount(0);
    await page.goto(url('/app/users/' + member.id, account.organizationId));
    const role = page.getByRole('form', { name: 'Organization role', exact: true });
    await role.locator('input[name="userId"]').evaluate((input, id) => {
        (input as HTMLInputElement).value = id;
    }, foreign.id);
    await role.getByLabel('Organization role', { exact: true }).selectOption('ADMIN');
    await role.getByRole('button', { name: 'Save role', exact: true }).click();
    await expect(role.getByRole('alert')).toHaveText('This resource is unavailable.');
    expect(await account.memberByEmail(foreign.email, other)).toMatchObject({ role: 'STAFF' });
    const grants = page.getByRole('form', { name: 'Member farm access', exact: true });
    await grants.getByLabel('Own Farm (OWN)', { exact: true }).evaluate((input, id) => {
        (input as HTMLInputElement).value = id;
    }, foreignFarm.id);
    await grants.getByRole('button', { name: 'Save farm access', exact: true }).click();
    await expect(grants.getByRole('alert')).toHaveText(
        'Selected farms are unavailable in this organization.',
    );
    expect(await account.memberByEmail(member.email)).toMatchObject({
        farmAccessAssignments: [{ farmId: ownFarm.id }],
    });
});
test('preserves required administrative access with safe last-administrator errors', async ({
    page,
    account,
}) => {
    await signIn(page, account);
    await page.goto(url('/app/users/' + account.userId, account.organizationId));
    const role = page.getByRole('form', { name: 'Organization role', exact: true });
    await role.getByLabel('Organization role', { exact: true }).selectOption('STAFF');
    await role.getByRole('button', { name: 'Save role', exact: true }).click();
    await expect(role.getByRole('alert')).toHaveText(
        'At least one active administrator must remain in the organization.',
    );
    const lifecycle = page.getByRole('form', { name: 'Membership lifecycle', exact: true });
    await lifecycle.getByRole('button', { name: 'Deactivate membership', exact: true }).click();
    await expect(lifecycle.getByRole('alert')).toHaveText(
        'At least one active administrator must remain in the organization.',
    );
    expect(await account.memberByEmail(account.email)).toMatchObject({
        role: 'OWNER',
        isActive: true,
    });
});
test('rejects stale permission and inactive membership mutation attempts', async ({
    page,
    account,
}) => {
    const member = await account.addMember();
    await signIn(page, account);
    await page.goto(url('/app/users/' + member.id, account.organizationId));
    const role = page.getByRole('form', { name: 'Organization role', exact: true });
    await account.setRole('MANAGER');
    await role.getByLabel('Organization role', { exact: true }).selectOption('ADMIN');
    await role.getByRole('button', { name: 'Save role', exact: true }).click();
    await expect(role.getByRole('alert')).toHaveText(
        'You do not have permission to perform this action.',
    );
    await account.setRole('OWNER');
    await page.reload();
    await account.setMembershipActive(false);
    await role.getByLabel('Organization role', { exact: true }).selectOption('ADMIN');
    await role.getByRole('button', { name: 'Save role', exact: true }).click();
    await expect(role.getByRole('alert')).toHaveText(
        'You do not have permission to perform this action.',
    );
    expect(await account.memberByEmail(member.email)).toMatchObject({ role: 'STAFF' });
});
test('validates bootstrap fields and returns generic creation conflicts without credential echoes', async ({
    page,
    account,
}) => {
    await signIn(page, account);
    await page.goto(url('/app/users/new', account.organizationId));
    const form = await fillNewUser(page, 'invalid', 'short');
    await form.evaluate((element) => element.setAttribute('novalidate', ''));
    await form.getByRole('button', { name: 'Create user', exact: true }).click();
    await expect(form.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByLabel('Initial password', { exact: true })).toHaveAttribute(
        'aria-invalid',
        'true',
    );
    await fillNewUser(page, account.email, 'Duplicate-account-test-input!');
    await form.getByRole('button', { name: 'Create user', exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText('User creation could not be completed.');
    expect((await page.content()).includes('passwordHash')).toBe(false);
});
test('paginates, filters and renders user administration responsively', async ({
    page,
    account,
}) => {
    await account.addMember();
    await account.addMember({ isActive: false });
    await account.addMember();
    await signIn(page, account);
    await page.goto(url('/app/users', account.organizationId) + '&pageSize=2');
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByText('4 users · Page 1 of 2', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Next page', exact: true }).click();
    await expect(page.getByText('4 users · Page 2 of 2', { exact: true })).toBeVisible();
    await page.getByLabel('Membership status', { exact: true }).selectOption('false');
    await page.getByRole('button', { name: 'Apply filter', exact: true }).click();
    await expect(page.getByText('1 user · Page 1 of 1', { exact: true })).toBeVisible();
    for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 812 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
        await page.goto(url('/app/users/new', account.organizationId));
        await expect(page.getByLabel('Initial password', { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
    }
});
