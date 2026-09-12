# Commise — Figma Make Design Prompt

## Project Overview

**Product**: Commise — A recipe-centered cooking workflow platform that connects recipes → meal planning → grocery lists → cooking → nutrition into one seamless loop. Available on web (Next.js) and mobile (Expo/React Native).

**Target Audience**: Home cooks, meal planners, nutrition-focused users, content creators — primarily P1 Casey (beginner cook, accessibility-sensitive) and P3 Riley (family meal planner).

**Core Features**: Recipe management, meal planning, grocery lists, cooking mode, nutrition planning, AI recipe generation, social sharing, subscriptions.

---

## Design Language Direction

### Aesthetic: "Summer at the Beach"

Warm, light, breezy, relaxing — like cooking with the windows open on a perfect summer afternoon. The design should feel:

- **Effortless**: Everything flows naturally, no visual heaviness
- **Inviting**: Warm colors that make you want to cook
- **Fresh**: Light, airy, never cluttered or overwhelming
- **Calming**: Cooking should feel relaxing, not stressful

### Liquid Glass Implementation

- **Backdrop blur**: `blur(10-20px) saturate(180%)`
- **Surface opacity**: `rgba(255,255,255,0.10-0.20)` backgrounds
- **Layer hierarchy**: Controls highest blur/opacity, cards medium, background lowest
- **Respect `prefers-reduced-transparency`**: Solid fallback for accessibility
- **Food visibility**: Translucent layers must not obscure food photography
- **Text scrims**: Solid text shadows or semi-transparent scrims behind text on blurred backgrounds to maintain WCAG contrast

---

## Color Palette

### Primary Colors

| Token             | Hex       | Usage                                                   |
| ----------------- | --------- | ------------------------------------------------------- |
| `--color-seafoam` | `#5BA8A0` | Primary actions, CTAs, active states, accent            |
| `--color-coral`   | `#E8917A` | Destructive/secondary actions, highlights, warm accents |
| `--color-sand`    | `#FAF6F0` | Page backgrounds, surfaces, warm base                   |
| `--color-sky`     | `#8ECAE6` | Secondary accents, info states, links, calm indicators  |

### Neutral Colors

| Token                | Hex       | Usage                                                             |
| -------------------- | --------- | ----------------------------------------------------------------- |
| `--color-white`      | `#FFFFFF` | Cards, modals, high-contrast text on dark                         |
| `--color-charcoal`   | `#2D3436` | Primary text, headings                                            |
| `--color-slate`      | `#636E72` | Secondary text, captions, disabled                                |
| `--color-mist`       | `#B2BEC3` | Borders, dividers, inactive states                                |
| `--color-pearl`      | `#F5F5F5` | Subtle backgrounds, hover states                                  |
| `--color-ocean-dark` | `#2A6B65` | Primary text on light backgrounds (seafoam darkened for contrast) |

### Semantic Colors

| Token             | Hex       | Usage                           |
| ----------------- | --------- | ------------------------------- |
| `--color-success` | `#4CAF7C` | Success states, completed items |
| `--color-warning` | `#F5B041` | Warnings, pending states        |
| `--color-error`   | `#E17055` | Errors, destructive actions     |
| `--color-premium` | `#D4A574` | Premium/gold tier indicators    |

### Gradient & Texture

- **Beach glow gradient**: `linear-gradient(135deg, #FAF6F0 0%, #F0F7F4 50%, #E8F4F8 100%)`
- **Liquid glass surface**: `rgba(255,255,255,0.15) + backdrop-filter: blur(16px) saturate(150%)`
- **Warm photo overlay**: Subtle `rgba(250,246,240,0.3)` overlay on food photography to maintain warmth

---

## Typography

### Font Family

- **Primary**: `Inter` or `SF Pro` (system font stack)
- **Display/Headings**: `Playfair Display` or `Georgia` — elegant, warm serif for recipe titles and page headers
- **Monospace**: `SF Mono` or `JetBrains Mono` — for code snippets, nutrition data, timers

### Type Scale

| Token        | Size             | Weight | Usage                         |
| ------------ | ---------------- | ------ | ----------------------------- |
| `display-xl` | 48px / 2.5rem    | 700    | Hero recipe titles            |
| `display-lg` | 36px / 2rem      | 700    | Page headings                 |
| `display-md` | 28px / 1.75rem   | 600    | Section headings              |
| `heading-lg` | 24px / 1.5rem    | 600    | Card titles, modal headings   |
| `heading-md` | 20px / 1.25rem   | 600    | Subsection headings           |
| `heading-sm` | 18px / 1.125rem  | 500    | Small headings, labels        |
| `body-lg`    | 18px / 1.125rem  | 400    | Lead paragraphs, descriptions |
| `body-md`    | 16px / 1rem      | 400    | Primary body text             |
| `body-sm`    | 14px / 0.875rem  | 400    | Secondary text, metadata      |
| `caption`    | 12px / 0.75rem   | 500    | Timestamps, badges, captions  |
| `overline`   | 11px / 0.6875rem | 600    | Uppercase labels, tags        |

