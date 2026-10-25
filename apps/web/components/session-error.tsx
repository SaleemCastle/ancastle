'use client';

import { Button } from '@/components/ui/button';

export function SessionError({ reset }: { reset?: () => void }) {
    return (
        <div className="mx-auto max-w-md space-y-4 p-6">
            <h1 className="text-xl font-semibold">Unable to check your session</h1>
            <p>Please try again in a moment.</p>
            <Button onClick={() => (reset ? reset() : window.location.reload())}>Try again</Button>
        </div>
    );
}
