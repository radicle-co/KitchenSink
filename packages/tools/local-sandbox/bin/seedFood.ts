/**
 * `npm run local:seed-food` — put the USDA catalog into the local food database.
 *
 * ⛔ WHY THIS EXISTS. `local:up` applies migrations and stops, so a fresh sandbox has an EMPTY food catalog
 * and nothing says so. Measured: 348 recipes and 1,832 ingredient lines imported with
 * `catalog_suggestion 0.0%` and zero lines carrying a real `food_id`, the whole run reporting success —
 * because the recipe service degrades to `catalogAvailability: 'unavailable'` rather than failing a write.
 *
 * ⚠️ This is a ONCE-PER-VOLUME operation. `local:down` omits `-v`, so the seeded foods survive a restart.
 * Re-running is cheap and safe (the seeder skips an unchanged food without a write), but it is not something
 * `local:up` should do on every boot.
 *
 * ⛔ The fetch is EXPLICIT, and belongs to this command rather than to `local:up`.
 * `food-service/src/foods/seed/README.md` makes downloading an operator step deliberately — "so a re-run
 * never re-downloads hundreds of MB, and so the importer is trivially testable and offline-safe". Booting a
 * sandbox must not reach out to a third-party host; asking for the catalog explicitly may.
 *
 * ⚠️ SR Legacy only, by default. It is FROZEN at 2018-04 (never re-issued), 6 MB, 7,793 lab-analysed whole
 * foods — the right default for a local stack. Foundation is re-issued roughly twice a year, so its filename
 * moves and pinning one here would rot; point `--dir` at it yourself if you want it.
 *
 * Usage:
 *     npm run local:seed-food                 # fetch if needed, then seed
 *     npm run local:seed-food -- --dir <path> # seed from an already-extracted directory
 *
 * @sideEffect Reads the database, may download and extract ~6 MB from usda.gov, and writes the catalog.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { planFoodSeed, SR_LEGACY_FOOD_COUNT } from '../src/foodSeedPlan.js';
import { REPO_ROOT } from './adapters.js';

/** Where a downloaded dataset lives. Inside the gitignored sandbox directory, so `git clean` reaches it. */
const DATASET_ROOT = path.join(REPO_ROOT, '.local-sandbox', 'fdc');

/** The frozen SR Legacy release. Its filename carries a date that will never change — it is not re-issued. */
const SR_LEGACY_ZIP = 'FoodData_Central_sr_legacy_food_csv_2018-04.zip';
const SR_LEGACY_URL = `https://fdc.nal.usda.gov/fdc-datasets/${SR_LEGACY_ZIP}`;
const SR_LEGACY_DIR = path.join(DATASET_ROOT, 'FoodData_Central_sr_legacy_food_csv_2018-04');

/** The local food database, as `local:up` provisions it. */
const DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/kitchensink_food_dev';

/** `--flag value` pairs. */
function parseArgs(argv: readonly string[]): ReadonlyMap<string, string> {
    const args = new Map<string, string>();

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];

        if (token !== undefined && token.startsWith('--')) {
            args.set(token.slice(2), argv[index + 1] ?? '');
        }
    }

    return args;
}

/**
 * The catalog's current size, or 0 when it cannot be read.
 *
 * ⚠️ An unreadable database answers 0 rather than throwing: the plan for "no catalog" and the plan for "no
 * database" are the same one, and the seeder reports the connection failure far better than a guess here.
 *
 * @sideEffect Runs psql inside the postgres container.
 */
function foodRowCount(): number {
    const result = spawnSync(
        'docker',
        [
            'exec',
            'local-sandbox-postgres',
            'psql',
            '-U',
            'postgres',
            '-d',
            'kitchensink_food_dev',
            '-tAc',
            'SELECT count(*) FROM food',
        ],
        { encoding: 'utf8' },
    );

    return Number.parseInt((result.stdout ?? '').trim(), 10) || 0;
}

/**
 * Download and extract SR Legacy.
 *
 * @returns Whether the dataset is on disk afterwards. @sideEffect Network I/O and writes to `.local-sandbox`.
 */
function fetchSrLegacy(): boolean {
    mkdirSync(DATASET_ROOT, { recursive: true });
    process.stdout.write(`  downloading ${SR_LEGACY_ZIP} (~6 MB, frozen 2018-04)…\n`);

    const download = spawnSync(
        'curl',
        ['-fL', '--max-time', '600', '-o', path.join(DATASET_ROOT, SR_LEGACY_ZIP), SR_LEGACY_URL],
        {
            stdio: 'inherit',
        },
    );

    if (download.status !== 0) {
        process.stderr.write(
            '  download FAILED — see the runbook: packages/services/food-service/src/foods/seed/README.md\n',
        );

        return false;
    }

    const unzip = spawnSync('unzip', ['-oq', path.join(DATASET_ROOT, SR_LEGACY_ZIP), '-d', DATASET_ROOT], {
        stdio: 'inherit',
    });

    return unzip.status === 0 && existsSync(path.join(SR_LEGACY_DIR, 'food.csv'));
}

/**
 * Run the food service's own bulk seeder.
 *
 * ⛔ Delegated, never reimplemented. The seeder validates the FDC schema by header name and aborts on a
 * missing column, because FDC changes that schema between releases without notice. A second loader here
 * would be a second thing to keep correct.
 *
 * @sideEffect Spawns npm and writes the catalog.
 */
function runSeeder(directory: string): boolean {
    const result = spawnSync(
        'npm',
        ['run', 'seed:usda-bulk', '--workspace=packages/services/food-service', '--', '--dir', directory],
        { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, DATABASE_URL } },
    );

    return result.status === 0;
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const requested = args.get('dir');
    const directory = requested === undefined || requested === '' ? SR_LEGACY_DIR : requested;
    const plan = planFoodSeed({
        foodRows: foodRowCount(),
        datasetPresent: existsSync(path.join(directory, 'food.csv')),
    });

    if (plan.kind === 'up-to-date') {
        process.stdout.write(`  food catalog: ${String(plan.foodRows)} foods — already seeded, nothing to do.\n`);

        return;
    }

    if (plan.kind === 'fetch-then-seed' && !fetchSrLegacy()) {
        process.exitCode = 1;

        return;
    }

    if (!runSeeder(directory)) {
        process.stderr.write('  seeding FAILED.\n');
        process.exitCode = 1;

        return;
    }

    const seeded = foodRowCount();

    process.stdout.write(
        `\n  food catalog: ${String(seeded)} foods (expected at least ${String(SR_LEGACY_FOOD_COUNT)}).\n`,
    );
}

main();
