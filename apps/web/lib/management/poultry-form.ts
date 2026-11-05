/** datetime-local is entered in the browser's timezone; the shared API contract requires an instant. */
export function poultryPostingForm(form: FormData): FormData {
    const value = form.get('occurredAt');
    // Only convert native datetime-local values. Keep malformed input for shared validation.
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) form.set('occurredAt', date.toISOString());
    }
    return form;
}
