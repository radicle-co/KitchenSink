/**
 * THE REMOTE PROBE WORDS — which words the Maestro remote-food flows type, chosen and VERIFIED at seed time
 * (owner ruling 2026-10-18).
 *
 * ## Why they are not literals in a flow
 *
 * A remote-food flow needs words the live USDA search answers a known way: "at least three foods", "the first food
 * names the word", "nothing at all". Those answers depend on the stage's catalog, because the search hides a USDA hit
 * whose root the catalog already holds (ADR-0055 point 4). A literal word therefore goes stale the day the catalog
 * grows: `'Flou'` showed no USDA group at all, `'butter'` two foods and then none, and each time a flow failed at a
 * labelled wait for a reason that read like an app defect. Provision now asks the real search, as the signer, before
 * any flow runs, and a word that no longer answers right fails PROVISION, loudly, naming the word and the reason.
 *
 * @pattern Specification — {@link judgeProbe} is one pure predicate per role over a {@link ProbeObservation}, so each
 *   role is a truth table; {@link planNextProbe} is a pure planner over the observations so far, like
 *   `planDowngradedWorldRun`. The impure half (the searches, the waits) is `ensureRemoteProbeWords.ts`.
 * @module
 */
import type { ProgressiveAnswer } from '@kitchensink/food-service-client';
import { sanitizeFoodName } from '@kitchensink/recipe-core/food-name';
import type { MaestroPlatform } from '@kitchensink/e2e-fixtures/testPool';

/**
 * What a flow needs a word for.
 *
 * - `append` — the "Your foods" append story types it; at least three USDA foods must show.
 * - `change` — the Change food story types it and taps the FIRST USDA food, then asserts the row names the word.
 * - `unresolved` — `ingredientCandidates.yaml` makes a line by this word that OUR database finds nothing for, so it lands
 *   `UNRESOLVED` with USDA's foods as candidates, and picks one. NO FALLBACK: it proves the test purge works, so a word
 *   that fails is a finding, not something to walk past.
 * - `ambiguity` — `recipes/ambiguityReview.yaml` reviews two AMBIGUOUS lines made from it (`deriveAmbiguityProbe`, made
 *   by `reset --mode ambiguity`) and picks a USDA food in each of its two legs; at least {@link MIN_AMBIGUITY_USDA_ITEMS}
 *   must show.
 * - `noMatch` — the create-a-food story types a name nothing matches, so the create offer is the only option.
 */
export const PROBE_ROLES = ['append', 'change', 'unresolved', 'ambiguity', 'noMatch'] as const;

/** A key of {@link PROBE_ROLES}. */
export type ProbeRole = (typeof PROBE_ROLES)[number];

/** The most USDA foods the flows need on screen to scroll to and tap one. */
export const MIN_USDA_ITEMS = 3;

/**
 * The USDA foods the ambiguity word must show: ONE PER LEG. `recipes/ambiguityReview` picks a USDA food in the detail's
 * review and again in the editor's row, and the first pick adopts its hit into the catalog, which the search then hides
 * (ADR-0055 point 4). So the second leg's search shows one food fewer than the first did.
 */
export const MIN_AMBIGUITY_USDA_ITEMS = 2;

/**
 * The name `createAuthoredFood.yaml` types to reach the create offer. ONE invented token, because the USDA source
 * matches a query on any of its words: a two-word name is only as rare as its commoner word ("Maestro" is a brand).
 * Not chosen from a list, so a leftover is never stepped around: it is VERIFIED at provision, and a search that finds
 * anything, or an authored food still there from a purge that did not finish, fails the run.
 */
export const NO_MATCH_FOOD_NAME = 'Zorbleflax';

/**
 * Words no probe word may be or start with, because another flow types them: the discovery probe food `Flour` (typed
 * as `Flou` and `Flo`), the cap foods' `Cap Probe`, and `kale`. The seed world's ingredient words are checked against
 * the real `SEED_WORLD` by the unit test, so they are not restated here.
 */
