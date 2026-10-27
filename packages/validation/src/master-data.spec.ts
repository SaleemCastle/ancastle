import { describe, expect, it } from 'vitest';
import {
    createCustomerSchema,
    createSupplierSchema,
    masterDataQuerySchema,
    updateCustomerSchema,
    updateSupplierSchema,
} from './index.js';

describe('Customer validation', () => {
    describe('createCustomerSchema', () => {
        it('accepts a valid individual customer', () => {
            const result = createCustomerSchema.safeParse({
                type: 'INDIVIDUAL',
                name: 'John Brown',
                phone: '876-555-0100',
                email: 'john@example.com',
                address: 'Spanish Town, St. Catherine',
                notes: 'Regular customer',
            });

            expect(result.success).toBe(true);

            if (result.success) {
                expect(result.data).toEqual({
                    type: 'INDIVIDUAL',
                    name: 'John Brown',
                    phone: '876-555-0100',
                    email: 'john@example.com',
                    address: 'Spanish Town, St. Catherine',
                    notes: 'Regular customer',
                });
            }
        });

        it('accepts a valid business customer with a contact person', () => {
            const result = createCustomerSchema.safeParse({
                type: 'BUSINESS',
                name: "Brown's Supermarket",
                contactPerson: 'John Brown',
                phone: '876-555-0200',
                email: 'accounts@brown.example.com',
            });

            expect(result.success).toBe(true);

            if (result.success) {
                expect(result.data.type).toBe('BUSINESS');
                expect(result.data.name).toBe("Brown's Supermarket");
                expect(result.data.contactPerson).toBe('John Brown');
            }
        });

        it('rejects an invalid customer type', () => {
            const result = createCustomerSchema.safeParse({
                type: 'WHOLESALE',
                name: 'ABC Farms',
            });

            expect(result.success).toBe(false);
        });

        it('rejects a missing customer name', () => {
            const result = createCustomerSchema.safeParse({
                type: 'INDIVIDUAL',
            });

            expect(result.success).toBe(false);
        });

        it('rejects a blank customer name', () => {
            const result = createCustomerSchema.safeParse({
                type: 'INDIVIDUAL',
                name: '     ',
            });

            expect(result.success).toBe(false);
        });

        it('trims the customer name', () => {
            const result = createCustomerSchema.parse({
                type: 'BUSINESS',
                name: '   ABC Farms   ',
            });

            expect(result.name).toBe('ABC Farms');
        });

        it('normalizes optional text fields', () => {
            const result = createCustomerSchema.parse({
                type: 'BUSINESS',
                name: 'ABC Farms',
                contactPerson: '   Jane Brown   ',
                address: '   Kingston, Jamaica   ',
                notes: '   Preferred customer   ',
            });

            expect(result.contactPerson).toBe('Jane Brown');
            expect(result.address).toBe('Kingston, Jamaica');
            expect(result.notes).toBe('Preferred customer');
        });

        it('normalizes blank optional strings to undefined', () => {
            const result = createCustomerSchema.parse({
                type: 'INDIVIDUAL',
                name: 'John Brown',
                contactPerson: '   ',
                phone: '',
                email: '   ',
                address: ' ',
                notes: '      ',
            });

            expect(result.contactPerson).toBeUndefined();
            expect(result.phone).toBeUndefined();
            expect(result.email).toBeUndefined();
            expect(result.address).toBeUndefined();
            expect(result.notes).toBeUndefined();
        });

        it('trims and lowercases email addresses', () => {
            const result = createCustomerSchema.parse({
                type: 'BUSINESS',
                name: 'ABC Farms',
                email: '   ACCOUNTS@EXAMPLE.COM   ',
            });

            expect(result.email).toBe('accounts@example.com');
        });

        it('rejects an invalid email address', () => {
            const result = createCustomerSchema.safeParse({
                type: 'INDIVIDUAL',
                name: 'John Brown',
                email: 'not-an-email',
            });

            expect(result.success).toBe(false);
        });

        it('trims phone numbers without changing their contents', () => {
            const result = createCustomerSchema.parse({
                type: 'INDIVIDUAL',
                name: 'John Brown',
                phone: '   +1 (876) 555-0100   ',
            });

            expect(result.phone).toBe('+1 (876) 555-0100');
        });

        it('rejects client-supplied organization ownership', () => {
            const result = createCustomerSchema.safeParse({
                type: 'BUSINESS',
                name: 'ABC Farms',
                organizationId: '5e8ca18e-8441-48cb-a38d-42d87bc97225',
            });

            expect(result.success).toBe(false);

            if (!result.success) {
                expect(result.error.issues).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            code: 'unrecognized_keys',
                            keys: expect.arrayContaining(['organizationId']),
                        }),
                    ]),
                );
            }
        });

        it.each([
            ['id', 'customer-id'],
            ['code', 'CUS-000001'],
            ['isActive', true],
            ['createdAt', '2026-10-26T12:00:00.000Z'],
            ['updatedAt', '2026-10-26T12:00:00.000Z'],
        ])('rejects client-supplied %s', (field: string, value: unknown) => {
            const result = createCustomerSchema.safeParse({
                type: 'INDIVIDUAL',
                name: 'John Brown',
                [field]: value,
            });

            expect(result.success).toBe(false);
        });
    });

    describe('updateCustomerSchema', () => {
        it('accepts a valid partial customer update', () => {
            const result = updateCustomerSchema.safeParse({
                name: 'Updated Customer',
                email: 'updated@example.com',
            });

            expect(result.success).toBe(true);
        });

        it('accepts updating only the customer type', () => {
            const result = updateCustomerSchema.safeParse({
                type: 'BUSINESS',
            });

            expect(result.success).toBe(true);
        });

        it('normalizes update values', () => {
            const result = updateCustomerSchema.parse({
                name: '   Updated Customer   ',
                email: '   UPDATED@EXAMPLE.COM   ',
            });

            expect(result.name).toBe('Updated Customer');
            expect(result.email).toBe('updated@example.com');
        });

        it('rejects an empty update payload', () => {
            const result = updateCustomerSchema.safeParse({});

            expect(result.success).toBe(false);
        });

        it('rejects organizationId in an update payload', () => {
            const result = updateCustomerSchema.safeParse({
                name: 'Updated Customer',
                organizationId: 'spoofed-organization',
            });

            expect(result.success).toBe(false);
        });

        it('rejects lifecycle changes through the ordinary update schema', () => {
            const result = updateCustomerSchema.safeParse({
                isActive: false,
            });

            expect(result.success).toBe(false);
        });

        it('rejects invalid customer types during update', () => {
            const result = updateCustomerSchema.safeParse({
                type: 'INVALID',
            });

            expect(result.success).toBe(false);
        });

        it('allows optional customer fields to be cleared with null', () => {
            expect(
                updateCustomerSchema.parse({
                    contactPerson: null,
                    phone: null,
                    email: null,
                    address: null,
                    notes: null,
                }),
            ).toEqual({
                contactPerson: null,
                phone: null,
                email: null,
                address: null,
                notes: null,
            });
        });

        it('normalizes blank optional customer update fields to null', () => {
            expect(
                updateCustomerSchema.parse({
                    contactPerson: '   ',
                    phone: '',
                    email: ' ',
                    address: '   ',
                    notes: '',
                }),
            ).toEqual({
                contactPerson: null,
                phone: null,
                email: null,
                address: null,
                notes: null,
            });
        });

        it('normalizes customer update values', () => {
            expect(
                updateCustomerSchema.parse({
                    contactPerson: '  Jane Doe  ',
                    phone: ' 876-555-1234 ',
                    email: '  JANE@EXAMPLE.COM ',
                    address: '  Spanish Town  ',
                    notes: '  Preferred customer  ',
                }),
            ).toEqual({
                contactPerson: 'Jane Doe',
                phone: '876-555-1234',
                email: 'jane@example.com',
                address: 'Spanish Town',
                notes: 'Preferred customer',
            });
        });

        it('rejects null customer name', () => {
            expect(() =>
                updateCustomerSchema.parse({
                    name: null,
                }),
            ).toThrow();
        });

        it('rejects null customer type', () => {
            expect(() =>
                updateCustomerSchema.parse({
                    type: null,
                }),
            ).toThrow();
        });
    });
});

