import { Logger } from '@aws-lambda-powertools/logger';

/**
 * Shared structured logger for the recipe-workers Lambdas. `serviceName` and the ambient
 * `POWERTOOLS_*` / `LOG_LEVEL` env vars flow into every emitted line so CloudWatch entries are
 * queryable per service.
 */
export const logger = new Logger({ serviceName: 'recipe-workers' });
