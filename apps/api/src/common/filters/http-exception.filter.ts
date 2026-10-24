import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorResponse } from '@ancastle/types';
import { BusinessException } from '../exceptions/business.exception.js';
import { ValidationException } from '../exceptions/validation.exception.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
        const response = host.switchToHttp().getResponse<Response>();

        if (exception instanceof BusinessException) {
            const body: ApiErrorResponse = {
                error: {
                    code: exception.code,
                    message: exception.message,
                },
            };

            response.status(exception.getStatus()).json(body);
            return;
        }

        if (exception instanceof ValidationException) {
            const body: ApiErrorResponse = {
                error: {
                    code: 'VALIDATION_ERROR',
                    message: exception.message,
                    fields: exception.fields,
                },
            };

            response.status(exception.getStatus()).json(body);
            return;
        }

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const exceptionResponse = exception.getResponse();

            const message =
                typeof exceptionResponse === 'string'
                    ? exceptionResponse
                    : this.getHttpExceptionMessage(exceptionResponse);

            const body: ApiErrorResponse = {
                error: {
                    code: this.getHttpErrorCode(status),
                    message,
                },
            };

            response.status(status).json(body);
            return;
        }

        const body: ApiErrorResponse = {
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'An unexpected error occurred',
            },
        };

        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
    }

    private getHttpExceptionMessage(response: object): string {
        if ('message' in response) {
            const message = response.message;

            if (typeof message === 'string') {
                return message;
            }

            if (Array.isArray(message)) {
                return message.join(', ');
            }
        }

        return 'Request failed';
    }

    private getHttpErrorCode(status: number): string {
        switch (status) {
            case HttpStatus.BAD_REQUEST:
                return 'BAD_REQUEST';
            case HttpStatus.UNAUTHORIZED:
                return 'UNAUTHORIZED';
            case HttpStatus.FORBIDDEN:
                return 'FORBIDDEN';
            case HttpStatus.NOT_FOUND:
                return 'NOT_FOUND';
            case HttpStatus.CONFLICT:
                return 'CONFLICT';
            default:
                return 'HTTP_ERROR';
        }
    }
}