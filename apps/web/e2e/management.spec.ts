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

test('redirects unauthenticated organization/farm administration routes', async ({ page }) => {
    for (const path of [
        '/app/settings/organization',
        '/app/farms',
        '/app/farms/new',
        '/app/farms/' + randomUUID(),
    ]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/login$/);
        await expect(page.getByRole('form', { name: 'Create farm', exact: true })).toHaveCount(0);
    }
});
test('edits supported organization fields and refreshes the current organization identity', async ({
    page,
    account,
}) => {
    await signIn(page, account);
    await page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Organization settings', exact: true })
        .click();
    const form = page.getByRole('form', { name: 'Organization profile', exact: true });
    await form.getByLabel('Organization name', { exact: true }).fill('Updated Organization');
    await form.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(form.getByRole('status')).toHaveText('Organization saved.');
    await expect(page.getByRole('banner')).toContainText('Updated Organization');
    await expect(form.locator('input[name="slug"], input[name="isActive"]')).toHaveCount(0);
    await page.reload();
    await expect(form.getByLabel('Organization name', { exact: true })).toHaveValue(
        'Updated Organization',
    );
});
test('creates, edits, deactivates and reactivates a farm through the real APIs', async ({
    page,
    account,
}) => {
    await signIn(page, account);
    await page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Farms', exact: true })
        .click();
    await expect(page.getByText('No farms match this view.', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Create farm', exact: true }).click();
    const create = page.getByRole('form', { name: 'Create farm', exact: true });
    await create.getByLabel('Farm name', { exact: true }).fill('New Farm');
    await create.getByLabel('Farm code', { exact: true }).fill('new_farm');
    await create.getByRole('button', { name: 'Create farm', exact: true }).click();
    await expect(create.getByRole('status')).toHaveText('Farm created.');
    await create.getByRole('link', { name: 'View created farm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New Farm', exact: true })).toBeVisible();
    const edit = page.getByRole('form', { name: 'Edit farm', exact: true });
    await expect(edit.getByLabel('Farm code', { exact: true })).toHaveValue('NEW_FARM');
    await edit.getByLabel('Farm name', { exact: true }).fill('Renamed Farm');
    await edit.getByLabel('Farm code', { exact: true }).fill('renamed');
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(edit.getByRole('status')).toHaveText('Farm saved.');
    await expect(page.getByRole('heading', { name: 'Renamed Farm', exact: true })).toBeVisible();
    const lifecycle = page.getByRole('form', { name: 'Farm lifecycle', exact: true });
    await lifecycle.getByRole('button', { name: 'Deactivate farm', exact: true }).click();
    await expect(lifecycle.getByRole('status')).toHaveText('Farm deactivated.');
    await expect(page.getByTestId('farm-status')).toHaveText('Inactive');
    await lifecycle.getByRole('button', { name: 'Reactivate farm', exact: true }).click();
    await expect(lifecycle.getByRole('status')).toHaveText('Farm reactivated.');
    await expect(page.getByTestId('farm-status')).toHaveText('Active');
    await expect
        .poll(() => account.findFarm('RENAMED'))
        .toMatchObject({ name: 'Renamed Farm', isActive: true });
});
test('shows shared validation and duplicate-code errors without upstream details', async ({
    page,
    account,
}) => {
    await account.addFarm('Existing Farm', 'EXISTING');
    await signIn(page, account);
    await page.goto(url('/app/farms/new', account.organizationId));
    const form = page.getByRole('form', { name: 'Create farm', exact: true });
    await form.getByLabel('Farm name', { exact: true }).fill(' ');
    await form.getByLabel('Farm code', { exact: true }).fill('invalid code');
    await form.getByRole('button', { name: 'Create farm', exact: true }).click();
    await expect(form.getByLabel('Farm name', { exact: true })).toHaveAttribute(
        'aria-invalid',
        'true',
    );
    await expect(form.getByLabel('Farm code', { exact: true })).toHaveAttribute(
        'aria-invalid',
        'true',
    );
    await form.getByLabel('Farm name', { exact: true }).fill('Duplicate Farm');
    await form.getByLabel('Farm code', { exact: true }).fill('existing');
    await form.getByRole('button', { name: 'Create farm', exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText(
        'A farm with this code already exists in this organization.',
    );
    expect(await account.findFarm('EXISTING')).toMatchObject({ name: 'Existing Farm' });
});
test('shows read-only organization and assigned farm views without restricted controls', async ({
    page,
    account,
}) => {
    const own = await account.addFarm('Assigned Farm', 'ASSIGNED');
    await account.addFarm('Hidden Farm', 'HIDDEN', { assigned: false });
    await account.setRole('STAFF');
    await signIn(page, account);
    await page.goto(url('/app/settings/organization', account.organizationId));
    await expect(
        page.getByText('Your access to organization settings is read-only.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('form', { name: 'Organization profile', exact: true })).toHaveCount(
        0,
    );
    await page.goto(url('/app/farms', account.organizationId));
    await expect(page.getByRole('link', { name: 'Create farm', exact: true })).toHaveCount(0);
    await expect(page.getByText('Hidden Farm', { exact: true })).toHaveCount(0);
    await page.goto(url('/app/farms/' + own.id, account.organizationId));
    await expect(
        page.getByText('Your access to this farm is read-only.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('form', { name: 'Edit farm', exact: true })).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'Farm lifecycle', exact: true })).toHaveCount(0);
    await page.goto(url('/app/farms/new', account.organizationId));
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
        'You do not have permission to perform this action.',
    );
    await expect(page.getByRole('form', { name: 'Create farm', exact: true })).toHaveCount(0);
});
test('rejects cross-organization detail IDs and tampered farm mutation IDs without modifying either tenant', async ({
    page,
    account,
}) => {
    const own = await account.addFarm('Own Farm', 'OWN');
    const otherOrg = await account.addOrganization('Other Organization', 'STAFF');
    const foreign = await account.addFarm('Other Farm', 'OTHER', { organizationId: otherOrg });
    await signIn(page, account);
    await page.goto(url('/app/farms/' + foreign.id, account.organizationId));
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
        'This resource is unavailable.',
    );
    await expect(page.getByRole('heading', { name: 'Other Farm', exact: true })).toHaveCount(0);
    await page.goto(url('/app/farms/' + own.id, account.organizationId));
    const edit = page.getByRole('form', { name: 'Edit farm', exact: true });
    await edit.locator('input[name="farmId"]').evaluate((input, id) => {
        (input as HTMLInputElement).value = id;
    }, foreign.id);
    await edit.getByLabel('Farm name', { exact: true }).fill('Cross Tenant Write');
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(edit.getByRole('alert')).toHaveText('This resource is unavailable.');
    expect(await account.findFarm('OWN')).toMatchObject({ name: 'Own Farm' });
    expect(await account.findFarm('OTHER', otherOrg)).toMatchObject({ name: 'Other Farm' });
});
test('rechecks selected organization permissions instead of trusting hidden organization IDs or stale forms', async ({
    page,
    account,
}) => {
    const otherOrg = await account.addOrganization('Other Organization', 'STAFF');
    await signIn(page, account);
    await page.goto(url('/app/farms/new', account.organizationId));
    const form = page.getByRole('form', { name: 'Create farm', exact: true });
    await form.locator('input[name="organization"]').evaluate((input, id) => {
        (input as HTMLInputElement).value = id;
    }, otherOrg);
    await form.getByLabel('Farm name', { exact: true }).fill('Forbidden Farm');
    await form.getByLabel('Farm code', { exact: true }).fill('FORBIDDEN');
    await form.getByRole('button', { name: 'Create farm', exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText(
        'You do not have permission to perform this action.',
    );
    expect(await account.findFarm('FORBIDDEN', otherOrg)).toBeNull();
    await page.reload();
    await account.setRole('STAFF');
    await form.getByLabel('Farm name', { exact: true }).fill('Stale Form');
    await form.getByLabel('Farm code', { exact: true }).fill('STALE');
    await form.getByRole('button', { name: 'Create farm', exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText(
        'You do not have permission to perform this action.',
    );
    expect(await account.findFarm('STALE')).toBeNull();
});
test('paginates and filters the real scoped farm list', async ({ page, account }) => {
    for (let index = 1; index <= 5; index++)
        await account.addFarm('Farm ' + index, 'FARM' + index, { isActive: index <= 3 });
    await signIn(page, account);
    await page.goto(url('/app/farms', account.organizationId) + '&pageSize=2');
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByText('5 farms · Page 1 of 3', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Next farm page', exact: true }).click();
    await expect(page.getByText('5 farms · Page 2 of 3', { exact: true })).toBeVisible();
    await page.getByLabel('Status', { exact: true }).selectOption('false');
    await page.getByRole('button', { name: 'Apply filter', exact: true }).click();
    await expect(page.getByText('2 farms · Page 1 of 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Farm 4', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Farm 1', exact: true })).toHaveCount(0);
});
test('handles API outages and saving states without leaking upstream errors', async ({
    page,
    request,
    account,
}) => {
    await signIn(page, account);
    await page.goto(url('/app/farms/new', account.organizationId));
    const form = page.getByRole('form', { name: 'Create farm', exact: true });
    await request.post(proxy + '/_fixture/mode', {
        data: { organizationDelay: 1600, organizationUnavailable: true },
    });
    await form.getByLabel('Farm name', { exact: true }).fill('Retry Farm');
    await form.getByLabel('Farm code', { exact: true }).fill('RETRY');
    await form.getByRole('button', { name: 'Create farm', exact: true }).click();
    await expect(form.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    await expect(form.getByRole('alert')).toHaveText(
        'This service is temporarily unavailable. Please try again.',
    );
    expect((await page.content()).includes('private upstream error')).toBe(false);
    expect(await account.findFarm('RETRY')).toBeNull();
    await request.post(proxy + '/_fixture/reset');
    await form.getByLabel('Farm name', { exact: true }).fill('Retry Farm');
    await form.getByLabel('Farm code', { exact: true }).fill('RETRY');
    await form.getByRole('button', { name: 'Create farm', exact: true }).click();
    await expect(form.getByRole('status')).toHaveText('Farm created.');
});
test('keeps farm administration usable on mobile and desktop', async ({ page, account }) => {
    await account.addFarm('Responsive Farm', 'RESPONSIVE');
    await signIn(page, account);
    for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 812 });
        await page.goto(url('/app/farms', account.organizationId));
        await expect(
            page.getByRole('table', { name: 'Accessible farms', exact: true }),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
        await page.getByRole('link', { name: 'Create farm', exact: true }).click();
        await expect(page.getByLabel('Farm name', { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
    }
});

test('creates, edits, deactivates and reactivates a customer through the real APIs', async ({
    page,
    account,
}) => {
    await account.addFarm('Responsive Farm', 'RESPONSIVE');
    await signIn(page, account);

    await page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Customers', exact: true })
        .click();

    await expect(page.getByText('No customers yet.', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Add customer', exact: true }).click();

    const create = page.getByRole('form', {
        name: 'Create customer',
        exact: true,
    });

    await create.getByLabel('Customer type', { exact: true }).selectOption('BUSINESS');

    await create.getByLabel('Customer name', { exact: true }).fill('Castle Produce Ltd');

    await create.getByLabel('Contact person', { exact: true }).fill('Jane Castle');

    await create.getByLabel('Phone', { exact: true }).fill('876-555-0100');

    await create.getByLabel('Email', { exact: true }).fill('SALES@EXAMPLE.COM');

    await create.getByLabel('Address', { exact: true }).fill('Spanish Town');

    await create.getByLabel('Notes', { exact: true }).fill('Wholesale customer');

    await create.getByRole('button', { name: 'Create customer', exact: true }).click();

    await expect(create.getByRole('status')).toHaveText('Customer created.');

    await create
        .getByRole('link', {
            name: 'View created customer',
            exact: true,
        })
        .click();

    await expect(
        page.getByRole('heading', {
            name: 'Castle Produce Ltd',
            exact: true,
        }),
    ).toBeVisible();

    await expect(page.getByText('Type: Business', { exact: true })).toBeVisible();

    const edit = page.getByRole('form', {
        name: 'Edit customer',
        exact: true,
    });

    await expect(edit.getByLabel('Customer type', { exact: true })).toHaveValue('BUSINESS');

    await expect(edit.getByLabel('Email', { exact: true })).toHaveValue('sales@example.com');

    await edit.getByLabel('Customer name', { exact: true }).fill('Ancastle Produce Ltd');

    await edit.getByLabel('Contact person', { exact: true }).fill('John Castle');

    await edit.getByRole('button', { name: 'Save changes', exact: true }).click();

    await expect(edit.getByRole('status')).toHaveText('Customer saved.');

    await expect(
        page.getByRole('heading', {
            name: 'Ancastle Produce Ltd',
            exact: true,
        }),
    ).toBeVisible();

    const lifecycle = page.getByRole('form', {
        name: 'Customer lifecycle',
        exact: true,
    });

    await lifecycle
        .getByRole('button', {
            name: 'Deactivate customer',
            exact: true,
        })
        .click();

    await expect(lifecycle.getByRole('status')).toHaveText('Customer deactivated.');

    await expect(page.getByRole('status', { name: 'Status: Inactive', exact: true })).toBeVisible();

    await lifecycle
        .getByRole('button', {
            name: 'Reactivate customer',
            exact: true,
        })
        .click();

    await expect(lifecycle.getByRole('status')).toHaveText('Customer reactivated.');

    await expect(page.getByRole('status', { name: 'Status: Active', exact: true })).toBeVisible();

    await expect
        .poll(() => account.findCustomer('CUS-000001'))
        .toMatchObject({
            name: 'Ancastle Produce Ltd',
            type: 'BUSINESS',
            contactPerson: 'John Castle',
            email: 'sales@example.com',
            isActive: true,
        });
});

test('creates, edits, deactivates and reactivates a supplier through the real APIs', async ({
    page,
    account,
}) => {
    await account.addFarm('Responsive Farm', 'RESPONSIVE');
    await signIn(page, account);

    await page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Suppliers', exact: true })
        .click();

    await expect(page.getByText('No suppliers yet.', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Add supplier', exact: true }).click();

    const create = page.getByRole('form', {
        name: 'Create supplier',
        exact: true,
    });

    await create.getByLabel('Supplier name', { exact: true }).fill('Castle Produce Ltd');

    await create.getByLabel('Contact person', { exact: true }).fill('Jane Castle');

    await create.getByLabel('Phone', { exact: true }).fill('876-555-0100');

    await create.getByLabel('Email', { exact: true }).fill('SALES@EXAMPLE.COM');

    await create.getByLabel('Address', { exact: true }).fill('Spanish Town');

    await create.getByLabel('Notes', { exact: true }).fill('Wholesale supplier');

    await create.getByRole('button', { name: 'Create supplier', exact: true }).click();

    await expect(create.getByRole('status')).toHaveText('Supplier created.');

    await create
        .getByRole('link', {
            name: 'View created supplier',
            exact: true,
        })
        .click();

    await expect(
        page.getByRole('heading', {
            name: 'Castle Produce Ltd',
            exact: true,
        }),
    ).toBeVisible();

    const edit = page.getByRole('form', {
        name: 'Edit supplier',
        exact: true,
    });

    await expect(edit.getByLabel('Email', { exact: true })).toHaveValue('sales@example.com');

    await edit.getByLabel('Supplier name', { exact: true }).fill('Ancastle Produce Ltd');

    await edit.getByLabel('Contact person', { exact: true }).fill('John Castle');

    await edit.getByRole('button', { name: 'Save changes', exact: true }).click();

    await expect(edit.getByRole('status')).toHaveText('Supplier saved.');

    await expect(
        page.getByRole('heading', {
            name: 'Ancastle Produce Ltd',
            exact: true,
        }),
    ).toBeVisible();

    const lifecycle = page.getByRole('form', {
        name: 'Supplier lifecycle',
        exact: true,
    });

    await lifecycle
        .getByRole('button', {
            name: 'Deactivate supplier',
            exact: true,
        })
        .click();

    await expect(lifecycle.getByRole('status')).toHaveText('Supplier deactivated.');

    await expect(page.getByRole('status', { name: 'Status: Inactive', exact: true })).toBeVisible();

    await lifecycle
        .getByRole('button', {
            name: 'Reactivate supplier',
            exact: true,
        })
        .click();

    await expect(lifecycle.getByRole('status')).toHaveText('Supplier reactivated.');

    await expect(page.getByRole('status', { name: 'Status: Active', exact: true })).toBeVisible();

    await expect
        .poll(() => account.findSupplier('SUP-000001'))
        .toMatchObject({
            name: 'Ancastle Produce Ltd',
            contactPerson: 'John Castle',
            email: 'sales@example.com',
            isActive: true,
        });
});

test('enforces customer management permissions in the UI', async ({ page, account }) => {
    const customer = await account.addCustomer('Permission Customer', {
        type: 'BUSINESS',
        contactPerson: 'Test Contact',
        email: 'permissions@example.com',
    });

    await account.setRole('STAFF');
    await signIn(page, account);

    await page.goto(url(`/app/customers/${customer.id}`, account.organizationId));

    await expect(
        page.getByRole('heading', {
            name: 'Permission Customer',
            exact: true,
        }),
    ).toBeVisible();

    await expect(
        page.getByRole('form', {
            name: 'Edit customer',
            exact: true,
        }),
    ).toHaveCount(0);

    await expect(
        page.getByRole('form', {
            name: 'Customer lifecycle',
            exact: true,
        }),
    ).toHaveCount(0);

    await page.goto(url('/app/customers', account.organizationId));

    await expect(
        page.getByRole('link', {
            name: 'Add customer',
            exact: true,
        }),
    ).toHaveCount(0);

    await account.setRole('MANAGER');

    await page.goto(url(`/app/customers/${customer.id}`, account.organizationId));

    await expect(
        page.getByRole('form', {
            name: 'Edit customer',
            exact: true,
        }),
    ).toBeVisible();

    await expect(
        page.getByRole('form', {
            name: 'Customer lifecycle',
            exact: true,
        }),
    ).toHaveCount(0);

    await page.goto(url('/app/customers', account.organizationId));

    await expect(
        page.getByRole('link', {
            name: 'Add customer',
            exact: true,
        }),
    ).toBeVisible();
});

test('supports customer search, lifecycle filtering and pagination', async ({ page, account }) => {
    await account.addCustomer('Alpha Farms Customer', {
        type: 'BUSINESS',
        email: 'alpha@example.com',
    });

    await account.addCustomer('Bravo Retail Customer', {
        type: 'INDIVIDUAL',
        phone: '876-555-0200',
    });

    await account.addCustomer('Charlie Wholesale Customer', {
        type: 'BUSINESS',
        isActive: false,
    });

    await signIn(page, account);

    // Search
    await page.goto(url('/app/customers', account.organizationId));

    const search = page.getByRole('search');

    await search.getByRole('searchbox').fill('Alpha Farms');

    await search.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(
        page
            .getByRole('cell')
            .filter({ hasText: 'Alpha Farms Customer' })
            .getByText('Alpha Farms Customer', { exact: true })
            .first(),
    ).toBeVisible();

    await expect(page.getByRole('cell').filter({ hasText: 'Bravo Retail Customer' })).toHaveCount(
        0,
    );

    // Inactive lifecycle filter.
    await page.goto(url('/app/customers', account.organizationId) + '&isActive=false');

    await expect(
        page
            .getByRole('cell')
            .filter({ hasText: 'Charlie Wholesale Customer' })
            .getByText('Charlie Wholesale Customer', { exact: true })
            .first(),
    ).toBeVisible();

    await expect(page.getByRole('cell').filter({ hasText: 'Alpha Farms Customer' })).toHaveCount(0);

    // Force pagination with a page size of 1.
    await page.goto(url('/app/customers', account.organizationId) + '&page=1&pageSize=1');

    await expect(page.getByText(/3 customers.*Page 1 of 3/)).toBeVisible();

    const next = page.getByRole('link', {
        name: 'Next customer page',
        exact: true,
    });

    await expect(next).toBeVisible();
    await next.click();

    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/3 customers.*Page 2 of 3/)).toBeVisible();
});

test('rejects cross-organization customer detail IDs and tampered customer mutation IDs without modifying either tenant', async ({
    page,
    account,
}) => {
    const own = await account.addCustomer('Own Customer', {
        type: 'BUSINESS',
        email: 'own@example.com',
    });

    const otherOrg = await account.addOrganization('Other Organization', 'STAFF');

    const foreign = await account.addCustomer('Other Customer', {
        organizationId: otherOrg,
        type: 'BUSINESS',
        email: 'other@example.com',
    });

    await signIn(page, account);

    // A Customer ID from another organization must not be readable
    // through the currently selected organization.
    await page.goto(url('/app/customers/' + foreign.id, account.organizationId));

    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
        'This resource is unavailable.',
    );

    await expect(
        page.getByRole('heading', {
            name: 'Other Customer',
            exact: true,
        }),
    ).toHaveCount(0);

    // Open a legitimate Customer belonging to the selected organization.
    await page.goto(url('/app/customers/' + own.id, account.organizationId));

    const edit = page.getByRole('form', {
        name: 'Edit customer',
        exact: true,
    });

    await expect(edit).toBeVisible();

    // Tamper with the hidden Customer ID so the form attempts to update
    // a Customer belonging to the other organization.
    await edit.locator('input[name="customerId"]').evaluate((input, id) => {
        (input as HTMLInputElement).value = id;
    }, foreign.id);

    await edit.getByLabel('Customer name', { exact: true }).fill('Cross Tenant Write');

    await edit
        .getByRole('button', {
            name: 'Save changes',
            exact: true,
        })
        .click();

    await expect(edit.getByRole('alert')).toHaveText('This resource is unavailable.');

    // Neither tenant's Customer should have been modified.
    expect(await account.findCustomer(own.code)).toMatchObject({
        name: 'Own Customer',
    });

    expect(await account.findCustomer(foreign.code, otherOrg)).toMatchObject({
        name: 'Other Customer',
    });
});

test('keeps customer management usable across mobile and desktop layouts', async ({
    page,
    account,
}) => {
    await account.addCustomer('Responsive Customer', {
        type: 'BUSINESS',
        contactPerson: 'Test Contact',
        email: 'responsive@example.com',
    });

    await signIn(page, account);

    // Mobile Customer list.
    await page.setViewportSize({
        width: 375,
        height: 812,
    });

    await page.goto(url('/app/customers', account.organizationId));

    await expect(
        page.getByRole('heading', {
            name: 'Customers',
            exact: true,
        }),
    ).toBeVisible();

    await expect(
        page.getByRole('link', {
            name: 'Add customer',
            exact: true,
        }),
    ).toBeVisible();

    await expect(
        page.getByRole('cell', {
            name: 'Responsive Customer Business',
            exact: true,
        }),
    ).toBeVisible();

    // The page itself should not introduce horizontal overflow.
    const mobileLayout = await page.evaluate(() => {
        const main = document.querySelector('main');
        const table = document.querySelector('table');
        const scrollContainer = table?.parentElement;

        return {
            viewportWidth: document.documentElement.clientWidth,
            body: {
                scrollWidth: document.body.scrollWidth,
                clientWidth: document.body.clientWidth,
            },
            main: main
                ? {
                      scrollWidth: main.scrollWidth,
                      clientWidth: main.clientWidth,
                  }
                : null,
            tableContainer: scrollContainer
                ? {
                      scrollWidth: scrollContainer.scrollWidth,
                      clientWidth: scrollContainer.clientWidth,
                      overflowX: getComputedStyle(scrollContainer).overflowX,
                  }
                : null,
        };
    });

    expect(mobileLayout.body.scrollWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth);

    expect(mobileLayout.main).not.toBeNull();

    expect(mobileLayout.main!.scrollWidth).toBeLessThanOrEqual(mobileLayout.main!.clientWidth);

    expect(mobileLayout.tableContainer).not.toBeNull();

    expect(mobileLayout.tableContainer!.overflowX).toBe('auto');

    expect(mobileLayout.tableContainer!.scrollWidth).toBeGreaterThan(
        mobileLayout.tableContainer!.clientWidth,
    );
    // Mobile create form remains usable.
    await page
        .getByRole('link', {
            name: 'Add customer',
            exact: true,
        })
        .click();

    await expect(
        page.getByRole('form', {
            name: 'Create customer',
            exact: true,
        }),
    ).toBeVisible();

    await expect(page.getByLabel('Customer name', { exact: true })).toBeVisible();

    // Desktop Customer list remains usable after resizing.
    await page.setViewportSize({
        width: 1280,
        height: 900,
    });

    await page.goto(url('/app/customers', account.organizationId));

    await expect(
        page.getByRole('heading', {
            name: 'Customers',
            exact: true,
        }),
    ).toBeVisible();

    await expect(
        page.getByRole('cell', {
            name: 'Responsive Customer Business',
            exact: true,
        }),
    ).toBeVisible();

    await expect(
        page.getByRole('link', {
            name: 'Add customer',
            exact: true,
        }),
    ).toBeVisible();
});
