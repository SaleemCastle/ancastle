export default function InvoicesLoading() {
    return (
        <section aria-label="Loading invoices" aria-busy="true" className="space-y-5 animate-pulse">
            <div className="h-8 w-48 rounded bg-muted" />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="h-24 rounded-2xl bg-muted" />
                ))}
            </div>
            <div className="h-40 rounded-2xl bg-muted" />
            <div className="h-72 rounded-2xl bg-muted" />
        </section>
    );
}
