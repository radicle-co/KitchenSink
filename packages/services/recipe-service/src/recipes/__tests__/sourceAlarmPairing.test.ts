/**
 * The pairing the infra stack cannot import (ADR-0100, plan everyAnswerSourceLock KTD-11, qse): the alarm in `RecipeServiceStack.ts`
 * watches a namespace and a metric name that `sourceEvents.ts` emits. The two files sit on either side of the infra boundary
 * (infra installs its own `aws-cdk-lib` and may not import service source), so each holds a literal. Rename one and the alarm watches a
 * metric nobody writes, which under `treatMissingData: NOT_BREACHING` is a permanent, confident `OK`. Repo guard W3 does not see an
 * emitter built through `buildStageCountMetricLine`, so this test is the pairing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOURCE_CORRECTED_METRIC, SOURCE_EVENT_NAMESPACE } from '../sourceEvents.js';

const STACK = readFileSync(join(import.meta.dirname, '../../../infra/lib/RecipeServiceStack.ts'), 'utf8');

/** The string literal a `const NAME = '...'` in the stack holds, or `undefined` when the stack declares no such const. */
function stackLiteral(name: string): string | undefined {
    return new RegExp(`const ${name} = '([^']+)';`, 'u').exec(STACK)?.[1];
}

describe('the source-correction alarm watches what the service emits', () => {
    it('the stack names the namespace the service writes', () => {
        expect(stackLiteral('SOURCE_EVENT_NAMESPACE')).toBe(SOURCE_EVENT_NAMESPACE);
    });

    it('the stack names the metric the service writes', () => {
        expect(stackLiteral('SOURCE_CORRECTED_METRIC')).toBe(SOURCE_CORRECTED_METRIC);
    });
});
