import { SetMetadata } from '@nestjs/common';

export const FARM_PARAM_KEY = 'farm_param';

export const FarmParam = (
  parameterName = 'farmId',
): MethodDecorator & ClassDecorator =>
  SetMetadata(FARM_PARAM_KEY, parameterName);
