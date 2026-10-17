/**
 * Write `src/details/__fixtures__/seedVariants.ts` from the committed seed and the design mockup.
 *
 * `npm run fixtures:generate --workspace=@commise/features-recipes`. The derivation lives in `seedVariantsFixture.ts`
 * (pure, and what the parity test holds the file to), so this script owns only reading, formatting and writing.
 *
 * @sideEffect Reads the seed and the mockup, and rewrites the fixture.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

import {
    FIXTURE_PATH,
    MOCKUP_PATH,
    SEED_PATH,
    deriveSeedVariants,
    seedVariantsModuleText,
} from './seedVariantsFixture.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const fixturePath = join(REPO_ROOT, FIXTURE_PATH);

const fixtures = deriveSeedVariants(
    readFileSync(join(REPO_ROOT, SEED_PATH), 'utf8'),
    readFileSync(join(REPO_ROOT, MOCKUP_PATH), 'utf8'),
);
const text = await format(seedVariantsModuleText(fixtures), {
    ...(await resolveConfig(fixturePath)),
    filepath: fixturePath,
});

writeFileSync(fixturePath, text);
process.stdout.write(`${FIXTURE_PATH} written: ${String(Object.keys(fixtures).length)} roots\n`);
