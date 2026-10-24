import { HttpException, HttpStatus } from '@nestjs/common';

export class ValidationException extends HttpException {
    constructor(public readonly fields: Record<string, string[]>) {
        super('Validation failed', HttpStatus.BAD_REQUEST);
    }
}