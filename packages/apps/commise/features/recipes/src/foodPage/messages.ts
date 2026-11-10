/**
 * @module @commise/features-recipes/foodPage/messages — the author's food page copy (private foods spec section 5 and 6),
 * consumed by the web and native leaves through `useMessages`, so the two platforms cannot drift. Every string a cook
 * reads here is a key; dates are formatted by the caller with `Intl.DateTimeFormat` and passed as `{date}`.
 */
import type { LocalizedMessages } from '@commise/i18n';

import type { PluralText } from '../format/plural.js';

/** The copy of one publication state's status panel. */
export interface FoodStatePanelCopy {
    readonly statement: string;
    readonly detail?: string;
}

/** The food page's copy. */
export interface FoodPageMessages {
    readonly titleFallback: string;
    /** The pinned Back: a food opens in a new tab with no history, so it goes to My recipes. */
    readonly back: { readonly label: string; readonly parent: string };
    /** Back from a food opened from a recipe page's refusal. */
    readonly backToRecipe: { readonly label: string; readonly parent: string };
    /** Back from a food opened above the editor (native): the chevron alone on a phone. */
    readonly backToEditor: { readonly label: string; readonly parent: string };
    readonly loading: string;
    readonly notFound: { readonly title: string; readonly body: string; readonly toRecipes: string };
    readonly error: { readonly title: string; readonly retry: string };
    readonly offlineActions: string;
    readonly status: {
        readonly private: string;
        readonly asked: string;
        readonly declined: string;
        readonly public: string;
        readonly editWaiting: string;
        readonly editDeclined: string;
        readonly withdrawn: string;
    };
    readonly private: { readonly statement: string; readonly askNote: string };
    readonly asked: { readonly statement: string; readonly detail: string };
    readonly declined: { readonly statement: string; readonly reason: string; readonly next: string };
    readonly public: { readonly statement: string; readonly detail: string };
    readonly editWaiting: { readonly statement: string; readonly detail: string };
    readonly editDeclined: { readonly statement: string; readonly next: string };
    readonly withdrawn: { readonly statement: string; readonly detail: string };
    readonly yourEdit: {
        readonly heading: string;
        readonly row: string;
        readonly rowSpoken: string;
        readonly rest: string;
        readonly fields: {
            readonly name: string;
            readonly calories: string;
            readonly proteinG: string;
            readonly carbsG: string;
            readonly fatG: string;
        };
    };
    readonly nutrition: {
        readonly heading: string;
        readonly calories: string;
        readonly protein: string;
        readonly carbs: string;
        readonly fat: string;
    };
    readonly portions: { readonly heading: string };
    readonly unit: { readonly kcal: string; readonly g: string };
    readonly action: { readonly edit: string; readonly ask: string; readonly withdraw: string };
    readonly ask: { readonly busy: string; readonly done: string; readonly failed: string };
    readonly withdraw: {
        readonly title: string;
        readonly confirm: string;
        readonly keep: string;
        readonly busy: string;
        readonly failed: string;
        readonly done: string;
        readonly bodyPrivate: string;
        readonly bodyAsked: string;
        readonly bodyPublic: string;
    };
    readonly edit: {
        readonly title: string;
        readonly save: string;
        readonly saving: string;
        readonly send: string;
        readonly sending: string;
        readonly noChangeSave: string;
        readonly noChangeSend: string;
        readonly saved: string;
        readonly askResent: string;
        readonly sent: string;
        readonly failed: string;
        readonly duplicate: string;
        readonly cancel: string;
        readonly close: string;
        readonly notice: {
            readonly review: string;
            readonly replacesWaiting: string;
            readonly askReplaced: string;
        };
    };
    readonly yourFoods: {
        readonly title: string;
        readonly profileRow: string;
        readonly profileRowUnseen: PluralText;
        readonly empty: string;
        readonly error: string;
        readonly loadMore: string;
        readonly rowDecision: string;
    };
}

