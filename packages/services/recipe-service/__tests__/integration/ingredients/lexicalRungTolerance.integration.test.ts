/**
 * Integration proof that the lexical tier survives a food that publishes NO rung (ADR-0070), over a REAL HTTP server,
 * on the path that runs it: the paste matcher's proposal chain (ADR-0071).
 *
 * An absent rung on a name hit means food is older than recipe, or sent a rung the food client reads as absent. Two
 * silent failures were possible: the ranked shape was dropped (so nothing was proposed or ranked), and
 * `shouldReformulate` read a rung-less list as "structural" (so the D11 synonym retry stopped). This suite drives the
 * real collaborators end to end: `FoodServiceClients` → the socket → `FoodCatalogGateway` → `createLexicalTier` →
 * `MatchProposalService`, and reads what the matcher stores.
 *
 * ⚠️ Re-targeted (ADR-0071). It drove `IngredientsService.addByName` with the lexical tier wired in by hand and asserted
 * the ranked resolution EVENT. By-name now runs the settled chain only, and that event write was deleted as unreachable,
 * so the same rung-less food is asserted through the matcher's stored PROPOSAL instead.
 *
 * No database: the parse job and the match store are doubled, which is the integration tier's rule.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallerToken } from '../../../src/auth/CallerToken.js';
import type { Principal } from '../../../src/auth/principal.js';
import { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { FoodServiceClients } from '../../../src/ingredients/FoodServiceClients.factory.js';
import { createLexicalTier } from '../../../src/ingredients/resolution/lexicalTier.js';
import { fakeLineVerificationsDal } from '../../../src/recipes/__fixtures__/lineVerificationsDal.fixture.js';
import {
    inMemoryParseJobMatches,
    makeParseJobLine,
    makeParseJobRecord,
    makeStoredProposal,
} from '../../../src/recipes/__fixtures__/parseJobMatches.fixture.js';
import { fakeVerificationQueue } from '../../../src/recipes/__fixtures__/verificationQueue.fixture.js';
import { MatchProposalService } from '../../../src/recipes/matchProposal.service.js';

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
const JOB = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

/** The cook, as the auth middleware hands it over. */
const COOK: Principal = {
    userId: AUTHOR,
    sub: `clerk_${AUTHOR}`,
    scopes: [],
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
};

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

    /** The matcher over the real food stack, proposing for one pasted line naming `phrase`, with its observer captured. */
    function build(phrase: string): {
        service: MatchProposalService;
        matches: ReturnType<typeof inMemoryParseJobMatches>;
        onUnrankedHits: ReturnType<typeof vi.fn>;
    } {
        const clients = new FoodServiceClients({
            baseUrl: origin,
            typeaheadTimeoutMs: 2_000,
            postCommitNutritionTimeoutMs: 1_500,
            readNutritionDeadlineMs: 3_000,
        });
        const gateway = new FoodCatalogGateway(clients, { enabled: true });
        const onUnrankedHits = vi.fn();
        const matches = inMemoryParseJobMatches(new Map([[JOB, AUTHOR]]));
        const sourceLine = `2 cups ${phrase}`;
        const job = makeParseJobRecord({
            lines: [
                makeParseJobLine({
                    sourceLine,
                    proposal: makeStoredProposal({ raw: sourceLine, foods: [{ name: phrase, prep: null }] }),
                }),
            ],
        });

        return {
            service: new MatchProposalService(
                { getJob: vi.fn(async (ownerId: string) => (ownerId === AUTHOR ? job : undefined)) },
                matches,
                [createLexicalTier(gateway, { onUnrankedHits })],
                gateway,
                new FoodRefsGateway(clients),
                fakeVerificationQueue(),
                fakeLineVerificationsDal(),
            ),
            matches,
            onUnrankedHits,
        };
    }

    it('proposes the top rung-less hit with its margin and shortlist, no rung, and reports the rung-less hits', async () => {
        const { service, matches, onUnrankedHits } = build('plain flour');

        await service.propose(COOK, CALLER, JOB);

        const [row] = matches.rows.values();

        expect(row?.proposal).toMatchObject({
            matchedBy: 'lexical',
            food: { kind: 'root', id: 'food-flour' },
            rung: null,
            margin: expect.closeTo(0.3, 6),
        });
        expect(row?.candidates).toStrictEqual([
            { kind: 'root', id: 'food-flour', rung: null },
            { kind: 'root', id: 'food-carob', rung: null },
        ]);
        expect(onUnrankedHits).toHaveBeenCalledWith(2);
    });

    it('still runs the synonym retry when the first pass carries only rung-less hits', async () => {
        const { service, matches } = build('aubergine');

        await service.propose(COOK, CALLER, JOB);

        expect(searchedTerms).toEqual(['aubergine', 'eggplant']);
        expect([...matches.rows.values()][0]?.proposal?.food).toStrictEqual({ kind: 'root', id: 'food-eggplant' });
    });
});