### Line Heights

- Headings: 1.2
- Body: 1.5
- Captions: 1.4

---

## Spacing System

### Base Unit: 8px

| Token     | Value |
| --------- | ----- |
| `space-1` | 4px   |
| `space-2` | 8px   |
| `space-3` | 12px  |
| `space-4` | 16px  |
| `space-5` | 24px  |
| `space-6` | 32px  |
| `space-7` | 48px  |
| `space-8` | 64px  |
| `space-9` | 96px  |

### Border Radius

| Token         | Value  | Usage                                   |
| ------------- | ------ | --------------------------------------- |
| `radius-sm`   | 4px    | Buttons, small inputs, badges           |
| `radius-md`   | 8px    | Cards, modals, containers               |
| `radius-lg`   | 16px   | Large cards, feature containers         |
| `radius-xl`   | 24px   | Hero sections, onboarding               |
| `radius-full` | 9999px | Pills, avatars, floating action buttons |

---

## Shadow System

| Token         | Value                             | Usage                             |
| ------------- | --------------------------------- | --------------------------------- |
| `shadow-sm`   | `0 1px 2px rgba(45,52,54,0.05)`   | Subtle elevation                  |
| `shadow-md`   | `0 4px 12px rgba(45,52,54,0.08)`  | Cards, dropdowns                  |
| `shadow-lg`   | `0 8px 24px rgba(45,52,54,0.12)`  | Modals, popovers                  |
| `shadow-xl`   | `0 16px 48px rgba(45,52,54,0.16)` | Overlays, toasts                  |
| `shadow-glow` | `0 0 24px rgba(91,168,160,0.2)`   | Active states, premium highlights |

---

## Component Library

### Buttons

**Primary Button (Seafoam)**

- Background: `#5BA8A0`
- Text: `#FFFFFF`
- Border radius: `radius-full` (pill shape)
- Padding: `12px 24px`
- Font: `body-md`, weight 600
- Hover: darken 10%, subtle glow shadow
- Active: scale 0.98
- Loading: spinner overlay, 50% opacity

**Secondary Button (Coral)**

- Background: transparent
- Border: 2px solid `#E8917A`
- Text: `#E8917A`
- Same shape and padding as primary
- Hover: fill with `#E8917A`, text white

**Tertiary Button (Ghost)**

- Background: `rgba(255,255,255,0.1)` + `backdrop-filter: blur(10px)`
- Text: `#2D3436`
- Border: 1px solid `rgba(255,255,255,0.2)`
- Hover: increase background opacity to 0.2

**Floating Action Button (FAB)**

- Size: 56px × 56px
- Shape: Circle (`radius-full`)
- Background: `#5BA8A0`
- Icon: white, 24px
- Shadow: `shadow-lg`
- Position: Bottom-right, 24px from edges

### Cards

**Recipe Card**

- Background: `#FFFFFF` or `rgba(255,255,255,0.85)` with `backdrop-filter: blur(16px)`
- Border radius: `radius-lg` (16px)
- Shadow: `shadow-md`
- Image aspect ratio: 4:3, `radius-lg` top corners
- Padding: `space-4` (16px)
- Content: Title (heading-sm), metadata row (time, servings, difficulty), tags row
- Hover: lift with `shadow-lg`, scale 1.02
- Premium badge: gold dot or "PRO" pill in top-right

**Meal Plan Card**

- Horizontal layout: date circle + meal slots
- Date circle: 48px, `#5BA8A0` background, white text
- Slots: breakfast, lunch, dinner, snack — each a mini recipe card or empty state
- Empty slot: dashed border, "+" icon, "Add meal" label
- Past days: 50% opacity, strikethrough

**Grocery Item Card**

- Checkbox left: 24px, `#5BA8A0` when checked
- Content: ingredient name (body-md), quantity/notes (body-sm, slate)
- Right: category icon (produce, dairy, etc.) or online order status
- Checked state: strikethrough, 50% opacity, checkbox filled

**Nutrition Summary Card**

- Background: `rgba(255,255,255,0.1)` + `backdrop-filter: blur(20px)`
- Border: 1px solid `rgba(255,255,255,0.15)`
- Radial progress rings: calories, protein, carbs, fat
- Color coding: protein = `#5BA8A0`, carbs = `#8ECAE6`, fat = `#E8917A`
- Goal vs. actual: inner ring = goal, outer ring = current

### Inputs

**Text Field**

- Background: `rgba(255,255,255,0.6)` + `backdrop-filter: blur(8px)`
- Border: 1px solid `rgba(178,190,195,0.3)`
- Border radius: `radius-md` (8px)
- Padding: `12px 16px`
- Focus: border color `#5BA8A0`, subtle glow
- Error: border `#E17055`, error message below in `#E17055`
- Placeholder: `#636E72` italic

**Search Bar**

