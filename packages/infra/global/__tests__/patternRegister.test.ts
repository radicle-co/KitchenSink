// @vitest-environment node
/**
 * THE PATTERN REGISTER — the gate that makes CLAUDE.md's design-pattern rule checkable, and the durable
 * record of every ref site in the component tree.
 *
 * ## The finding this was written for
 *
 * `packages/tools/docgen-components` measured the real tree and reported **`@pattern` tags: 0 of 224
 * components**. Read alone that says nobody in this repository names the patterns they build with. Measured
 * further, it says something narrower and more useful:
 *
 *  - `@pattern` appears in EIGHT files repo-wide, and all eight are inside the generator's own package — its
 *    fixtures, its classifier, its model, its tests. The tag has never been used in product code because
 *    nothing ever asked for it: CLAUDE.md says a unit's JSDoc "names the pattern", not that it carries a tag.
 *  - The convention the repository actually adopted is PROSE — `DESIGN PATTERN:` in **190 files**, plus
 *    `Pattern:` in another 23. About twenty component leaves carry a substantive one already
 *    (`Null Object for the loading phase`, `Decorator over RN's Modal`, `Adapter over
 *    @radix-ui/react-dropdown-menu`, `Template Method / Layout component`, `discriminated union +
 *    exhaustive switch (Visitor, satisfied by the language)`).
 *
 * So the rule was being followed in substance and in a form nothing could check — anywhere. `0 of 224`
 * measured adherence to a spelling the standard never specified, not adherence to the standard.
 *
 * ## Why the rule was AMENDED and not merely enforced
 *
 * Read literally — every component's JSDoc names its pattern — CLAUDE.md rule 2 collides head-on with
 * `docs/CODING_STANDARDS.md` §8's owner ruling of 2026-08-12: comments are "information-bearing, not
 * positional", a name that fully states its meaning "takes NO block", and near-duplicate comments are
 * forbidden. A pure presentational leaf whose docblock already says it is presentational, carrying
 * `@pattern Presentational Component`, is precisely that near-duplicate. Two standards in this repository
 * could not both be satisfied as written, and stamping 224 components would have satisfied the weaker one
 * while making the stronger one permanently worthless.
 *
 * The amendment narrows the rule to where a pattern name carries information, names the machine-readable
 * form, and forbids the stamp in the rule's own text. `CLAUDE.md` rule 2 and `docs/CODING_STANDARDS.md`
 * §11.2 carry the wording; {@link owesPatternEntry} carries the scope predicate; the assertion below that no
 * entry may merely restate the layer is the clause that keeps the register worth reading.
 *
 * ## What this gate asserts, and what each assertion is FOR
 *
 *  1. Every in-scope component names a pattern (40 of 224 today). This is the standard, enforced at 100% —
 *     there is no backlog and no exemption list, because the scope was narrowed until there did not need to
 *     be one. A gate with a 180-entry exemption ledger would have made `why` a formality.
 *  2. No named pattern is a bare restatement of the layer. Without this, (1) is satisfiable by stamping and
 *     the register decays into noise that still reports green — the cargo-cult outcome, delivered by the
 *     gate meant to prevent it.
 *  3. Every component recorded in {@link DECLARED_ORCHESTRATION} still declares orchestration. The scope
 *     predicate's fourth clause is the only one read out of PROSE, so without this pin an author could
 *     delete a word from a docblock, leave the obligation set, and take the gate green by making the
 *     documentation worse.
 *  4. Component ids are path-bearing. This tree holds three components named `CheckIcon`, two of them in
 *     one group, so a `group/name` key would transfer one component's record to another.
 *  5. The ref sites in the tree are EXACTLY the ones triaged in {@link REF_SITES}, both directions. A new
 *     ref cannot land untriaged; a removed ref cannot leave a stale exemption behind. This is the
 *     `natEgressConsumers.test.ts` / `llmSpendGuards.test.ts` set-equality idiom.
 *  6. The number of ref sites carrying an UNSANCTIONED ref may only go down.
 *  7. The ref-using modules that are NOT components are exactly {@link REF_MODULES}. (5) is scoped to
 *     COMPONENTS, so a ref moved into a hook leaves it altogether — a burn-down that is really a relocation.
 *  8. No ref-bearing file in the app tree escapes BOTH (5) and (7). Neither half can notice the other going
 *     blind; their union is checkable against a parse of the tree, and that parse is the only reading here
 *     that does not come from the catalogue.
 *  9. The number of components stating no layer at all may only go down. A NEW component that says nothing
 *     never enters the predicate's fourth clause at all, so (3) cannot see it; this can.
 *
 * ⛔ WHAT A WORTHLESS VERSION OF THIS GATE WOULD STILL PASS ON — and therefore what the fakes and the
 * working-tree assertions below are aimed at. A "the tag count did not decrease" guard is green while every
 * tag says `Presentational Component`; while a new `useRef` lands in a component nobody triaged; while an
 * author deletes "orchestration" from a docblock to shed the obligation; while one `CheckIcon`'s record
 * covers another's; and while the catalogue failed to load and every assertion is vacuous. Each of those
 * five is asserted against explicitly, and each was run as a real mutation before this landed.
 *
 * ⚠️ WHAT IT CANNOT PROVE. That a claim is TRUE. `@pattern Adapter` on a component that stopped adapting
 * anything is a lie with a machine-readable veneer, and only review catches that.
 */
