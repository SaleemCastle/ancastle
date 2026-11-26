const JMD_AMOUNT = /^(-?)(0|[1-9]\d{0,31})\.(\d{2})$/;

export function formatJmdAmount(amount: string): string {
    const match = JMD_AMOUNT.exec(amount);
    if (!match) throw new Error('Invalid JMD decimal amount');
    const [, sign, whole, fraction] = match;
    const grouped = new Intl.NumberFormat('en-JM', { useGrouping: true }).format(BigInt(whole!));
    return `${sign === '-' ? '-' : ''}JMD ${grouped}.${fraction}`;
}

export function formatJamaicaDate(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error('Invalid calendar date');
    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
    return new Intl.DateTimeFormat('en-JM', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(date);
}

export function formatJamaicaInstant(value: string): string {
    return new Intl.DateTimeFormat('en-JM', {
        timeZone: 'America/Jamaica',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(new Date(value));
}