export const RESERVED_WORDS: readonly string[] = ['flour', 'flou', 'flo', 'cap', 'probe', 'kale'];

/**
 * Ordered candidates for the roles that are chosen, per platform. The first that answers right wins and the rest are
 * never asked, so a stage whose catalog has not grown costs one search per role.
 *
 * ⛔ DISJOINT across platforms: an Android and an iOS lane run at once against the same stage, and a word both pick
 * would be picked (and its root created) twice. Measured on pr-91 on 2026-10-18 (USDA foods shown): gochujang 20,
 * sumac 19, kombu 18, harissa 18, yuzu 18, paneer 17, miso 14, tahini 6. Distinctive foods, not common ones, because a
 * common word is the one the catalog grows to cover first. The last word of each list is unmeasured on purpose: a
 * reserve, so a stage that has outgrown the measured ones has somewhere to go before it fails.
 *
 * Lowercase and letters only: the search canonicalises a term to lowercase, and a flow puts the word inside a Maestro
 * pattern.
 */
export const PROBE_CANDIDATES = {
    android: {
        append: ['paneer', 'tahini', 'kimchi'],
        change: ['gochujang', 'harissa', 'tamarind'],
        // ⛔ ONE word, no fallback (see `unresolved` above). `halloumi` is the word the flow has always used.
        unresolved: ['halloumi'],
        // ⚠️ UNMEASURED on a stage. The placeholder rule rejects a word when either of the two foods the legs tap is named
        // the word alone, and USDA's Branded data often leads with such a food: a raw USDA search (2026-10-20, top 20,
        // all four data types) found one for wasabi, chorizo, mascarpone, sriracha, polenta, couscous, edamame, pancetta
        // and prosciutto, and none for `mirin` (18 distinct names). So `mirin` leads; the other two are guesses at words
        // USDA names only inside a longer one. Not stocks, broths, oils or fats: the gate must judge the
        // food plainly unlike the probe's source lines ("chicken stock", "olive oil"). Not `ponzu`: "yuzu ponzu" is a
        // common product, so it would share USDA foods with iOS's `yuzu`.
        ambiguity: ['mirin', 'furikake', 'achiote'],
    },
    ios: {
        append: ['yuzu', 'miso', 'tempeh'],
        change: ['kombu', 'sumac', 'ghee'],
        // UNMEASURED: no stage has been asked for it yet. With no fallback, a stage that has outgrown it fails provision
        // by name, and the fix is to change this one word.
        unresolved: ['labneh'],
        // UNMEASURED on a stage, like android's ambiguity list (see there).
        ambiguity: ['teriyaki', 'tzatziki', 'chutney'],
    },
} as const satisfies Record<
    MaestroPlatform,
    {
        readonly append: readonly string[];
        readonly change: readonly string[];
        readonly unresolved: readonly string[];
        readonly ambiguity: readonly string[];
    }
>;

/** The ordered candidates of every role. */
export type ProbeCandidates = Readonly<Record<ProbeRole, readonly string[]>>;

/**
 * The candidates one platform's provision searches.
 *
 * @param platform - The Maestro platform.
 * @returns Every role's ordered candidates.
 */
export function candidatesFor(platform: MaestroPlatform): ProbeCandidates {
    return { ...PROBE_CANDIDATES[platform], noMatch: [NO_MATCH_FOOD_NAME] };
}

/** Why a search could not be judged yet. Never a reason to drop a word. */
export type TransientCause = 'busy' | 'limited' | 'unavailable';

/** What one search showed. */
export type ProbeObservation =
    | {
          readonly kind: 'answered';
          /** How many foods the catalog group showed. */
          readonly catalogCount: number;
          /** How many of the caller's own foods the authored group showed. */
          readonly authoredCount: number;
          /** The names of the USDA foods shown, in the order shown. */
          readonly items: readonly string[];
      }
    | {
          readonly kind: 'transient';
          readonly cause: TransientCause;
          /** When a `busy` or `limited` source may be asked again, in epoch milliseconds. */
          readonly retryAt?: number;
      };