import { describe, expect, it } from 'vitest';

import {
    declaresOrchestration,
    isCatalogueUnreadableError,
    isLayerRestatement,
    layerUnstated,
    normalizePattern,
    owesPatternEntry,
    readComponentCatalogue,
    refUsingComponents,
    refUsingFiles,
    refUsingModulesOutsideComponents,
    registerFindings,
    type RegisteredComponent,
} from './patternRegister.js';

/**
 * How a component's ref use was judged against CLAUDE.md's "near-forbidden … permitted only to wrap a
 * genuinely external, non-declarative system with no alternative".
 */
type RefVerdict =
    /** Every ref in the component wraps an external non-declarative system. The sanctioned exception. */
    | 'sanctioned'
    /** Every ref is external-RESOURCE lifecycle bookkeeping (an Object-URL ledger). Argued, not assumed. */
    | 'sanctioned-adjacent'
    /** At least one ref holds React state, derived data, or a render-affecting latch. Debt, ratcheted down. */
    | 'unsanctioned';

/** One triaged ref site. */
interface RefSite {
    readonly verdict: RefVerdict;
    /** Substantive reason — what the ref holds, and for `unsanctioned`, the correct shape. */
    readonly why: string;
}

/**
 * EVERY component in the tree that reaches for a ref API, triaged one site at a time (2026-09-02).
 *
 * The catalogue attributes a file-scoped hook to every component declared in that file, which is why
 * `HomeNudgeContext` appears beside `SubscriptionNudge` — they share `SubscriptionNudge.tsx`. Entries are
 * per COMPONENT because that is the unit the catalogue names; the reasons below are per ref.
 *
 * ⛔ An entry is a JUDGEMENT, not a silencer. `unsanctioned` records a real violation with its correct
 * shape and is counted by {@link UNSANCTIONED_CEILING}; it does not excuse it. Do not change a verdict to
 * `sanctioned` to make the ceiling assertion pass — lower the ceiling by fixing the ref.
 */
