import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireUser } from '@/lib/auth/current-user';
import { LogoutForm } from '@/components/logout-form';

export const metadata: Metadata = { title: 'Dashboard | Ancastle Farms' };

async function Dashboard() {
    // Page-level verification also protects direct navigation/RSC requests.
    const user = await requireUser();
    return (
        <div className="mx-auto max-w-5xl">
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="mt-2 text-gray-600">Signed in as {user.email}</p>
            <div className="mt-6">
                <LogoutForm />
            </div>
        </div>
    );
}

export default function DashboardPage() {
    return (
        <Suspense fallback={<p role="status">Loading your dashboard…</p>}>
            <Dashboard />
        </Suspense>
    );
}