/** Why a word was dropped. */
export type RejectionReason =
    | 'too-few-usda-items'
    | 'first-item-lacks-word'
    | 'source-showed-items'
    | 'catalog-holds-matches'
    | 'item-would-complete-placeholder'
    | 'authored-food-present';

/** One dropped word. */
export interface ProbeRejection {
    readonly word: string;
    readonly reason: RejectionReason;
}

/** What one observation says about one word. */
export type ProbeVerdict =
    | { readonly kind: 'accepted' }
    | { readonly kind: 'rejected'; readonly reason: RejectionReason }
    | { readonly kind: 'undecided'; readonly cause: TransientCause };

/**
 * The key a live catalog root carries a name under: food-service's `normalizeName` (`foodName.ts`), which is the
 * sanitised name lowercased. The same call, because the comparison is only meaningful if it is the pick's own.
 * Pure.
 */
function rootKeyOf(name: string): string {
    return sanitizeFoodName(name).toLowerCase();
}

/**
 * The keys of the resolution cascade's lexical tier's synonym map (`lexicalTier.ts`, `LEXICAL_SYNONYMS`). A line by one
 * of them is re-asked under the mapped word, so the database could answer a search the probe's plain term did not see.
 * A unit test holds this list equal to the map in that file.
 */
export const LEXICAL_SYNONYM_KEYS: readonly string[] = [
    'aubergine',
    'courgette',
    'rocket',
    'coriander',
    'beetroot',
    'scallion',
];

const ACCEPTED: ProbeVerdict = { kind: 'accepted' };

const rejected = (reason: RejectionReason): ProbeVerdict => ({ kind: 'rejected', reason });

/**
 * Whether a pick of any of `items` would land on a catalog root under the WORD's own key. Pure.
 *
 * The pick looks a root up by `sanitizeFoodName(name).toLowerCase()` (`AdoptRemoteFood.pick`). A placeholder under the
 * word's key (which "Find nutrition for <word>" leaves PENDING) is COMPLETED by such a pick, which is never attributed
 * and so never purged. Any other key INSERTS a new, attributed, purgeable root. The caller passes the foods its flow
 * may pick: every shown one for `unresolved`, the two tapped ones for `ambiguity`.
 */
function wouldCompletePlaceholder(word: string, items: readonly string[]): boolean {
    const wordKey = rootKeyOf(word);

    return items.some((name) => rootKeyOf(name) === wordKey);
}

/**
 * Whether a word does its role's job, given what its search showed. Pure and total.
 *
 * ⛔ A transient outcome (`busy`, `limited`, `unavailable`) is `undecided`, never `rejected`: the source said nothing
 * about the word, and dropping it would walk the list on a rate limit and fail provision for a reason that is not the
 * word's.
 *
 * @param role - What the word is for.
 * @param word - The word searched.
 * @param observation - What the search showed.
 * @returns Accepted, rejected with a reason, or undecided.
 */
