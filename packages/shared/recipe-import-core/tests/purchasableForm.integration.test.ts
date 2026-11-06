/**
 * A form the cook BUYS stays in the food's name through the whole parse pipeline (dogfooding PR 132).
 *
 * `2 tablespoons unsalted butter, melted` was stored as `butter` with the preparation `melted unsalted`: both engines
 * kept `unsalted` in the name, and the merge's placement step moved it out because the lexicon read `-ed` as
 * preparation. The paste then bound salted butter. This runs the real pipeline (both promotion adapters, the merge,
 * the cache bookkeeping) with engines that answer what the real ones answered for the line, so a lexicon that moves
 * the word again fails here and not only in the comparator's unit tier.
 *
 * The CRF row is the engine's real answer, measured with `ingredient-parser-nlp` 2.3.0 on 2026-11-06.
 */
import { createHash } from 'node:crypto';

import type { HexDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { describe, it, expect } from 'vitest';

import {
    NO_CACHE,
    NO_CORRECTIONS,
    promoteCrfReading,
    promoteLlmParse,
    runParsePipeline,
    type CrfReading,
    type EngineAnswer,
    type ParseEnginePorts,
} from '../src/index.js';

const sha256: HexDigest = (value) => createHash('sha256').update(value).digest('hex');

const LINE = '2 tablespoons unsalted butter, melted';

/** What the CRF sidecar returns for {@link LINE}. */
const CRF_ROW: CrfReading = {
    sentence: LINE,
    measure: '2 tablespoons',
    names: ['unsalted butter'],
    size: null,
    preparation: 'melted',
    comment: null,
};

/** Both engines, answering the one line as the deployed ones do. */
const engines: ParseEnginePorts = {
    crf: {
        engine: 'crf',
        engineVersion: 'ingredient-parser-nlp==2.3.0',
        async parse(lines): Promise<readonly EngineAnswer[]> {
            return lines.map((line) => promoteCrfReading(CRF_ROW, line));
        },
    },
    llm: {
        engine: 'llm',
        engineVersion: 'test-llm@v1',
        async parse(lines): Promise<readonly EngineAnswer[]> {
            return lines.map((line) =>
                promoteLlmParse(
                    { statedMeasure: '2 tablespoons', foods: [{ name: 'unsalted butter', prep: 'melted' }] },
                    line,
                ),
            );
        },
    },
};

describe('a purchasable form survives the parse pipeline', () => {
    it('stores `unsalted butter` with the preparation `melted`, and the engines agree', async () => {
        const [outcome] = await runParsePipeline(
            [LINE],
            { corrections: NO_CORRECTIONS, cache: NO_CACHE, engines, digest: sha256 },
            { userId: undefined },
            { onTierFailure: () => undefined, onUnreadablePayload: () => undefined },
        );

        expect(outcome?.tier).toBe('parse');
        expect(outcome?.parsed?.foods).toEqual([{ name: 'unsalted butter', prep: 'melted' }]);
        expect(outcome !== undefined && 'agreement' in outcome ? outcome.agreement : undefined).toEqual({
            kind: 'agree',
        });
    });
});
