# UX Information Architecture

**Status**: Ready for UX discovery and low-/mid-fidelity IA work.

## Product shell

Commise needs one coherent app shell across web and mobile. The navigation may be visually different by platform, but the information architecture must stay in lockstep.

### Primary destinations

| Destination   | Purpose                                                                                                                         | Primary personas                       | Notes for UX                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Home          | Personalized signed-in launchpad.                                                                                               | All                                    | Must not be generic. Show relevant next actions, recents, resume cooking, plan/shop/nutrition prompts, and premium-aware opportunities. |
| Recipes       | Personal and public recipe discovery/management.                                                                                | P8 Alex, P1 Casey, P3 Riley, P11 Robin | Includes search, filters, collections, create/import/clone/share, visibility, recipe detail/card.                                       |
| Meal Planning | Calendar-based planning and templates.                                                                                          | P3 Riley, P4 Sam                       | Supports starting from Home or recipe pages; must expose nutrition context and grocery handoff.                                         |
| Grocery Lists | Dedicated shopping-list management and online ordering status.                                                                  | P3 Riley, P6 Avery                     | Users can start from meal plans or directly from this page. Must support in-store and online-order modes.                               |
| Nutrition     | Nutrition Planning goals, compliance, contextual recipe/meal-plan links, and separate dieting/protocol guidance where in scope. | P4 Sam, P3 Riley                       | Related to recipes and meal plans, but needs a dedicated page for goal setup and review without medical-advice framing.                 |
| Cooking Mode  | Focused, guided recipe execution.                                                                                               | P1 Casey, P2 Taylor, P9 Drew           | Enter from recipe detail and meal-plan recipe slots; optimized for hands-busy use.                                                      |
| AI            | AI recipe generation, assistance, and external-agent connections.                                                               | P7 Quinn, P8 Alex                      | May appear as a page plus contextual entry points from recipes, meal planning, and cooking mode.                                        |
| Account       | Profile, auth/session, subscription, billing, connected agents, privacy.                                                        | All                                    | Includes Clerk flows, subscription management, agent consent/revocation, deletion/export.                                               |

### Recommended web navigation

- Persistent left rail for primary destinations: Home, Recipes, Meal Planning, Grocery Lists, Nutrition, and AI.
- Account, subscription, privacy, connected agents, and settings live behind a persistent avatar/account menu instead of competing with primary work destinations.
- The rail may collapse from expanded labels to icon-only density, but the destination set must remain stable.
- Global create action with menu: Create recipe, Import recipe, Create meal plan, Create shopping list, Generate with AI.
- Global search scoped by content type: Recipes first, then ingredients/foods, creators/public recipes, meal plans, grocery lists.
- Contextual right panel on desktop for nutrition summary, selected meal slot details, grocery order status, or paywall preview.
- Cooking Mode uses a focused full-screen shell and may hide the standard rail while active.

### Recommended mobile navigation

- Bottom tab bar with exactly five primary tabs: Home, Recipes, Plan, Grocery, AI.
- Account, subscription, privacy, connected agents, and settings live behind a header/avatar action instead of a generic More tab.
- Nutrition remains a first-class feature, but mobile access is contextual from Home, Recipes, and Plan rather than a primary bottom-tab destination.
- Floating/contextual primary action changes by tab: add recipe, add meal, add item, start plan, or generate with AI.
- Cooking Mode temporarily hides tab navigation and uses a focused full-screen shell.

## Home screen requirements

Home is the first post-login surface and must answer: "What should I do next in Commise?"

### Required Home modules

| Module                   | Required content                                                                                        | Empty-state behavior                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Continue / Resume        | Active cooking session, draft recipe, in-progress import, unfinished meal plan, or active grocery list. | Replace with starter checklist.                         |
| This week                | Upcoming meal-plan slots and gaps.                                                                      | CTA: Create this week's plan.                           |
| Recent recipes           | Recently viewed/edited/cooked recipes.                                                                  | CTA: Add or import first recipe.                        |
| Nutrition snapshot       | Current plan/goal compliance if configured.                                                             | CTA: Set nutrition goal.                                |
| Shopping status          | Active grocery list and online order status if present.                                                 | CTA: Create shopping list.                              |
| Explore / public recipes | Personalized public recipe suggestions.                                                                 | Show generic-but-useful starter set only for new users. |
| Premium value nudge      | Contextual premium opportunity based on attempted/likely action.                                        | Never block core free actions.                          |

Home modules may be reordered or hidden after onboarding so frequent cooks, planners, shoppers, and AI-first users can make the launchpad feel personal. Critical continuation, sync/conflict, and safety/account alerts must remain pinned or otherwise visible until resolved.

## Navigation ownership rules

- Recipes own recipe detail/card, visibility, collections, sharing, cloning, and edit history.
- Meal Planning owns calendar views, plan templates, meal-slot assignment, and plan-level nutrition summary.
- Grocery Lists owns list generation review, in-store check-off, manual lists, store connection, ordering handoff, and order status.
- Nutrition owns Nutrition Planning goals, compliance, contextual deficiency planning guidance, and trainer/client plan views; dieting/protocol guidance must remain visually and verbally distinct where in scope.
- Subscriptions owns paywall patterns, pricing page, subscription status, billing history, restore/manage flows.
- AI owns AI generation, preview/save, confidence/guard messaging, BYOK setup, and connected-agent consent/revocation.

When a flow crosses domains, the originating screen must keep the user oriented with clear back-links and object labels.
