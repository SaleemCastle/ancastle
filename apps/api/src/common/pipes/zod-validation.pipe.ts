import { Injectable, type PipeTransform } from '@nestjs/common';
import { type ZodType, ZodError } from 'zod';
import { ValidationException } from '../exceptions/validation.exception.js';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
    constructor(private readonly schema: ZodType<T>) { }

    transform(value: unknown): T {
        try {
            return this.schema.parse(value);
        } catch (error) {
            if (error instanceof ZodError) {
                throw new ValidationException(this.mapIssuesToFields(error));
            }

            throw error;
        }
    }

    private mapIssuesToFields(
        error: ZodError,
    ): Record<string, string[]> {
        const fields: Record<string, string[]> = {};

        for (const issue of error.issues) {
            const field = issue.path.length > 0
                ? issue.path.join('.')
                : '_root';

            fields[field] ??= [];
            fields[field].push(issue.message);
        }

        return fields;
    }
}