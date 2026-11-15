'use client';
import { useActionState, useState } from 'react';
import Link from 'next/link';
import type { InventoryItem, SalesProduct, PoultryProductSource } from '@ancastle/types';
import {
    saveProductAction,
    setProductStatusAction,
    mutateSourceAction,
} from '@/app/app/sales-products/actions';
import type { ManagementActionState } from '@/lib/management/action-state';
import { applicationHref } from '@/lib/application/selection';
import { Button } from '@/components/ui/button';

const inputClass =
    'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base';
function Result({ state }: { state: ManagementActionState }) {
    return (
        <>
            {state.error && (
                <p role="alert" className="text-sm text-destructive">
                    {state.error}
                </p>
            )}
            {state.success && (
                <p role="status" className="text-sm">
                    {state.success}
                </p>
            )}
        </>
    );
}
function ErrorField({ state, field }: { state: ManagementActionState; field: string }) {
    return (
        state.fields?.[field] && (
            <p id={`product-${field}-error`} className="text-sm text-destructive">
                {state.fields[field][0]}
            </p>
        )
    );
}
export function ProductForm({
    organization,
    product,
    items,
    canLinkProduce,
}: {
    organization: string;
    product?: SalesProduct;
    items: InventoryItem[];
    canLinkProduce: boolean;
}) {
    const [name, setName] = useState(product?.name ?? '');
    const [kind, setKind] = useState(product?.kind ?? 'POULTRY');
    const [changing, setChanging] = useState(!product);
    const [selection, setSelection] = useState({ id: '', unit: '' });
    const [state, submit, pending] = useActionState<ManagementActionState, FormData>(
        async (previous, form) => {
            const result = await saveProductAction(previous, form);
            if (result.success && !product) {
                setName('');
                setKind('POULTRY');
                setSelection({ id: '', unit: '' });
            }
            return result;
        },
        {},
    );
    return (
        <form
            action={submit}
            aria-label={product ? 'Edit sales product' : 'Create sales product'}
            className="mt-6 max-w-2xl space-y-5 rounded-xl border bg-card p-5"
        >
            <input type="hidden" name="organization" value={organization} />
            {product && <input type="hidden" name="productId" value={product.id} />}
            <fieldset disabled={pending} className="min-w-0 space-y-5">
                <div className="space-y-2">
                    <label htmlFor="product-name">Product name</label>
                    <input
                        id="product-name"
                        name="name"
                        required
                        maxLength={120}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className={inputClass}
                        aria-invalid={Boolean(state.fields?.name)}
                        aria-describedby={state.fields?.name ? 'product-name-error' : undefined}
                    />
                    <ErrorField state={state} field="name" />
                </div>
                {product && (
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            name="changeDefinition"
                            checked={changing}
                            onChange={(event) => setChanging(event.target.checked)}
                        />
                        Change source definition
                    </label>
                )}
                {changing && (
                    <>
                        <div className="space-y-2">
                            <label htmlFor="product-kind">Product kind</label>
                            <select
                                id="product-kind"
                                name="kind"
                                value={kind}
                                onChange={(event) => {
                                    setKind(event.target.value as SalesProduct['kind']);
                                    setSelection({ id: '', unit: '' });
                                }}
                                className={inputClass}
                            >
                                <option value="POULTRY">Poultry</option>
                                <option value="PRODUCE" disabled={!canLinkProduce}>
                                    Produce
                                </option>
                            </select>
                            <ErrorField state={state} field="kind" />
                        </div>
                        {kind === 'PRODUCE' ? (
                            <div className="space-y-2">
                                <label htmlFor="product-item">Produce inventory item</label>
                                <select
                                    id="product-item"
                                    name="inventoryItemId"
                                    required
                                    value={selection.id}
                                    onChange={(event) => {
                                        const id = event.target.value;
                                        setSelection({
                                            id,
                                            unit: items.find((item) => item.id === id)?.unit ?? '',
                                        });
                                    }}
                                    className={inputClass}
                                    aria-invalid={Boolean(state.fields?.inventoryItemId)}
                                >
                                    <option value="" disabled>
                                        Select active produce
                                    </option>
                                    {items.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.code} - {item.name} ({item.unit})
                                        </option>
                                    ))}
                                </select>
                                <input
                                    type="hidden"
                                    name="expectedInventoryUnit"
                                    value={selection.unit}
                                />
                                <p className="text-sm text-muted-foreground">
                                    {selection.unit
                                        ? `Sale unit: ${selection.unit}`
                                        : 'Select a source to verify its sale unit.'}
                                </p>
                                <ErrorField state={state} field="inventoryItemId" />
                                <ErrorField state={state} field="expectedInventoryUnit" />
                                {!items.length && (
                                    <p>
                                        No matching active produce items. Refine the source search
                                        or create an inventory definition first.
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm">
                                Poultry is sold in EACH units. Attach farm flocks after creating the
                                product.
                            </p>
                        )}
                        <ErrorField state={state} field="definition" />
                    </>
                )}
                <p className="text-sm text-muted-foreground">
                    Catalog changes do not reserve stock or birds. Referenced source identities
                    cannot be changed.
                </p>
                <Result state={state} />
                <Button type="submit">
                    {pending ? 'Saving...' : product ? 'Save product' : 'Create product'}
                </Button>
            </fieldset>
            {state.resourceId && !pending && (
                <Link
                    prefetch={false}
                    href={applicationHref('/app/sales-products/' + state.resourceId, organization)}
                    className="block underline"
                >
                    View product
                </Link>
            )}
        </form>
    );
}
export function ProductStatusForm({
    organization,
    product,
}: {
    organization: string;
    product: SalesProduct;
}) {
    const [state, submit, pending] = useActionState<ManagementActionState, FormData>(
        setProductStatusAction,
        {},
    );
    return (
        <form action={submit} aria-label="Product lifecycle" className="space-y-3">
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="productId" value={product.id} />
            <input
                type="hidden"
                name="operation"
                value={product.isActive ? 'deactivate' : 'reactivate'}
            />
            <Result state={state} />
            <Button type="submit" disabled={pending} variant="outline">
                {pending
                    ? 'Saving...'
                    : product.isActive
                      ? 'Deactivate product'
                      : 'Reactivate product'}
            </Button>
        </form>
    );
}
export function SourceForm({
    organization,
    farm,
    productId,
    source,
    flocks = [],
    disabled = false,
}: {
    organization: string;
    farm: string;
    productId: string;
    source?: PoultryProductSource;
    flocks?: { id: string; code: string; name: string }[];
    disabled?: boolean;
}) {
    const [state, submit, pending] = useActionState<ManagementActionState, FormData>(
        mutateSourceAction,
        {},
    );
    return (
        <form
            action={submit}
            aria-label={source ? `Eligibility for ${source.flockName}` : 'Attach flock'}
            className="min-w-0 space-y-3"
        >
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="farm" value={farm} />
            <input type="hidden" name="productId" value={productId} />
            <fieldset disabled={pending || disabled} className="min-w-0 space-y-3">
                {source ? (
                    <>
                        <input type="hidden" name="sourceId" value={source.id} />
                        <input
                            type="hidden"
                            name="operation"
                            value={source.isActive ? 'deactivate' : 'reactivate'}
                        />
                    </>
                ) : (
                    <div className="space-y-2">
                        <label htmlFor="source-flock">Active flock</label>
                        <select
                            id="source-flock"
                            name="flockId"
                            required
                            defaultValue=""
                            className={inputClass}
                            aria-invalid={Boolean(state.fields?.flockId)}
                        >
                            <option value="" disabled>
                                Select a flock
                            </option>
                            {flocks.map((flock) => (
                                <option key={flock.id} value={flock.id}>
                                    {flock.code} - {flock.name}
                                </option>
                            ))}
                        </select>
                        {state.fields?.flockId && (
                            <p className="text-sm text-destructive">{state.fields.flockId[0]}</p>
                        )}
                    </div>
                )}
                <Result state={state} />
                <Button type="submit" variant="outline">
                    {pending
                        ? 'Saving...'
                        : source
                          ? source.isActive
                              ? 'Deactivate eligibility'
                              : 'Reactivate eligibility'
                          : 'Attach flock'}
                </Button>
            </fieldset>
        </form>
    );
}
