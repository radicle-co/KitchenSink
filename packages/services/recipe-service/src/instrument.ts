import * as Sentry from '@sentry/nestjs';
import { scrubEvent, scrubLog } from '@kitchensink/observability-scrubbers';

/**
 * Sentry initialisation for the recipe-service (plan U17/U22).
 *
 * ⛔ LOADED VIA `node --import`, BEFORE ANYTHING ELSE. `@sentry/nestjs` instruments modules by patching
 * them as they load, so anything imported before this file is imported is never instrumented — which is
 * why the Dockerfile's `CMD` names it rather than `main.ts` importing it. A service that merely imports
 * Sentry first inside its own entry point still loses everything the framework loaded on the way in.
 *
 * ⛔ THE SCRUBBERS ARE THE SHARED ONES. This service handles recipe text, ingredient phrases and display
 * names; the denylist is one rule about what may leave a host, and it had three copies before U16
 * (`@kitchensink/observability-scrubbers`). A fourth here would mean the next key someone adds protects
 * three runtimes out of four.
 *
 * ⚠️ INERT WITHOUT A DSN, deliberately. Local runs, the integration tier and any stage whose SSM parameter
 * is unwritten behave exactly as before, rather than failing to boot over telemetry.
 */
const sentryDsn = process.env['SENTRY_DSN'];

if (sentryDsn) {
    Sentry.init({
        dsn: sentryDsn,
        environment: process.env['STAGE'] ?? 'dev',
        // ⚠️ Spread, not `release: undefined` — a release named "undefined" groups unrelated deploys, which
        // is harder to notice than no release at all.
        ...(process.env['SENTRY_RELEASE'] === undefined ? {} : { release: process.env['SENTRY_RELEASE'] }),
        tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0'),
        enableLogs: true,
        sendDefaultPii: false,
        beforeSend: scrubEvent,
        beforeSendLog: scrubLog,
    });
}
