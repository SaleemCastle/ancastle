import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
    createWebAuthFixture,
    closeWebAuthDatabase,
    webAuthPrisma,
} from '../../api/test/web-auth-fixture.js';

const apiOrigin = process.env.ANCASTLE_E2E_API_ORIGIN ?? 'http://127.0.0.1:4310';

async function signIn(page: Page, account: { email: string; password: string }) {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

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
        post: async (path: string, data: object) => {
            const response = await request.post(`${base}/${path}`, { headers, data });
            expect(response.ok()).toBe(true);
            return (await response.json()).data;
        },
        get: async (path: string) => request.get(`${base}/${path}`, { headers }),
        rawPost: async (path: string, data: object, extraHeaders: Record<string, string> = {}) =>
            request.post(`${base}/${path}`, { headers: { ...headers, ...extraHeaders }, data }),
        rawPostAt: async (
            organization: string,
            path: string,
            data: object,
            extraHeaders: Record<string, string> = {},
        ) =>
            request.post(`${apiOrigin}/api/organizations/${organization}/${path}`, {
                headers: { ...headers, ...extraHeaders },
                data,
            }),
    };
}

test('posts and reverses mixed partial fulfilment through authorized farm sources', async ({
    page,
    request,
}) => {
    test.setTimeout(90000);
    const account = await createWebAuthFixture();
    try {
        const farm = await account.addFarm('Fulfilment Farm', 'FULFILLMENT');
        const staffOrganization = await account.addOrganization('Staff farm scope', 'STAFF');
        const foreignFarm = await account.addFarm('Unassigned Farm', 'UNASSIGNED', {
            organizationId: staffOrganization,
            assigned: false,
        });
        const customer = await account.addCustomer('Fulfilment buyer');
        const api = await organizationApi(request, account);
        const item = await api.post('inventory-items', {
            name: 'Fulfilment pumpkin',
            category: 'PRODUCE',
            unit: 'KG',
        });
        const poultryProduct = await api.post('sales-products', {
            name: 'Table birds',
            kind: 'POULTRY',
        });
        const produceProduct = await api.post('sales-products', {
            name: 'Sale pumpkin',
            kind: 'PRODUCE',
            inventoryItemId: item.id,
            expectedInventoryUnit: 'KG',
        });
        const flock = await api.post(`farms/${farm.id}/flocks`, {
            name: 'Sales flock',
            birdType: 'Broiler',
            placementDate: '2026-10-01',
            startingBirdCount: 20,
        });
        await api.post(`farms/${farm.id}/sales-products/${poultryProduct.id}/poultry-sources`, {
            flockId: flock.id,
        });
        await api.post(`farms/${farm.id}/inventory/movements`, {
            inventoryItemId: item.id,
            expectedInventoryUnit: 'KG',
            quantity: 20,
            reason: 'RECEIPT',
            occurredAt: new Date().toISOString(),
        });
        const order = await api.post('orders', {
            customerId: customer.id,
            currency: 'JMD',
            terms: { saleType: 'CASH', creditTermDays: null },
            lines: [
                {
                    productId: poultryProduct.id,
                    expectedProduct: { kind: 'POULTRY', unit: 'EACH' },
                    quantity: '5',
                    unitPrice: '3.0000',
                },
                {
                    productId: produceProduct.id,
                    expectedProduct: { kind: 'PRODUCE', unit: 'KG', inventoryItemId: item.id },
                    quantity: '3.500',
                    unitPrice: '2.0000',
                },
            ],
        });
        await api.post(`orders/${order.id}/confirm`, { expectedOrderVersion: order.version });
        const base = `farms/${farm.id}`;
        const stockBefore = await api.get(`${base}/inventory`);
        expect(
            (await stockBefore.json()).data.find(
                (row: { item: { id: string } }) => row.item.id === item.id,
            ).stockOnHand,
        ).toBe('20');
        await signIn(page, account);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(
            `/app/orders/${order.id}?organization=${account.organizationId}&farm=${farm.id}`,
        );
        const panel = page.getByRole('region', { name: 'Physical fulfilment' });
        await expect(panel).toContainText('available 20 EACH');
        await expect(panel).toContainText('available 20 KG');
        await panel.getByLabel('Table birds source').selectOption(flock.id);
        await panel.getByLabel('Table birds quantity').fill('1.5');
        await panel.getByLabel('Sale pumpkin source').selectOption(item.id);
        await panel.getByLabel('Sale pumpkin quantity').fill('1.250');
        const proxyOrigin = process.env.ANCASTLE_E2E_PROXY_ORIGIN;
        expect(proxyOrigin).toBeTruthy();
        await panel.getByRole('button', { name: 'Post fulfilment' }).click();
        await expect(panel.getByRole('alert')).toContainText('whole birds');
        expect(await webAuthPrisma().fulfilment.count({ where: { orderId: order.id } })).toBe(0);
        await panel.getByLabel('Table birds quantity').fill('2');
        await request.post(`${proxyOrigin}/_fixture/mode`, { data: { fulfilmentValidation: 1 } });
        await panel.getByRole('button', { name: 'Post fulfilment' }).click();
        await expect(panel.getByRole('alert')).toContainText(
            'allocations: The command quantity is no longer valid.',
        );
        expect(await webAuthPrisma().fulfilment.count({ where: { orderId: order.id } })).toBe(0);
        await request.post(`${proxyOrigin}/_fixture/mode`, { data: { fulfilmentConflict: 1 } });
        await panel.getByRole('button', { name: 'Post fulfilment' }).click();
        await expect(panel.getByRole('alert')).toContainText('order changed since you opened it');
        expect(await webAuthPrisma().fulfilment.count({ where: { orderId: order.id } })).toBe(0);
        expect(
            await webAuthPrisma().inventoryMovement.count({
                where: {
                    organizationId: account.organizationId,
                    farmId: farm.id,
                    inventoryItemId: item.id,
                },
            }),
        ).toBe(1);
        await request.post(`${proxyOrigin}/_fixture/mode`, { data: { fulfilmentResponseLoss: 1 } });
        await panel.getByRole('button', { name: 'Post fulfilment' }).click();
        await expect(panel.getByRole('alert')).toContainText('outcome is unknown');
        const committedStock = await api.get(`${base}/inventory`);
        expect(
            (await committedStock.json()).data.find(
                (row: { item: { id: string } }) => row.item.id === item.id,
            ).stockOnHand,
        ).toBe('18.75');
        const committedFlock = await api.get(
            `${base}/flocks/${flock.id}?ageAndMaturityAsOfDate=2026-11-19`,
        );
        expect((await committedFlock.json()).data.metrics.liveBirdCount).toBe(18);
        const prisma = webAuthPrisma();
        const committedBatch = await prisma.fulfilment.findFirstOrThrow({
            where: { organizationId: account.organizationId, orderId: order.id, kind: 'POSTING' },
            include: { lines: { include: { inventoryMovement: true, depletions: true } } },
        });
        const committedProduce = committedBatch.lines.find((line) => line.kind === 'PRODUCE');
        const committedPoultry = committedBatch.lines.find((line) => line.kind === 'POULTRY');
        expect(committedProduce?.quantity.toFixed(3)).toBe('1.250');
        expect(committedProduce?.unit).toBe('KG');
        expect(committedProduce?.inventoryMovement?.quantity.toFixed(3)).toBe('-1.250');
        expect(committedProduce?.inventoryMovement?.reason).toBe('ISSUE');
        expect(committedPoultry?.quantity.toFixed(3)).toBe('2.000');
        expect(committedPoultry?.unit).toBe('EACH');
        expect(committedPoultry?.depletions.reduce((sum, row) => sum + row.birdCount, 0)).toBe(2);
        expect(
            await prisma.fulfilment.count({
                where: { organizationId: account.organizationId, orderId: order.id },
            }),
        ).toBe(1);
        expect(
            await prisma.fulfilmentCommand.count({
                where: {
                    organizationId: account.organizationId,
                    orderId: order.id,
                    operation: 'POST',
                },
            }),
        ).toBe(1);
        await panel.getByRole('button', { name: 'Retry exact command' }).click();
        await expect(panel.getByRole('status')).toHaveText('Fulfilment posted.');
        await expect(page.getByRole('region', { name: 'Order lines' })).toContainText('3 EACH');
        await expect(page.getByRole('region', { name: 'Order lines' })).toContainText('2.25 KG');
        await expect(panel).toContainText('FUL-');
        const stock = await api.get(`${base}/inventory`);
        expect(
            (await stock.json()).data.find(
                (row: { item: { id: string } }) => row.item.id === item.id,
            ).stockOnHand,
        ).toBe('18.75');
        const flockRead = await api.get(
            `${base}/flocks/${flock.id}?ageAndMaturityAsOfDate=2026-11-19`,
        );
        expect((await flockRead.json()).data.metrics.liveBirdCount).toBe(18);
        const foreign = await api.rawPostAt(
            staffOrganization,
            `farms/${foreignFarm.id}/orders/${order.id}/fulfilments`,
            {
                expectedOrderVersion: 3,
                occurredAt: new Date().toISOString(),
                allocations: [
                    {
                        orderLineId: order.lines[0].id,
                        kind: 'POULTRY',
                        flockId: flock.id,
                        quantity: '1',
                    },
                ],
            },
            { 'Idempotency-Key': crypto.randomUUID() },
        );
        expect(foreign.status()).toBe(403);
        const handleDialog = async (dialog: import('@playwright/test').Dialog) =>
            dialog.type() === 'prompt'
                ? dialog.accept('Correction for a recorded posting error')
                : dialog.accept();
        page.on('dialog', handleDialog);
        await panel.getByRole('button', { name: 'Reverse full batch' }).click();
        page.off('dialog', handleDialog);
        await expect(panel).toContainText('REVERSAL');
        const restoredStock = await api.get(`${base}/inventory`);
        expect(
            (await restoredStock.json()).data.find(
                (row: { item: { id: string } }) => row.item.id === item.id,
            ).stockOnHand,
        ).toBe('20');
        const restoredFlock = await api.get(
            `${base}/flocks/${flock.id}?ageAndMaturityAsOfDate=2026-11-19`,
        );
        expect((await restoredFlock.json()).data.metrics.liveBirdCount).toBe(20);
        const persistedHistory = await prisma.fulfilment.findMany({
            where: { organizationId: account.organizationId, orderId: order.id },
            include: { lines: { include: { inventoryMovement: true, depletions: true } } },
            orderBy: { createdAt: 'asc' },
        });
        expect(persistedHistory.map((event) => event.kind)).toEqual(['POSTING', 'REVERSAL']);
        const reversalProduce = persistedHistory[1]?.lines.find((line) => line.kind === 'PRODUCE');
        const reversalPoultry = persistedHistory[1]?.lines.find((line) => line.kind === 'POULTRY');
        expect(reversalProduce?.quantity.toFixed(3)).toBe('1.250');
        expect(reversalProduce?.inventoryMovement?.quantity.toFixed(3)).toBe('1.250');
        expect(reversalProduce?.inventoryMovement?.reason).toBe('ADJUSTMENT');
        expect(reversalPoultry?.depletions.reduce((sum, row) => sum + row.birdCount, 0)).toBe(2);
        expect(persistedHistory[1]?.reversesFulfilmentId).toBe(committedBatch.id);
        const movementLedger = await prisma.inventoryMovement.aggregate({
            where: {
                organizationId: account.organizationId,
                farmId: farm.id,
                inventoryItemId: item.id,
            },
            _sum: { quantity: true },
        });
        expect(movementLedger._sum.quantity?.toFixed(3)).toBe('20.000');
        expect(
            await prisma.fulfilmentCommand.count({
                where: {
                    organizationId: account.organizationId,
                    orderId: order.id,
                    operation: 'POST',
                },
            }),
        ).toBe(1);
        expect(
            await prisma.fulfilmentCommand.count({
                where: {
                    organizationId: account.organizationId,
                    orderId: order.id,
                    operation: 'REVERSE',
                },
            }),
        ).toBe(1);
        await expect(page.getByRole('region', { name: 'Order lines' })).toContainText('0 EACH');
        await expect(page.getByRole('region', { name: 'Order lines' })).toContainText('0 KG');
        await page.goto(`/app/customers/${customer.id}?organization=${account.organizationId}`);
        const purchaseHistory = page.getByRole('region', { name: 'Customer purchase history' });
        await expect(purchaseHistory).toContainText('Net purchased 0 EACH');
        await expect(purchaseHistory).toContainText('Net purchased 0 KG');
        await expect(purchaseHistory).not.toContainText('Paid');
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
    } finally {
        await closeWebAuthDatabase();
    }
});

