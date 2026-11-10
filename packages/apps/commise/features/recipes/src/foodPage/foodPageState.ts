/**
 * @module @commise/features-recipes/foodPage — `foodPageStateOf`: the food page's twelve states as one closed union.
 *
 * The page reads two things, the food and (for an author's own food) its newest publication request, and this module
 * turns the answers into exactly one state, so the view is an exhaustive switch and a new state is a compile error
 * there (private foods spec section 4.1). The author's `publicationState` is the only authority on states 5 to 11: it
 * is derived on the service, and a client never rebuilds it from the request. A food that carries none is somebody
 * else's public food (state 12). A missing food, another cook's private food and another cook's withdrawn food all
 * answer the same `NotFoundError`, so the page says nothing about which.
 *
 * @pattern Visitor — a discriminated union the view consumes with an exhaustive switch
 */
import { isNotFoundError } from '@kitchensink/food-service-client';
import type {
    FoodResponse,
    GetFoodResult,
    PublicationRequestDetail,
    PublicationStateValue,
} from '@kitchensink/schema-food';

/** Where the food read stands. */
export type FoodRead =
    /** `parked`: TanStack paused the read for want of a connection (`fetchStatus: 'paused'`). */
    | { readonly phase: 'pending'; readonly parked: boolean }
    | { readonly phase: 'error'; readonly error: unknown }
    | { readonly phase: 'ready'; readonly result: GetFoodResult };

/** What the page knows. */
export interface FoodPageInput {
    readonly read: FoodRead;
    /** The newest request, once read. Absent while it loads and for a food never asked for. */
    readonly request: PublicationRequestDetail | undefined;
    /** Whether the device has a connection. */
    readonly online: boolean;
}

/** A state of the author's own food, which carries the food and the newest request. */
export interface OwnFoodState<K extends PublicationStateValue> {
    readonly kind: K;
    readonly food: FoodResponse;
    readonly request: PublicationRequestDetail | undefined;
    /** A cached copy shown with no connection: the actions stay, disabled, with a line saying why. */
    readonly actionsDisabled: boolean;
}

/** The page's state. States 1 to 4, then 5 to 11 (one per `publicationState`), then 12. */
export type FoodPageState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'notFound' }
    | { readonly kind: 'error' }
    | { readonly kind: 'offline' }
    | OwnFoodState<'private'>
    | OwnFoodState<'asked'>
    | OwnFoodState<'notApproved'>
    | OwnFoodState<'public'>
    | OwnFoodState<'editWaiting'>
    | OwnFoodState<'editNotApproved'>
    | OwnFoodState<'withdrawn'>
    | { readonly kind: 'othersPublic'; readonly food: FoodResponse };

/**
 * The state the page is in. Pure.
 *
 * @param input - The food read, the newest request, and the connection.
 * @returns Exactly one state.
 */
export function foodPageStateOf({ read, request, online }: FoodPageInput): FoodPageState {
    // Offline, the app's `offlineFirst` read fails once and parks its retry, so it stays pending: that is state 4 too.
    // Only a PARKED read, as `@commise/query`'s `PendingSlot` rules: one still in its first attempt is loading.
    if (read.phase === 'pending') {
        return read.parked && !online ? { kind: 'offline' } : { kind: 'loading' };
    }

    if (read.phase === 'error') {
        if (isNotFoundError(read.error)) {
            return { kind: 'notFound' };
        }

        return online ? { kind: 'error' } : { kind: 'offline' };
    }

    if (read.result.status !== 'RESOLVED') {
        return { kind: 'error' };
    }

    const { food } = read.result;
    const word = food.publicationState;

    if (word === undefined) {
        return { kind: 'othersPublic', food };
    }

    // A withdrawn food has no actions, so there is nothing for a missing connection to disable.
    const actionsDisabled = !online && word !== 'withdrawn';

    // No cast: each `publicationState` value must name an `OwnFoodState` member, so a new one fails to compile here.
    return { kind: word, food, request, actionsDisabled };
}