const REF_SITES: Readonly<Record<string, RefSite>> = {
    'design-system/motion/EnterTransition': {
        verdict: 'sanctioned',
        why: "Holds the React Native `Animated.Value` that drives the transition. RN's animation driver is imperative and has no declarative equivalent; the module docblock names it as the sanctioned use.",
    },
    'features-recipes/actions/MoreActionsMenu': {
        verdict: 'sanctioned',
        why: 'Two DOM node handles: the panel, for `contains(event.target)` outside-click dismissal, and the trigger, for `focus()` on Escape. Neither `.contains()` nor `.focus()` has a declarative form.',
    },
    'web/components/home/chrome/HomeMobileNav': {
        verdict: 'sanctioned',
        why: "`closeRef` and nothing else: it wraps the close button's DOM node so `onOpenAutoFocus` can call the imperative `.focus()` the DOM API requires, overriding which control Radix focuses on open. There is no declarative way to name a specific element as the autofocus target. The `triggerRef`/`wasOpenRef` pair that made this entry unsanctioned moved into `useReturnFocusOnClose` (see {@link REF_MODULES}).",
    },
    'web/components/recipes/IngredientPicker': {
        verdict: 'sanctioned',
        why: '`useImperativeHandle` publishes ONE method, `focusSearch`, over the search input; the node itself never escapes. The declarative alternative was considered and rejected in writing at `ingredientResolver.model.ts` — a `focusSignal` epoch prop still needs a ref and an effect inside the picker and makes correctness depend on observing a render exactly once.',
    },
    'web/components/recipes/RecipeCreateContainer': {
        verdict: 'sanctioned-adjacent',
        why: 'A file-input handle (resetting `.value` is the only way to re-fire `change` for the same file) and the picker handle, both sanctioned; plus an Object-URL ledger swept on unmount. `createObjectURL`/`revokeObjectURL` is a two-call browser API whose lifetime React does not model, and the ledger is never read to drive rendering.',
    },
    'web/components/recipes/RecipeEditContainer': {
        verdict: 'sanctioned',
        why: 'The parent half of the picker handle only: one `IngredientPickerHandle` whose `focusSearch()` is called when the caller adds an ingredient row. ⚠️ CONTESTED, and recorded as such rather than settled: a handle on OUR OWN component is not literally "an external non-declarative system", so this reads as the weakest sanctioned claim in the register. It is admitted because the system being wrapped is the focus API at the far end of the handle, no node escapes, and the declarative alternative is worse and was rejected in writing at `ingredientResolver.model.ts` — a `focusSignal` epoch prop still needs a ref and an effect inside the picker and makes correctness depend on observing one render exactly once. A reviewer may overrule this; if so it becomes `unsanctioned` and the ceiling goes UP by the number of sites, which is the honest bookkeeping.',
    },
    'web/components/recipes/RecipePhotoUploaderContainer': {
        verdict: 'sanctioned-adjacent',
        why: 'Two file-input handles (one to reset `.value`, one to open the picker programmatically) plus a fileId→Object-URL ledger revoked per item and on unmount. Same reasoning as `RecipeCreateContainer`; the ledger never drives a render.',
    },
    'mobile/components/IngredientPicker': {
        verdict: 'sanctioned',
        why: 'The native mirror of the web picker — `useImperativeHandle` publishing `focusSearch` over a `TextInput`, node never escaping, same rejected alternative recorded.',
    },
    'mobile/screens/RecipeEditor': {
        verdict: 'sanctioned',
        why: "The parent half of the picker handle only, the native mirror of `RecipeEditContainer` — and it carries that entry's CONTESTED status with it: a handle on our own component is the weakest sanctioned claim here, admitted on the same three grounds and overrulable on the same one. Fix or re-judge both platforms together.",
    },
};

/**
 * How many triaged ref sites still carry an unsanctioned ref.
 *
 * ⚠️ RATCHET. This may only ever go DOWN, and the assertion is EXACT rather than an upper bound: a ceiling
 * with slack is not a ratchet, and one integer is cheap enough to keep honest. Fixing a ref means editing
 * this number in the same commit, which is the point — the burn-down is visible in the diff.
 *
 * ✅ BURNED DOWN 10 → 0 (2026-09-02). All nine unsanctioned refs behind the ten entries are gone:
 *
 *  - The six verbatim `wasOpenRef` copies became ONE hook, `useReturnFocusOnClose`
 *    (`@commise/ui/dialog-focus`), whose edge latch is `useState` adjusted during render. Twelve refs left
 *    the components; one sanctioned DOM handle remains, inside the hook (see {@link REF_MODULES}).
 *  - The two `shown` nudge latches became a three-state `NudgePhase`, on both platforms.
 *  - SpeedDial's `openOnLast` folded into its open state as a `DialState` discriminated union.
 *
 * ⚠️ This register previously recorded that NO test could observe the discarded-render hazard and that the
 * fix would rest on reasoning alone. That was WRONG, and the correction is worth more than the claim:
 * `useReturnFocusOnClose.test.tsx`'s Suspense case does observe it — a render is discarded, focus moves, the
 * replay commits — and it was watched failing on the ref latch and passing on the state latch. What remains
 * unproven by test is the OTHER two fixes: `NudgePhase` and `DialState` have no reachable behavioural
 * difference and are pinned only by characterization suites that were green before AND after. Do not
 * describe those two as test-proven.
 */
const UNSANCTIONED_CEILING = 0;

