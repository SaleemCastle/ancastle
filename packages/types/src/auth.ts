export interface AuthenticatedUser {
    id: string;
    email: string;
}

export interface AuthenticatedMembership {
    organizationId: string;
    role: string;
}

export interface LoginResponse {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: AuthenticatedUser;
    memberships: AuthenticatedMembership[];
}

export interface RefreshTokenResponse {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}
