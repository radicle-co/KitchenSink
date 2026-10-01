/**
 * FNDDS/WWEIA consumption-prior **operator/CLI task** entrypoint (plan U5, KTD-G; curated seed plan U1, R45).
 *
 * @pattern Composition Root — wires the pinned inputs, the pure derivation and the committed output file
 *
 * It regenerates the committed `data/foodPopularity.jsonl`; it writes no database. Nothing deployed fetches
 * USDA or CDC, and this reads only files whose SHA-256 is pinned in `data/usda/sourcePins.json`
 * (`fnddsPrior`), so a rerun proves it used the reviewed inputs:
 *
 *  1. `--survey-zip` — the FDC survey-food archive (FNDDS), `FoodData_Central_survey_food_csv_2024-10-31.zip`
 *     (`survey_fndds_food.csv` + `input_food.csv`).
 *  2. `--intake-csv` — per-food-code consumption weights derived from the NHANES day-1 intake file
 *     (`DR1IFF_L.xpt`): the `DR1IFDCD` and `weighted` columns (see `README.md` for the derivation).
 *  3. The SR Legacy NDB → FDC crosswalk comes from the COMMITTED SR Legacy archive, through the same pinned
 *     reader the seed uses, so the weights key to exactly the items the seed holds.
 *
 * The run REPORTS its match rates and FAILS LOUDLY (non-zero exit) when any coverable row of the 14-query
 * staple set received no prior — `evaluateStapleGate`, unchanged. By default it then COMPARES its output with
 * the committed file and exits non-zero on any difference; `--write` rewrites the file instead.
 *
 * Usage:
 *   npm run seed:fndds-prior --workspace=packages/services/food-service -- \
 *       --survey-zip …/FoodData_Central_survey_food_csv_2024-10-31.zip \
 *       --intake-csv …/wweia_day1_frequencies.csv [--write]
 *
 * @sideEffect Reads the pinned inputs and the committed SR Legacy archive; with `--write`, writes
 *   `foodPopularity.jsonl`.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { parse } from 'csv-parse/sync';

import { readFdcCsv } from '../../sources/usda/bulk/usdaBulk.reader.js';
import { readTextIfPresent } from './archive/committedFile.js';
import { openPinnedArchive, parseSourcePins, readPinnedBytes, zipEntrySource } from './archive/usdaSourceArchive.js';
import {
    deriveSrPriors,
    evaluateStapleGate,
    popularityWeightsByItem,
    renderPopularityJsonl,
    type InputFoodRow,
    type IntakeRow,
    type SurveyFoodRow,
} from './fnddsPrior.js';

/** The committed seed data directory, beside this file. */
const DATA_DIR = fileURLToPath(new URL('./data/', import.meta.url));
const OUTPUT = join(DATA_DIR, 'foodPopularity.jsonl');

/**
 * Parse the intake CSV's records into intake rows. Pure.
 *
 * @param bytes - The pinned intake CSV.
 * @returns The rows.
 */
function intakeRowsOf(bytes: Buffer): IntakeRow[] {
    const records = parse(bytes, { bom: true, columns: true, skip_empty_lines: true }) as Record<string, string>[];

    return records.map((row) => ({
        // The pandas step writes the food code as a float ('94000100.0'); normalize to the integer string.
        foodCode: String(Math.trunc(Number(row['DR1IFDCD'] ?? row['foodCode'] ?? 0))),
        weight: Number(row['weighted'] ?? row['weight'] ?? 0) || 0,
    }));
}

/**
 * Read the survey archive's two derivation inputs.
 *
 * @param surveyZip - The survey archive's path.
 * @param sha256 - Its pin.
 * @returns The survey-food and input-food rows.
 * @sideEffect Reads the archive.
 */