/**
 * Ref-using modules under `packages/apps/commise/**` that are NOT components, and are therefore invisible to
 * {@link REF_SITES}.
 *
 * ⛔ THIS IS A BLIND SPOT, RECORDED RATHER THAN CLAIMED CLOSED. The catalogue discovers COMPONENTS; a hook
 * module declares none, so no amount of set-equality over {@link REF_SITES} can see a ref that lives in one.
 * FOUR such modules already existed when this was written, and the `wasOpenRef` extraction ADDED a fifth by
 * moving a ref out of six components into a hook — exactly the move that would have laundered a violation
 * past the ratchet had nobody written it down.
 *
 * ⚠️ What this list asserts is EXISTENCE, not a verdict: a new ref-bearing hook module fails this test and
 * has to be looked at, which is the guarantee the ratchet is supposed to give. It does NOT assert that the
 * five entries are sanctioned. Each carries an in-source justification, and four of them are UNADJUDICATED
 * against CLAUDE.md rule 3 — that triage is owed work, and doing it may well raise
 * {@link UNSANCTIONED_CEILING}. Saying so is cheaper than a register that quietly implies otherwise.
 */
const REF_MODULES: readonly string[] = [
    // The only one triaged, because this commit wrote it: ONE `useRef` holding a DOM node whose sole use is
    // the imperative `.focus()` the DOM API requires — the same sanctioned shape as `MoreActionsMenu`'s
    // trigger handle, and the node never leaves the module. Its edge latch is deliberately NOT a ref; the
    // module docblock says why, and its Suspense test fails if it becomes one again.
    'packages/apps/commise/ui/src/dialogFocus/useReturnFocusOnClose.ts',
    // ⚠️ UNADJUDICATED — pre-existing, each with a written in-source defence nobody has graded.
    'packages/apps/commise/features/recipes/src/hooks/useIngredientResolver.ts',
    'packages/apps/commise/features/recipes/src/hooks/useRecipeEditor.ts',
    'packages/apps/commise/features/recipes/src/hooks/useRecipePhotoUpload.ts',
    'packages/apps/commise/mobile/src/hooks/useScrollResetOnChange.ts',
];

/**
 * How many catalogued components state no layer at all.
 *
 * ⚠️ RATCHET, exact for the same reason as {@link UNSANCTIONED_CEILING}. This is the pre-existing backlog
 * the generator reports as `unclassified-layer`, and it is the hole in the scope predicate: a component that
 * never says it orchestrates is never asked what it orchestrates with. Adding a component without a layer
 * word raises this and fails; classifying one lowers it and fails until the number is lowered with it.
 */
const LAYER_UNSTATED_CEILING = 144;

/**
 * Every component obliged under {@link owesPatternEntry}'s clause 4 — the ONE clause read out of prose.
 *
 * ⛔ THIS PIN IS THE INTEGRITY CONTROL ON THE SCOPE PREDICATE, not a coverage list. `kind` comes from
 * regexing the docblock for layer words, so without this an author could delete the word "orchestration"
 * from a component's documentation, watch it drop out of the obligation set, and take the gate green — by
 * making the docs worse, silently. Recording the members makes that failure loud and NAMED.
 *
 * ⚠️ It is asserted one-way (`recorded ⊆ still-declaring`) on purpose. Growth needs no edit here — a new
 * orchestration component is already caught by the pattern gate — so the only thing this file has to be
 * kept in step with is a DELIBERATE removal, which is a decision and should cost a line in a diff. A
 * genuine deletion or reclassification means deleting the id in the same commit and saying why in the
 * message.
 */
const DECLARED_ORCHESTRATION: readonly string[] = [
    'features-recipes/components/RecentRecipeGrid',
    'features-recipes/detail/PhotoCarousel',
    'features-recipes/detail/RecipeDetailBody',
    'features-recipes/detail/RecipeDetailView',
    'features-recipes/detail/RecipeHero',
    'features-recipes/nutrition/RecipeNutritionBoundary',
    'features-recipes/nutrition/RecipeNutritionSlot',
    'features-recipes/rating/RecipeRatingDisplay',
    'web/components/app/RedactedAnalytics',
    'web/components/app/RouteErrorBoundary',
    'web/components/app/RouteErrorState',
    'web/components/auth/AccountEraseForm',
    'web/components/auth/LogoutButton',
    'web/components/recipes/RecipePhotoUploaderContainer',
    'mobile/components/account/AccountDangerZone',
    'mobile/components/account/SignOutButton',
    'mobile/screens/RecipeEditor',
];

/** The real, committed catalogue. Read once — it is the same bytes for every assertion below. */
const components = readComponentCatalogue();

