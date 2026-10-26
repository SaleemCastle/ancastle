import type { Metadata } from 'next';
import { Leaf, Sprout } from 'lucide-react';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in | Ancastle Farms' };

export default function LoginPage() {
    return (
        <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(28rem,0.9fr)]">
            <section className="relative hidden min-h-full overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-800 to-green-700 p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
                <div className="absolute -right-32 top-20 size-[34rem] rounded-full border border-white/10" />
                <div className="absolute -right-10 top-44 size-[24rem] rounded-full border border-white/10" />
                <Leaf
                    className="absolute bottom-24 right-20 size-64 rotate-12 text-lime-100/10"
                    aria-hidden="true"
                />
                <div className="relative flex items-center gap-3">
                    <span className="flex size-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                        <Leaf className="size-5" aria-hidden="true" />
                    </span>
                    <span>
                        <span className="block font-semibold tracking-tight">Ancastle Farms</span>
                        <span className="block text-xs text-emerald-100/75">Farm management</span>
                    </span>
                </div>
                <div className="relative max-w-xl">
                    <span className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-lime-300/15 text-lime-200 ring-1 ring-lime-100/20">
                        <Sprout className="size-7" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-medium uppercase tracking-[0.18em] text-lime-200">
                        Rooted in good work
                    </p>
                    <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
                        A better way to care for your farm.
                    </h2>
                    <p className="mt-5 max-w-md leading-7 text-emerald-50/80">
                        Bring your organization, farms, and team into one thoughtful workspace.
                    </p>
                </div>
                <p className="relative text-xs text-emerald-100/60">
                    Ancastle Farms · Farm operations management
                </p>
            </section>
            <section
                aria-labelledby="login-heading"
                className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-8"
            >
                <div className="w-full max-w-md rounded-3xl border border-border/80 bg-card p-7 shadow-xl shadow-emerald-950/5 sm:p-10">
                    <div className="mb-8 flex items-center gap-3 lg:hidden">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                            <Leaf className="size-5" aria-hidden="true" />
                        </span>
                        <span className="font-semibold tracking-tight">Ancastle Farms</span>
                    </div>
                    <p className="text-sm font-medium text-primary">Welcome back</p>
                    <h1 id="login-heading" className="mt-2 text-3xl font-semibold tracking-tight">
                        Sign in to your workspace
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Manage your farm operations from one place.
                    </p>
                    <LoginForm />
                </div>
            </section>
        </main>
    );
}