test('creates, edits, confirms and reviews a mixed poultry/produce sales order', async ({
    page,
    request,
}) => {
    test.setTimeout(90000);
    const account = await createWebAuthFixture();
    try {
        const customer = await account.addCustomer('Browser order customer');
        const api = await organizationApi(request, account);
        const produceItem = await api.post('inventory-items', {
            name: 'Order test pumpkin',
            category: 'PRODUCE',
            unit: 'KG',
        });
        const poultryProduct = await api.post('sales-products', {
            name: 'Order test poultry',
            kind: 'POULTRY',
        });
        const produceProduct = await api.post('sales-products', {
            name: 'Order test produce',
            kind: 'PRODUCE',
            inventoryItemId: produceItem.id,
            expectedInventoryUnit: 'KG',
        });

        await signIn(page, account);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/app/orders?organization=${account.organizationId}`);
        await expect(page.getByText('No sales orders found')).toBeVisible();
        await page.getByRole('link', { name: 'Create order', exact: true }).click();

        const create = page.getByRole('form', { name: 'Create sales order', exact: true });
        await create.getByLabel('Customer', { exact: true }).selectOption(customer.id);
        await create.getByLabel('Commercial terms', { exact: true }).selectOption('CREDIT');
        const creditDays = create.getByLabel('Credit term days', { exact: true });
        await creditDays.fill('');
        await create.getByRole('button', { name: 'Create draft order', exact: true }).click();
        expect(await creditDays.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(
            false,
        );
        await expect(create.getByRole('status')).toHaveCount(0);
        await creditDays.fill('45');
        await create.getByLabel('Quantity (EACH)', { exact: true }).fill('3');
        await create.getByLabel('Agreed unit price (JMD)', { exact: true }).fill('12.3456');
        await expect(create).toContainText('JMD 37.04');
        await create.getByRole('button', { name: 'Create draft order', exact: true }).click();
        await expect(create.getByRole('status')).toHaveText('Draft order created.');
        await create.getByRole('link', { name: 'View created order', exact: true }).click();

        await expect(
            page.getByRole('heading', { name: 'Browser order customer', exact: true }),
        ).toBeVisible();
        await expect(
            page.getByRole('region', { name: 'Commercial summary', exact: true }),
        ).toContainText('CREDIT · 45 days');
        await page.getByRole('link', { name: 'Edit draft', exact: true }).click();
        const edit = page.getByRole('form', { name: 'Edit draft order', exact: true });
        await edit.getByLabel('Quantity (EACH)', { exact: true }).fill('4');
        await edit.getByLabel('Agreed unit price (JMD)', { exact: true }).first().fill('12.3456');
        await edit.getByRole('button', { name: 'Add line', exact: true }).click();
        const produceSelect = edit.getByLabel('Saleable product', { exact: true }).nth(1);
        await produceSelect.selectOption(produceProduct.id);
        await edit.getByLabel('Quantity (KG)', { exact: true }).fill('1.500');
        await edit.getByLabel('Agreed unit price (JMD)', { exact: true }).nth(1).fill('2.0000');
        await expect(edit).toContainText('JMD 52.38');
        await edit.getByRole('button', { name: 'Save draft', exact: true }).click();
        await expect(edit.getByRole('status')).toHaveText('Draft order saved.');
        await edit.getByRole('link', { name: 'Return to order', exact: true }).click();

        const details = page.getByRole('region', { name: 'Order lines', exact: true });
        await expect(details).toContainText('Order test poultry');
        await expect(details).toContainText('Order test produce');
        await expect(
            page.getByRole('region', { name: 'Commercial summary', exact: true }),
        ).toContainText('JMD 52.38');
        const confirmTrigger = page.getByRole('button', { name: 'Confirm order', exact: true });
        await confirmTrigger.focus();
        await page.keyboard.press('Enter');
        const confirm = page.getByRole('dialog', { name: 'Confirm this order?', exact: true });
        await expect(confirm).toContainText('does not reserve produce stock or live birds');
        await expect(
            confirm.getByRole('button', { name: 'Confirm order', exact: true }),
        ).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(confirm).toHaveCount(0);
        await expect(confirmTrigger).toBeFocused();
        await confirmTrigger.press('Enter');
        const reopenedConfirm = page.getByRole('dialog', {
            name: 'Confirm this order?',
            exact: true,
        });
        await reopenedConfirm.getByRole('button', { name: 'Confirm order', exact: true }).click();
        await expect(page.getByText('CONFIRMED', { exact: true })).toBeVisible();
        const history = page.getByRole('region', { name: 'Order event history', exact: true });
        await expect(history).toContainText('CREATED');
        await expect(history).toContainText('AMENDED');
        await expect(history).toContainText('CONFIRMED');
        await expect(page.getByRole('link', { name: 'Edit draft', exact: true })).toHaveCount(0);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        const orderUrl = page.url();

        const secondCustomer = await account.addCustomer('Pagination test customer');
        const cancellationOrder = await api.post('orders', {
            customerId: secondCustomer.id,
            currency: 'JMD',
            terms: { saleType: 'CASH', creditTermDays: null },
            lines: [
                {
                    productId: poultryProduct.id,
                    expectedProduct: { kind: 'POULTRY', unit: 'EACH' },
                    quantity: '1',
                    unitPrice: '1.0000',
                },
            ],
        });
        await page.goto(`/app/orders?organization=${account.organizationId}&pageSize=1`);
        await expect(page.getByRole('table')).toContainText('Pagination test customer');
        await expect(
            page.getByRole('navigation', { name: 'Sales orders pagination', exact: true }),
        ).toContainText('Page 1 of 2');
        await page.getByRole('link', { name: 'Next order page', exact: true }).click();
        await expect(page.getByRole('table')).toContainText('Browser order customer');
        await expect(page.getByRole('table')).not.toContainText('Pagination test customer');

        await page.goto(
            `/app/orders/${cancellationOrder.id}?organization=${account.organizationId}`,
        );
        await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
        const cancel = page.getByRole('dialog', { name: 'Cancel this order?', exact: true });
        await expect(cancel.getByLabel('Reason', { exact: true })).toBeFocused();
        await cancel
            .getByLabel('Reason', { exact: true })
            .fill('Browser workflow cancellation check');
        await cancel.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
        await expect(page.getByText('CANCELLED', { exact: true })).toBeVisible();
        await expect(
            page.getByRole('region', { name: 'Order event history', exact: true }),
        ).toContainText('CANCELLED');

        const uncertainCustomer = await account.addCustomer('Unknown outcome browser customer');
        await page.goto(`/app/orders/new?organization=${account.organizationId}`);
        const uncertainForm = page.getByRole('form', {
            name: 'Create sales order',
            exact: true,
        });
        await uncertainForm
            .getByLabel('Customer', { exact: true })
            .selectOption(uncertainCustomer.id);
        await uncertainForm.getByLabel('Quantity (EACH)', { exact: true }).fill('1');
        await uncertainForm.getByLabel('Agreed unit price (JMD)', { exact: true }).fill('9.2500');
        let lostActionResponse = false;
        const loseActionResponse = async (route: import('@playwright/test').Route) => {
            const headers = route.request().headers();
            if (route.request().method() === 'POST' && headers['next-action']) {
                const response = await route.fetch();
                expect(response.ok()).toBe(true);
                await response.body();
                lostActionResponse = true;
                await route.abort('failed');
                return;
            }
            await route.continue();
        };
        await page.route('**/app/orders/new**', loseActionResponse);
        await uncertainForm
            .getByRole('button', { name: 'Create draft order', exact: true })
            .click();
        await expect(uncertainForm.getByRole('alert')).toContainText(
            'could not confirm whether the draft was created',
        );
        await expect(
            uncertainForm.getByRole('link', {
                name: 'Check the sales order list before trying again',
                exact: true,
            }),
        ).toBeVisible();
        expect(lostActionResponse).toBe(true);
        await page.unroute('**/app/orders/new**', loseActionResponse);
        await uncertainForm
            .getByRole('link', {
                name: 'Check the sales order list before trying again',
                exact: true,
            })
            .click();
        await expect(page.getByRole('table')).toContainText('Unknown outcome browser customer');

        await account.setRole('STAFF');
        await page.goto(`/app/orders?organization=${account.organizationId}`);
        await expect(page.getByRole('table')).toContainText('Browser order customer');
        await expect(page.getByRole('link', { name: 'Create order', exact: true })).toHaveCount(0);
        await page.goto(orderUrl);
        await expect(
            page.getByRole('heading', { name: 'Browser order customer', exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: 'Confirm order', exact: true })).toHaveCount(
            0,
        );
        await expect(page.getByRole('button', { name: 'Cancel order', exact: true })).toHaveCount(
            0,
        );
    } finally {
        await closeWebAuthDatabase();
    }
});
