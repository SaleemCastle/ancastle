'use client';

import { useActionState, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Customer, Order, SalesProduct } from '@ancastle/types';
import { Button } from '@/components/ui/button';
import { applicationHref } from '@/lib/application/selection';
import type { ManagementActionState } from '@/lib/management/action-state';
import {
    estimateOrderCents,
    expectedProduct,
    formatJmdCents,
    type EditableOrderLine,
} from '@/lib/management/order-form';
import { amendOrderAction, createOrderAction } from '@/app/app/orders/actions';
import { searchOrderChoicesAction } from '@/app/app/orders/choice-actions';

const inputClass =
    'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base';

function newLine(product: SalesProduct, key: string): EditableOrderLine {
    return { key, productId: product.id, quantity: '', unitPrice: '' };
}

export function OrderEditor({
    organization,
    customers: initialCustomers,
    products: initialProducts,
    order,
}: {
    organization: string;
    customers: Customer[];
    products: SalesProduct[];
    order?: Order;
}) {
    const router = useRouter();
    const editing = Boolean(order);
    const [customers, setCustomers] = useState(initialCustomers);
    const [products, setProducts] = useState(initialProducts);
    const [customerSearch, setCustomerSearch] = useState('');
    const [productSearch, setProductSearch] = useState('');
    const [choiceError, setChoiceError] = useState('');
    const [choicePending, startChoiceSearch] = useTransition();
    const choiceRequest = useRef({ customer: 0, product: 0 });
    const initialLines = useMemo(
        () =>
            order?.lines
                .filter((line) => !line.isRemoved)
                .map((line) => ({
                    key: line.id,
                    lineId: line.id,
                    productId: line.productId,
                    quantity: line.orderedQuantity,
                    unitPrice: line.unitPrice,
                })) ?? (initialProducts[0] ? [newLine(initialProducts[0], 'new-1')] : []),
        [order, initialProducts],
    );
    const [customerId, setCustomerId] = useState(order?.customer.id ?? customers[0]?.id ?? '');
    const [saleType, setSaleType] = useState<'CASH' | 'CREDIT'>(order?.terms.saleType ?? 'CASH');
    const [creditTermDays, setCreditTermDays] = useState(
        order?.terms.saleType === 'CREDIT' ? String(order.terms.creditTermDays) : '30',
    );
    const [lines, setLines] = useState<EditableOrderLine[]>(initialLines);
    const action = editing ? amendOrderAction : createOrderAction;
    const submitInFlight = useRef(false);
    const [state, submit, pending] = useActionState<ManagementActionState, FormData>(
        async (previous, form) => {
            let result: ManagementActionState;
            try {
                result = await action(previous, form);
            } catch {
                result = editing
                    ? { error: 'We could not confirm the save. Reload the order and review it.' }
                    : {
                          outcomeUnknown: true,
                          error: 'We could not confirm whether the draft was created. Check the sales order list before trying again.',
                      };
            }
            if (result.success) router.refresh();
            if (!result.success && !result.outcomeUnknown) submitInFlight.current = false;
            return result;
        },
        {},
    );

    function updateLine(key: string, patch: Partial<EditableOrderLine>) {
        setLines((current) =>
            current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
        );
    }

    function searchChoices(type: 'customer' | 'product') {
        const value = type === 'customer' ? customerSearch : productSearch;
        const requestId = ++choiceRequest.current[type];
        startChoiceSearch(async () => {
            const result = await searchOrderChoicesAction(organization, type, value);
            if (choiceRequest.current[type] !== requestId) return;
            if (result.error) {
                setChoiceError(result.error);
                return;
            }
            setChoiceError('');
            if (result.type === 'customer') {
                const selected = customers.find((entry) => entry.id === customerId);
                setCustomers([
                    ...(selected ? [selected] : []),
                    ...result.data.filter((entry) => entry.id !== selected?.id),
                ]);
            } else {
                const selectedIds = new Set(
                    lines.filter((line) => !line.removed).map((line) => line.productId),
                );
                const retained = products.filter((entry) => selectedIds.has(entry.id));
                const combined = [
                    ...retained,
                    ...result.data.filter(
                        (entry) => !retained.some((item) => item.id === entry.id),
                    ),
                ];
                setProducts(combined);
                if (lines.filter((line) => !line.removed).length === 0 && combined[0])
                    setLines([newLine(combined[0], `search-${Date.now()}`)]);
            }
        });
    }

    const activeLines = lines.filter((line) => !line.removed);
    const payloadLines: unknown[] = [];
    for (const line of activeLines) {
        const product = products.find((entry) => entry.id === line.productId);
        if (!product) continue;
        const input = {
            productId: product.id,
            expectedProduct: expectedProduct(product),
            quantity: line.quantity,
            unitPrice: line.unitPrice,
        };
        if (editing && line.lineId)
            payloadLines.push({ operation: 'UPDATE', lineId: line.lineId, line: input });
        else if (editing) payloadLines.push({ operation: 'ADD', line: input });
        else payloadLines.push(input);
    }
    const payload = editing
        ? [
              ...lines
                  .filter((line) => line.lineId && line.removed)
                  .map((line) => ({ operation: 'REMOVE' as const, lineId: line.lineId! })),
              ...payloadLines,
          ]
        : payloadLines;
    const previewCents = estimateOrderCents(activeLines);
    const createdHref = state.resourceId
        ? applicationHref(`/app/orders/${state.resourceId}`, organization)
        : undefined;

    return (
        <form
            action={submit}
            onSubmit={(event) => {
                if (submitInFlight.current) {
                    event.preventDefault();
                    return;
                }
                submitInFlight.current = true;
            }}
            aria-label={editing ? 'Edit draft order' : 'Create sales order'}
            className="mt-6 max-w-4xl space-y-6"
        >
            <input type="hidden" name="organization" value={organization} />
            {order && (
                <>
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="expectedOrderVersion" value={order.version} />
                </>
            )}
            <input type="hidden" name="lines" value={JSON.stringify(payload)} />
            <fieldset
                disabled={
                    pending ||
                    choicePending ||
                    Boolean(state.success) ||
                    Boolean(state.outcomeUnknown)
                }
                className="space-y-6"
            >
                <section className="grid gap-5 rounded-xl border bg-card p-5 sm:grid-cols-2">
                    <div className="space-y-2">
                        <label htmlFor="order-customer-search">Find a customer</label>
                        <div className="flex gap-2">
                            <input
                                id="order-customer-search"
                                value={customerSearch}
                                maxLength={120}
                                onChange={(event) => setCustomerSearch(event.target.value)}
                                className={inputClass}
                                placeholder="Search by customer name or code"
                            />
                            <Button
                                type="button"
                                variant="outline"
                                disabled={choicePending}
                                onClick={() => searchChoices('customer')}
                            >
                                {choicePending ? 'Searching…' : 'Find'}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Search returns up to 100 matches. Refine the name or code to find more.
                        </p>
                        <label htmlFor="order-customer">Customer</label>
                        <select
                            id="order-customer"
                            name="customerId"
                            required
                            value={customerId}
                            onChange={(event) => setCustomerId(event.target.value)}
                            className={inputClass}
                        >
                            {customers.map((customer) => (
                                <option key={customer.id} value={customer.id}>
                                    {customer.code} · {customer.name}
                                </option>
                            ))}
                        </select>
                        {customers.length === 0 && (
                            <p role="alert" className="text-sm text-destructive">
                                Create an active customer before opening a sales order.
                            </p>
                        )}
                        {state.fields?.customerId?.[0] && (
                            <p role="alert" className="text-sm text-destructive">
                                {state.fields.customerId[0]}
                            </p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <span className="block text-sm font-medium">Currency</span>
                        <p className="flex h-11 items-center rounded-md border bg-muted/50 px-3">
                            JMD
                        </p>
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="order-sale-type">Commercial terms</label>
                        <select
                            id="order-sale-type"
                            name="saleType"
                            value={saleType}
                            onChange={(event) =>
                                setSaleType(event.target.value as 'CASH' | 'CREDIT')
                            }
                            className={inputClass}
                        >
                            <option value="CASH">CASH</option>
                            <option value="CREDIT">CREDIT</option>
                        </select>
                    </div>
                    {saleType === 'CREDIT' && (
                        <div className="space-y-2">
                            <label htmlFor="order-credit-days">Credit term days</label>
                            <input
                                id="order-credit-days"
                                name="creditTermDays"
                                type="number"
                                min="1"
                                max="2147483647"
                                required
                                value={creditTermDays}
                                onChange={(event) => setCreditTermDays(event.target.value)}
                                className={inputClass}
                            />
                            <p className="text-sm text-muted-foreground">
                                Commercial terms only; this does not set a due date or payment
                                status.
                            </p>
                        </div>
                    )}
                </section>

                <section aria-labelledby="order-lines-heading" className="space-y-4">
                    <header className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 id="order-lines-heading" className="text-lg font-semibold">
                                Order lines
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                Poultry is counted in birds; produce uses its catalog unit. No stock
                                or birds are reserved.
                            </p>
                        </div>
                        <div className="flex min-w-0 gap-2 sm:col-span-2">
                            <label className="sr-only" htmlFor="order-product-search">
                                Find a saleable product
                            </label>
                            <input
                                id="order-product-search"
                                value={productSearch}
                                maxLength={120}
                                onChange={(event) => setProductSearch(event.target.value)}
                                className={inputClass}
                                placeholder="Find poultry or produce products"
                            />
                            <Button
                                type="button"
                                variant="outline"
                                disabled={choicePending}
                                onClick={() => searchChoices('product')}
                            >
                                {choicePending ? 'Searching…' : 'Find products'}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground sm:col-span-2">
                            Search returns up to 100 matches. Refine the name or code to find more.
                        </p>
                        {choiceError && (
                            <p role="alert" className="text-sm text-destructive sm:col-span-2">
                                {choiceError}
                            </p>
                        )}
                        <Button
                            type="button"
                            variant="outline"
                            disabled={products.length === 0}
                            onClick={() =>
                                setLines((current) => [
                                    ...current,
                                    newLine(products[0]!, `new-${Date.now()}-${current.length}`),
                                ])
                            }
                        >
                            Add line
                        </Button>
                    </header>
                    {state.fields?.lines?.[0] && (
                        <p role="alert" className="text-sm text-destructive">
                            {state.fields.lines[0]}
                        </p>
                    )}

                    {activeLines.length === 0 ? (
                        <p className="rounded-xl border border-dashed bg-card p-6 text-sm">
                            {products.length
                                ? 'Add at least one product line.'
                                : 'No active saleable products are available.'}
                        </p>
                    ) : (
                        <div className="space-y-4">
                            {activeLines.map((line, index) => {
                                const product = products.find(
                                    (entry) => entry.id === line.productId,
                                );
                                const unit = product?.unit ?? 'unit';
                                return (
                                    <fieldset
                                        key={line.key}
                                        className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,2fr)_minmax(7rem,1fr)_minmax(9rem,1fr)_auto]"
                                    >
                                        <legend className="sr-only">Order line {index + 1}</legend>
                                        <div className="min-w-0 space-y-2">
                                            <label htmlFor={`product-${line.key}`}>
                                                Saleable product
                                            </label>
                                            <select
                                                id={`product-${line.key}`}
                                                value={line.productId}
                                                onChange={(event) =>
                                                    updateLine(line.key, {
                                                        productId: event.target.value,
                                                    })
                                                }
                                                className={inputClass}
                                                required
                                            >
                                                {products.map((entry) => (
                                                    <option key={entry.id} value={entry.id}>
                                                        {entry.code} · {entry.name} ·{' '}
                                                        {entry.kind === 'POULTRY'
                                                            ? 'Poultry'
                                                            : 'Produce'}
                                                    </option>
                                                ))}
                                            </select>
                                            <p className="text-xs text-muted-foreground">
                                                Unit: {product?.unit ?? 'unavailable'}
                                            </p>
                                        </div>
                                        <div className="space-y-2">
                                            <label htmlFor={`quantity-${line.key}`}>
                                                Quantity ({unit})
                                            </label>
                                            <input
                                                id={`quantity-${line.key}`}
                                                type="text"
                                                inputMode="decimal"
                                                autoComplete="off"
                                                required
                                                value={line.quantity}
                                                onChange={(event) =>
                                                    updateLine(line.key, {
                                                        quantity: event.target.value,
                                                    })
                                                }
                                                className={inputClass}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label htmlFor={`price-${line.key}`}>
                                                Agreed unit price (JMD)
                                            </label>
                                            <input
                                                id={`price-${line.key}`}
                                                type="text"
                                                inputMode="decimal"
                                                autoComplete="off"
                                                required
                                                value={line.unitPrice}
                                                onChange={(event) =>
                                                    updateLine(line.key, {
                                                        unitPrice: event.target.value,
                                                    })
                                                }
                                                className={inputClass}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Up to four decimal places
                                            </p>
                                        </div>
                                        <div className="flex items-end sm:col-span-2 lg:col-span-1">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() =>
                                                    setLines((current) =>
                                                        line.lineId
                                                            ? current.map((item) =>
                                                                  item.key === line.key
                                                                      ? { ...item, removed: true }
                                                                      : item,
                                                              )
                                                            : current.filter(
                                                                  (item) => item.key !== line.key,
                                                              ),
                                                    )
                                                }
                                            >
                                                Remove line
                                            </Button>
                                        </div>
                                    </fieldset>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section className="rounded-xl border bg-muted/40 p-5" aria-live="polite">
                    <p className="text-sm text-muted-foreground">Estimated order total</p>
                    <p className="text-2xl font-semibold">
                        {previewCents === null
                            ? 'Enter valid quantities and prices to estimate'
                            : `JMD ${formatJmdCents(previewCents)}`}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Preview only. The server validates prices and returns the saved order total.
                    </p>
                </section>

                {state.error && (
                    <p role="alert" className="text-sm text-destructive">
                        {state.error}
                    </p>
                )}
                {state.outcomeUnknown && (
                    <Link
                        className="inline-flex underline"
                        href={applicationHref('/app/orders', organization)}
                    >
                        Check the sales order list before trying again
                    </Link>
                )}
                {Object.values(state.fields ?? {}).flat().length > 0 && (
                    <div
                        role="alert"
                        className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                    >
                        Review the highlighted customer, terms, quantity, and price fields.{' '}
                        {Object.values(state.fields ?? {})
                            .flat()
                            .join(' ')}
                    </div>
                )}
                {state.success && <p role="status">{state.success}</p>}
                {createdHref && (
                    <Link className="inline-flex underline" href={createdHref}>
                        View created order
                    </Link>
                )}
                {editing && state.success && (
                    <Link
                        className="inline-flex underline"
                        href={applicationHref(`/app/orders/${order!.id}`, organization)}
                    >
                        Return to order
                    </Link>
                )}
                <div className="flex flex-wrap gap-3">
                    <Button
                        type="submit"
                        disabled={
                            pending ||
                            Boolean(state.success) ||
                            Boolean(state.outcomeUnknown) ||
                            customers.length === 0 ||
                            activeLines.length === 0
                        }
                    >
                        {pending ? 'Saving…' : editing ? 'Save draft' : 'Create draft order'}
                    </Button>
                    <Link
                        className="inline-flex h-11 items-center underline"
                        href={applicationHref('/app/orders', organization)}
                    >
                        Cancel
                    </Link>
                </div>
            </fieldset>
        </form>
    );
}