/** A component fake, so a predicate can be fired at a shape the tree does not currently contain. */
function makeComponent(overrides: Partial<RegisteredComponent> = {}): RegisteredComponent {
    return {
        id: 'group/dir/Fake',
        packageName: '@commise/fake',
        layer: 'feature',
        kind: 'presentational',
        patterns: [],
        refApis: [],
        booleanSubtreeProps: [],
        sourcePaths: ['packages/apps/commise/fake/src/Fake.tsx'],
        ...overrides,
    };
}

describe('the scope predicate — which components owe a named pattern', () => {
    it('binds every design-system component, the vocabulary the rest of the tree is written in', () => {
        expect(owesPatternEntry(makeComponent({ layer: 'design-system', kind: 'presentational' }))).toBe(true);
    });

    it('binds a component that reaches for a ref, because the ref rule already demands that justification', () => {
        expect(owesPatternEntry(makeComponent({ kind: 'presentational', refApis: ['useRef'] }))).toBe(true);
        expect(owesPatternEntry(makeComponent({ kind: 'unclassified', refApis: ['useImperativeHandle'] }))).toBe(true);
    });

    it('binds a component whose boolean prop selects between two rendered subtrees', () => {
        expect(owesPatternEntry(makeComponent({ booleanSubtreeProps: ['isLoading'] }))).toBe(true);
    });

    it('binds a component that states it orchestrates, because what it orchestrates WITH is a choice', () => {
        expect(owesPatternEntry(makeComponent({ kind: 'orchestration' }))).toBe(true);
    });

    it('exempts a pure presentational leaf, whose only pattern is the layer its docblock already states', () => {
        expect(owesPatternEntry(makeComponent({ kind: 'presentational' }))).toBe(false);
    });

    it('exempts a component that states nothing and has none of the three code-derived shapes', () => {
        expect(owesPatternEntry(makeComponent({ kind: 'unclassified' }))).toBe(false);
    });

    // ⛔ THE MUTANT THAT PROVES THE HAZARD IS REAL. Clause 4 reads prose, so an author could try to leave the
    // obligation set by deleting the layer word. Here that works — which is exactly why DECLARED_ORCHESTRATION
    // exists and is asserted against the working tree below. Losing THAT assertion re-opens this hole.
    it('DOES lose a clause-4 component when its docblock stops saying orchestration — hence the pin', () => {
        const declared = makeComponent({ id: 'g/d/Shell', kind: 'orchestration' });
        const worsened = { ...declared, kind: 'unclassified' as const };

        expect(owesPatternEntry(declared)).toBe(true);
        expect(owesPatternEntry(worsened)).toBe(false);
        expect(declaresOrchestration([worsened])).toEqual([]);
    });

    // The mirror: the three code-derived clauses CANNOT be escaped that way.
    it.each([
        ['design-system', makeComponent({ layer: 'design-system' })],
        ['ref-using', makeComponent({ refApis: ['useRef'] })],
        ['boolean-subtree', makeComponent({ booleanSubtreeProps: ['isLoading'] })],
    ])('keeps a %s component in scope however its docblock is rewritten', (_label, component) => {
        for (const kind of ['presentational', 'orchestration', 'unclassified'] as const) {
            expect(owesPatternEntry({ ...component, kind })).toBe(true);
        }
    });
});

describe('the anti-stamp rule — a pattern that only restates the layer is not a register entry', () => {
    it.each([
        'Presentational Component',
        'presentational',
        '**Presentational Component**',
        'Orchestration',
        'Container Component',
        'React component',
        'Component.',
    ])('rejects %j', (stamp) => {
        expect(isLayerRestatement(stamp)).toBe(true);
    });

    it.each([
        'Null Object for the loading phase',
        'Adapter over @radix-ui/react-dropdown-menu',
        "Decorator over RN's Modal",
        'Suspense boundary + error boundary as a state selector',
        'Humble Object — the pure render half of the orchestration/render split',
        'Command, already satisfied by the TanStack mutation it wraps',
    ])('accepts %j', (pattern) => {
        expect(isLayerRestatement(pattern)).toBe(false);
    });

    // The denylist compares NORMALIZED heads, so it must survive the three spellings this repo already uses.
    // A denylist defeated by a pair of asterisks stops the careless author and waves the careless-plus-bold
    // one through.
    it('normalizes emphasis, punctuation, case and the trailing clause down to the pattern name', () => {
        expect(normalizePattern('**Adapter** over the DOM focus API')).toBe('adapter over the dom focus api');
        expect(normalizePattern('Null Object — for the pending phase')).toBe('null object');
        expect(normalizePattern('Presentational Component.')).toBe('presentational component');
    });
});

