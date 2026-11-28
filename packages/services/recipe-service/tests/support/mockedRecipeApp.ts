/**
 * The integration tier's boot: the REAL `AppModule` — auth middleware, pipes, guards and the exception filter — with
 * its dependencies mocked (`docs/CODING_STANDARDS.md` §7.1a).
 *
 * A suite replaces data access with provider doubles, and fakes food at the network (`foodFake.ts`), so the real food
 * client still serializes, forwards the bearer and parses. Every other dependency address is FORCED to a closed port,
 * so a call a suite forgot to mock fails instead of reaching the LocalStack or Postgres the tier's global setup starts.
 *
 * The tokens in `DEFAULT_DOUBLES` are the exception: every suite gets a default that answers "nothing", so a forgotten
 * mock for one of them does NOT fail loud. `ErasureJobsDal.findActiveJob` feeds `ErasureLockGuard`, so a suite gets
 * "no erasure in progress"; a suite that tests the erasure lock stages its own double. `PendingArchivesDal.enqueueMany`
 * is a WRITE that is accepted and forgotten; a suite that asserts on it stages its own too. A default is the WHOLE
 * token: `bootServiceApp` replaces a token's whole `useValue` and never merges members, so a suite whose double
 * differs keeps its whole copy.
 */
import { bootServiceApp, type BootedServiceApp, type ProviderDouble } from '@kitchensink/service-test-harness';

import { RECIPE_HTTP_SETUP } from '../../src/config/httpSetup.js';
import { ErasureJobsDal } from '../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../src/authors/dal/authorHandles.dal.js';
import type { PhotosDal } from '../../src/photos/dal/photos.dal.js';
import type { LineVerificationsDal } from '../../src/recipes/dal/lineVerifications.dal.js';
import { RecipeStatementAttestationsDal } from '../../src/recipes/dal/recipeStatementAttestations.dal.js';
import {
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../src/recipes/recipes.tokens.js';
import type { RatingsDal } from '../../src/ratings/dal/ratings.dal.js';
import { PendingArchivesDal } from '../../src/versions/dal/pendingArchives.dal.js';
import { RECIPE_APP_ENV_DEFAULTS } from './recipeAppEnv.js';

/** An address nothing listens on. */
const CLOSED = 'http://127.0.0.1:9';

/**
 * The attestation record's double every suite gets: an append that is accepted and forgotten. A suite that asserts on the rows
 * supplies its own for the same token (a later double for a token replaces an earlier one), so a suite about something else
 * never has to know the record exists.
 */
const DEFAULT_ATTESTATIONS_DOUBLE = {
    provide: RecipeStatementAttestationsDal,
    useValue: {
        insertMany: (): Promise<void> => Promise.resolve(undefined),
        hasFromPerson: (): Promise<boolean> => Promise.resolve(false),
        hasWordedAttestation: (): Promise<boolean> => Promise.resolve(false),
    },
};

/**
 * What each defaulted DAL answers when a suite does not stage it: nothing found, and the one write accepted and
 * forgotten (it answers the rows it inserted, none). Each is checked against the real DAL's own member types, so a
 * signature change fails `tsc` here rather than going quietly stale.
 */
export const DEFAULT_ANSWERS = {
    pendingArchives: { enqueueMany: () => Promise.resolve([]) } satisfies Partial<PendingArchivesDal>,
    photos: { findByRecipe: () => Promise.resolve([]) } satisfies Partial<PhotosDal>,
    ratings: { findStars: () => Promise.resolve(undefined) } satisfies Partial<RatingsDal>,
    lineVerifications: {
        findBandsByKeys: () => Promise.resolve(new Map()),
        findExistingKeys: () => Promise.resolve(new Set()),
    } satisfies Partial<LineVerificationsDal>,
    erasureJobs: { findActiveJob: () => Promise.resolve(undefined) } satisfies Partial<ErasureJobsDal>,
    authorHandles: { findByline: () => Promise.resolve(undefined) } satisfies Partial<AuthorHandlesDal>,
};

const DEFAULT_DOUBLES: readonly ProviderDouble[] = [
    DEFAULT_ATTESTATIONS_DOUBLE,
    { provide: PendingArchivesDal, useValue: DEFAULT_ANSWERS.pendingArchives },
    { provide: RECIPE_PHOTOS_DAL, useValue: DEFAULT_ANSWERS.photos },
    { provide: RECIPE_RATINGS_DAL, useValue: DEFAULT_ANSWERS.ratings },
    { provide: RECIPE_LINE_VERIFICATIONS_DAL, useValue: DEFAULT_ANSWERS.lineVerifications },
    { provide: ErasureJobsDal, useValue: DEFAULT_ANSWERS.erasureJobs },
    { provide: AuthorHandlesDal, useValue: DEFAULT_ANSWERS.authorHandles },
];

/**
 * A suite's doubles behind the defaults. The order is the contract: the harness applies doubles in order and a later
 * double for a token replaces an earlier one, so the defaults go FIRST.
 *
 * @param doubles - The suite's own doubles.
 * @returns The defaults, then the suite's doubles.
 */
export function withDefaultDoubles(doubles: readonly ProviderDouble[]): readonly ProviderDouble[] {
    return [...DEFAULT_DOUBLES, ...doubles];
}

/** Options for {@link bootMockedRecipeApp}. */
export interface MockedRecipeAppOptions {
    /** The providers to replace, typically the DALs a route reads. */
    readonly doubles: readonly ProviderDouble[];
    /** Where food answers: a `startFoodFake()` origin. Absent, food is unreachable. */
    readonly foodServiceUrl?: string;
}

/**
 * Boot the app for the mocked integration tier. Authenticate a request with `asPrincipal` (`tests/e2e/harness.ts`);
 * a request outside it has no principal and answers `401`.
 *
 * @param options - The doubles and the food origin.
 * @returns The booted app's base URL, Nest handle, and `close()`.
 * @sideEffect Mutates `process.env` and starts an HTTP listener.
 */
export async function bootMockedRecipeApp(options: MockedRecipeAppOptions): Promise<BootedServiceApp> {
    return bootServiceApp({
        loadAppModule: () => import('../../src/app.module.js'),
        forcedEnv: {
            NODE_ENV: 'development',
            // The config schema requires a URL; with no credentials and a closed port, no query can land anywhere.
            DATABASE_URL: 'postgres://127.0.0.1:9/mocked-tier',
            S3_ENDPOINT: CLOSED,
            SQS_ENDPOINT: CLOSED,
            ACCOUNT_ERASURE_QUEUE_URL: `${CLOSED}/000000000000/mocked-tier-erasure`,
            INGREDIENT_VERIFICATION_QUEUE_URL: `${CLOSED}/000000000000/mocked-tier-verification`,
            RECIPE_PARSE_QUEUE_URL: `${CLOSED}/000000000000/mocked-tier-parse`,
            FOOD_SERVICE_URL: options.foodServiceUrl ?? CLOSED,
        },
        envDefaults: RECIPE_APP_ENV_DEFAULTS,
        doubles: withDefaultDoubles(options.doubles),
        httpSetup: RECIPE_HTTP_SETUP,
    });
}
