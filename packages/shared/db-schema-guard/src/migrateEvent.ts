/**
 * The ONE event a migration runner accepts: `{ expectManifestSha }`, and nothing else.
 *
 * ⛔ It selects NO behaviour — every runner has exactly one action. `expectManifestSha` is an ASSERTION: it states
 * which migration set the caller believes the runner holds, and a runner holding a different one refuses rather
 * than reporting a clean run over the wrong SQL. Its one caller is `.github/scripts/runMigrations.sh`.
 *
 * ⛔ VALIDATED AT THE JSON BOUNDARY, not merely typed. A payload that spells the key differently, or one the CLI
 * mangled, would otherwise yield `undefined` — and an unchecked `undefined` is a runner reporting a clean run
 * over a set nobody asked about. `.strict()` refuses an extra key, because a caller that sends one believes it
 * selects something.
 *
 * DESIGN PATTERN: Parse, don't validate — the boundary returns the typed event or throws.
 */
import { z } from 'zod';

import { isManifestSha } from './manifest.js';

/** The accepted event, after parsing. */
export interface MigrateEvent {
    readonly expectManifestSha: string;
}

const MIGRATE_EVENT = z
    .object({
        expectManifestSha: z.string().refine(isManifestSha, 'must be a 64-character lowercase hex sha256'),
    })
    .strict();

/** A migration runner received an event that is not exactly `{ expectManifestSha }`. */
export class MalformedMigrateEventError extends Error {
    /** Each refused field as `path: reason`, `(root)` for the event itself. */
    public readonly issues: readonly string[];

    public constructor(runner: string, issues: readonly string[]) {
        super(`${runner} migration runner received a malformed event — ${issues.join(', ')}`);
        this.name = 'MalformedMigrateEventError';
        this.issues = issues;
        Object.setPrototypeOf(this, MalformedMigrateEventError.prototype);
    }
}

/**
 * Type guard for {@link MalformedMigrateEventError}.
 *
 * @param value - Anything caught.
 * @returns Whether it is a {@link MalformedMigrateEventError}.
 */
export function isMalformedMigrateEventError(value: unknown): value is MalformedMigrateEventError {
    return value instanceof MalformedMigrateEventError;
}

/**
 * Parse a runner's invocation event. Pure.
 *
 * @param event - The raw Lambda event; an absent one is read as `{}`.
 * @param runner - The runner's name for the message, e.g. `Food`.
 * @returns The parsed event.
 * @throws {MalformedMigrateEventError} when the event is anything but `{ expectManifestSha: <sha256 hex> }`.
 */
export function parseMigrateEvent(event: unknown, runner: string): MigrateEvent {
    const parsed = MIGRATE_EVENT.safeParse(event ?? {});

    if (!parsed.success) {
        throw new MalformedMigrateEventError(
            runner,
            parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
        );
    }

    return parsed.data;
}