describe('the register findings — the pure verdict, fired at fakes the tree does not contain', () => {
    it('reports an in-scope component that names no pattern at all', () => {
        const findings = registerFindings([makeComponent({ id: 'g/d/Orch', kind: 'orchestration' })]);

        expect(findings).toEqual([
            {
                id: 'g/d/Orch',
                sourcePath: 'packages/apps/commise/fake/src/Fake.tsx',
                reason: 'no-pattern-named',
                evidence: [],
            },
        ]);
    });

    // THE MUTATION THIS GATE EXISTS FOR. A version of it that only counted tags would report this tree clean,
    // and "every component says Presentational Component" is exactly the cargo-cult compliance the amendment
    // forbids by name.
    it('reports an in-scope component whose only pattern restates its layer', () => {
        const findings = registerFindings([
            makeComponent({ id: 'g/d/Stamped', kind: 'orchestration', patterns: ['Presentational Component'] }),
        ]);

        expect(findings.map((finding) => [finding.id, finding.reason])).toEqual([
            ['g/d/Stamped', 'pattern-only-restates-layer'],
        ]);
    });

    it('accepts an in-scope component that names one real pattern alongside a restatement', () => {
        expect(
            registerFindings([
                makeComponent({
                    kind: 'orchestration',
                    patterns: ['Presentational Component', 'Adapter over the Clerk session'],
                }),
            ]),
        ).toEqual([]);
    });

    it('says nothing about an out-of-scope component, however it is documented', () => {
        expect(registerFindings([makeComponent({ kind: 'presentational' })])).toEqual([]);
    });
});

// The two ratchets below are integer comparisons against the working tree, so nothing about them would fail
// if their SELECTOR silently returned nothing. These fire the selectors at fakes for that reason.
describe('the ratchet selectors', () => {
    it('counts as unstated exactly the components whose docblock names no layer', () => {
        expect(
            layerUnstated([
                makeComponent({ id: 'g/d/Silent', kind: 'unclassified' }),
                makeComponent({ id: 'g/d/Says', kind: 'presentational' }),
                makeComponent({ id: 'g/d/Orch', kind: 'orchestration' }),
            ]),
        ).toEqual(['g/d/Silent']);
    });

    it('counts as ref-using exactly the components some leaf of which reaches for a ref API', () => {
        expect(
            refUsingComponents([
                makeComponent({ id: 'g/d/Ref', refApis: ['useRef'] }),
                makeComponent({ id: 'g/d/Handle', refApis: ['useImperativeHandle'] }),
                makeComponent({ id: 'g/d/Clean' }),
            ]),
        ).toEqual(['g/d/Ref', 'g/d/Handle']);
    });
});

describe('the committed catalogue', () => {
    // Without this every assertion below is vacuously true on a catalogue that failed to load, which is the
    // silent-success class this whole branch has been removing.
    it('carries the component surface, so no assertion over it can pass by reading nothing', () => {
        expect(components.length).toBeGreaterThan(200);
        expect(components.filter(owesPatternEntry).length).toBeGreaterThan(20);
    });

    it('refuses to be read from a tree that has none, rather than reporting a clean verdict', () => {
        let thrown: unknown;

        try {
            readComponentCatalogue('/nonexistent-root-for-this-assertion');
        } catch (error) {
            thrown = error;
        }

        expect(isCatalogueUnreadableError(thrown)).toBe(true);
    });
});