- Height: 48px
- Icon: Search (20px, `#636E72`) left
- Background: `rgba(255,255,255,0.8)` + `backdrop-filter: blur(12px)`
- Border radius: `radius-full`
- Shadow: `shadow-sm`
- Clear button (X) appears when text entered

**Ingredient Input (Recipe Creation)**

- Inline autocomplete dropdown
- Quantity + unit + ingredient name in one row
- Suggestions appear below with USDA database matches
- Confidence indicator: green dot = confirmed, yellow = ambiguous, red = not found

### Navigation

**Bottom Tab Bar (Mobile)**

- Background: `rgba(255,255,255,0.85)` + `backdrop-filter: blur(20px)` + `saturate(150%)`
- Height: 64px + safe area
- 5 tabs: Home, Recipes, Meal Plan, Grocery, Profile
- Active: `#5BA8A0` icon + label
- Inactive: `#636E72`
- Floating center button (optional): Meal plan quick-add

**Side Navigation (Web)**

- Width: 240px collapsed, 280px expanded
- Background: `rgba(255,255,255,0.1)` + `backdrop-filter: blur(16px)`
- Logo at top, nav items with icons
- Active item: `#5BA8A0` left border + background highlight
- Collapse toggle at bottom

**Top App Bar**

- Background: transparent initially, `rgba(250,246,240,0.9)` + `backdrop-filter: blur(16px)` on scroll
- Height: 56px
- Left: Menu/hamburger or back arrow
- Center: Page title or logo
- Right: Search icon, notifications bell (with badge), profile avatar

### Lists & Collections

**Recipe Grid**

- Mobile: 2 columns, gap `space-3`
- Tablet: 3 columns
- Desktop: 4 columns
- Pull-to-refresh: spinner with `#5BA8A0`
- Infinite scroll: skeleton cards at bottom

**Collection/List View Toggle**

- Toggle buttons: grid icon vs. list icon
- List view: horizontal cards with image left (1:1), content right

**Sort/Filter Bar**

- Sticky below app bar
- Chips: "Recent", "Favorites", "Drafts", "Public", "Private"
- Active chip: `#5BA8A0` background, white text, pill shape
- Filter button right: filter icon + "Filter" label

### Modals & Overlays

**Bottom Sheet (Mobile)**

- Background: `#FFFFFF`
- Border radius: `radius-xl` (24px) top corners
- Drag handle: 36px wide, 4px tall, `#B2BEC3`, centered top
- Backdrop: `rgba(45,52,54,0.5)`
- Max height: 85% viewport
- Snap points: 25%, 50%, 85%

**Centered Modal (Web)**

- Max width: 560px
- Background: `#FFFFFF`
- Border radius: `radius-lg`
- Shadow: `shadow-xl`
- Backdrop: `rgba(45,52,54,0.6)` + `backdrop-filter: blur(4px)`

**Toast Notification**

- Background: `#2D3436` (dark) or `#5BA8A0` (success)
- Text: white
- Border radius: `radius-md`
- Position: top-center (web) or bottom (mobile)
- Auto-dismiss: 4 seconds
- Icon left: checkmark, warning, or info

### Progress & Loading

**Skeleton Loader**

- Base: `#F5F5F5`
- Shimmer: `#FFFFFF` to `#F5F5F5` animation
- Border radius matches content type

**Circular Progress**

- Size: 40px (small), 64px (medium), 120px (large)
- Stroke: `#5BA8A0`
- Track: `rgba(91,168,160,0.2)`
- Cooking timer: countdown display in center

**Linear Progress**

- Height: 4px
- Fill: `#5BA8A0`
- Track: `rgba(91,168,160,0.2)`
- Indeterminate: animated shimmer

---

## Screen Designs

### Screen 1: Splash / Onboarding

**Purpose**: First impression, brand introduction, value proposition.

**Layout**:

- Full-screen background: beach/summer lifestyle photo or gradient
- Centered: Commise logo (wordmark with chef hat icon)
- Tagline: "Cook with confidence. Plan with ease." (display-md, white, text-shadow)
- Below: 3 value prop pills with icons: "Save recipes", "Plan meals", "Shop smarter"
- Bottom: "Get Started" primary button (full width, 56px tall)
- Below button: "Already have an account? Sign In" (body-sm, white)

**States**:

- Loading: Logo pulse animation
- First launch: Swipeable onboarding carousel (3 slides)
- Return visit: "Welcome back" + sign-in shortcut

---

### Screen 2: Sign-In / Authentication

**Purpose**: Login, signup, social auth.

**Layout**:

- Top: "Welcome back" or "Create account" (display-md)
- Subtitle: "Your kitchen, organized." (body-lg, slate)
- Social login buttons (stacked, full width):
    - "Continue with Google" (white, Google icon)
    - "Continue with Apple" (black, Apple icon) — iOS only
    - "Continue with Facebook" (blue, Facebook icon)
- Divider: "or" with horizontal lines
- Email input field
- Password input field (with show/hide toggle)
- "Forgot password?" link (body-sm, `#5BA8A0`)
- Primary button: "Sign In" or "Create Account"
- Bottom: Toggle text "Don't have an account? Sign Up" / "Already have an account? Sign In"

