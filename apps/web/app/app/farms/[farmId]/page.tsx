import type { Metadata } from 'next';
import Link from 'next/link';
import { farmResponseSchema, resourceIdSchema } from '@ancastle/validation';
import { managementApi, ManagementApiError } from '@/lib/management/api';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { ManagementForm, FarmStatusForm } from '@/components/management/form';

export const metadata: Metadata = { title: 'Farm details | Ancastle Farms' };
export default function FarmPage({
    searchParams,
    params,
}: {
    searchParams: Promise<ApplicationSearch>;
    params: Promise<{ farmId: string }>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/farms"
            title="Farm details"
            render={async (context) => {
                const current = context.current!;
                if (!current.permissions.includes('farm:read'))
                    throw new ManagementApiError('FORBIDDEN');
                const id = resourceIdSchema.safeParse((await params).farmId);
                if (!id.success) throw new ManagementApiError('FARM_NOT_FOUND');
                const { data } = await managementApi(
                    'organizations/' + current.organization.id + '/farms/' + id.data,
                    farmResponseSchema,
                );
                return (
                    <>
                        <Link
                            prefetch={false}
                            href={applicationHref('/app/farms', current.organization.id)}
                            className="text-sm underline"
                        >
                            Back to farms
                        </Link>
                        <h1 className="mt-4 break-words text-2xl font-semibold">{data.name}</h1>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Code: {data.code} · Status:{' '}
                            <span data-testid="farm-status">
                                {data.isActive ? 'Active' : 'Inactive'}
                            </span>
                        </p>
                        {current.permissions.includes('farm:update') ? (
                            <>
                                <ManagementForm
                                    kind="update-farm"
                                    organization={current.organization.id}
                                    farmId={data.id}
                                    name={data.name}
                                    code={data.code}
                                />
                                <FarmStatusForm
                                    organization={current.organization.id}
                                    farmId={data.id}
                                    isActive={data.isActive}
                                />
                            </>
                        ) : (
                            <p className="mt-6 text-sm text-muted-foreground">
                                Your access to this farm is read-only.
                            </p>
                        )}
                    </>
                );
            }}
        />
    );
}
