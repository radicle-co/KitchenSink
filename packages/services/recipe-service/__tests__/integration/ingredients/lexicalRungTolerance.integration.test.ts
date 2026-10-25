/**
 * Integration proof that the lexical tier survives a food that publishes NO rung (ADR-0070), over a REAL HTTP server.
 *
 * An absent rung on a name hit means food is older than recipe, or sent a rung the food client reads as absent. Before
 * this, `IngredientsService.recordResolution` dropped the whole ranked event when the rung was missing (so the line's
 * evidence fell to `unattributed`), and `shouldReformulate` read a rung-less list as "structural" (so the D11 synonym
 * retry stopped). Both failures were silent. This suite drives the real collaborators end to end:
 * `FoodServiceClients` → the socket → `FoodCatalogGateway` → `createLexicalTier` → `IngredientsService`.
 *
 * The tier is wired into the service explicitly. Production's by-name path no longer runs the lexical tier (ADR-0071),
 * and the paste-match proposal chain does; this suite is about the tier and the event write, not about which chain
 * holds it.
 *
 * No database: the bindings and resolution repositories are doubled, which is the integration tier's rule.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallerToken } from '../../../src/auth/CallerToken.js';
import type { RootArm } from '../../../src/database/schema/foodLookupArm.js';
import type { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';

import { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { FoodServiceClients } from '../../../src/ingredients/FoodServiceClients.factory.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import { createLexicalTier } from '../../../src/ingredients/resolution/lexicalTier.js';
import {
    makeFakeIngredientResolutionsDal,
    makeFakeResolutionBandsDal,
} from '../../../src/ingredients/__fixtures__/resolutionDals.fixture.js';
import { makeCanonicalName } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';

/** What the stub food answers for each search term: hits with NO rung, as an older food sends them. */
const SEARCHES: Readonly<Record<string, readonly { id: string; name: string; score: number }[]>> = {
    'plain flour': [
        { id: 'food-flour', name: 'Flour, wheat, all-purpose', score: 0.9 },
        { id: 'food-carob', name: 'Carob flour', score: 0.6 },
    ],
    aubergine: [{ id: 'food-dip', name: 'Aubergine dip', score: 0.3 }],
    eggplant: [{ id: 'food-eggplant', name: 'Eggplant, raw', score: 0.9 }],
};

const CALLER = CallerToken.fromAuthorizationHeader('Bearer eyJhbGciOiJSUzI1NiJ9.RUNGLESS.sig');
const AUTHOR = '01JU10RUNGLESS00000AUTHOR0';

describe('the lexical tier against a food that publishes no rung (integration)', () => {
    let server: Server;
    let origin: string;
    let searchedTerms: string[];

    beforeAll(async () => {
        server = createServer((req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url ?? '/', 'http://stub');

            if (url.pathname === '/api/v1/foods/search') {
                const term = url.searchParams.get('query') ?? '';

                searchedTerms.push(term);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ results: SEARCHES[term] ?? [] }));

                return;
            }

            if (url.pathname === '/api/v1/foods/refs/resolve') {
                let body = '';

                req.on('data', (chunk: Buffer) => {
                    body += chunk.toString();
                });
                req.on('end', () => {
                    const { refs } = JSON.parse(body) as { refs: { kind: 'root'; id: string }[] };

                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(
                        JSON.stringify({
                            entries: refs.map((ref) => ({ outcome: 'found', ref, name: ref.id, status: 'RESOLVED' })),
                        }),
                    );
                });

                return;
            }

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{}');
        });

        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    });

    beforeEach(() => {
        searchedTerms = [];
    });

    /** The service over the real food stack, with the lexical tier wired in and its observer and recorder captured. */
    function build(): {
        service: IngredientsService;
        record: ReturnType<typeof vi.fn>;
        onUnrankedHits: ReturnType<typeof vi.fn>;
    } {
        const clients = new FoodServiceClients({
            baseUrl: origin,
            typeaheadTimeoutMs: 2_000,
            postCommitNutritionTimeoutMs: 1_500,
            readNutritionDeadlineMs: 3_000,
        });
        const gateway = new FoodCatalogGateway(clients, { enabled: true });
        const record = vi.fn().mockResolvedValue(undefined);
        const onUnrankedHits = vi.fn();
        const lookups = {
            findOrCreateBound: vi.fn(async (ref: { id: string }): Promise<RootArm> => ({
                kind: 'root',
                lookupId: `lookup-${ref.id}`,
                foodId: ref.id,
                foodOwnerId: null,
                createdAt: new Date('2026-10-25T00:00:00.000Z'),
            })),
        } as unknown as FoodLookupsDal;

        return {
            service: new IngredientsService(
                lookups,
                clients,
                gateway,
                new FoodRefsGateway(clients),
                [createLexicalTier(gateway, { onUnrankedHits })],
                makeFakeIngredientResolutionsDal({ record }),
                makeFakeResolutionBandsDal(),
            ),
            record,
            onUnrankedHits,
        };
    }

    it('records the shortlist and margin with no rung, and reports the rung-less hits', async () => {
        const { service, record, onUnrankedHits } = build();

        const bound = await service.addByName(CALLER, makeCanonicalName('plain flour'), AUTHOR);

        expect(bound.foodId).toBe('food-flour');
        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({
                tier: 'lexical',
                margin: expect.closeTo(0.3, 6),
                shortlist: [
                    { foodId: 'food-flour', score: 0.9 },
                    { foodId: 'food-carob', score: 0.6 },
                ],
            }),
        );
        expect((record.mock.calls[0]?.[0] as Record<string, unknown>)['rung']).toBeUndefined();
        expect(onUnrankedHits).toHaveBeenCalledWith(2);
    });

    it('still runs the synonym retry when the first pass carries only rung-less hits', async () => {
        const { service } = build();

        const bound = await service.addByName(CALLER, makeCanonicalName('aubergine'), AUTHOR);

        expect(searchedTerms).toEqual(['aubergine', 'eggplant']);
        expect(bound.foodId).toBe('food-eggplant');
    });
});
