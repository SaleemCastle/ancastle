import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authConfig } from '../auth/config';
import { requireUser } from '../auth/current-user';
import { webSessions } from '../auth/sessions';
import { loadOrganizations } from './api';
import { selectApplicationContext, type ApplicationSearch } from './selection';

// Deduplicate within this render only. Never persist access/permissions in the browser session.
const accessibleOrganizations = cache(async () => {
    const id = (await cookies()).get(authConfig().cookie.name)?.value;
    if (!id) redirect('/login');
    const organizations = await webSessions().withAccessToken(id, loadOrganizations);
    if (!organizations) redirect('/login');
    return organizations;
});

export async function requireApplicationContext(search: ApplicationSearch) {
    const user = await requireUser();
    const organizations = await accessibleOrganizations();
    return { user, organizations, ...selectApplicationContext(organizations, search) };
}
