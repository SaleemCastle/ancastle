'use client';

import { createContext, useContext } from 'react';
import type { ApplicationFarm, ApplicationOrganization, AuthenticatedUser } from '@ancastle/types';

export interface ApplicationViewContext {
    user: AuthenticatedUser;
    current: ApplicationOrganization | null;
    farm: ApplicationFarm | null;
}
const Context = createContext<ApplicationViewContext | undefined>(undefined);

/** Display context only. Server pages and resource APIs must revalidate access. */
export function ApplicationContextProvider({
    value,
    children,
}: {
    value: ApplicationViewContext;
    children: React.ReactNode;
}) {
    return <Context value={value}>{children}</Context>;
}

export function useApplicationContext() {
    const context = useContext(Context);
    if (!context) throw new Error('Application context is unavailable');
    return context;
}
