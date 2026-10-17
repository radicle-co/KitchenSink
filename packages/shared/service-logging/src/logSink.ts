/**
 * THE ONE PLACE A LOG LINE IS WRITTEN.
 *
 * ⛔ WHY EVERY ADAPTER FUNNELS THROUGH ONE FUNCTION. The rule this executes — ADR-0042's "stdout is already
 * forwarded to a Sentry project, so a line written to both is one failure counted twice" — existed in two
 * copies in this tree and they DISAGREED (see `logRouting.ts`). A third and fourth copy were about to be
 * written, for recipe-service and food-service. The rule has one reason to change, so it has one home; the
 * three call-site SHAPES have three reasons to change, so they stay where they are, as adapters over this.
 *
 * ⚠️ SCRUBBING HAPPENS EXACTLY ONCE PER PATH, AND THE TWO PATHS SCRUB IN DIFFERENT PLACES.
 * The Sentry path is scrubbed by `beforeSendLog: scrubLog`, wired in each service's `instrument.ts`. The
 * console path is scrubbed HERE, because nothing else does: ADR-0042's drain forwards it to a third party
 * and the forwarder's own sanitiser covers five key names and URL path segments and no more.
 * ⛔ Do NOT "harden" this by scrubbing both paths here. `scrubAttributes` PSEUDONYMIZES person-linked ids,
 * and pseudonymizing an already-pseudonymized id yields a different token — which silently destroys the
 * cross-service, cross-line correlation that is the entire reason ids are pseudonymized rather than
 * redacted.
 */
import * as Sentry from '@sentry/nestjs';
import { scrubAttributes } from '@kitchensink/observability-scrubbers';

import { renderLogAttributes, scrubLogText } from './logAttributes.js';
import { type LogLevel, routeLogRecord } from './logRouting.js';

/** Console method per level: `error` to stderr, everything else to stdout, matching CloudWatch's split. */
const CONSOLE_METHOD: Readonly<Record<LogLevel, 'error' | 'info'>> = {
    error: 'error',
    warn: 'info',
    info: 'info',
    debug: 'info',
};

/**
 * Write one log record wherever the rule says it goes.
 *
 * ⚠️ `getClient()` — not an env-var check. A DSN in the environment does not mean a client exists: `init`
 * may not have run yet (a module logging at import time), or a second `@sentry/core` on the graph may have
 * given this module a different version-keyed carrier from the one the service initialised. Asking the SDK
 * is the only question whose answer matches what `Sentry.logger` will actually do.
 *
 * @param level - The level the caller logged at.
 * @param message - The line's text.
 * @param attributes - Structured fields. Rendered before either path sees them, because both lose an
 *   `Error` to the same non-enumerable-property flattening.
 * @sideEffect Emits a Sentry log entry or writes one JSON line to the console.
 */
export function emitLogRecord(level: LogLevel, message: string, attributes: Record<string, unknown>): void {
    const rendered = renderLogAttributes(attributes);
    const destination = routeLogRecord(level, Sentry.getClient() !== undefined);

    if (destination.sentry) {
        Sentry.logger[level](message, rendered);

        return;
    }

    // ⚠️ THE MESSAGE IS SCRUBBED HERE TOO, and it is not covered by the walk above: `renderLogAttributes`
    // takes the attribute bag and structurally cannot reach this argument. The Sentry path already does it
    // (`scrubLog` assigns `log.message = scrubText(log.message)`), so leaving it out made this module's own
    // claim — that the console path is scrubbed here because nothing else does — false for the one field
    // every single line carries.
    const line = {
        level,
        message: scrubLogText(message),
        timestamp: new Date().toISOString(),
        ...scrubAttributes(rendered),
    };

    // ⚠️ THIS IS THE console SINK — the one place in the repository that is supposed to reach for it. Every
    // other module routes here instead, which is what makes the routing rule un-bypassable.
    console[CONSOLE_METHOD[level]](JSON.stringify(line));
}
