/**
 * Named barrel for the food-service event layer (MOD-002 completion fan-out, T-165). Named-only
 * (no `export *`) per the project's barrel convention.
 */
export {
    FoodEventEmitter,
    buildFoodFetchCompleted,
    buildFetchFailed,
    newEventId,
    FOOD_FETCH_COMPLETED_DETAIL_TYPE,
    FETCH_FAILED_DETAIL_TYPE,
} from './FoodEventEmitter.js';
export type {
    EventClock,
    FoodEventPublisher,
    FoodFetchCompletedDetail,
    FetchFailedDetail,
    PublishCompletedInput,
    PublishFailedInput,
} from './FoodEventEmitter.js';
// The `EventBus`/`ConsoleEventBus` seam that used to live here was DELETED, not deprecated (plan U4). It
// was EventBridge-shaped (`{ detailType, detail }`) and could not carry the substrate's two-field group key,
// and leaving it exported would have let a new producer pick the wrong one. Its replacement is the shared
// `publish` port in `@kitchensink/messaging`, with `ConsolePublisher` as the no-AWS default.