export const foodPageMessages: LocalizedMessages<FoodPageMessages> = {
    en: {
        titleFallback: 'Food',
        back: { label: 'Back to My recipes', parent: 'My recipes' },
        backToEditor: { label: 'Back to Edit recipe', parent: 'Edit recipe' },
        backToRecipe: { label: 'Back to recipe', parent: 'Recipe' },
        loading: 'Loading food',
        notFound: {
            title: 'Food not found',
            body: 'It was removed, or the link is wrong.',
            toRecipes: 'Go to My recipes',
        },
        error: { title: 'We couldn’t load this food', retry: 'Try again' },
        offlineActions: 'Editing and asking need a connection.',
        status: {
            private: 'Private',
            asked: 'Waiting for review',
            declined: 'Not approved',
            public: 'Public',
            editWaiting: 'Edit waiting for review',
            editDeclined: 'Edit not approved',
            withdrawn: 'Withdrawn',
        },
        private: {
            statement: 'Only you can see this food. You can use it in your private recipes.',
            askNote: 'After staff approve it, anyone can find and use it, and it can’t be made private again.',
        },
        asked: {
            statement: 'You asked to make this food public on {date}.',
            detail: 'Staff are reviewing it. It stays private until they approve. If you edit it, your edit is sent for review instead.',
        },
        declined: {
            statement: 'Staff didn’t approve making this food public.',
            reason: 'Their reason: {reason}',
            next: 'It stays private. Edit the food to ask again.',
        },
        public: {
            statement: 'Anyone can find and use this food.',
            detail: 'Staff review each edit before anyone sees it.',
        },
        editWaiting: {
            statement: 'You sent an edit for review on {date}.',
            detail: 'Until staff approve it, everyone sees the public version below, and so do your recipes.',
        },
        editDeclined: {
            statement: 'Staff didn’t approve your edit.',
            next: 'The public version hasn’t changed. You can edit again.',
        },
        withdrawn: { statement: 'You withdrew this food.', detail: 'Recipes that used it show it as removed.' },
        yourEdit: {
            heading: 'Your edit',
            row: '{from} → {to}',
            rowSpoken: '{field}: public {from}, your edit {to}',
            rest: 'Nothing else changes.',
            fields: { name: 'Name', calories: 'Calories', proteinG: 'Protein', carbsG: 'Carbs', fatG: 'Fat' },
        },
        nutrition: {
            heading: 'Nutrition per 100 g',
            calories: 'Calories',
            protein: 'Protein',
            carbs: 'Carbs',
            fat: 'Fat',
        },
        portions: { heading: 'Portions' },
        unit: { kcal: 'kcal', g: 'g' },
        action: { edit: 'Edit', ask: 'Ask to make public', withdraw: 'Withdraw' },
        ask: { busy: 'Sending…', done: 'Asked to make public.', failed: 'We couldn’t send your ask.' },
        withdraw: {
            title: 'Withdraw {name}?',
            confirm: 'Withdraw food',
            keep: 'Keep food',
            busy: 'Withdrawing…',
            failed: 'We couldn’t withdraw this food.',
            done: 'Food withdrawn.',
            bodyPrivate:
                'Your recipes that use it will show it as removed and stop counting its nutrition. You can’t undo this.',
            bodyAsked:
                'Your ask to make it public is cancelled. Your recipes that use it will show it as removed and stop counting its nutrition. You can’t undo this.',
            bodyPublic:
                'No one will be able to find it. Every recipe that uses it, yours and other cooks’, will show it as removed and stop counting its nutrition. Any edit waiting for review is cancelled. You can’t undo this.',
        },
        edit: {
            title: 'Edit {name}',
            save: 'Save',
            saving: 'Saving…',
            send: 'Send for review',
            sending: 'Sending…',
            noChangeSave: 'Change something to save it.',
            noChangeSend: 'Change something to send it for review.',
            saved: 'Food saved.',
            askResent: 'Food saved and sent for review.',
            sent: 'Edit sent for review.',
            failed: 'We couldn’t save your changes.',
            duplicate: 'You already have a food with that name.',
            cancel: 'Cancel',
            close: 'Close food editor',
            notice: {
                review: 'Staff review every change to a public food. Until they approve, everyone, including your recipes, keeps the current version.',
                replacesWaiting: 'This replaces the edit waiting for review.',
                askReplaced: 'You asked to make this food public. Saving sends this version for review instead.',
            },
        },
        yourFoods: {
            title: 'Your foods',
            profileRow: 'Your foods',
            profileRowUnseen: { one: 'Your foods, {count} new decision', other: 'Your foods, {count} new decisions' },
            empty: 'You haven’t made any foods yet. A food you make appears here.',
            error: 'We couldn’t load your foods',
            loadMore: 'Show more',
            rowDecision: 'New decision',
        },
    },
};
