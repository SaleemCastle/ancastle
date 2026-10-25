import type { Metadata } from 'next';
import Link from 'next/link';
import { organizationMemberResponseSchema, resourceIdSchema } from '@ancastle/validation';
import { managementApi, ManagementApiError } from '@/lib/management/api';
import { memberFarmChoices } from '@/lib/management/farm-choices';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import {
    MemberProfileForm,
    MemberRoleForm,
    MemberFarmForm,
    MemberStatusForm,
} from '@/components/users/forms';

export const metadata: Metadata = { title: 'Organization member | Ancastle Farms' };
export default function MemberPage({
    searchParams,
    params,
}: {
    searchParams: Promise<ApplicationSearch>;
    params: Promise<{ userId: string }>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/users"
            title="Organization member"
            render={async (context) => {
                const current = context.current!;
                if (!current.permissions.includes('user:read'))
                    throw new ManagementApiError('FORBIDDEN');
                const id = resourceIdSchema.safeParse((await params).userId);
                if (!id.success) throw new ManagementApiError('ORGANIZATION_USER_NOT_FOUND');
                const { data } = await managementApi(
                    'organizations/' + current.organization.id + '/users/' + id.data,
                    organizationMemberResponseSchema,
                );
                const canManage = current.permissions.includes('membership:manage');
                const farms = canManage ? await memberFarmChoices(current.organization.id) : [];
                return (
                    <>
                        <Link
                            prefetch={false}
                            href={applicationHref('/app/users', current.organization.id)}
                            className="text-sm underline"
                        >
                            Back to users
                        </Link>
                        <h1 className="mt-4 break-all text-2xl font-semibold">
                            {data.displayName ?? data.email}
                        </h1>
                        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
                            <div>
                                <dt className="text-muted-foreground">Email (read-only)</dt>
                                <dd className="break-all">{data.email}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">
                                    Global account status (read-only)
                                </dt>
                                <dd>{data.userIsActive ? 'Active' : 'Inactive'}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">Organization role</dt>
                                <dd data-testid="member-role">{data.role}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">Membership status</dt>
                                <dd data-testid="membership-status">
                                    {data.isActive ? 'Active' : 'Inactive'}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">Farm access</dt>
                                <dd data-testid="member-farm-summary">
                                    {data.farmAccess.allFarms
                                        ? 'All farms in this organization'
                                        : data.farmAccess.farmIds.length +
                                          (data.farmAccess.farmIds.length === 1
                                              ? ' assigned farm'
                                              : ' assigned farms')}
                                </dd>
                            </div>
                        </dl>
                        <div className="mt-8 space-y-8 divide-y">
                            {current.permissions.includes('user:update') && (
                                <section className="pt-6">
                                    <h2 className="mb-4 text-lg font-semibold">
                                        Organization profile
                                    </h2>
                                    <MemberProfileForm
                                        organization={current.organization.id}
                                        userId={data.userId}
                                        displayName={data.displayName}
                                    />
                                </section>
                            )}
                            {canManage && (
                                <>
                                    <section className="pt-6">
                                        <h2 className="mb-4 text-lg font-semibold">Role</h2>
                                        <MemberRoleForm
                                            organization={current.organization.id}
                                            userId={data.userId}
                                            role={data.role}
                                        />
                                    </section>
                                    <section className="pt-6">
                                        <h2 className="mb-4 text-lg font-semibold">
                                            Farm assignments
                                        </h2>
                                        <MemberFarmForm
                                            organization={current.organization.id}
                                            userId={data.userId}
                                            farms={farms}
                                            assigned={data.farmAccess.farmIds}
                                            allFarms={data.farmAccess.allFarms}
                                        />
                                    </section>
                                </>
                            )}
                            {canManage && current.permissions.includes('user:deactivate') && (
                                <section className="pt-6">
                                    <h2 className="mb-4 text-lg font-semibold">
                                        Membership lifecycle
                                    </h2>
                                    <MemberStatusForm
                                        organization={current.organization.id}
                                        userId={data.userId}
                                        isActive={data.isActive}
                                    />
                                </section>
                            )}
                        </div>
                    </>
                );
            }}
        />
    );
}
