import type { Metadata } from 'next';
import Link from 'next/link';
import {
    organizationMemberListQuerySchema,
    organizationMemberListResponseSchema,
} from '@ancastle/validation';
import { managementApi, ManagementApiError } from '@/lib/management/api';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Organization users | Ancastle Farms' };
export default function UsersPage({ searchParams }: { searchParams: Promise<ApplicationSearch> }) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/users"
            title="Organization users"
            render={async (context, search) => {
                const current = context.current!;
                if (!current.permissions.includes('user:read'))
                    throw new ManagementApiError('FORBIDDEN');
                const parsed = organizationMemberListQuerySchema.safeParse({
                    page: search.page,
                    pageSize: search.pageSize,
                    isActive: search.isActive === '' ? undefined : search.isActive,
                });
                if (!parsed.success) throw new ManagementApiError('VALIDATION_ERROR');
                const query = new URLSearchParams({
                    page: String(parsed.data.page),
                    pageSize: String(parsed.data.pageSize),
                });
                if (parsed.data.isActive !== undefined)
                    query.set('isActive', String(parsed.data.isActive));
                const result = await managementApi(
                    'organizations/' + current.organization.id + '/users?' + query.toString(),
                    organizationMemberListResponseSchema,
                );
                const pageHref = (page: number) => {
                    const value = new URLSearchParams(query);
                    value.set('page', String(page));
                    return (
                        applicationHref('/app/users', current.organization.id) +
                        '&' +
                        value.toString()
                    );
                };
                const canCreate =
                    current.permissions.includes('user:create') &&
                    current.permissions.includes('membership:manage');
                const canManage =
                    current.permissions.includes('user:update') ||
                    current.permissions.includes('membership:manage');
                return (
                    <>
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <h1 className="text-2xl font-semibold">Organization users</h1>
                            {canCreate && (
                                <Link
                                    prefetch={false}
                                    href={applicationHref(
                                        '/app/users/new',
                                        current.organization.id,
                                    )}
                                    className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                                >
                                    Create user
                                </Link>
                            )}
                        </div>
                        <form action="/app/users" className="my-6 flex flex-wrap items-end gap-3">
                            <input
                                type="hidden"
                                name="organization"
                                value={current.organization.id}
                            />
                            <input type="hidden" name="pageSize" value={parsed.data.pageSize} />
                            <div>
                                <label
                                    htmlFor="membership-filter"
                                    className="mb-2 block text-sm font-medium"
                                >
                                    Membership status
                                </label>
                                <select
                                    id="membership-filter"
                                    name="isActive"
                                    defaultValue={search.isActive ?? ''}
                                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                >
                                    <option value="">All memberships</option>
                                    <option value="true">Active</option>
                                    <option value="false">Inactive</option>
                                </select>
                            </div>
                            <Button type="submit" variant="outline" className="h-10">
                                Apply filter
                            </Button>
                        </form>
                        {result.data.length ? (
                            <div className="relative max-w-full overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <caption className="sr-only">Organization members</caption>
                                    <thead className="border-b text-muted-foreground">
                                        <tr>
                                            <th className="p-3 font-medium">User</th>
                                            <th className="p-3 font-medium">Role</th>
                                            <th className="p-3 font-medium">Membership</th>
                                            <th className="p-3 font-medium">Farm access</th>
                                            <th className="p-3 font-medium">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.data.map((member) => (
                                            <tr key={member.membershipId} className="border-b">
                                                <td className="p-3">
                                                    <p className="break-words">
                                                        {member.displayName ?? member.email}
                                                    </p>
                                                    {member.displayName && (
                                                        <p className="text-xs text-muted-foreground">
                                                            {member.email}
                                                        </p>
                                                    )}
                                                </td>
                                                <td className="p-3">{member.role}</td>
                                                <td className="p-3">
                                                    {member.isActive ? 'Active' : 'Inactive'}
                                                </td>
                                                <td className="p-3">
                                                    {member.farmAccess.allFarms
                                                        ? 'All farms'
                                                        : member.farmAccess.farmIds.length +
                                                          ' assigned'}
                                                </td>
                                                <td className="p-3">
                                                    <Link
                                                        prefetch={false}
                                                        href={applicationHref(
                                                            '/app/users/' + member.userId,
                                                            current.organization.id,
                                                        )}
                                                        className="underline"
                                                    >
                                                        {canManage ? 'Manage' : 'View'}
                                                        <span className="sr-only">
                                                            {' '}
                                                            {member.email}
                                                        </span>
                                                    </Link>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="my-6">No users match this view.</p>
                        )}
                        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
                            <p>
                                {result.meta.totalItems}{' '}
                                {result.meta.totalItems === 1 ? 'user' : 'users'} · Page{' '}
                                {result.meta.page} of {Math.max(1, result.meta.totalPages)}
                            </p>
                            {result.meta.page > 1 && (
                                <Link
                                    prefetch={false}
                                    href={pageHref(result.meta.page - 1)}
                                    className="underline"
                                >
                                    Previous page
                                </Link>
                            )}
                            {result.meta.page < result.meta.totalPages && (
                                <Link
                                    prefetch={false}
                                    href={pageHref(result.meta.page + 1)}
                                    className="underline"
                                >
                                    Next page
                                </Link>
                            )}
                        </div>
                    </>
                );
            }}
        />
    );
}
