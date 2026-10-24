import { ZodError } from 'zod';
import { envSchema, type Environment } from './env.schema.js';

export function validateEnvironment(
  environment: NodeJS.ProcessEnv,
): Environment {
  try {
    return envSchema.parse(environment);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => {
          const field = issue.path.join('.') || 'environment';
          return `- ${field}: ${issue.message}`;
        })
        .join('\n');

      throw new Error(`Invalid environment configuration:\n${details}`);
    }

    throw error;
  }
}
