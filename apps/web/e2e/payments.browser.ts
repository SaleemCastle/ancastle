import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Invoice, Payment } from '@ancastle/types';
import {
    closeWebAuthDatabase,
    createWebAuthFixture,
    webAuthPrisma,
} from '../../api/test/web-auth-fixture.js';

const apiOrigin = process.env.ANCASTLE_E2E_API_ORIGIN ?? 'http://127.0.0.1:4310';
const proxyOrigin = process.env.ANCASTLE_E2E_PROXY_ORIGIN ?? 'http://127.0.0.1:4311';
type Account = Awaited<ReturnType<typeof createWebAuthFixture>>;

async function signIn(page: Page, account: Account) {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

async function organizationApi(
    request: APIRequestContext,
    account: Account,
    organization = account.organizationId,
) {
    const login = await request.post(apiOrigin + '/api/auth/login', {
        data: { email: account.email, password: account.password },
    });
    expect(login.ok()).toBe(true);
    const headers = { Authorization: 'Bearer ' + (await login.json()).accessToken };
    const base = apiOrigin + '/api/organizations/' + organization + '/';
    return {
        get: (path: string) => request.get(base + path, { headers }),
        post: (path: string, data: object, key = randomUUID()) =>
            request.post(base + path, { headers: { ...headers, 'Idempotency-Key': key }, data }),
        create: async <T>(path: string, data: object) => {
            const response = await request.post(base + path, {
                headers: { ...headers, 'Idempotency-Key': randomUUID() },
                data,
            });
            expect(response.ok(), await response.text()).toBe(true);
            return (await response.json()).data as T;
        },
    };
}

async function invoiceSource(
    api: Awaited<ReturnType<typeof organizationApi>>,
    farmId: string,
    customerId: string,
) {
    const item = await api.create<{ id: string }>('inventory-items', {
        name: 'Pumpkins',
        category: 'PRODUCE',
        unit: 'KG',
    });
    const product = await api.create<{ id: string }>('sales-products', {
        name: 'Pumpkins',
        kind: 'PRODUCE',
        inventoryItemId: item.id,
        expectedInventoryUnit: 'KG',
    });
    await api.create(`farms/${farmId}/inventory/movements`, {
        inventoryItemId: item.id,
        expectedInventoryUnit: 'KG',
        quantity: '5',
        reason: 'RECEIPT',
        occurredAt: new Date().toISOString(),
    });
    return async (unitPrice: string) => {
        const order = await api.create<{ id: string; version: number }>('orders', {
            customerId,
            currency: 'JMD',
            terms: { saleType: 'CASH', creditTermDays: null },
            lines: [
                {
                    productId: product.id,
                    expectedProduct: { kind: 'PRODUCE', unit: 'KG', inventoryItemId: item.id },
                    quantity: '1',
                    unitPrice,
                },
            ],
        });
        const confirmed = await api.create<{ version: number; lines: { id: string }[] }>(
            `orders/${order.id}/confirm`,
            {
                expectedOrderVersion: order.version,
            },
        );
        const posted = await api.create<{ fulfilment: { id: string } }>(
            `farms/${farmId}/orders/${order.id}/fulfilments`,
            {
                expectedOrderVersion: confirmed.version,
                occurredAt: new Date().toISOString(),
                allocations: [
                    {
                        orderLineId: confirmed.lines[0]!.id,
                        kind: 'PRODUCE',
                        inventoryItemId: item.id,
                        quantity: '1',
                    },
                ],
            },
        );
        return api.create<Invoice>(`invoices/fulfilments/${posted.fulfilment.id}/issue`, {});
    };
}

test.afterEach(async () => {
    await closeWebAuthDatabase();
});

test('records, safely retries, verifies, allocates and reverses through the real API', async ({
    page,
    request,
}) => {
    test.setTimeout(100_000);
    test.skip(
        process.env.ANCASTLE_E2E_INVOICE_ISSUANCE !== '1' ||
            process.env.ANCASTLE_E2E_SALES_FULFILMENT !== '1',
        'Invoice fixtures require the runner to enable the disposable-database flags.',
    );
    const owner = await createWebAuthFixture();
    const otherOrganization = await owner.addOrganization('West Farm Office');
    const farm = await owner.addFarm('Payment Fixture Farm', 'PAY-FARM');
    const customer = await owner.addCustomer('Kingston Produce Market');
    const api = await organizationApi(request, owner);
    const createInvoice = await invoiceSource(api, farm.id, customer.id);
    const first = await createInvoice('30.0000');
    const second = await createInvoice('35.0000');

    await signIn(page, owner);
    const list = '/app/payments?organization=' + owner.organizationId;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(list);
    await expect(page.getByText('No payments on this page.')).toBeVisible();

    async function recordCash() {
        await page.getByRole('button', { name: 'Record payment', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Record payment' });
        await dialog.getByLabel('Customer', { exact: true }).selectOption(customer.id);
        await dialog.getByLabel('Amount (JMD)', { exact: true }).fill('60');
        await dialog.getByLabel('Transaction date (Jamaica)').fill('2026-11-25');
        await dialog.getByLabel('Cash receipt number').fill('RCPT-0268');
        await dialog.getByRole('checkbox').check();
        await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
        return dialog;
    }

    await request.post(proxyOrigin + '/_fixture/mode', { data: { paymentResponseLoss: 2 } });
    const record = await recordCash();
    await expect(record.getByRole('alert')).toContainText('outcome could not be confirmed');
    await record.getByRole('button', { name: 'Retry same submission' }).click();
    await expect(record.getByRole('alert')).toContainText('outcome could not be confirmed');
    await expect(record.getByRole('button', { name: 'Retry same submission' })).toBeEnabled();
    await page.reload();
    await recordCash();
    await expect(page.getByRole('status')).toContainText(
        'Payment recorded and awaiting verification.',
    );
    const recorded = (await (await api.get('payments')).json()) as { data: Payment[] };
    expect(recorded.data).toHaveLength(1);
    expect(recorded.data[0]).toMatchObject({
        transactionDate: '2026-11-25',
        recordedByCurrentMember: true,
    });
    const paymentId = recorded.data[0]!.id;

    const duplicate = await recordCash();
    await expect(duplicate.getByRole('alert')).toContainText('already recorded');
    await page.keyboard.press('Escape');
    await expect(duplicate).toBeHidden();
    await expect(page.getByRole('button', { name: 'Record payment', exact: true })).toBeFocused();

    await page.getByRole('link', { name: 'RCPT-0268' }).click();
    await expect(page.getByRole('heading', { name: 'RCPT-0268', exact: true })).toBeVisible();
    await expect(
        page.getByRole('main').getByText('Pending verification', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allocate payment' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Verify payment' }).click();
    const verify = page.getByRole('dialog', { name: 'Verify payment' });
    await verify.getByRole('checkbox').check();
    await verify.getByRole('button', { name: 'Verify payment' }).click();
    await expect(page.getByText('Verified by the recorder')).toBeVisible();

    async function allocate() {
        await page.getByRole('button', { name: 'Allocate payment' }).click();
        return page.getByRole('dialog', { name: 'Allocate payment' });
    }
    const partial = await allocate();
    await partial.getByRole('button', { name: 'Add invoice ' + first.invoiceNumber }).click();
    const firstAmount = partial.getByRole('textbox', {
        name: new RegExp('Allocation for ' + first.invoiceNumber),
    });
    await firstAmount.fill('30.01');
    await partial.getByRole('checkbox').check();
    await partial.getByRole('button', { name: 'Allocate payment', exact: true }).click();
    await expect(partial.getByRole('alert')).toContainText('exceeds the outstanding');
    await firstAmount.fill('10.00');
    await partial.getByRole('button', { name: 'Allocate payment', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Payment allocations saved.');
    await expect(page.getByText('JMD 50.00', { exact: true })).toBeVisible();

    const full = await allocate();
    await full.getByRole('button', { name: 'Add invoice ' + second.invoiceNumber }).click();
    await full.getByLabel('Invoice settlement status').selectOption('PARTIALLY_PAID');
    await full.getByRole('button', { name: 'Add invoice ' + first.invoiceNumber }).click();
    await full
        .getByRole('textbox', { name: new RegExp('Allocation for ' + first.invoiceNumber) })
        .fill('20.00');
    await full
        .getByRole('textbox', { name: new RegExp('Allocation for ' + second.invoiceNumber) })
        .fill('30.00');
    const competing = await api.create<Payment>('payments', {
        customerId: customer.id,
        method: 'CASH',
        cashReceiptNumber: 'Competing receipt',
        amount: '1.00',
    });
    await api.create('payments/' + competing.id + '/verify', {});
    await api.create('payments/' + competing.id + '/allocations', {
        allocations: [{ invoiceId: first.id, amount: '1.00' }],
    });
    await full.getByRole('checkbox').check();
    await full.getByRole('button', { name: 'Allocate payment', exact: true }).click();
    await expect(full.getByRole('alert')).toContainText('outstanding invoice balance changed');
    await api.create('payments/' + competing.id + '/reverse', {
        reason: 'Competing test allocation settled separately',
    });
    await full.getByRole('button', { name: 'Reload balances' }).click();
    await expect(full.getByRole('alert')).toHaveCount(0);
    await full.getByRole('button', { name: 'Add invoice ' + first.invoiceNumber }).click();
    await full.getByLabel('Invoice settlement status').selectOption('UNPAID');
    await full.getByRole('button', { name: 'Add invoice ' + second.invoiceNumber }).click();
    await full
        .getByRole('textbox', { name: new RegExp('Allocation for ' + first.invoiceNumber) })
        .fill('20.00');
    await full
        .getByRole('textbox', { name: new RegExp('Allocation for ' + second.invoiceNumber) })
        .fill('30.00');
    await page.screenshot({
        path: resolve(process.cwd(), '../../docs/screenshots/m6-08-payment-allocation.png'),
        fullPage: true,
    });
    await full.getByRole('button', { name: 'Allocate payment', exact: true }).click();
    await expect(full).toBeHidden();
    await expect(page.getByRole('button', { name: 'Allocate payment' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Reverse payment' }).click();
    const reverse = page.getByRole('dialog', { name: 'Reverse payment' });
    await expect(reverse).toContainText('unwinds all active invoice allocations');
    await reverse.getByLabel('Reversal reason').fill('Receipt entered against the wrong customer');
    await reverse.getByRole('checkbox').check();
    await reverse.getByRole('button', { name: 'Reverse payment' }).click();
    await expect(page.getByText('Receipt entered against the wrong customer')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reverse payment' })).toHaveCount(0);
    await expect(page.getByText(/Unwound /)).toHaveCount(3);
    for (const invoice of [first, second]) {
        const result = await api.get('payments/invoices/' + invoice.id + '/balance');
        expect(result.ok()).toBe(true);
        expect((await result.json()).data.outstandingAmount).toBe(invoice.grossAmount);
    }
    await page.screenshot({
        path: resolve(process.cwd(), '../../docs/screenshots/m6-08-payment-reversal.png'),
        fullPage: true,
    });
    await page.goto(list + '&pageSize=1');
    await expect(page.getByRole('navigation', { name: 'Payment pages' })).toContainText(
        'Page 1 of 2',
    );
    await page.getByRole('link', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Payment pages' })).toContainText(
        'Page 2 of 2',
    );
    await page.goto(list);
    await expect(page.getByRole('link', { name: 'RCPT-0268' })).toBeVisible();
    const filter = page.getByRole('search', { name: 'Filter payments' });
    await filter.getByLabel('Customer', { exact: true }).selectOption(customer.id);
    await filter.getByRole('button', { name: 'Filter payments' }).click();
    await expect(page).toHaveURL(new RegExp('customerId=' + customer.id));
    await expect(page.getByRole('link', { name: 'RCPT-0268' })).toBeVisible();
    await page.screenshot({
        path: resolve(process.cwd(), '../../docs/screenshots/m6-08-payments.png'),
        fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
        path: resolve(process.cwd(), '../../docs/screenshots/m6-08-payments-mobile.png'),
        fullPage: true,
    });

    await page.getByLabel('Organization', { exact: true }).selectOption(otherOrganization);
    await page.getByRole('button', { name: 'Switch organization' }).click();
    await expect(page.getByText('No payments on this page.')).toBeVisible();
    await expect(page.getByText('RCPT-0268')).toHaveCount(0);
    await page.goto('/app/payments/' + paymentId + '?organization=' + otherOrganization);
    await expect(page.getByRole('alert').filter({ hasText: 'unavailable' })).toBeVisible();
    await expect(page.getByText('RCPT-0268')).toHaveCount(0);
    const staffApi = await organizationApi(request, owner, otherOrganization);
    expect((await staffApi.get('payments/' + paymentId)).status()).toBe(404);
});

test('handles bank evidence and rechecks permissions when a dialog is open', async ({
    page,
    request,
}) => {
    test.setTimeout(60_000);
    const manager = await createWebAuthFixture({ role: 'MANAGER' });
    const owner = await createWebAuthFixture();
    await webAuthPrisma().organizationMembership.create({
        data: { organizationId: manager.organizationId, userId: owner.userId, role: 'ADMIN' },
    });
    const customer = await manager.addCustomer('Montego Bay Trading');
    const ownerApi = await organizationApi(request, owner, manager.organizationId);
    const managerApi = await organizationApi(request, manager);
    const another = await ownerApi.create<Payment>('payments', {
        customerId: customer.id,
        method: 'CASH',
        cashReceiptNumber: 'Other member receipt',
        amount: '1.00',
    });
    await signIn(page, manager);
    const list = '/app/payments?organization=' + manager.organizationId;
    await page.goto(list);
    await page.getByRole('button', { name: 'Record payment' }).click();
    const bank = page.getByRole('dialog', { name: 'Record payment' });
    await bank.getByLabel('Customer', { exact: true }).selectOption(customer.id);
    await bank.getByLabel('Payment method').selectOption('BANK_TRANSFER');
    await bank
        .getByLabel('Amount (JMD)', { exact: true })
        .fill('99999999999999999999999999999999.99');
    await bank.getByLabel('Transaction date (Jamaica)').fill('2026-11-25');
    await bank.getByLabel('Bank transfer reference').fill('BANK-1024');
    await bank.getByLabel('Receiving bank account').fill('Operating account');
    await bank.getByRole('checkbox').check();
    await bank.getByRole('button', { name: 'Record payment' }).click();
    await page.getByRole('link', { name: 'View recorded payment' }).click();
    await expect(
        page.getByText('Ask another authorized member to verify this payment.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify payment' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reverse payment' })).toHaveCount(0);
    const ownId = new URL(page.url()).pathname.split('/').at(-1);
    expect((await managerApi.post('payments/' + ownId + '/verify', {})).status()).toBe(403);
    expect(
        (
            await managerApi.post('payments/' + ownId + '/reverse', { reason: 'Permission check' })
        ).status(),
    ).toBe(403);
    expect(
        (
            await request.get(
                apiOrigin + '/api/organizations/' + manager.organizationId + '/payments',
            )
        ).status(),
    ).toBe(401);

    await page.goto('/app/payments/' + another.id + '?organization=' + manager.organizationId);
    await page.getByRole('button', { name: 'Verify payment' }).click();
    const verify = page.getByRole('dialog', { name: 'Verify payment' });
    await verify.getByRole('checkbox').check();
    const membership = { organizationId: manager.organizationId, userId: manager.userId };
    await webAuthPrisma().organizationMembership.update({
        where: { organizationId_userId: membership },
        data: { role: 'STAFF' },
    });
    await verify.getByRole('button', { name: 'Verify payment' }).click();
    await expect(verify).toBeHidden();
    await expect(
        page.getByRole('region', { name: 'Payment actions' }).getByRole('alert'),
    ).toContainText('do not have permission');
    await expect(page.getByRole('button', { name: 'Verify payment' })).toHaveCount(0);
    expect((await (await ownerApi.get('payments/' + another.id)).json()).data.status).toBe(
        'PENDING_VERIFICATION',
    );

    await webAuthPrisma().organizationMembership.update({
        where: { organizationId_userId: membership },
        data: { role: 'MANAGER' },
    });
    await page.reload();
    await page.getByRole('button', { name: 'Verify payment' }).click();
    await verify.getByRole('checkbox').check();
    await verify.getByRole('button', { name: 'Verify payment' }).click();
    await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible();
});

test('shows loading and a retry when the payment API is unavailable', async ({ page, request }) => {
    const account = await createWebAuthFixture();
    await signIn(page, account);
    const mode = proxyOrigin + '/_fixture/mode';
    try {
        await request.post(mode, {
            data: { organizationDelay: 1200, organizationUnavailable: true },
        });
        await page.goto('/app/payments?organization=' + account.organizationId, {
            waitUntil: 'commit',
        });
        await expect(
            page.getByRole('status').filter({ hasText: /Loading payments/ }),
        ).toBeVisible();
        await expect(
            page.getByRole('heading', { name: 'Unable to check your session' }),
        ).toBeVisible();
        await request.post(mode, {
            data: { organizationDelay: 0, organizationUnavailable: false },
        });
        await page.getByRole('button', { name: 'Try again' }).click();
        await expect(page.getByText('No payments on this page.')).toBeVisible();
    } finally {
        await request.post(mode, {
            data: { organizationDelay: 0, organizationUnavailable: false },
        });
    }
});
