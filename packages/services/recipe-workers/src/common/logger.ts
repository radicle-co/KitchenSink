import { Logger } from '@aws-lambda-powertools/logger';
import type { LogItemExtraInput, LogItemMessage } from '@aws-lambda-powertools/logger/types';

import { scrubLogInput } from './logScrub.js';

/**
 * Shared structured logger for the recipe-workers Lambdas. `serviceName` and the ambient
 * `POWERTOOLS_*` / `LOG_LEVEL` env vars flow into every emitted line so CloudWatch entries are
 * queryable per service.
 *
 * Every extra-attributes argument is deep-scrubbed ({@link scrubLogInput}) before it reaches
 * CloudWatch: person-linked ids (`ownerId`, `userId`, …) are pseudonymized and secrets redacted, so
 * an erased user's identifiers do not survive in log copies (GDPR Art. 17 / Art. 5). Only
 * `info`/`warn`/`error` are exposed — the whole recipe-workers surface uses those.
 */
const base = new Logger({ serviceName: 'recipe-workers' });

const scrubExtra = (extra: LogItemExtraInput): LogItemExtraInput =>
    extra.map((entry) => scrubLogInput(entry)) as LogItemExtraInput;

/** @sideEffect emits scrubbed structured log lines to stdout → CloudWatch. */
export const logger = {
    info: (message: LogItemMessage, ...extra: LogItemExtraInput): void => base.info(message, ...scrubExtra(extra)),
    warn: (message: LogItemMessage, ...extra: LogItemExtraInput): void => base.warn(message, ...scrubExtra(extra)),
    error: (message: LogItemMessage, ...extra: LogItemExtraInput): void => base.error(message, ...scrubExtra(extra)),
};
