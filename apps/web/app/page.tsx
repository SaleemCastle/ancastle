import Link from 'next/link';
import { ArrowRight, Building2, Leaf, Sprout, Warehouse } from 'lucide-react';

export default function Home() {
    return (
        <main className="min-h-screen overflow-hidden bg-background">
            <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
                <Link href="/" className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                        <Leaf className="size-5" aria-hidden="true" />
                    </span>
                    <span>
                        <span className="block font-semibold tracking-tight">Ancastle Farms</span>
                        <span className="block text-xs text-muted-foreground">Farm management</span>
                    </span>
                </Link>
                <Link
                    href="/login"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                    Sign in
                    <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
            </header>
            <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pb-24 lg:grid-cols-[1fr_0.9fr] lg:py-24">
                <div className="max-w-2xl">
                    <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-primary shadow-sm">
                        <Sprout className="size-4" aria-hidden="true" />
                        Made for the work that matters
                    </p>
                    <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                        Good work starts with a well-run farm.
                    </h1>
                    <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                        A thoughtful workspace for the organizations, farms, and people behind
                        modern farm operations.
                    </p>
                    <Link
                        href="/login"
                        className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/15 transition hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                        Open your workspace
                        <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                    <p className="mt-4 text-xs text-muted-foreground">
                        Sign in with your Ancastle Farms account.
                    </p>
                </div>
                <div className="relative mx-auto w-full max-w-xl">
                    <div className="absolute -inset-6 rounded-[2.5rem] bg-secondary/70 blur-2xl" />
                    <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-emerald-950 via-emerald-800 to-green-700 p-6 text-white shadow-2xl shadow-emerald-950/20 sm:p-8">
                        <div className="absolute -right-16 -top-20 size-64 rounded-full border border-white/10" />
                        <div className="absolute -right-4 -top-8 size-44 rounded-full border border-white/10" />
                        <div className="relative flex items-center justify-between">
                            <div>
                                <p className="text-sm text-emerald-100/75">Your operations</p>
                                <h2 className="mt-1 text-xl font-semibold">All in one place</h2>
                            </div>
                            <span className="flex size-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                                <Leaf className="size-5 text-lime-200" aria-hidden="true" />
                            </span>
                        </div>
                        <div className="relative mt-8 space-y-3">
                            {[
                                {
                                    icon: Building2,
                                    label: 'Organizations',
                                    detail: 'A home for your team',
                                },
                                {
                                    icon: Warehouse,
                                    label: 'Farms',
                                    detail: 'Your day-to-day operations',
                                },
                                {
                                    icon: Sprout,
                                    label: 'People & access',
                                    detail: 'The right access, together',
                                },
                            ].map(({ icon: Icon, label, detail }) => (
                                <div
                                    key={label}
                                    className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm"
                                >
                                    <span className="flex size-11 items-center justify-center rounded-xl bg-white/10 text-lime-200">
                                        <Icon className="size-5" aria-hidden="true" />
                                    </span>
                                    <div>
                                        <p className="text-sm font-semibold">{label}</p>
                                        <p className="mt-0.5 text-xs text-emerald-50/70">
                                            {detail}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="relative mt-6 flex items-center gap-2 text-xs text-emerald-50/65">
                            <span className="size-2 rounded-full bg-lime-300" />
                            Farm management, thoughtfully connected
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
