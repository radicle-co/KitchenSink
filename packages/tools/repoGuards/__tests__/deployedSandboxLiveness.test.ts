// @vitest-environment node
/**
 * The ONE verdict rule for "is the deployed sandbox still up" - `.github/scripts/deployedSandboxLiveness.sh check`.
 *
 * The rule is the one the resolver and both Maestro start probes have always applied: the sandbox is live only
 * when BOTH services answer `live=true` AND neither wants a deploy (`deploy=false`). `live=true, deploy=true`
 * means the gate is about to CREATE or REPLACE the environment, which a test tier must not drive.
 *
 * The real script runs under real bash. Only the gate it asks (`deployGate.sh evaluate`) is replaced, through
 * `DEPLOY_GATE_SCRIPT`, by a stub answering per service from a fixture table, so every live x deploy combination
 * for both services is exercised: 16 rows, one live. Mutation lens: dropping the `deploy=false` term reds the
 * `live=true, deploy=true` rows; checking only one service reds the rows where just the other is down.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/deployedSandboxLiveness.sh', import.meta.url));

let dir: string;
let gate: string;

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'liveness-'));
    gate = join(dir, 'gate.sh');
    // `evaluate <intent> <service> …`: answer from RECIPE_ANSWER / FOOD_ANSWER, shaped `<live>,<deploy>`.
    writeFileSync(
        gate,
        `#!/usr/bin/env bash
service="$3"
if [ "$service" = recipe ]; then answer="$RECIPE_ANSWER"; else answer="$FOOD_ANSWER"; fi
echo "live=\${answer%,*}"; echo "deploy=\${answer#*,}"; echo "reason=\${service} said \${answer}"
`,
        'utf8',
    );
    chmodSync(gate, 0o755);
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

function check(recipe: string, food: string): { status: number; out: string; live: string } {
    const result = spawnSync('bash', [SCRIPT, 'check', 'pr-91', 'us-east-1', 'https://r.test', 'https://f.test'], {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', DEPLOY_GATE_SCRIPT: gate, RECIPE_ANSWER: recipe, FOOD_ANSWER: food },
    });
    const out = `${result.stdout}${result.stderr}`;
    const live = (result.stdout.match(/^live=(.*)$/gmu) ?? []).at(-1)?.slice('live='.length) ?? '(none)';

    return { status: result.status ?? -1, out, live };
}

const COMBOS = ['true,false', 'true,true', 'false,false', 'false,true'] as const;
const table = COMBOS.flatMap((recipe) => COMBOS.map((food) => [recipe, food] as const));

describe('deployedSandboxLiveness.sh check', () => {
    it.each(table)('recipe %s / food %s', (recipe, food) => {
        const outcome = check(recipe, food);
        const expected = recipe === 'true,false' && food === 'true,false' ? 'true' : 'false';

        expect(outcome.status, outcome.out).toBe(0);
        expect(outcome.live, outcome.out).toBe(expected);
        expect(outcome.out).toMatch(/^reason=.*recipe:.*food:/mu);
    });

    it('refuses a call without the four arguments rather than guessing a stage', () => {
        const result = spawnSync('bash', [SCRIPT, 'check', 'pr-91'], { encoding: 'utf8' });

        expect(result.status).toBe(2);
    });
});