**States**:

- Loading: Button spinner, disabled inputs
- Error: Inline error message, input border red
- Success: Redirect to Home with toast
- Session restore: "Restoring your session..." spinner

---

### Screen 3: Signed-In Home Dashboard

**Purpose**: Personalized launchpad, not generic. Every session starts here.

**Layout**:

- Scrollable vertical layout
- **Welcome header**: "Good morning, [Name]!" (heading-lg) + date
- **Continue/Resume card** (if active):
    - Background: `rgba(91,168,160,0.15)` + `backdrop-filter: blur(12px)`
    - Content: "Resume cooking [Recipe Name]" with progress bar
    - Right: Recipe thumbnail
    - Action: "Continue" button
- **This week's meal plan** (compact):
    - Horizontal scroll: 7 day cards
    - Today highlighted with `#5BA8A0` border
    - Empty slots show "+" with dashed border
    - Tap expands to meal plan detail
- **Recent recipes** (horizontal scroll):
    - 4 recipe cards, compact size
    - "See all" link right
- **Shopping status**:
    - Card: "You have 12 items on your list"
    - Progress bar: 8/12 checked
    - Action: "View list" button
- **Nutrition snapshot** (if configured):
    - Mini radial chart: calories today vs. goal
    - Text: "1,240 / 2,000 cal"
    - Link: "View details"
- **Explore section**:
    - "Trending recipes" or "Seasonal picks"
    - 2-3 featured recipe cards with large images
- **AI suggestion** (premium):
    - Card: "Try a Mediterranean bowl based on your recent meals"
    - "Generate recipe" button
- **Premium nudge** (free tier, max once per session):
    - Banner at bottom: "Upgrade for unlimited meal plans and AI recipes"
    - "Learn more" link, dismissible X

**States**:

- New user: Starter checklist (5 steps: add first recipe, plan a meal, make a list, cook something, set nutrition goal)
- No meal plan: "Start planning your week" CTA card
- Active cooking: Resume card prominently displayed
- Customized: Modules reordered per user preference
- Offline: Cached data with "Last updated [time]" badge
- Premium: No nudge, AI features unlocked

---

### Screen 4: Recipe Library

**Purpose**: Discover, organize, and manage recipes.

**Layout**:

- Top: Search bar (sticky)
- Filter bar: "All", "Recent", "Favorites", "My Recipes", "Public", "Drafts", "AI Generated"
- Sort: Grid/list toggle, sort by recent/name/date created
- Recipe grid (main content):
    - Recipe cards in responsive grid
    - Image 4:3, title, cook time, difficulty badge, rating
    - Long-press (mobile) or right-click (web): context menu (Edit, Delete, Share, Add to collection)
- Bottom sheet (mobile) or sidebar (web): Filter panel
    - Categories: Breakfast, Lunch, Dinner, Dessert, Snack, Drink
    - Dietary: Vegetarian, Vegan, Gluten-Free, Keto, etc.
    - Time: Under 15 min, 15-30 min, 30-60 min, 60+ min
    - Source: Manual, Imported, AI Generated, Cloned
    - Difficulty: Easy, Medium, Hard
- FAB: "+" for create/import recipe

**States**:

- Empty: "No recipes yet" with illustration, "Add your first recipe" CTA
- Search no results: "No recipes found for 'query'", suggestion chips
- Loading: Skeleton grid (6 cards)
- Import in progress: Toast "Importing from URL..."
- Filter active: Chip bar showing active filters, "Clear all" link

---

### Screen 5: Recipe Detail

**Purpose**: View, cook, plan, and share a single recipe.

**Layout**:

- Hero image: Full width, 16:9, parallax scroll effect
- Floating back button top-left (liquid glass circle)
- Floating share/bookmark buttons top-right
- Title: Recipe name (display-lg, Playfair Display serif)
- Metadata row: Author avatar + name, date, visibility badge (Public/Private/Shared)
- Action bar (sticky on scroll):
    - "Cook" primary button
    - "Add to Meal Plan" secondary button
    - "Add to List" ghost button
    - "Share" icon button
- Stats row: Prep time, cook time, total time, servings, difficulty, calories
- Tags: Chips for categories and dietary labels
- Description: Body text, expandable
- Ingredients section:
    - "Scale: 1x 2x 3x" segment control
    - Checklist: Each ingredient with checkbox (for shopping)
    - Checked ingredients move to bottom with strikethrough
    - USDA match status: green/yellow/red dot per ingredient
- Instructions section:
    - Numbered steps
    - Each step: text + optional image
    - "Start Cooking Mode" button at bottom
- Nutrition section (expandable):
    - Per-serving breakdown: calories, protein, carbs, fat, fiber, sodium
    - Chart: macro distribution pie chart
    - Disclaimer: "Nutritional estimates only — not medical advice"
- Versions section (if premium):
    - Timeline: "Version 3 (today)", "Version 2 (2 days ago)", "Original"
    - Diff view: what changed
