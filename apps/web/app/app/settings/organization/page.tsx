import type { Metadata } from 'next';
import { organizationResponseSchema } from '@ancastle/validation';
import { managementApi, ManagementApiError } from '@/lib/management/api';
import type { ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { ManagementForm } from '@/components/management/form';

export const metadata: Metadata = { title: 'Organization settings | Ancastle Farms' };

export default function OrganizationPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/settings/organization"
            title="Organization settings"
            render={async (context) => {
                const current = context.current!;
                if (!current.permissions.includes('organization:read'))
                    throw new ManagementApiError('FORBIDDEN');
                const { data } = await managementApi(
                    'organizations/' + current.organization.id,
                    organizationResponseSchema,
                );
                return (
                    <>
                        <h1 className="text-2xl font-semibold">Organization settings</h1>
                        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
                            <div>
                                <dt className="text-muted-foreground">Name</dt>
                                <dd className="break-words">{data.name}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">Slug</dt>
                                <dd className="break-all">{data.slug}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">Status</dt>
                                <dd>{data.isActive ? 'Active' : 'Inactive'}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">Created</dt>
                                <dd>{data.createdAt.slice(0, 10)}</dd>
                            </div>
                        </dl>
                        {current.permissions.includes('organization:update') ? (
                            <ManagementForm
                                kind="organization"
                                organization={data.id}
                                name={data.name}
                            />
                        ) : (
                            <p className="mt-6 text-sm text-muted-foreground">
                                Your access to organization settings is read-only.
                            </p>
                        )}
                    </>
                );
            }}
        />
    );
}