export function judgeProbe(role: ProbeRole, word: string, observation: ProbeObservation): ProbeVerdict {
    if (observation.kind === 'transient') {
        return { kind: 'undecided', cause: observation.cause };
    }

    switch (role) {
        case 'append':
            return observation.items.length >= MIN_USDA_ITEMS ? ACCEPTED : rejected('too-few-usda-items');

        case 'change': {
            if (observation.items.length < MIN_USDA_ITEMS) {
                return rejected('too-few-usda-items');
            }

            // The flow taps index 0 and then asserts the row is named for the word, so the FIRST food must carry it.
            const first = observation.items[0] ?? '';

            return first.toLowerCase().includes(word.toLowerCase()) ? ACCEPTED : rejected('first-item-lacks-word');
        }

        case 'unresolved': {
            if (observation.catalogCount > 0) {
                return rejected('catalog-holds-matches');
            }

            if (observation.authoredCount > 0) {
                return rejected('authored-food-present');
            }

            if (observation.items.length < MIN_USDA_ITEMS) {
                return rejected('too-few-usda-items');
            }

            // "Find nutrition for <word>" leaves a PENDING root under the word's own key, so here the placeholder is
            // certain: the flow makes it.
            return wouldCompletePlaceholder(word, observation.items)
                ? rejected('item-would-complete-placeholder')
                : ACCEPTED;
        }

        case 'ambiguity': {
            // A food under the word at provision is one the last purge did not take back: the fixture's own is authored
            // later, by `reset --mode ambiguity`. Refused for the reason `unresolved` and `noMatch` refuse one.
            if (observation.authoredCount > 0) {
                return rejected('authored-food-present');
            }

            // The catalog group is NOT judged: the lines are bound to the signer's authored food, so a catalog match
            // changes nothing the flow reads. Nor is the first food's name: the flow taps index 0 of `, from USDA` and
            // reads only the saved sentence, the count and the sheet closing, never the name of the food it picked.
            if (observation.items.length < MIN_AMBIGUITY_USDA_ITEMS) {
                return rejected('too-few-usda-items');
            }

            // ⚠️ The hazard is a pick that COMPLETES a pending placeholder under the word's key: never attributed, so
            // never purged, and the word loses a food on every run. With no placeholder, a pick of an exact-name item
            // INSERTS an attributed, purgeable root (`remoteHitTriage.ts`: "A placeholder carrying the name leaves the
            // hit shown, because a pick completes the placeholder"). The probe cannot see a placeholder: the catalog
            // part lists `RESOLVED` roots only (`FoodSearchDao.searchCatalog`), and a RESOLVED root under the name hides
            // the hit anyway. So the exact-name check stands in for it, but only on the foods the flow TAPS: leg 1 taps
            // index 0, its pick hides that hit, and leg 2 taps the food shown second. A later exact-name food is never
            // picked, so it does not cost the word.
            return wouldCompletePlaceholder(word, observation.items.slice(0, MIN_AMBIGUITY_USDA_ITEMS))
                ? rejected('item-would-complete-placeholder')
                : ACCEPTED;
        }

        case 'noMatch': {
            if (observation.authoredCount > 0) {
                return rejected('authored-food-present');
            }

            if (observation.catalogCount > 0) {
                return rejected('catalog-holds-matches');
            }

            return observation.items.length === 0 ? ACCEPTED : rejected('source-showed-items');
        }

        default: {
            const unhandled: never = role;

            return unhandled;
        }
    }
}

/** The latest observation of each word searched, per role. */
export type ObservedProbes = Readonly<Partial<Record<ProbeRole, Readonly<Record<string, ProbeObservation>>>>>;

/** What to do next. */
export type ProbePlan =
    | { readonly kind: 'search'; readonly role: ProbeRole; readonly term: string }
    | { readonly kind: 'chosen'; readonly words: Readonly<Record<ProbeRole, string>> }
    | { readonly kind: 'exhausted'; readonly role: ProbeRole; readonly rejections: readonly ProbeRejection[] };

/**
 * The next step of the choice. Pure.
 *
 * Roles are decided in {@link PROBE_ROLES} order and each stops at its first accepted candidate, so a later candidate
 * is never searched once an earlier one holds. A word whose latest outcome is transient is asked again, the same term.
 *
 * @param candidates - Every role's ordered candidates.
 * @param observed - The latest observation of each word searched so far.
 * @returns A search to run, the chosen words, or the first role with no candidate left.
 */