- Source/Attribution (if imported):
    - "Imported from [Source]" with link
    - Confidence badge: High/Medium/Low
- Comments (if public):
    - Thread below recipe
    - "Add comment" input

**States**:

- Private recipe (free tier): Banner "Upgrade to keep recipes private"
- AI-generated: "Generated by AI" badge, confidence score, edit prompt
- Imported: "Imported from [URL]", original link, import confidence
- Nutrition pending: "Calculating nutrition..." spinner
- Offline: Cached recipe with "Offline mode" badge
- Cooking active: "Cooking now — [step 3 of 8]" persistent mini-bar

---

### Screen 6: Create/Edit Recipe

**Purpose**: Add or modify recipes with structured data.

**Layout**:

- Top: "New Recipe" or "Edit [Name]" (heading-lg)
- Progress indicator: "Details → Ingredients → Steps → Review" (web) or step dots (mobile)
- **Details tab**:
    - Title input
    - Description textarea
    - Photo upload: Grid of 1-6 photos, drag to reorder, star primary
    - Yield: Servings input + scale notes
    - Time: Prep, cook, total (auto-calculated)
    - Difficulty: Easy/Medium/Hard segment
    - Category tags: Multi-select chips
    - Visibility: Public/Private toggle (premium: private; free: public only)
- **Ingredients tab**:
    - Reorderable list (drag handle left)
    - Each row: quantity + unit dropdown + ingredient name + USDA match status
    - "Add ingredient" button below
    - Autocomplete suggestions for ingredient names
    - "Parse from text" button: Paste unstructured ingredient list, AI parses
- **Steps tab**:
    - Numbered list, reorderable
    - Each step: text area + optional photo
    - "Add step" button
    - "Add timer" button: Embeds timer in step
    - "Add tip" button: Highlighted callout within step
- **Review tab**:
    - Preview of recipe card
    - "Save as draft" or "Publish" buttons
    - Nutrition calculation status

**States**:

- Draft: "Auto-saved [time ago]" label
- AI parse loading: "Parsing ingredients..." spinner
- USDA match warning: "Some ingredients need verification" with list
- Photo upload: Progress bar per image, thumbnail preview
- Validation error: Missing title or ingredients — inline error
- Conflict (edit while offline): "This recipe was modified elsewhere" with diff options

---

### Screen 7: Meal Planning

**Purpose**: Calendar-based meal planning with grocery integration.

**Layout**:

- Top: Month/week toggle, "Today" button
- Calendar grid (main view):
    - 7 columns (Mon-Sun), time-based rows optional
    - Each cell: date number + meal slots
    - Today: `#5BA8A0` circle around date
    - Past: 50% opacity
    - Future: Full opacity
- Meal slot cards within cells:
    - Breakfast, lunch, dinner, snack rows
    - Filled: Recipe thumbnail (tiny) + name truncated
    - Empty: "+" with dashed border, tap to add
- Bottom sheet: "Add to meal plan" (recipe picker)
    - Search, recent recipes, collections
    - Tap recipe → select day → select meal type
- Week view (toggle):
    - Horizontal scroll: 7 day columns
    - Each column: stacked meal cards
    - Drag meals between days
- Grocery list preview (bottom):
    - "Shopping for [Date range]: X items"
    - "Generate list" button

**States**:

- Empty week: "Plan your week" with suggested template chips ("Family dinners", "Meal prep Sunday", "Quick weeknights")
- Template applied: "Applied 'Family dinners' template — 5 recipes added"
- Conflict: "This day already has [Meal] assigned. Replace or keep both?"
- Past due: "You missed planning [Day]. Add retroactively?"
- Nutrition goal conflict: "This day's meals exceed sodium goal. Adjust?"

---

### Screen 8: Grocery List

**Purpose**: Shopping list management with online ordering.

**Layout**:

- Top: List name ("This week's shopping"), item count, estimated total
- Filter tabs: "All", "Need", "Checked", "Online Order"
- Sort: "By aisle" (default), "By recipe", "By store"
- Item list (main):
    - Grouped by category: Produce, Dairy, Meat, Pantry, Frozen, etc.
    - Category header: sticky, colored dot indicator
    - Each item: checkbox + name + quantity/notes + recipe tag (small)
    - Checked items: move to bottom, 50% opacity, strikethrough
    - Swipe right (mobile): Quick check
    - Swipe left: More (Edit, Delete, Move to another list)
- Add item: Inline input at top or FAB
- Online order status (if linked):
    - Store selector: Instacart, Amazon Fresh, etc.
    - Cart sync: "8 items in Instacart cart"
    - Order status: "Ordered", "Out for delivery", "Delivered"
- Bottom bar:
    - "Check all" / "Uncheck all"
    - "Clear checked" (removes checked items)
    - "Share list" button

**States**:

- Empty: "Your list is empty" with "Add from meal plan" CTA
- Offline: "List available offline" badge
- Shared: "Shared with [Name]" — live sync indicator
- Order placed: Status banner with tracking link
- Recipe removed: "Items from [Recipe] removed. Keep in list?"

