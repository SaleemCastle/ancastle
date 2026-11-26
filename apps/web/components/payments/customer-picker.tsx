'use client';

import { useId, useState, useTransition } from 'react';
import { searchPaymentCustomers } from '@/app/app/payments/actions';
import { Button } from '@/components/ui/button';

export type CustomerChoice = { id: string; name: string; code: string };
export type CustomerPage = { data: CustomerChoice[]; totalPages: number };
export const paymentInput =
    'w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm';

export function CustomerPicker({
    organization,
    initial,
    selected,
    required,
}: {
    organization: string;
    initial: CustomerPage;
    selected?: CustomerChoice;
    required?: boolean;
}) {
    const id = useId();
    const [search, setSearch] = useState('');
    const [term, setTerm] = useState('');
    const [page, setPage] = useState(1);
    const [results, setResults] = useState(initial);
    const [chosen, setChosen] = useState(selected);
    const [error, setError] = useState('');
    const [pending, startTransition] = useTransition();

    function load(value: string, next: number) {
        startTransition(async () => {
            setError('');
            try {
                const result = await searchPaymentCustomers(organization, value, next);
                if (result.error || !result.data) {
                    setError(result.error ?? 'Could not load customers.');
                    return;
                }
                setResults({ data: result.data, totalPages: result.totalPages });
                setPage(next);
                setTerm(value);
            } catch {
                setError('Could not load customers. Try again.');
            }
        });
    }

    const choices =
        chosen && !results.data.some((customer) => customer.id === chosen.id)
            ? [chosen, ...results.data]
            : results.data;

    return (
        <div className="space-y-2">
            <label htmlFor={id + '-search'} className="text-sm font-medium">
                Find a customer
            </label>
            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <input
                    id={id + '-search'}
                    type="search"
                    className={paymentInput}
                    maxLength={120}
                    value={search}
                    placeholder="Customer name or code"
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            if (!pending) load(search, 1);
                        }
                    }}
                />
                <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => load(search, 1)}
                >
                    Search customers
                </Button>
            </div>
            <label htmlFor={id} className="block text-sm font-medium">
                Customer
            </label>
            <select
                id={id}
                name="customerId"
                className={paymentInput}
                required={required}
                value={chosen?.id ?? ''}
                onChange={(event) =>
                    setChosen(choices.find((item) => item.id === event.target.value))
                }
            >
                <option value="">{required ? 'Choose a customer' : 'All customers'}</option>
                {choices.map((customer) => (
                    <option value={customer.id} key={customer.id}>
                        {customer.name}
                        {customer.code ? ' - ' + customer.code : ''}
                    </option>
                ))}
            </select>
            {pending && (
                <p role="status" className="text-sm">
                    Loading customers...
                </p>
            )}
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            {!pending && !error && results.data.length === 0 && (
                <p className="text-sm text-muted-foreground">No matching customers.</p>
            )}
            {(page > 1 || page < results.totalPages) && (
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending || page <= 1}
                        onClick={() => load(term, page - 1)}
                    >
                        Previous customers
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending || page >= results.totalPages}
                        onClick={() => load(term, page + 1)}
                    >
                        Next customers
                    </Button>
                </div>
            )}
        </div>
    );
}
