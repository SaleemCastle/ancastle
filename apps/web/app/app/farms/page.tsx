import type { Metadata } from 'next';
import Link from 'next/link';
import { farmListQuerySchema, farmListResponseSchema } from '@ancastle/validation';
import { managementApi, ManagementApiError } from '@/lib/management/api';
import { applicationHref, type ApplicationSearch } from '@/lib/application/selection';
import { ManagementPage } from '@/components/management/page';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Farms | Ancastle Farms' };

export default function FarmsPage({ searchParams }: { searchParams: Promise<ApplicationSearch> }) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/farms"
            title="Farms"
            render={async (context, search) => {
                const current = context.current!;
                if (!current.permissions.includes('farm:read'))
                    throw new ManagementApiError('FORBIDDEN');
                const parsed = farmListQuerySchema.safeParse({
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
                    'organizations/' + current.organization.id + '/farms?' + query.toString(),
                    farmListResponseSchema,
                );
                const pageHref = (page: number) => {
                    const value = new URLSearchParams(query);
                    value.set('page', String(page));
                    return (
                        applicationHref('/app/farms', current.organization.id) +
                        '&' +
                        value.toString()
                    );
                };
                const canEdit = current.permissions.includes('farm:update');
                return (
                    <>
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <h1 className="text-2xl font-semibold">Farms</h1>
                            {current.permissions.includes('farm:create') && (
                                <Link
                                    prefetch={false}
                                    href={applicationHref(
                                        '/app/farms/new',
                                        current.organization.id,
                                    )}
                                    className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                                >
                                    Create farm
                                </Link>
                            )}
                        </div>
                        <form action="/app/farms" className="my-6 flex flex-wrap items-end gap-3">
                            <input
                                type="hidden"
                                name="organization"
                                value={current.organization.id}
                            />
                            <input type="hidden" name="pageSize" value={parsed.data.pageSize} />
                            <div>
                                <label
                                    htmlFor="status-filter"
                                    className="mb-2 block text-sm font-medium"
                                >
                                    Status
                                </label>
                                <select
                                    id="status-filter"
                                    name="isActive"
                                    defaultValue={search.isActive ?? ''}
                                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                >
                                    <option value="">All accessible farms</option>
                                    <option value="true">Active</option>
                                    <option value="false">Inactive</option>
                                </select>
                            </div>
                            <Button type="submit" variant="outline" className="h-10">
                                Apply filter
                            </Button>
                        </form>
                        {result.data.length ? (
                            <div className="max-w-full overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <caption className="sr-only">Accessible farms</caption>
                                    <thead className="border-b text-muted-foreground">
                                        <tr>
                                            <th className="p-3 font-medium">Name</th>
                                            <th className="p-3 font-medium">Code</th>
                                            <th className="p-3 font-medium">Status</th>
                                            <th className="p-3 font-medium">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.data.map((farm) => (
                                            <tr key={farm.id} className="border-b">
                                                <td className="p-3">{farm.name}</td>
                                                <td className="p-3">{farm.code}</td>
                                                <td className="p-3">
                                                    {farm.isActive ? 'Active' : 'Inactive'}
                                                </td>
                                                <td className="p-3">
                                                    <Link
                                                        prefetch={false}
                                                        href={applicationHref(
                                                            '/app/farms/' + farm.id,
                                                            current.organization.id,
                                                        )}
                                                        className="underline"
                                                    >
                                                        {canEdit ? 'Edit' : 'View'}
                                                        <span className="sr-only">
                                                            {' '}
                                                            {farm.name}
                                                        </span>
                                                    </Link>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="my-6">No farms match this view.</p>
                        )}
                        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
                            <p>
                                {result.meta.totalItems} farms · Page {result.meta.page} of{' '}
                                {Math.max(1, result.meta.totalPages)}
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
