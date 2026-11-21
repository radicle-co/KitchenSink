import { keptTimerSchema } from '@commise/features-recipes/session';

/** Whether the kept record's own schema takes this as a running timer's id: the id rule is the schema's, not copied. */
export function keptSchemaTakesId(id: string): boolean {
    return keptTimerSchema.safeParse({
        state: 'running',
        id,
        recipeId: 'recipe',
        stepIndex: 0,
        stepDigest: 'digest',
        ordinal: 1,
        run: 1,
        durationMs: 60_000,
        origin: 'added',
        endsAt: '2026-11-20T10:00:00.000Z',
    }).success;
}
