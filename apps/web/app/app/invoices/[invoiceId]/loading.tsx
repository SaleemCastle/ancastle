export default function InvoiceDetailsLoading() {
    return (
        <section
            aria-label="Loading invoice details"
            aria-busy="true"
            className="space-y-5 animate-pulse"
        >
            <div className="h-8 w-56 rounded bg-muted" />
            <div className="grid gap-4 lg:grid-cols-2">
                <div className="h-48 rounded-2xl bg-muted" />
                <div className="h-48 rounded-2xl bg-muted" />
            </div>
            <div className="h-72 rounded-2xl bg-muted" />
        </section>
    );
}