describe('CLAUDE.md rule 2, as amended — every in-scope component names the pattern it implements', () => {
    // The integrity control on clause 4. Losing this assertion makes the obligation set escapable by editing
    // a docblock, which is the one silent failure this whole design is arranged around.
    it('still obliges every component recorded as declaring orchestration', () => {
        const declaring = new Set(declaresOrchestration(components));

        expect(
            DECLARED_ORCHESTRATION.filter((id) => !declaring.has(id)),
            'These components no longer say "orchestration" in their docblock, so they have silently left ' +
                'the obligation set. Either restore the word, or — if the component was genuinely deleted or ' +
                'reclassified — remove the id from DECLARED_ORCHESTRATION in the same commit and say why.',
        ).toEqual([]);
    });

    // The key is the full catalogue id, PATH-BEARING, and this tree is why. `CheckIcon` exists three times,
    // twice inside one group; a `group/name` key would transfer one component's record to another — the
    // silent-silencing failure `scripts/boundariesRatchet.mjs` documents for its own key choice.
    it('keys components by a path-bearing id, because three components here are named CheckIcon', () => {
        const checkIcons = components.filter((component) => component.id.endsWith('/CheckIcon'));

        expect(checkIcons.length).toBeGreaterThanOrEqual(3);
        expect(new Set(checkIcons.map((component) => component.id)).size).toBe(checkIcons.length);
    });

    it('leaves no in-scope component without a usable pattern entry', () => {
        const findings = registerFindings(components);

        expect(
            findings.map((finding) => `${finding.reason}: ${finding.id} (${finding.sourcePath})`),
            'Add a `@pattern <name>` line as the LAST line of the module docblock. It must name what the ' +
                'unit IS — Adapter, Facade, Null Object, statechart, Suspense selector — never restate its ' +
                'layer. See CLAUDE.md rule 2 and docs/CODING_STANDARDS.md §8.1.',
        ).toEqual([]);
    });
});

describe('the ref register — CLAUDE.md rule 3, made checkable', () => {
    // Set equality in BOTH directions. One direction lets an untriaged ref land; the other lets a triage
    // outlive the ref it excused. `natEgressConsumers.test.ts` learned the same lesson about a list that
    // could not detect its own incompleteness.
    it('triages exactly the ref sites the tree contains — no more, no fewer', () => {
        expect([...refUsingComponents(components)].sort()).toEqual(Object.keys(REF_SITES).sort());
    });

    it('gives every triaged site a substantive reason, never a blank exemption', () => {
        const thin = Object.entries(REF_SITES).filter(([, site]) => site.why.trim().split(/\s+/u).length < 12);

        expect(thin.map(([id]) => id)).toEqual([]);
    });

    it('holds the unsanctioned refs at the recorded count, which may only go down', () => {
        const unsanctioned = Object.entries(REF_SITES)
            .filter(([, site]) => site.verdict === 'unsanctioned')
            .map(([id]) => id);

        expect(
            unsanctioned.length,
            `${unsanctioned.length} site(s) carry an unsanctioned ref: ${unsanctioned.join(', ')}. If you ` +
                'fixed one, lower UNSANCTIONED_CEILING in the same commit. If this went UP, a ref that holds ' +
                'React state was added — refs are near-forbidden (CLAUDE.md rule 3).',
        ).toBe(UNSANCTIONED_CEILING);
    });

    // The other half of the tree. Without this, a ref moved out of a component and into a hook LEAVES the
    // register entirely and the ratchet reports a burn-down that was really a relocation — which is exactly
    // what the `wasOpenRef` extraction did to six components.
    it('records exactly the ref-using modules that are NOT components — no more, no fewer', () => {
        expect(
            [...refUsingModulesOutsideComponents(components)],
            'A module outside the component catalogue reaches for a ref API. Triage it against CLAUDE.md ' +
                'rule 3 and add it to REF_MODULES with a reason, or remove the stale entry. A hook is not ' +
                'exempt from the ref rule just because the catalogue cannot see it.',
        ).toEqual([...REF_MODULES].sort());
    });

    // Neither half of the register can detect that the OTHER half went blind — a component catalogue that
    // silently stopped reporting `usesRefApi`, or a module scan whose identifier list drifted from the
    // generator's, would each leave a hole the other's set-equality still passes over. Their union is
    // checkable against the tree, so this asserts the two together see EVERY ref-bearing file.
    it('leaves no ref-bearing file in the app tree outside BOTH halves of the register', () => {
        const componentSources = components
            .filter((component) => component.refApis.length > 0)
            .flatMap((component) => component.sourcePaths);
        const covered = new Set([...componentSources, ...REF_MODULES]);
        const uncovered = refUsingFiles().filter((file) => !covered.has(file));

        expect(uncovered).toEqual([]);
    });
});

describe('the layer backlog — the silence the scope predicate can be dodged with', () => {
    it('holds the unstated-layer count at the recorded number, which may only go down', () => {
        const unstated = layerUnstated(components);

        expect(
            unstated.length,
            'A component states its layer by saying "presentational" or "orchestration" in its docblock. If ' +
                'this went UP, a new component said neither. If it went DOWN, lower LAYER_UNSTATED_CEILING ' +
                'in the same commit.',
        ).toBe(LAYER_UNSTATED_CEILING);
    });
});
