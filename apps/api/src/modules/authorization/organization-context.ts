import type { MembershipRole } from '../../generated/prisma/client.js';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/** Server-created context for one verified, active organization membership. */
export class OrganizationContext {
  constructor(
    readonly organizationId: string,
    readonly membershipId: string,
    readonly userId: string,
    readonly role: MembershipRole,
  ) {
    Object.freeze(this);
  }

  /** AND preserves the tenant constraint even when filters contain OR/NOT. */
  scope<T extends object>(
    where: T,
  ): {
    AND: [T, { organizationId: string }];
  } {
    return { AND: [where, { organizationId: this.organizationId }] };
  }
}

export type OrganizationRequest = Request & {
  user?: AuthenticatedUser;
  organizationContext?: OrganizationContext;
};
