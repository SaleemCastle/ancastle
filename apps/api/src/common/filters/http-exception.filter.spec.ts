import {
    type ArgumentsHost,
    HttpStatus,
    NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { BusinessException } from '../exceptions/business.exception.js';
import { ValidationException } from '../exceptions/validation.exception.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

function createMockHost() {
    const json = vi.fn();
    const status = vi.fn(() => ({
        json,
    }));

    const response = {
        status,
    } as unknown as Response;

    const host = {
        switchToHttp: () => ({
            getResponse: () => response,
        }),
    } as unknown as ArgumentsHost;

    return {
        host,
        status,
        json,
    };
}
describe('HttpExceptionFilter', () => {
    const filter = new HttpExceptionFilter();

    it('returns standardized validation errors', () => {
        const { host, status, json } = createMockHost();

        const exception = new ValidationException({
            email: ['Invalid email address'],
        });

        filter.catch(exception, host);

        expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);

        expect(json).toHaveBeenCalledWith({
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Validation failed',
                fields: {
                    email: ['Invalid email address'],
                },
            },
        });
    });

    it('returns stable business error codes', () => {
        const { host, status, json } = createMockHost();

        const exception = new BusinessException(
            'INSUFFICIENT_STOCK',
            'There is insufficient stock',
            HttpStatus.CONFLICT,
        );

        filter.catch(exception, host);

        expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);

        expect(json).toHaveBeenCalledWith({
            error: {
                code: 'INSUFFICIENT_STOCK',
                message: 'There is insufficient stock',
            },
        });
    });

    it('returns standardized HTTP errors', () => {
        const { host, status, json } = createMockHost();

        filter.catch(
            new NotFoundException('Customer was not found'),
            host,
        );

        expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);

        expect(json).toHaveBeenCalledWith({
            error: {
                code: 'NOT_FOUND',
                message: 'Customer was not found',
            },
        });
    });

    it('does not expose internal error details', () => {
        const { host, status, json } = createMockHost();

        const exception = new Error(
            'Database password leaked here',
        );

        filter.catch(exception, host);

        expect(status).toHaveBeenCalledWith(
            HttpStatus.INTERNAL_SERVER_ERROR,
        );

        expect(json).toHaveBeenCalledWith({
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'An unexpected error occurred',
            },
        });

        const responseBody = json.mock.calls[0]?.[0];
        const serializedResponse = JSON.stringify(responseBody);

        expect(serializedResponse).not.toContain(
            'Database password leaked here',
        );

        if (exception.stack) {
            expect(serializedResponse).not.toContain(exception.stack);
        }
    });
});