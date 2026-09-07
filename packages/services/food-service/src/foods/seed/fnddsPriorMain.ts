/**
 * FNDDS/WWEIA consumption-prior **operator/CLI task** entrypoint (plan U5, KTD-G).
 *
 * Consumes THREE operator-obtained artifacts — nothing deployed fetches USDA or CDC:
 *
 *  1. `--survey-dir` — the extracted FDC survey-food CSVs (FNDDS), e.g.
 *     `FoodData_Central_survey_food_csv_2024-10-31/` (needs `survey_fndds_food.csv` + `input_food.csv`).
 *  2. `--sr-dir` — the extracted SR Legacy CSVs (needs `sr_legacy_food.csv`, the NDB→fdc_id crosswalk).
 *  3. `--intake-csv` — per-food-code consumption weights derived from an NHANES day-1 intake file
 *     (`DR1IFF_*.xpt`). XPT is a SAS transport format with no maintained Node reader, so the derivation is
 *     a documented operator preprocessing step (see `README.md` — a three-line pandas groupby); the CSV
 *     carries `DR1IFDCD,weighted` header columns exactly as that step writes them.
 *
 * The run REPORTS its match rates and FAILS LOUDLY (non-zero exit) when any coverable row of the 14-query
 * staple set received no prior — `evaluateStapleGate`, with the spike's three structural exceptions named
 * in `fnddsPrior.ts`. Idempotent: re-running upserts the same rows.
 *
 * Usage:
 *   DATABASE_URL=postgres://… npm run seed:fndds-prior --workspace=packages/services/food-service -- \
 *       --survey-dir …/FoodData_Central_survey_food_csv_2024-10-31 \
 *       --sr-dir …/FoodData_Central_sr_legacy_food_csv_2018-04 \
 *       --intake-csv …/wweia_day1_frequencies.csv \
 *       --source fndds-2021-2023+nhanes-2021-2023-day1
 *
 * @sideEffect Opens Postgres connections, reads local files, writes `food_popularity`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { parse } from 'csv-parse/sync';
import pg from 'pg';

import { foodPoolConfigFromEnv } from '../../database/poolConfig.js';
import {
    deriveSrPriors,
    evaluateStapleGate,
    normalizePriorFraction,
    type InputFoodRow,
    type IntakeRow,
    type SurveyFoodRow,
} from './fnddsPrior.js';

const { Pool } = pg;

/** Parse one CSV file into records keyed by its header row. */
function readCsv(filePath: string): Record<string, string>[] {
    return parse(readFileSync(filePath, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
}

function main(): void {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            'survey-dir': { type: 'string' },
            'sr-dir': { type: 'string' },
            'intake-csv': { type: 'string' },
            source: { type: 'string' },
        },
        allowPositionals: false,
    });

    const surveyDir = values['survey-dir'];
    const srDir = values['sr-dir'];
    const intakeCsv = values['intake-csv'];
    const source = values.source;

    if (!surveyDir || !srDir || !intakeCsv || !source) {
        throw new Error('Missing --survey-dir, --sr-dir, --intake-csv or --source (see the file header).');
    }

    void run(surveyDir, srDir, intakeCsv, source);
}

/** @sideEffect The whole task. */
async function run(surveyDir: string, srDir: string, intakeCsv: string, source: string): Promise<void> {
    const surveyFoods: SurveyFoodRow[] = readCsv(path.join(surveyDir, 'survey_fndds_food.csv')).map((row) => ({
        fdcId: row['fdc_id'] ?? '',
        foodCode: row['food_code'] ?? '',
    }));
    const inputFoods: InputFoodRow[] = readCsv(path.join(surveyDir, 'input_food.csv'))
        .filter((row) => (row['sr_code'] ?? '') !== '')
        .map((row) => ({
            surveyFdcId: row['fdc_id'] ?? '',
            srCode: row['sr_code'] ?? '',
            gramWeight: Number(row['gram_weight'] ?? 0) || 0,
        }));
    const intake: IntakeRow[] = readCsv(intakeCsv).map((row) => ({
        // The pandas step writes the food code as a float ('94000100.0'); normalize to the integer string.
        foodCode: String(Math.trunc(Number(row['DR1IFDCD'] ?? row['foodCode'] ?? 0))),
        weight: Number(row['weighted'] ?? row['weight'] ?? 0) || 0,
    }));
    const fdcByNdb = new Map(
        readCsv(path.join(srDir, 'sr_legacy_food.csv')).map((row) => [row['NDB_number'] ?? '', row['fdc_id'] ?? '']),
    );

    const srWeights = deriveSrPriors({ surveyFoods, inputFoods, intake });
    const gate = evaluateStapleGate(srWeights);

    const totalIntake = intake.reduce((sum, row) => sum + row.weight, 0);
    const matched = [...srWeights.entries()].filter(([ndb]) => fdcByNdb.has(ndb));
    const matchedWeight = matched.reduce((sum, [, weight]) => sum + weight, 0);

    process.stdout.write(`  SR codes receiving weight: ${String(srWeights.size)}\n`);
    process.stdout.write(
        `  matched to SR Legacy: ${String(matched.length)} codes, ${((100 * matchedWeight) / totalIntake).toFixed(1)}% of intake weight\n`,
    );

    if (!gate.ok) {
        process.stderr.write(
            `  ⛔ STAPLE GATE FAILED — coverable staples with no prior: ${gate.missing.join('; ')}\n` +
                '  "unmatched rows carry no prior" is silent precisely on the rows the prior exists to fix.\n',
        );
        process.exitCode = 1;

        return;
    }

    const pool = new Pool(foodPoolConfigFromEnv());

    try {
        let written = 0;
        let absentFromCatalog = 0;

        for (const [ndb, weight] of matched) {
            const externalKey = fdcByNdb.get(ndb) ?? '';
            const { rows } = await pool.query<{ food_id: string }>(
                `SELECT food_id FROM food_sources WHERE source = 'usda' AND external_key = $1`,
                [externalKey],
            );
            const foodId = rows[0]?.food_id;

            if (foodId === undefined) {
                absentFromCatalog += 1;
                continue;
            }

            await pool.query(
                `INSERT INTO food_popularity (food_id, consumption_weight, prior_fraction, source)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (food_id) DO UPDATE
                    SET consumption_weight = EXCLUDED.consumption_weight,
                        prior_fraction = EXCLUDED.prior_fraction,
                        source = EXCLUDED.source,
                        seeded_at = now()`,
                [foodId, weight, normalizePriorFraction(weight), source],
            );
            written += 1;
        }

        process.stdout.write(
            `  food_popularity rows written: ${String(written)} (SR rows not in this catalog: ${String(absentFromCatalog)})\n`,
        );
    } finally {
        await pool.end();
    }
}

main();
