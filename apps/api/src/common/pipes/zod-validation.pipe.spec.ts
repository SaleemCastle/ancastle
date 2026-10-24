import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationException } from '../exceptions/validation.exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
    const schema = z.object({
        name: z.string().min(1, 'Name is required'),
        email: z.email('Invalid email address'),
    });

    const pipe = new ZodValidationPipe(schema);

    it('returns validated data when input is valid', () => {
        const input = {
            name: 'Ancastle Farms',
            email: 'admin@ancastle.com',
        };

        expect(pipe.transform(input)).toEqual(input);
    });

    it('throws field-level validation errors when input is invalid', () => {
        try {
            pipe.transform({
                name: '',
                email: 'invalid-email',
            });
        } catch (error) {
            expect(error).toBeInstanceOf(ValidationException);

            const validationError = error as ValidationException;

            expect(validationError.fields).toEqual({
                name: ['Name is required'],
                email: ['Invalid email address'],
            });

            return;
        }

        throw new Error('Expected validation to fail');
    });
});