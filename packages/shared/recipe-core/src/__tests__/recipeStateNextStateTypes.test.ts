/**
 * Fail-open facts are a compile error (ADR-0103 review): the server's source facts state every flag, so a caller that
 * forgot `sourceCorrected`, `statementRequired` or `attestedFromPerson` does not compile. These assertions are checked by
 * `tsc --noEmit` (the package's `typecheck`), which includes this folder. A client keeps the optional shape.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { GUARD_NAMES } from '../recipeState/transitions.js';
import type { LabelKey } from '../recipeState/labelledNames.js';
import { nextState, type TransitionFacts } from '../recipeState/nextState.js';
import type { RefusalFacts, ServerRefusalFacts } from '../recipeState/refusalOf.js';
import { SOURCE_LOCK } from '../recipeState/recipeStateValues.js';
import type { SourceLock } from '../sourceRules.js';

describe('the types of nextState', () => {
    it('types the source facts as ServerRefusalFacts, so a missing fact does not compile', () => {
        expectTypeOf<TransitionFacts['source']>().toEqualTypeOf<ServerRefusalFacts>();
        expectTypeOf<RefusalFacts>().not.toExtend<ServerRefusalFacts>();
        expectTypeOf<Omit<ServerRefusalFacts, 'sourceCorrected'>>().not.toExtend<ServerRefusalFacts>();
        expectTypeOf<Omit<ServerRefusalFacts, 'statementRequired'>>().not.toExtend<ServerRefusalFacts>();
        expectTypeOf<Omit<ServerRefusalFacts, 'attestedFromPerson'>>().not.toExtend<ServerRefusalFacts>();
        expectTypeOf<ServerRefusalFacts>().toExtend<RefusalFacts>();
        expect(typeof nextState).toBe('function');
    });

    it('types the source lock fact as the SourceLock sourceLockOf answers', () => {
        expectTypeOf<NonNullable<TransitionFacts['sourceLock']>>().toEqualTypeOf<SourceLock>();
        expectTypeOf<(typeof SOURCE_LOCK)[keyof typeof SOURCE_LOCK]>().toEqualTypeOf<SourceLock>();
    });

    it('types a failure as a named refusal (never REFUSAL_NONE) or a cause', () => {
        type Failure = Extract<ReturnType<typeof nextState>, { ok: false }>;

        expectTypeOf<Extract<Failure, { refusal: unknown }>['refusal']>().toEqualTypeOf<
            Exclude<import('../recipeState/refusalOf.js').Refusal, 'REFUSAL_NONE'>
        >();
        expectTypeOf<Extract<Failure, { cause: unknown }>['cause']>().toEqualTypeOf<'noEdge' | 'actor' | 'guard'>();
    });
});

describe('LabelKey', () => {
    it('is a closed union, so a key that is not a name plus one of its shapes fails the build', () => {
        expectTypeOf<'VIEW_ADAPTED_BY_COOK.heading.owner'>().toExtend<LabelKey>();
        expectTypeOf<'VIEW_ADAPTED_BY_COOK.bogus'>().not.toExtend<LabelKey>();
        expectTypeOf<'ORIGIN_WEB_PAGE.owner'>().not.toExtend<LabelKey>();
        expectTypeOf<string>().not.toExtend<LabelKey>();
    });
});

describe('the guards of nextState (ADR-0105)', () => {
    it('has no forcesPrivate guard and no forcesPrivate fact', () => {
        expect(GUARD_NAMES).not.toContain('forcesPrivate');
        expectTypeOf<'forcesPrivate'>().not.toExtend<keyof TransitionFacts>();
    });
});
