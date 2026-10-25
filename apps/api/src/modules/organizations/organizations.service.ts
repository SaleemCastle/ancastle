import { Injectable } from '@nestjs/common';
import type { OrganizationProfile } from '@ancastle/types';
import type { OrganizationProfileUpdateInput } from '@ancastle/validation';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import type { OrganizationContext } from '../authorization/organization-context.js';

const profileSelect = {
  id: true,
  name: true,
  slug: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

type ProfileRecord = Prisma.OrganizationGetPayload<{
  select: typeof profileSelect;
}>;

function profile(record: ProfileRecord): OrganizationProfile {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(context: OrganizationContext): Promise<OrganizationProfile> {
    const record = await this.prisma.organization.findFirst({
      where: { id: context.organizationId, isActive: true },
      select: profileSelect,
    });
    if (!record) throw this.notFound();
    return profile(record);
  }

  async update(
    context: OrganizationContext,
    input: OrganizationProfileUpdateInput,
  ): Promise<OrganizationProfile> {
    const [record] = await this.prisma.organization.updateManyAndReturn({
      where: { id: context.organizationId, isActive: true },
      data: { name: input.name },
      select: profileSelect,
    });
    if (!record) throw this.notFound();
    return profile(record);
  }

  private notFound(): BusinessException {
    return new BusinessException(
      'ORGANIZATION_NOT_FOUND',
      'Organization was not found',
      404,
    );
  }
}
