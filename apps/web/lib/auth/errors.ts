import 'server-only';

export class AuthUnavailableError extends Error {
    constructor() {
        super('Authentication is temporarily unavailable');
    }
}
export class AuthenticationRejectedError extends Error {
    constructor() {
        super('Authentication was rejected');
    }
}