describe('Supplier validation', () => {
    describe('createSupplierSchema', () => {
        it('accepts a valid supplier', () => {
            const result = createSupplierSchema.safeParse({
                name: 'Caribbean Feed Supplies Ltd',
                contactPerson: 'Jane Brown',
                phone: '876-555-0300',
                email: 'sales@caribbeanfeed.example.com',
                address: 'Kingston, Jamaica',
                notes: 'Primary feed supplier',
            });

            expect(result.success).toBe(true);
        });

        it('rejects a missing supplier name', () => {
            const result = createSupplierSchema.safeParse({
                email: 'supplier@example.com',
            });

            expect(result.success).toBe(false);
        });

        it('rejects a blank supplier name', () => {
            const result = createSupplierSchema.safeParse({
                name: '     ',
            });

            expect(result.success).toBe(false);
        });

        it('normalizes supplier fields', () => {
            const result = createSupplierSchema.parse({
                name: '   Caribbean Feed Supplies   ',
                contactPerson: '   Jane Brown   ',
                phone: '   +1 (876) 555-0300   ',
                email: '   SALES@SUPPLIER.COM   ',
                address: '   Kingston, Jamaica   ',
            });

            expect(result.name).toBe('Caribbean Feed Supplies');
            expect(result.contactPerson).toBe('Jane Brown');
            expect(result.phone).toBe('+1 (876) 555-0300');
            expect(result.email).toBe('sales@supplier.com');
            expect(result.address).toBe('Kingston, Jamaica');
        });

        it('normalizes blank optional fields to undefined', () => {
            const result = createSupplierSchema.parse({
                name: 'Feed Supplier',
                contactPerson: '',
                phone: ' ',
                email: '   ',
                address: '',
                notes: ' ',
            });

            expect(result.contactPerson).toBeUndefined();
            expect(result.phone).toBeUndefined();
            expect(result.email).toBeUndefined();
            expect(result.address).toBeUndefined();
            expect(result.notes).toBeUndefined();
        });

        it('rejects an invalid supplier email', () => {
            const result = createSupplierSchema.safeParse({
                name: 'Feed Supplier',
                email: 'invalid-email',
            });

            expect(result.success).toBe(false);
        });

        it('rejects client-supplied organization ownership', () => {
            const result = createSupplierSchema.safeParse({
                name: 'Feed Supplier',
                organizationId: 'spoofed-organization',
            });

            expect(result.success).toBe(false);
        });

        it.each([
            ['id', 'supplier-id'],
            ['code', 'SUP-000001'],
            ['isActive', false],
            ['createdAt', '2026-10-26T12:00:00.000Z'],
            ['updatedAt', '2026-10-26T12:00:00.000Z'],
        ])('rejects client-supplied %s', (field: string, value: unknown) => {
            const result = createSupplierSchema.safeParse({
                name: 'Feed Supplier',
                [field]: value,
            });

            expect(result.success).toBe(false);
        });
    });

    describe('updateSupplierSchema', () => {
        it('accepts a valid partial supplier update', () => {
            const result = updateSupplierSchema.safeParse({
                contactPerson: 'Updated Contact',
                phone: '876-555-9999',
            });

            expect(result.success).toBe(true);
        });

        it('normalizes supplier update values', () => {
            const result = updateSupplierSchema.parse({
                name: '   Updated Supplier   ',
                email: '   UPDATED@SUPPLIER.COM   ',
            });

            expect(result.name).toBe('Updated Supplier');
            expect(result.email).toBe('updated@supplier.com');
        });

        it('rejects an empty update payload', () => {
            const result = updateSupplierSchema.safeParse({});

            expect(result.success).toBe(false);
        });

        it('rejects organizationId in an update payload', () => {
            const result = updateSupplierSchema.safeParse({
                name: 'Updated Supplier',
                organizationId: 'spoofed-organization',
            });

            expect(result.success).toBe(false);
        });

        it('rejects lifecycle changes through the ordinary update schema', () => {
            const result = updateSupplierSchema.safeParse({
                isActive: false,
            });

            expect(result.success).toBe(false);
        });

        it('allows optional supplier fields to be cleared with null', () => {
            expect(
                updateSupplierSchema.parse({
                    contactPerson: null,
                    phone: null,
                    email: null,
                    address: null,
                    notes: null,
                }),
            ).toEqual({
                contactPerson: null,
                phone: null,
                email: null,
                address: null,
                notes: null,
            });
        });

        it('normalizes blank optional supplier update fields to null', () => {
            expect(
                updateSupplierSchema.parse({
                    contactPerson: '',
                    phone: ' ',
                    email: '   ',
                    address: '',
                    notes: ' ',
                }),
            ).toEqual({
                contactPerson: null,
                phone: null,
                email: null,
                address: null,
                notes: null,
            });
        });
    });
});

