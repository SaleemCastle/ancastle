import { z } from 'zod';

export const loginSchema = z.object({
    email: z
        .string()
        .trim()
        .email()
        .transform((email) => email.toLowerCase()),
    password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const logoutSchema = refreshTokenSchema;

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;

// Responses are validated by server-side consumers; credentials remain server-only.
export const authenticatedUserSchema = z.object({ id: z.uuid(), email: z.email() });
export const refreshTokenResponseSchema = z.object({
    accessToken: z.string().min(1).max(16384),
    refreshToken: z.string().min(1).max(16384),
    expiresIn: z.number().int().positive(),
});
export const loginResponseSchema = refreshTokenResponseSchema.extend({
    user: authenticatedUserSchema,
    memberships: z.array(z.object({ organizationId: z.uuid(), role: z.string().min(1) })),
});
