import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authConfig } from './config';
import { webSessions } from './sessions';

// React cache deduplicates only this render pass; backend identity stays authoritative.
export const currentUser = cache(async () => {
    const jar = await cookies();
    const id = jar.get(authConfig().cookie.name)?.value;
    return id ? webSessions().user(id) : null;
});

export async function requireUser() {
    const user = await currentUser();
    if (!user) redirect('/login');
    return user;
}
