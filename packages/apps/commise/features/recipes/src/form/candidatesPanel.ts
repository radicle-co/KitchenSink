/**
 * @module @commise/features-recipes/form — the contract of rows 6 and 7's panel body (`docs/design/
 * ingredientStatusExplanation.md` SPECIFY.1 rows 6 and 7): the view the presentational `CandidatesPanelBody` leaves
 * draw, and what each control does. `shortlistPanel.model.ts` derives the view for both rows.
 *
 * The body lists what the progressive food search finds for the line's words (`docs/design/rowEditorOpenDecisions.md`,
 * S7 list contract P12): our database's foods first, then each remote source's under `From {source}`, added at the end,
 * and under them the sentences the list owes and a waiting line while the answer runs. None of these is always last: it
 * starts Change food and records nothing (§3a, "Rows 6-7 must not be a dead end").
 */

/** Props for the `CandidatesPanelBody` leaves (web and native): the panel's view, and what each control does. */
export interface CandidatesPanelBodyProps {
    readonly view: CandidatesPanelView;
    /** An option was pressed. */
    readonly onPick: (candidateId: string) => void;
    /** Try again, after a failed read. */
    readonly onRetryRead: () => void;
    /** None of these. */
    readonly onNoneOfThese: () => void;
}

/** One food the cook can press. */
export interface CandidateOption {
    readonly candidateId: string;
    readonly name: string;
    /** A one-line hint: the variant parts a catalog result matched. */
    readonly summary: string | undefined;
    /** A name that says more than the visible one, starting with it (2.5.3): a remote food's names its source (P5). */
    readonly accessibleName: string | undefined;
    /** This option's pick is in flight. */
    readonly busy: boolean;
    /** Another option's pick is in flight, so this one does nothing. */
    readonly blocked: boolean;
}

/** A labelled run of options. */
export interface CandidateGroup {
    readonly key: string;
    /** Its accessible name, and its visible heading when {@link heading} is set. */
    readonly label: string;
    /** Whether the label shows: a remote source's group names its source (P5); the database group is named only. */
    readonly heading: boolean;
    readonly options: readonly CandidateOption[];
}

/** What the panel shows where the options go. */
export type CandidatesPanelBody =
    | { readonly kind: 'loading' | 'offline' | 'failed' | 'empty'; readonly text: string }
    | {
          readonly kind: 'list';
          /** The groups, in P1's order, each added after the last (P2). */
          readonly groups: readonly CandidateGroup[];
          /** What the list could not search, each source's note, and that it did not finish: said politely under it. */
          readonly notes: readonly string[];
          /** The answer still runs: the line after the options says so (P12). */
          readonly waiting: string | undefined;
      };

/** The panel's view. */
export interface CandidatesPanelView {
    /** Why the row needs the cook: the row's own explanation. */
    readonly explanation: string;
    readonly body: CandidatesPanelBody;
    /** A pick's failure or the cook's limit, said assertively; `''` otherwise. */
    readonly alert: string;
    /** Each refused press under the limit says it again (`LiveRegion`'s `occurrence`, R8). */
    readonly alertOccurrence: number;
}