async function readSurvey(
    surveyZip: string,
    sha256: string,
): Promise<{ surveyFoods: SurveyFoodRow[]; inputFoods: InputFoodRow[] }> {
    const survey = await zipEntrySource(await readPinnedBytes(surveyZip, sha256));
    const surveyFoods: SurveyFoodRow[] = [];
    const inputFoods: InputFoodRow[] = [];

    try {
        const surveySpec = { name: 'survey_fndds_food.csv', columns: ['fdc_id', 'food_code'] };

        for await (const row of readFdcCsv(survey, surveySpec, true)) {
            surveyFoods.push({ fdcId: row['fdc_id'] ?? '', foodCode: row['food_code'] ?? '' });
        }

        const inputSpec = { name: 'input_food.csv', columns: ['fdc_id', 'sr_code', 'gram_weight'] };

        for await (const row of readFdcCsv(survey, inputSpec, true)) {
            if ((row['sr_code'] ?? '') !== '') {
                inputFoods.push({
                    surveyFdcId: row['fdc_id'] ?? '',
                    srCode: row['sr_code'] ?? '',
                    gramWeight: Number(row['gram_weight'] ?? 0) || 0,
                });
            }
        }
    } finally {
        survey.close();
    }

    return { surveyFoods, inputFoods };
}

/**
 * Read the committed SR Legacy archive's NDB number → FDC id crosswalk.
 *
 * @param path - The committed archive.
 * @param sha256 - Its pin.
 * @returns The crosswalk.
 * @sideEffect Reads the archive.
 */
async function readSrCrosswalk(path: string, sha256: string): Promise<Map<string, string>> {
    const sr = await openPinnedArchive(path, sha256);
    const fdcByNdb = new Map<string, string>();

    try {
        for await (const row of readFdcCsv(
            sr,
            { name: 'sr_legacy_food.csv', columns: ['fdc_id', 'NDB_number'] },
            true,
        )) {
            fdcByNdb.set(row['NDB_number'] ?? '', row['fdc_id'] ?? '');
        }
    } finally {
        sr.close();
    }

    return fdcByNdb;
}

/** @sideEffect The whole task. */
async function main(): Promise<void> {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            'survey-zip': { type: 'string' },
            'intake-csv': { type: 'string' },
            write: { type: 'boolean', default: false },
        },
        allowPositionals: false,
    });
    const surveyZip = values['survey-zip'];
    const intakeCsv = values['intake-csv'];

    if (surveyZip === undefined || intakeCsv === undefined) {
        throw new Error('Missing --survey-zip or --intake-csv (see the file header).');
    }

    const pins = parseSourcePins(await readFile(join(DATA_DIR, 'usda', 'sourcePins.json'), 'utf8'));
    const { surveyFoods, inputFoods } = await readSurvey(surveyZip, pins.fnddsPrior.survey.upstreamSha256);
    const intake = intakeRowsOf(await readPinnedBytes(intakeCsv, pins.fnddsPrior.intake.upstreamSha256));
    const fdcByNdb = await readSrCrosswalk(join(DATA_DIR, 'usda', pins.srLegacy.file), pins.srLegacy.upstreamSha256);

    const srWeights = deriveSrPriors({ surveyFoods, inputFoods, intake });
    const gate = evaluateStapleGate(srWeights);
    const weights = popularityWeightsByItem(srWeights, fdcByNdb);
    const totalIntake = intake.reduce((sum, row) => sum + row.weight, 0);
    const matchedWeight = [...srWeights]
        .filter(([ndb]) => fdcByNdb.has(ndb))
        .reduce((sum, [, weight]) => sum + weight, 0);

    process.stdout.write(`  SR codes receiving weight: ${String(srWeights.size)}\n`);
    process.stdout.write(
        `  matched to SR Legacy: ${String(weights.size)} items, ${((100 * matchedWeight) / totalIntake).toFixed(1)}% of intake weight\n`,
    );

    if (!gate.ok) {
        process.stderr.write(
            `  ⛔ STAPLE GATE FAILED — coverable staples with no prior: ${gate.missing.join('; ')}\n` +
                '  "unmatched rows carry no prior" is silent precisely on the rows the prior exists to fix.\n',
        );
        process.exitCode = 1;

        return;
    }

    const text = renderPopularityJsonl(weights);
    const sha = createHash('sha256').update(text).digest('hex');

    if (values.write) {
        await writeFile(OUTPUT, text);
        process.stdout.write(`  wrote ${OUTPUT} (sha256 ${sha})\n`);

        return;
    }

    const committed = await readTextIfPresent(OUTPUT);

    if (committed !== text) {
        process.stderr.write(
            `  ⛔ ${OUTPUT} differs from what these pinned inputs derive (derived sha256 ${sha}). ` +
                'Rerun with --write only if the inputs changed on purpose.\n',
        );
        process.exitCode = 1;

        return;
    }

    process.stdout.write(`  ${OUTPUT} is reproduced byte for byte (sha256 ${sha})\n`);
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