---

### Screen 9: Cooking Mode

**Purpose**: Focused, hands-free recipe execution.

**Layout**:

- Full-screen, minimal chrome
- Top bar (auto-hides after 3s, tap to show):
    - Recipe title (small)
    - Timer (if active)
    - "Exit" button
- Step display (center):
    - Current step number and total ("Step 3 of 12")
    - Step text (display-md, large, readable from distance)
    - Step image (if any)
    - Ingredient highlights: Tap to see quantity
- Navigation:
    - Large tap areas: Left half = previous, Right half = next
    - Swipe gestures: Up = next, Down = previous
    - Or visible buttons: "← Previous" and "Next →"
- Timer integration:
    - Embedded timers in steps ("Simmer for 15 min")
    - Tap timer → starts countdown with large display
    - Background timer: Keeps running if app backgrounded
- Voice mode (optional, premium):
    - "Read step aloud" button
    - "Next step" voice command
- Ingredients sidebar (swipe from left):
    - Checklist of all ingredients
    - Tap to mark "used"
- Notes (swipe from right):
    - Scratchpad for cooking notes
    - Saved to recipe version history
- Completion:
    - "Done!" celebration animation (confetti or checkmark)
    - Rate recipe: 1-5 stars
    - "Add note" prompt
    - "Share result" photo prompt

**States**:

- Phone locked: Audio guidance continues (if premium)
- Backgrounded: Timer notifications, step change notifications
- Interruption: "Resume cooking?" on return
- Ingredient missing: "You don't have [ingredient] — add to list?"
- Timer done: Full-screen alert + vibration + sound

---

### Screen 10: Nutrition Planning

**Purpose**: Set goals, track compliance, view trends.

**Layout**:

- Top: Date range selector (Today, This week, This month)
- Summary cards (top row):
    - Calories: Radial progress, actual vs. goal
    - Protein, carbs, fat: Mini progress bars
    - Weight/wellness: Optional manual entry
- Daily breakdown (list):
    - Each day: date + calorie bar + meal thumbnails
    - Tap → day detail view
- Goal settings (tab or bottom sheet):
    - Goal type: Lose weight, Maintain, Gain muscle, Custom
    - Calories: Manual or calculated from TDEE
    - Macros: Slider allocation (protein/carbs/fat %)
    - Micronutrients: Optional (iron, calcium, etc.)
    - Dietary restrictions: Allergies, intolerances
- Insights (AI, premium):
    - "You're consistently under protein on Tuesdays"
    - Suggestion: "Try adding Greek yogurt to your breakfast routine"
- Chart view (toggle):
    - Line chart: Calories over time
    - Bar chart: Macro distribution over week
    - Comparison: You vs. goal bands

**States**:

- No goals set: "Set your nutrition goals" CTA with wizard
- Goal met: Green checkmark, "Great job today!"
- Goal exceeded: Gentle warning (not punitive), "Tomorrow is a new day"
- Data incomplete: "Some meals missing nutrition data" with list
- Medical disclaimer: Persistent footer "Not medical advice. Consult a professional."

---

### Screen 11: AI Recipe Generation

**Purpose**: Generate recipes from prompts, with user control.

**Layout**:

- Top: "AI Recipe Creator" (heading-lg) with sparkle icon
- Prompt input:
    - Large text area: "Describe what you want to cook..."
    - Placeholder examples (rotating): "A quick weeknight pasta with spinach", "Something spicy and vegetarian for 4 people", "Use chicken, broccoli, and rice"
    - Character count / token limit indicator
- Parameter chips (below input):
    - Servings: 1, 2, 4, 6, 8+
    - Time: Under 15 min, 15-30 min, 30-60 min, No limit
    - Difficulty: Easy, Medium, Any
    - Dietary: Vegetarian, Vegan, Gluten-free, etc.
    - Style: Italian, Asian, Mexican, Mediterranean, Fusion, etc.
- "Generate" primary button (disabled until prompt entered)
- History (below):
    - Previous generations with status
    - "Reuse prompt" button
- Results (new screen):
    - Generated recipe card with "AI Generated" badge
    - Confidence score: High/Medium/Low
    - Nutrition estimate: Preliminary (pending calculation)
    - Actions: "Save to my recipes", "Edit", "Regenerate", "Discard"
    - Disclaimer: "AI-generated recipes may need adjustment. Always verify ingredients and cooking times."

**States**:

- Generating: Full-screen spinner with "Cooking up something delicious..." + progress steps
- Rate limit: "You've used 3/5 free generations today. Upgrade for unlimited."
- Low confidence: "This recipe may need refinement. Review carefully."
- Save prompt: "Name this recipe" input, default = generated title
- Premium gate: "AI generation is a premium feature" with upgrade CTA

---

### Screen 12: Subscription / Paywall

**Purpose**: Convert free users to premium, manage subscription.

**Layout**:

