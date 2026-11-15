'use server';
import {
    createSalesProductSchema,
    updateSalesProductSchema,
    createPoultryProductSourceSchema,
    resourceIdSchema,
    salesProductResponseSchema,
    poultryProductSourceResponseSchema,
} from '@ancastle/validation';
import { requireApplicationContext } from '@/lib/application/current-context';
import { ManagementApiError, managementApi } from '@/lib/management/api';
import { formValue, runOrganizationMutation, validateForm } from '@/lib/management/mutation';
import type { ManagementActionState } from '@/lib/management/action-state';

function definition(form: FormData) {
    const kind = formValue(form, 'kind');
    return kind === 'PRODUCE'
        ? {
              kind,
              inventoryItemId: formValue(form, 'inventoryItemId'),
              expectedInventoryUnit: formValue(form, 'expectedInventoryUnit'),
          }
        : { kind };
}
export async function saveProductAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'sales-product:manage', async (organization) => {
        const creating = !form.has('productId');
        const selected =
            creating || form.get('changeDefinition') === 'on' ? definition(form) : undefined;
        if (selected?.kind === 'PRODUCE') {
            const context = await requireApplicationContext({ organization });
            if (!context.current?.permissions.includes('inventory:read'))
                throw new ManagementApiError('FORBIDDEN');
        }
        const input = creating
            ? validateForm(createSalesProductSchema, { name: formValue(form, 'name'), ...selected })
            : validateForm(updateSalesProductSchema, {
                  name: formValue(form, 'name'),
                  ...(selected ? { definition: selected } : {}),
              });
        const id = creating
            ? ''
            : '/' + validateForm(resourceIdSchema, formValue(form, 'productId'));
        const result = await managementApi(
            `organizations/${organization}/sales-products${id}`,
            salesProductResponseSchema,
            { method: creating ? 'POST' : 'PATCH', body: JSON.stringify(input) },
        );
        return {
            success: creating ? 'Product created.' : 'Product saved.',
            resourceId: result.data.id,
        };
    });
}
export async function setProductStatusAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(form, 'sales-product:manage', async (organization) => {
        const id = validateForm(resourceIdSchema, formValue(form, 'productId'));
        const operation = formValue(form, 'operation');
        if (operation !== 'reactivate' && operation !== 'deactivate')
            return { error: 'Choose a valid lifecycle action.' };
        await managementApi(
            `organizations/${organization}/sales-products/${id}/${operation}`,
            salesProductResponseSchema,
            { method: 'POST', body: '{}' },
        );
        return {
            success: operation === 'reactivate' ? 'Product activated.' : 'Product deactivated.',
        };
    });
}
export async function mutateSourceAction(
    _previous: ManagementActionState,
    form: FormData,
): Promise<ManagementActionState> {
    return runOrganizationMutation(
        form,
        ['sales-product-source:manage', 'flock:read'],
        async (organization) => {
            const farm = validateForm(resourceIdSchema, formValue(form, 'farm'));
            const context = await requireApplicationContext({ organization, farm });
            if (
                context.farm?.id !== farm ||
                !context.current?.permissions.includes('sales-product-source:manage') ||
                !context.current.permissions.includes('flock:read')
            )
                throw new ManagementApiError('FORBIDDEN');
            const product = validateForm(resourceIdSchema, formValue(form, 'productId'));
            let path = `organizations/${organization}/farms/${farm}/sales-products/${product}/poultry-sources`;
            let input: object;
            if (form.has('sourceId')) {
                const id = validateForm(resourceIdSchema, formValue(form, 'sourceId'));
                const operation = formValue(form, 'operation');
                if (operation !== 'reactivate' && operation !== 'deactivate')
                    return { error: 'Choose a valid lifecycle action.' };
                path += `/${id}/${operation}`;
                input = {};
            } else
                input = validateForm(createPoultryProductSourceSchema, {
                    flockId: formValue(form, 'flockId'),
                });
            await managementApi(path, poultryProductSourceResponseSchema, {
                method: 'POST',
                body: JSON.stringify(input),
            });
            return { success: 'Source eligibility saved.' };
        },
    );
}
