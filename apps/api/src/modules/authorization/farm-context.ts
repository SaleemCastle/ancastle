import type { OrganizationRequest } from './organization-context.js';

/** One farm selected and verified within an authorized organization request. */
export class FarmContext {
  constructor(
    readonly organizationId: string,
    readonly farmId: string,
  ) {
    Object.freeze(this);
  }

  /** For operational records with both organizationId and farmId columns. */
  scope<T extends object>(
    where: T,
  ): {
    AND: [T, { organizationId: string; farmId: string }];
  } {
    return {
      AND: [
        where,
        { organizationId: this.organizationId, farmId: this.farmId },
      ],
    };
  }
}

export type FarmRequest = OrganizationRequest & {
  farmContext?: FarmContext;
};
