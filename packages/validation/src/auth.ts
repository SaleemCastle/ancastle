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
