import type { Metadata } from 'next';
import Link from 'next/link';
import { resourceIdSchema } from '@ancastle/validation';
import { customerResponseSchema, managementApi, ManagementApiError } from '@/lib/management/api';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { CustomerForm, CustomerStatusForm } from '@/components/customers/forms';
import { MasterDataStatus } from '@/components/management/master-data-list';

export const metadata: Metadata = {
    title: 'Customer details | Ancastle Farms',
};

export default function CustomerPage({
    searchParams,
    params,
}: {
    searchParams: Promise<ApplicationSearch>;
    params: Promise<{ customerId: string }>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/customers"
            title="Customer details"
            render={async (context) => {
                const current = context.current!;

                if (!current.permissions.includes('customer:read')) {
                    throw new ManagementApiError('FORBIDDEN');
                }

                const id = resourceIdSchema.safeParse((await params).customerId);

                if (!id.success) {
                    throw new ManagementApiError('CUSTOMER_NOT_FOUND');
                }

                const { data } = await managementApi(
                    'organizations/' + current.organization.id + '/customers/' + id.data,
                    customerResponseSchema,
                );

                const canEdit = current.permissions.includes('customer:update');

                const canChangeStatus = current.permissions.includes('customer:deactivate');

                return (
                    <>
                        <Link
                            prefetch={false}
                            href={applicationHref('/app/customers', current.organization.id)}
                            className="text-sm underline"
                        >
                            Back to customers
                        </Link>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <h1 className="wrap-break-word text-2xl font-semibold">{data.name}</h1>

                            <MasterDataStatus isActive={data.isActive} />
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            <span>Code: {data.code}</span>
                            <span>
                                Type: {data.type === 'BUSINESS' ? 'Business' : 'Individual'}
                            </span>
                        </div>

                        {canEdit ? (
                            <CustomerForm
                                mode="update"
                                organization={current.organization.id}
                                customerId={data.id}
                                type={data.type}
                                name={data.name}
                                contactPerson={data.contactPerson}
                                phone={data.phone}
                                email={data.email}
                                address={data.address}
                                notes={data.notes}
                            />
                        ) : (
                            <section
                                aria-label="Customer details"
                                className="mt-6 max-w-2xl space-y-4 rounded-xl border p-5"
                            >
                                <div>
                                    <p className="text-sm font-medium">Contact person</p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {data.contactPerson || 'Not provided'}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm font-medium">Phone</p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {data.phone || 'Not provided'}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm font-medium">Email</p>
                                    <p className="mt-1 break-all text-sm text-muted-foreground">
                                        {data.email || 'Not provided'}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm font-medium">Address</p>
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                                        {data.address || 'Not provided'}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm font-medium">Notes</p>
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                                        {data.notes || 'Not provided'}
                                    </p>
                                </div>

                                <p className="border-t pt-4 text-sm text-muted-foreground">
                                    Your access to this customer is read-only.
                                </p>
                            </section>
                        )}

                        {canChangeStatus && (
                            <CustomerStatusForm
                                organization={current.organization.id}
                                customerId={data.id}
                                isActive={data.isActive}
                            />
                        )}
                    </>
                );
            }}
        />
    );
}