- Top: "Unlock your full kitchen potential" (display-md)
- Visual: Split screen — left: free features list (greyed), right: premium features (vibrant)
- Tier cards (stacked vertically, mobile) or side-by-side (web):
    - **Free**: $0 — Basic recipes, public only, 3 meal plans, basic nutrition
    - **Pro**: $9.99/mo or $79.99/yr — Private recipes, unlimited meal plans, AI generation, nutrition insights, offline cooking
    - **Family**: $14.99/mo — Everything in Pro + 5 profiles, shared meal plans, collaborative grocery lists
- Feature comparison table (expandable):
    - Checkmarks for each tier per feature
    - "Most popular" badge on Pro tier
- CTA: "Start free trial" (7 days) or "Subscribe now"
- Payment form (inline or modal):
    - Apple Pay / Google Pay buttons
    - Credit card fields
    - Billing address
- FAQ accordion below:
    - "Can I cancel anytime?", "What happens to my recipes?", etc.
- Bottom: "Restore purchases" link

**States**:

- Active subscriber: "Your Pro subscription renews on [Date]"
- Expired: Grace period banner "Renew to keep your private recipes"
- Trial active: "5 days left in your free trial"
- Family invite: "Invite family members" with email input
- Promotional: "50% off first year" banner with countdown

---

### Screen 13: Profile & Settings

**Purpose**: Manage account, preferences, data.

**Layout**:

- Top: Profile header
    - Avatar (uploadable, default: initials in colored circle)
    - Name, email, join date
    - Tier badge: Free / Pro / Family
- Settings sections (grouped list):
    - **Account**: Edit profile, change password, linked accounts, connected agents
    - **Preferences**: Units (metric/imperial), default servings, dietary defaults, notification settings
    - **Notifications**: Push, email, SMS toggles for meal reminders, grocery reminders, cooking timers, weekly summary
    - **Privacy**: Recipe visibility default, data export, account deletion
    - **Subscription**: Current plan, billing history, change plan, cancel
    - **Help**: FAQ, contact support, report bug
    - **About**: App version, terms, privacy policy, credits
- Data export:
    - "Export my recipes" button → JSON/PDF/Markdown options
    - Progress indicator for large exports

**States**:

- Unsaved changes: "Save changes?" confirmation on back
- Account deletion: Multi-step confirmation with data retention notice
- Data export: "Preparing your export..." spinner, then download link
- Offline: Read-only for server-dependent settings

---

### Screen 14: Empty States (Global)

All empty states should be consistent:

- **Illustration**: Warm, friendly line art or soft 3D render (beach/cooking theme)
- **Title**: Friendly, actionable (e.g., "No recipes yet")
- **Subtitle**: Explain the value prop (e.g., "Save your favorite recipes to build your personal cookbook")
- **CTA**: Primary button to take the first action
- **Secondary**: Link to learn more or example content

Examples:

- No recipes: Chef hat illustration + "Start your cookbook" + "Add recipe" button
- No meal plan: Calendar illustration + "Plan your week" + "Create plan" button
- No grocery list: Shopping bag illustration + "Build your shopping list" + "Add items" button
- No nutrition data: Apple/heart illustration + "Set your goals" + "Get started" button
- Offline: Cloud illustration + "You're offline" + "Cached data available" subtitle

---

### Screen 15: Error States (Global)

- **Toast errors**: Brief, auto-dismiss, red left border
- **Inline errors**: Red text below input, red border
- **Screen errors**: Centered illustration + message + retry button
- **Offline banner**: Top of screen, amber, "Working offline — changes will sync when connected"

---

## Web vs. Mobile Variants

### Web-Specific Patterns

- **Side navigation**: Persistent left sidebar, collapsible
- **Multi-column layouts**: Recipe grid 3-4 columns, dashboard modules in grid
- **Hover states**: Lift cards, show action buttons, preview tooltips
- **Keyboard shortcuts**: `/` for search, `Esc` to close modals
- **Context menus**: Right-click on recipes for quick actions
- **Drag and drop**: Reorder meal plan days, sort ingredients
- **Resizable panels**: Split view in cooking mode (recipe left, timer right)

### Mobile-Specific Patterns

- **Bottom sheets**: Filter, add to meal plan, share
- **Swipe gestures**: Check grocery items, navigate cooking steps
- **Pull-to-refresh**: Standard on all scrollable lists
- **Haptic feedback**: On step completion, timer done, button presses
- **Safe area insets**: Respect notch, home indicator
- **Floating action buttons**: Create recipe, add to meal plan
- **Tab bar**: 5-item bottom navigation

---

## Accessibility (WCAG 2.1 AA)

- **Contrast**: Minimum 4.5:1 for body text, 3:1 for large text/UI components
- **Color independence**: Never rely on color alone — always pair with icon or label
- **Touch targets**: Minimum 44×44px for interactive elements
- **Screen reader support**: All images have alt text, all buttons have labels
- **Focus indicators**: Visible focus rings (2px solid `#5BA8A0`) for keyboard navigation
- **Reduced motion**: Disable animations for `prefers-reduced-motion`
- **Reduced transparency**: Solid backgrounds for `prefers-reduced-transparency`
- **Text scaling**: Support up to 200% text size without breaking layout
- **Liquid glass fallback**: When transparency is reduced, use solid `#FAF6F0` backgrounds

