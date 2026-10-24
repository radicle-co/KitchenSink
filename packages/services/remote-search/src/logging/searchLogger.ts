/**
 * Where the search handler writes its one line per request: a port, so the handler's tests read what it logs, and a
 * Powertools implementation that writes structured JSON to stdout for the function's log group. An error line goes to
 * Sentry instead, once Sentry is live (`../observability/observability.ts`).
 *
 * Attribute values are scalars and lists of names. The handler logs typed fields only (a status, a code, a source, an
 * error's name), never a message, a URL or a configuration value, because the source's request URL carries its key.
 *
 * @pattern Adapter — Powertools `Logger` behind the handler's own logging port
 * @module
 */
import { Logger } from '@aws-lambda-powertools/logger';

import { reportErrorLine } from '../observability/observability.js';
import type { SearchLogAttributes } from './searchLogAttributes.js';

/** A log line's level. */
export type LogLevel = 'info' | 'warn' | 'error';

/** The search handler's logging port. */
export type SearchLogger = Readonly<Record<LogLevel, (message: string, attributes: SearchLogAttributes) => void>>;

/**
 * The production logger.
 *
 * @returns A logger that writes structured JSON lines to stdout, and error lines to Sentry when it is live.
 * @sideEffect Each call writes to stdout or to Sentry.
 */
export function createSearchLogger(): SearchLogger {
    const logger = new Logger({ serviceName: 'remote-search' });

    return {
        info: (message, attributes) => {
            logger.info(message, { ...attributes });
        },
        warn: (message, attributes) => {
            logger.warn(message, { ...attributes });
        },
        error: (message, attributes) => {
            if (!reportErrorLine(message, attributes)) {
                logger.error(message, { ...attributes });
            }
        },
    };
}