export function planNextProbe(candidates: ProbeCandidates, observed: ObservedProbes): ProbePlan {
    const words = new Map<ProbeRole, string>();

    for (const role of PROBE_ROLES) {
        const rejections: ProbeRejection[] = [];
        let decided = false;

        for (const word of candidates[role]) {
            const observation = observed[role]?.[word];

            if (observation === undefined) {
                return { kind: 'search', role, term: word };
            }

            const verdict = judgeProbe(role, word, observation);

            if (verdict.kind === 'undecided') {
                return { kind: 'search', role, term: word };
            }

            if (verdict.kind === 'accepted') {
                words.set(role, word);
                decided = true;
                break;
            }

            rejections.push({ word, reason: verdict.reason });
        }

        if (!decided) {
            return { kind: 'exhausted', role, rejections };
        }
    }

    return { kind: 'chosen', words: Object.fromEntries(words) as Readonly<Record<ProbeRole, string>> };
}

/**
 * The words a role dropped, in candidate order, with the reason. Pure.
 *
 * @param candidates - Every role's ordered candidates.
 * @param observed - The latest observation of each word searched so far.
 * @param role - The role.
 * @returns One entry per candidate whose latest observation rejects it; an undecided or unasked word is not listed.
 */
export function rejectionsOf(
    candidates: ProbeCandidates,
    observed: ObservedProbes,
    role: ProbeRole,
): readonly ProbeRejection[] {
    return candidates[role].flatMap((word): readonly ProbeRejection[] => {
        const observation = observed[role]?.[word];
        const verdict = observation === undefined ? undefined : judgeProbe(role, word, observation);

        return verdict?.kind === 'rejected' ? [{ word, reason: verdict.reason }] : [];
    });
}

/** The words a run's flows type, as the manifest carries them (`manifestToEnvLines`). */
export interface ProvisionedProbeWords {
    /** The append story's word (`E2E_REMOTE_APPEND_WORD`). */
    readonly appendWord: string;
    /** The signer's own food the append story expects listed under "Your foods": `<appendWord> <runKey>`. */
    readonly appendFood: string;
    /** The Change food story's word (`E2E_REMOTE_CHANGE_WORD`). */
    readonly changeWord: string;
    /** The word `ingredientCandidates.yaml` makes an UNRESOLVED line from (`E2E_UNRESOLVED_WORD`). */
    readonly unresolvedWord: string;
    /**
     * The word `recipes/ambiguityReview` reviews (`E2E_AMBIGUITY_WORD`): the ambiguity probe's food and lines are named
     * for it. The per-flow reset reads it from the session state, which `provision` writes after choosing it.
     */
    readonly ambiguityWord: string;
    /** The name nothing matches (`E2E_NO_MATCH_FOOD`). */
    readonly noMatchFood: string;
}

/** The source the flows' remote lists show. */
const PROBE_SOURCE = 'usda';

/**
 * Fold a finished progressive answer into what the probe judges. Pure.
 *
 * An answer that is not whole is TRANSIENT, never empty: a stream that stopped before `complete`, a database group
 * that could not be read, or no USDA frame at all says nothing about the word.
 *
 * @param answer - The frames folded with `withProgressiveFrame`.
 * @returns The observation.
 */
export function observationOf(answer: ProgressiveAnswer): ProbeObservation {
    const unavailable: ProbeObservation = { kind: 'transient', cause: 'unavailable' };
    const database = answer.database;
    const source = answer.sources.find((frame) => frame.source === PROBE_SOURCE);

    if (!answer.complete || database === undefined || source === undefined) {
        return unavailable;
    }

    if (database.catalog.outcome !== 'answered' || database.authored.outcome !== 'answered') {
        return unavailable;
    }

    switch (source.outcome) {
        case 'answered':
            return {
                kind: 'answered',
                catalogCount: database.catalog.results.length,
                authoredCount: database.authored.results.length,
                items: source.items.map((item) => item.name),
            };
        case 'busy':
        case 'limited':
            return { kind: 'transient', cause: source.outcome, retryAt: source.retryAt };
        case 'unavailable':
            return unavailable;

        default: {
            const unhandled: never = source;

            return unhandled;
        }
    }
}