---

## Animation & Motion

### Micro-interactions

- **Button press**: Scale to 0.96, spring back
- **Card hover**: Lift 4px, shadow increase, 200ms ease-out
- **Checkbox check**: Spring animation with checkmark stroke drawing
- **Toggle switch**: 150ms ease, background color transition
- **FAB press**: Ripple effect from center

### Transitions

- **Page push**: Slide from right (mobile), fade + scale (web)
- **Modal**: Backdrop fade 200ms, content scale from 0.95 + fade
- **Bottom sheet**: Slide up with spring physics
- **List item add**: Slide down + fade in, push existing items
- **List item remove**: Slide left + fade out, collapse height

### Loading States

- **Skeleton shimmer**: `#F5F5F5` base, white highlight sweeping left to right, 1.5s loop
- **Spinner**: `#5BA8A0` stroke, 2s infinite rotation
- **Progress bar**: Animated fill, smooth 300ms transitions

### Celebratory

- **Cooking complete**: Confetti burst (subtle, 2s), checkmark scale bounce
- **Goal met**: Gentle pulse glow on achievement element
- **First recipe saved**: "Welcome to your cookbook!" modal with illustration

---

## File Structure for Figma

```
Commise Design System
├── 🎨 Color Tokens
│   ├── Primary (Seafoam, Coral, Sand, Sky)
│   ├── Neutrals (White to Charcoal)
│   ├── Semantics (Success, Warning, Error, Premium)
│   └── Gradients
├── 📝 Typography
│   ├── Display (xl, lg, md)
│   ├── Headings (lg, md, sm)
│   ├── Body (lg, md, sm)
│   └── Special (caption, overline, monospace)
├── 📐 Spacing & Layout
│   ├── Space scale (1-9)
│   ├── Border radius (sm to full)
│   └── Shadows (sm to glow)
├── 🧩 Components
│   ├── Buttons (Primary, Secondary, Tertiary, FAB, Icon)
│   ├── Inputs (Text, Search, Textarea, Select, Checkbox, Radio)
│   ├── Cards (Recipe, Meal Plan, Grocery, Nutrition, Empty)
│   ├── Navigation (Top bar, Side nav, Bottom tab, Breadcrumbs)
│   ├── Lists (Recipe grid, Grocery list, Meal slots)
│   ├── Modals (Centered, Bottom sheet, Toast, Tooltip)
│   ├── Progress (Spinner, Skeleton, Linear, Circular)
│   └── Badges & Chips (Category, Status, Premium, Notification)
└── 📱 Screens
    ├── Web
    │   ├── Splash / Onboarding
    │   ├── Sign In / Sign Up
    │   ├── Home Dashboard
    │   ├── Recipe Library
    │   ├── Recipe Detail
    │   ├── Create/Edit Recipe
    │   ├── Meal Planning
    │   ├── Grocery List
    │   ├── Cooking Mode
    │   ├── Nutrition Planning
    │   ├── AI Generation
    │   ├── Subscription / Paywall
    │   ├── Profile & Settings
    │   └── Empty & Error States
    └── Mobile
        ├── Splash / Onboarding
        ├── Sign In / Sign Up
        ├── Home Dashboard
        ├── Recipe Library
        ├── Recipe Detail
        ├── Create/Edit Recipe
        ├── Meal Planning
        ├── Grocery List
        ├── Cooking Mode
        ├── Nutrition Planning
        ├── AI Generation
        ├── Subscription / Paywall
        ├── Profile & Settings
        └── Empty & Error States
```

---

## Final Notes for Implementation

1. **Food photography first**: Design must showcase food beautifully. UI elements should complement, not compete with, recipe imagery.
2. **Liquid glass as enhancement, not obstruction**: Translucent layers should feel premium but never make text hard to read or food hard to see.
3. **Summer warmth everywhere**: Even error states and empty states should feel warm and inviting, never cold or punitive.
4. **Progressive disclosure**: Don't show everything at once. Reveal features as users need them (e.g., nutrition details only if user sets goals).
5. **Platform-native feel**: Web should feel like a modern web app; mobile should feel native to iOS/Android while maintaining visual consistency.
6. **Performance-aware**: Heavy blur effects should degrade gracefully on lower-end devices (reduce blur radius, increase opacity).
7. **Test with real recipes**: Use actual recipe content (ingredients, steps, photos) in mockups to validate readability and layout.

---

_Generated for Apron/Commise by the UX team (DIR-UX-1, UXR-1, UX-ENG-1) based on comprehensive product documentation review and market research._
_Design direction: Liquid glass + "Summer at the beach" aesthetic_
_Target: Figma Make high-fidelity mockup generation_
