import Link from 'next/link';

export default function Home() {
    return (
        <main className="flex min-h-screen items-center justify-center">
            <div className="text-center">
                <h1 className="text-4xl font-bold">Ancastle Farms</h1>

                <p className="mt-2 text-gray-600">Farm Operations Management</p>
                <Link
                    href="/login"
                    className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-primary-foreground"
                >
                    Sign in
                </Link>
            </div>
        </main>
    );
}
