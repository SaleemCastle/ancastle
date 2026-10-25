import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in | Ancastle Farms' };

export default function LoginPage() {
    return (
        <main className="flex min-h-screen items-center justify-center px-4 py-12">
            <section
                className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8"
                aria-labelledby="login-heading"
            >
                <p className="text-sm font-medium text-muted-foreground">Ancastle Farms</p>
                <h1 id="login-heading" className="mt-2 text-2xl font-semibold">
                    Welcome back
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Sign in to manage your farm operations.
                </p>
                <LoginForm />
            </section>
        </main>
    );
}