describe('Master data collection query validation', () => {
    it('applies pagination defaults', () => {
        const result = masterDataQuerySchema.parse({});

        expect(result).toEqual({
            page: 1,
            pageSize: 20,
        });
    });

    it('coerces valid pagination query strings to numbers', () => {
        const result = masterDataQuerySchema.parse({
            page: '2',
            pageSize: '50',
        });

        expect(result.page).toBe(2);
        expect(result.pageSize).toBe(50);
    });

    it('rejects a page below 1', () => {
        const result = masterDataQuerySchema.safeParse({
            page: '0',
        });

        expect(result.success).toBe(false);
    });

    it('rejects a non-integer page', () => {
        const result = masterDataQuerySchema.safeParse({
            page: '1.5',
        });

        expect(result.success).toBe(false);
    });

    it('rejects pageSize above 100', () => {
        const result = masterDataQuerySchema.safeParse({
            pageSize: '101',
        });

        expect(result.success).toBe(false);
    });

    it('converts the true query string to boolean true', () => {
        const result = masterDataQuerySchema.parse({
            isActive: 'true',
        });

        expect(result.isActive).toBe(true);
    });

    it('converts the false query string to boolean false', () => {
        const result = masterDataQuerySchema.parse({
            isActive: 'false',
        });

        expect(result.isActive).toBe(false);
    });

    it('rejects invalid lifecycle query values', () => {
        const result = masterDataQuerySchema.safeParse({
            isActive: 'yes',
        });

        expect(result.success).toBe(false);
    });

    it('trims search text', () => {
        const result = masterDataQuerySchema.parse({
            search: '   Brown Farms   ',
        });

        expect(result.search).toBe('Brown Farms');
    });

    it('normalizes a blank search to undefined', () => {
        const result = masterDataQuerySchema.parse({
            search: '     ',
        });

        expect(result.search).toBeUndefined();
    });

    it('rejects unknown query parameters', () => {
        const result = masterDataQuerySchema.safeParse({
            organizationId: 'spoofed-organization',
        });

        expect(result.success).toBe(false);
    });
});
