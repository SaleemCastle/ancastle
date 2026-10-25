import type { Metadata } from 'next';
import type { ApplicationSearch } from '@/lib/application/selection';
import { ManagementApiError } from '@/lib/management/api';
import { memberFarmChoices } from '@/lib/management/farm-choices';
import { ManagementPage } from '@/components/management/page';
import { NewUserForm } from '@/components/users/forms';

export const metadata: Metadata = { title: 'Create organization user | Ancastle Farms' };
export default function NewUserPage({
    searchParams,
}: {
    searchParams: Promise<ApplicationSearch>;
}) {
    return (
        <ManagementPage
            searchParams={searchParams}
            activePath="/app/users"
            title="Create user"
            render={async (context) => {
                const current = context.current!;
                if (
                    !['user:create', 'membership:manage'].every((permission) =>
                        current.permissions.includes(permission),
                    )
                )
                    throw new ManagementApiError('FORBIDDEN');
                const farms = await memberFarmChoices(current.organization.id);
                return (
                    <>
                        <h1 className="text-2xl font-semibold">Create user</h1>
                        <p className="mt-2 text-muted-foreground">
                            Create a new account and membership in this organization.
                        </p>
                        <NewUserForm organization={current.organization.id} farms={farms} />
                    </>
                );
            }}
        />
    );
}
