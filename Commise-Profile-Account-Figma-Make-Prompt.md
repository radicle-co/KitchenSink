# Commise — Profile & Account Page

## Figma Make Design Prompt

---

## Design System Context

**Product**: Commise — A recipe-centered cooking workflow platform. This page serves **dual purpose**: it's both the user's **public profile** (identity, recipes, collections) AND their **private account settings** (configuration, security, subscription, data). It must seamlessly blend personal identity management with account administration without feeling cluttered.

**Aesthetic**: "Summer at the Beach" — Warm, light, breezy, relaxing. Like cooking with the windows open on a perfect summer afternoon. Effortless, inviting, fresh, calming.

**Liquid Glass**: `backdrop-filter: blur(16px) saturate(150%)` on `rgba(255,255,255,0.15)` surfaces. Controls highest blur/opacity, cards medium, background lowest. Text scrims behind text on blurred backgrounds for WCAG contrast.

### Color Tokens

| Token                | Hex       | Usage                                                                 |
| -------------------- | --------- | --------------------------------------------------------------------- |
| `--color-seafoam`    | `#5BA8A0` | Primary actions, CTAs, active states, accent, avatar initials         |
| `--color-coral`      | `#E8917A` | Destructive actions, highlights, warm accents, danger zone, allergies |
| `--color-sand`       | `#FAF6F0` | Page backgrounds, surfaces, warm base                                 |
| `--color-sky`        | `#8ECAE6` | Secondary accents, info states, links, calm indicators                |
| `--color-white`      | `#FFFFFF` | Cards, modals, high-contrast text                                     |
| `--color-charcoal`   | `#2D3436` | Primary text, headings                                                |
| `--color-slate`      | `#636E72` | Secondary text, captions, disabled, placeholders                      |
| `--color-mist`       | `#B2BEC3` | Borders, dividers, inactive states                                    |
| `--color-pearl`      | `#F5F5F5` | Subtle backgrounds, hover states, skeleton base                       |
| `--color-ocean-dark` | `#2A6B65` | Primary text on light backgrounds                                     |
| `--color-success`    | `#4CAF7C` | Success states, verified badges, saved confirmation                   |
| `--color-warning`    | `#F5B041` | Warnings, pending states, unverified email                            |
| `--color-error`      | `#E17055` | Errors, destructive actions, form validation                          |
| `--color-premium`    | `#D4A574` | Premium/gold tier indicators, Pro badge                               |

**Page Background**: `linear-gradient(135deg, #FAF6F0 0%, #F0F7F4 50%, #E8F4F8 100%)`

### Typography

- **Body**: Inter, weight 400/500/600
- **Headings**: Playfair Display, weight 600/700 — elegant, warm serif
- **Monospace**: SF Mono for stats, metadata, codes

| Token        | Size | Weight | Usage                              |
| ------------ | ---- | ------ | ---------------------------------- |
| `display-lg` | 36px | 700    | Page heading "Profile & Account"   |
| `heading-lg` | 24px | 600    | Display name, section titles       |
| `heading-md` | 20px | 600    | Subsection headings                |
| `heading-sm` | 18px | 500    | Card titles, labels                |
| `body-lg`    | 18px | 400    | Lead text, descriptions            |
| `body-md`    | 16px | 400    | Primary body text, form labels     |
| `body-sm`    | 14px | 400    | Secondary text, metadata, captions |
| `caption`    | 12px | 500    | Timestamps, badges, join date      |
| `overline`   | 11px | 600    | Uppercase labels, section headers  |

### Spacing & Shape

- Base unit: 8px. Cards use `space-4` (16px) padding. Sections use `space-5` (24px) gap.
- **Pills**: `radius-full` (avatars, buttons, chips, badges)
- **Cards**: `radius-lg` (16px)
- **Inputs**: `radius-md` (8px)
- **Shadows**: Cards use `shadow-md` (`0 4px 12px rgba(45,52,54,0.08)`). Modals use `shadow-lg`.

---

## Page Architecture

### Dual-Purpose Layout

The page is organized into **two logical zones** that visually flow as one:

1. **Profile Zone** (top): Public-facing identity card + stats
2. **Account Zone** (below): Grouped settings sections

### Web Layout (Desktop)

- **Two-column layout on large screens (1024px+)**:
    - **Left column** (320px, sticky/fixed): Profile card with avatar, display name, username, bio, stats, public toggle, profile URL. This is the user's "identity anchor."
    - **Right column** (flexible, scrollable): All account settings sections stacked vertically with `space-5` (24px) gap between cards.
- **Side Navigation** (left edge, 240px): Vertical list of section anchors — Profile, Personal Info, Login & Security, Preferences, Notifications, Privacy, Subscription, Data & Export. Active item highlighted with seafoam left border + background highlight.
- **Top bar**: "← Back to Commise" link (body-sm, seafoam) + page title "Profile & Account" (heading-lg).
- **Bottom sticky bar** (appears when pending changes): "You have unsaved changes" with "Save" (primary seafoam pill) and "Discard" (tertiary ghost) buttons.

### Mobile Layout

- **Scrollable vertical list**, single column.
- **Sticky header**: Profile card (avatar, name, stats) remains pinned at top while scrolling through settings.
- **Section headers** are collapsible accordions. Tap to expand/collapse.
- **Section index** on right edge: A-Z jump dots for long settings list.
- **Bottom Tab Bar** still visible: Home, Recipes, Meal Plan, Grocery, Profile (Profile active in seafoam).
- **Floating Action Button** (if needed): "Edit Profile" quick action.

---

## Section 1: Profile Card (Public Identity)

**Container**: Liquid glass card — `rgba(255,255,255,0.15)` + `backdrop-filter: blur(16px)`, `radius-lg`, `shadow-md`, padding `space-5` (24px).

### Avatar

- **Size**: 120px × 120px circle (`radius-full`)
- **Default state**: Seafoam circle (`#5BA8A0`) with white initials "JC" (heading-lg, Playfair Display, weight 600)
- **Uploaded state**: Photo fill, circular crop
- **Upload indicator**: Small 32px seafoam circle overlay at bottom-right with white camera icon (20px)
- **Hover/ tap state**: Subtle seafoam glow ring (`shadow-glow`)
- **Web**: Drag-and-drop zone with dashed border (`#B2BEC3`, 2px dashed) and "Drop photo here" text when dragging
- **Mobile**: Tap opens bottom sheet — "Take Photo", "Choose from Library", "Remove Photo" — with `radius-xl` top corners, drag handle, backdrop `rgba(45,52,54,0.5)`

### Display Name

- "Jamie Cooks" — `heading-lg` (24px, Playfair Display, weight 600, charcoal)
- **Editable inline**: Tap → field becomes active input with seafoam border, save (checkmark) and cancel (X) icons appear right. Auto-save on blur or manual save.
- **Placeholder**: "Your display name"

### Username / Handle

- "@jamiecooks" — `body-sm`, slate color
- **Copy button**: Small square 32px button right of handle, ghost style, with copy icon (16px). Tap → icon changes to checkmark for 2 seconds.

### Bio

- Textarea, max 160 characters.
- "Tell us about your cooking style..." — placeholder, slate, italic.
- Character counter: "142/160" in caption, slate, right-aligned below.
- Inline edit: Tap → textarea expands to 3 lines with save/cancel.
- Example filled: "Home cook obsessed with Mediterranean flavors. Weeknight warrior, weekend baker. 🍋🌿"

### Location

- Optional. Inline edit.
- "San Francisco, CA" — `body-sm`, slate, with map-pin icon (16px, slate) left.
- Tap to edit.

### Join Date

- "Member since March 2024" — `caption`, slate, non-editable.
- Small calendar icon left.

### Public Profile Toggle

- **Switch component**: 48px wide, 28px tall, seafoam when ON, mist when OFF.
- Label left: "Public Profile" — `body-md`, charcoal.
- Sublabel below: "Your recipes and collections will appear in public search." — `body-sm`, slate.
- **Mobile**: Haptic feedback on toggle.

### Profile URL

- "commise.app/u/jamiecooks" — `body-sm`, ocean-dark.
- **Copy button**: Same pattern as username copy.
- **Share button** (mobile only): Native share sheet trigger.

### Stats Row

- Horizontal row of 4 stat blocks, evenly spaced, separated by 1px mist dividers.
- Each block: Number (`heading-sm`, charcoal, weight 600) + label (`caption`, slate, uppercase).
    - **47** Recipes
    - **1.2k** Followers
    - **384** Following
    - **156** Total Cooks
- **Tappable**: Each stat block is a button. Tap → opens modal/list of that category.
- **Loading state**: Skeleton shimmer on numbers (pearl base, white shimmer).

---

## Section 2: Personal Information

**Section card**: White background, `radius-lg`, `shadow-md`, padding `space-5`.
**Section header**: "Personal Information" — `heading-md` (20px), charcoal, with user icon (20px, seafoam) left.

### Fields (stacked vertically, `space-3` gap)

**Full Name**

- Label: "Full Name" — `body-sm`, slate, uppercase `overline` style.
- Value: "Jamie Chen" — `body-md`, charcoal.
- Note: "Private — not displayed on your public profile." — `caption`, slate, with lock icon.
- Inline editable.

**Email Address**

- Value: "jamie.chen@email.com" — `body-md`, charcoal.
- **Verified badge**: Green checkmark circle (16px, `#4CAF7C`) + "Verified" — `caption`, success color.
- **Unverified state** (alternate): Warning icon (16px, `#F5B041`) + "Unverified" — `caption`, warning color, with "Resend email" link (body-sm, seafoam) right.

**Phone Number**

- Value: "+1 (415) 555-0192" — `body-md`, charcoal.
- Optional note: "For SMS reminders" — `caption`, slate.
- Edit: Inline or "Add phone number" link if empty.

**Date of Birth**

- Value: "March 15, 1990" — `body-md`, charcoal.
- Optional note: "For age-restricted content if applicable." — `caption`, slate.
- **Mobile**: Native date picker.
- **Web**: Calendar dropdown input.

**Gender / Pronouns**

- Value: "They / them" — `body-md`, charcoal.
- **Options** (dropdown): She/her, He/him, They/them, Custom (opens text field).
- Inclusive language throughout.

---

## Section 3: Login & Security

**Section card**: White background, `radius-lg`, `shadow-md`.
**Section header**: "Login & Security" — `heading-md`, with shield icon (20px, seafoam).

### Password

- Current status: "Last changed 3 months ago" — `body-sm`, slate.
- **Button**: "Change password" — Secondary button (coral outline, pill).
- **Modal** (web: centered, 560px max-width, `shadow-xl`; mobile: bottom sheet, `radius-xl` top):
    - Title: "Change Password" — `heading-lg`.
    - Fields: Current password, New password, Confirm new password.
    - Password strength indicator below new password: Weak (coral) → Fair (warning) → Strong (success) with colored bar.
    - "Forgot current password?" link (body-sm, seafoam).
    - Buttons: "Update Password" (primary, seafoam) + "Cancel" (tertiary).

### Two-Factor Authentication

- **Status row**: Toggle switch + "Enabled" (success) or "Disabled" (slate).
- **When disabled**: "Add an extra layer of security to your account." — `body-sm`, slate.
- **When enabling**: Opens setup flow modal — QR code for authenticator app + backup codes list + "I've saved my backup codes" checkbox.
- **When enabled**: "Active since January 2025" — `caption`, success. "View backup codes" link.

### Linked Accounts

- **Row per provider** (Google, Apple, Facebook):
    - Provider icon (24px) + name — `body-md`, charcoal.
    - Status: "Connected ✓" (success, caption) or "Connect" button (secondary, small).
    - **Disconnect**: "Disconnect" text button (coral, body-sm) if connected.
    - **Disconnect confirmation modal**: "Are you sure? You'll need to use your password to sign in." + "Disconnect" (coral) + "Keep connected" (tertiary).

### Active Sessions

- **List of devices** (max 3 visible, "Show all" link):
    - Device icon (24px, slate) + device name — `body-md`, charcoal.
    - Location + time: "iPhone 15 — San Francisco, CA — Active now" — `body-sm`, slate.
    - Current device badge: "This device" — `caption`, seafoam pill badge.
    - **Revoke button**: "Revoke" text button (coral, body-sm) per device.
- **"Log out all other devices"** link (body-sm, coral) at bottom.
- **Confirmation modal** for revoke all.

### Login History

- Last 3 entries visible:
    - "Mar 15, 2026 — 9:42 AM — San Francisco, CA — Chrome on Mac" — `body-sm`, charcoal.
    - Device icon left.
- **"See full history"** link (body-sm, seafoam) → opens full list modal/table.

---

## Section 4: Preferences

**Section card**: White background, `radius-lg`, `shadow-md`.
**Section header**: "Preferences" — `heading-md`, with sliders icon (20px, seafoam).

### Units

- **Toggle**: Metric / Imperial segmented control.
    - Selected: seafoam background, white text, pill.
    - Unselected: pearl background, charcoal text.
- Note: "Affects all recipes globally." — `caption`, slate.

### Default Servings

- Label: "Default Servings" — `body-md`, charcoal.
- **Number picker**: Horizontal stepper with - / + buttons (36px square, ghost style), number centered (`heading-sm`). Range 1–12, default 4.

### Dietary Preferences

- Label: "Dietary Preferences" — `body-md`, charcoal.
- Subtitle: "These filter recipe suggestions and AI generation defaults." — `body-sm`, slate.
- **Multi-select chips** (wrap in rows, `space-2` gap):
    - Vegetarian, Vegan, Gluten-Free, Dairy-Free, Nut-Free, Keto, Paleo, Halal, Kosher.
    - **Selected**: Seafoam background, white text, pill shape, `radius-full`.
    - **Unselected**: Pearl background, charcoal text, pill shape, 1px mist border.
    - **Web**: Bulk select mode — checkboxes appear on hover/edit mode.

### Allergies

- **Critical safety feature** — highlighted with coral accent.
- Label: "Allergies" — `body-md`, charcoal, with warning icon (16px, coral).
- Subtitle: "Critical for recipe safety. We'll flag recipes containing these ingredients." — `body-sm`, coral.
- **Common allergen chips** (same chip style as dietary preferences, but selected state uses coral background + white text):
    - Peanuts, Tree nuts, Shellfish, Fish, Eggs, Milk, Wheat, Soy.
- **Free-text field**: "Other allergies..." — input field below chips.
- **Mobile**: Extra confirmation dialog on first save: "Please double-check — this affects recipe safety."

### Language

- Label: "Language" — `body-md`, charcoal.
- **Dropdown**: English (selected), Spanish, French, German, Italian, Japanese, Korean, Chinese (Simplified).
- Dropdown style: White background, `shadow-md`, `radius-md`, seafoam selected highlight.

### Timezone

- Label: "Timezone" — `body-md`, charcoal.
- Value: "Pacific Time (PT) — Auto-detected" — `body-sm`, slate.
- **Override link**: "Set manually" (body-sm, seafoam) → opens timezone picker modal.

---

## Section 5: Notifications

**Section card**: White background, `radius-lg`, `shadow-md`.
**Section header**: "Notifications" — `heading-md`, with bell icon (20px, seafoam).

### Master Toggles (3 rows)

Each row: Icon (20px) + label (`body-md`, charcoal) + toggle switch right.

- **Push Notifications** — bell icon
- **Email Notifications** — envelope icon
- **SMS Notifications** — message icon (only if phone number provided; otherwise disabled with "Add phone number" link)

### Sub-options (expandable accordion per master toggle)

When a master toggle is ON, show indented sub-list with individual toggles:

- Meal plan reminders (day before, morning of)
- Grocery list reminders ("Don't forget to shop!")
- Cooking timers ("Your timer is done!")
- Recipe interactions (likes, comments, saves on public recipes)
- Weekly summary ("Your week in review")
- Promotional / offers (can be disabled separately)

**SMS-specific**: Grocery reminders, Timer done.

**Visual**: Sub-list has left indent (`space-4`) and 1px left border (`mist`) to show hierarchy. Each sub-item: label (`body-sm`, charcoal) + toggle (small, 40px wide).

---

## Section 6: Privacy

**Section card**: White background, `radius-lg`, `shadow-md`.
**Section header**: "Privacy" — `heading-md`, with lock icon (20px, seafoam).

### Recipe Visibility Default

- Label: "Default Recipe Visibility" — `body-md`, charcoal.
- **Segmented control**: Public / Private / Unlisted.
    - Public: Seafoam selected.
    - Private: Coral accent (note: "Pro feature" badge if free tier).
    - Unlisted: Slate.
- Note: "Default for new recipes you create." — `caption`, slate.

### Activity Visibility

- Toggle: "Show my cooking activity to followers" / "Hide all activity".
- Label: "Activity Visibility" — `body-md`, charcoal.

### Search Indexing

- Toggle: "Allow search engines to index my public profile."
- Label: "Search Indexing" — `body-md`, charcoal.

### Data Sharing

- Toggle: "Help improve Commise by sharing anonymous usage data."
- Label: "Data Sharing" — `body-md`, charcoal.
- Subtitle: "We never share personal information." — `caption`, slate.

### Blocked Users

- "Blocked Users" — `heading-md`.
- List (empty state or populated):
    - Empty: "No blocked users" — `body-sm`, slate, centered with shield-check icon.
    - Populated: Avatar (32px circle) + name (`body-md`) + "Unblock" button (tertiary, small).

---

## Section 7: Subscription & Billing

**Section card**: White background, `radius-lg`, `shadow-md`.
**Section header**: "Subscription & Billing" — `heading-md`, with star icon (20px, premium gold).

### Current Plan Card

- **Plan badge**: "Pro" — `caption`, uppercase, white text on premium gold (`#D4A574`) background, pill.
    - Free tier: "Free" badge on pearl background, charcoal text.
    - Family tier: "Family" badge on seafoam background, white text.
- **Pricing**: "$6.99/month — Renews Jan 15, 2026" — `body-md`, charcoal.
    - Annual: "$59.99/year — Renews March 2027 (save 29%)".
- **Payment method**: Card icon + "Visa ending in 4242" — `body-sm`, charcoal.
- **Buttons row** (`space-3` gap):
    - "Change plan" — Secondary button (coral outline).
    - "Cancel subscription" — Text button (coral, body-sm).
- **Cancel flow**:
    - Step 1: Retention offer modal — "Here's 50% off to stay!" with "$3.49/month for 3 months" highlighted in seafoam badge.
    - Step 2: If still canceling — "We're sad to see you go. Your Pro features will remain active until Jan 15, 2026."
    - Step 3: Final confirmation — "Cancel subscription" (coral) + "Keep Pro" (primary seafoam).

### Billing History

- **Table/list** (last 3 invoices):
    - Row: Date (`body-sm`, charcoal) + Amount (`body-md`, charcoal, weight 600) + Status badge (`caption`, pill — "Paid" success, "Pending" warning) + PDF download icon (16px, slate).
- **"View all invoices"** link (body-sm, seafoam).

### Family Members (if Family plan)

- "Family Members" — `heading-md`.
- **Member row**: Avatar (32px circle) + name (`body-md`) + role badge (`caption`, pill — "Admin" seafoam, "Member" pearl).
- **Invite button**: "+ Invite member" — Secondary button (small, coral outline).
- **Remove member**: Three-dot menu → "Remove" with confirmation.

### Redeem Code

- "Promo Code" — `body-md`, charcoal.
- **Input field** + "Apply" button (primary, small, seafoam).
- Success: "Code applied! $5.00 off your next month." — `body-sm`, success, with checkmark.
- Error: "Invalid code" — `body-sm`, error.

---

## Section 8: Data & Export

**Section card**: White background, `radius-lg`, `shadow-md`.
**Section header**: "Data & Export" — `heading-md`, with download icon (20px, seafoam).

### Export Recipes

- "Download all your recipes" — `body-md`, charcoal.
- **Format selection** (dropdown or chips): JSON, PDF cookbook, Markdown, CSV (ingredients only).
- **Button**: "Export recipes" — Primary button (seafoam).
- **Progress modal** (when in progress):
    - "Preparing your export..." — `heading-lg`.
    - Linear progress bar: 4px height, seafoam fill, pearl track.
    - Percentage: "45%" — `heading-sm`, charcoal.
    - Note: "We'll email you a download link when ready." — `body-sm`, slate.

### Import Recipes

- "Import from file" — `body-md`, charcoal.
- **Upload area**: Dashed border (`#B2BEC3`, 2px dashed), `radius-lg`, centered. Upload icon (32px, slate) + "Drop file or click to browse" — `body-sm`, slate.
- **Supported formats note**: "Supports Paprika, BigOven, generic JSON" — `caption`, slate.

### Account Data (GDPR Export)

- "Download your data" — `body-md`, charcoal.
- Subtitle: "Full account export including recipes, meal plans, and preferences." — `body-sm`, slate.
- **Button**: "Request data export" — Secondary button (coral outline).
- Processing state: Same progress pattern as recipe export.

---

## Section 9: Danger Zone

**Section card**: Coral-accented — 2px coral border (`#E8917A`), white background, `radius-lg`.
**Section header**: "Danger Zone" — `heading-md`, coral color, with alert-triangle icon (20px, coral).
**Spacing**: Extra `space-5` (24px) margin-top from previous section to visually separate.

### Log Out All Devices

- "Log out all other devices" — `body-md`, charcoal.
- Subtitle: "You'll need to sign in again on any other device." — `body-sm`, slate.
- **Button**: "Log out all devices" — Secondary button (coral outline, pill).
- **Confirmation modal**: "Log out all other devices?" + device count + "Log out" (coral) + "Cancel".

### Deactivate Account

- "Deactivate account" — `body-md`, charcoal.
- Subtitle: "Temporarily hide your profile and recipes. You can reactivate anytime." — `body-sm`, slate.
- **Button**: "Deactivate" — Text button (coral, body-sm).
- **Confirmation modal**: "Deactivate your account?" + explanation + "Deactivate" (coral) + "Keep active".

### Delete Account

- "Delete account" — `body-md`, coral color, with warning icon.
- Subtitle: "Permanently delete your account and all data. This cannot be undone." — `body-sm`, coral.
- **Multi-step confirmation flow**:
    - **Step 1 modal**: "Are you absolutely sure?" + bullet list of data to be deleted + "Your recipes will be removed from public search. Shared recipes attributed to you will show 'Deleted User'." — `body-sm`, slate.
    - **Step 2 modal**: "Type DELETE to confirm" + text input + "I understand all my data will be permanently lost" checkbox.
    - **Step 3 modal**: "Final confirmation" + "30-day grace period: You can recover your account within 30 days by signing in. After that, all data is permanently erased." — `body-sm`, warning color. Buttons: "Permanently delete" (coral, filled) + "Cancel" (tertiary).
- **Mobile**: Biometric auth prompt (Face ID / fingerprint) before Step 1.

---

## Navigation & Global Elements

### Web Side Navigation

- Width: 240px.
- Background: `rgba(255,255,255,0.1)` + `backdrop-filter: blur(16px)`.
- **Items** (vertical list, `space-2` gap):
    - Profile (user icon)
    - Personal Info (id-card icon)
    - Login & Security (shield icon)
    - Preferences (sliders icon)
    - Notifications (bell icon)
    - Privacy (lock icon)
    - Subscription (star icon)
    - Data & Export (download icon)
- **Active state**: Seafoam left border (3px), `rgba(91,168,160,0.1)` background highlight, seafoam text.
- **Hover state**: Pearl background.
- **Top**: Small Commise logo or "Account" label.
- **Bottom**: "Back to Commise" link with arrow-left icon.

### Mobile Section Headers (Accordion)

- Header row: Icon (20px, seafoam) + Section name (`heading-sm`, charcoal) + chevron-down icon (16px, slate) right.
- **Collapsed**: Chevron right. Show only header.
- **Expanded**: Chevron down. Show full content below with `space-3` padding.
- **Animation**: Smooth 200ms ease height transition.

### Top Bar

- **Web**:
    - Left: "← Back to Commise" (body-sm, seafoam) with arrow icon.
    - Center: "Profile & Account" (heading-lg, charcoal).
    - Right: Save status indicator ("Saved ✓" caption, success, or "Unsaved" caption, warning).
- **Mobile**:
    - Sticky top: Profile card only (compact version — 80px avatar, name, stats in horizontal row).
    - Below: Settings sections scroll.

---

## States to Design

### 1. Loading State

- **Avatar area**: Circular skeleton shimmer (120px, pearl base).
- **Stats row**: 4 small skeleton rectangles (40px × 24px).
- **Settings sections**: Each shows 3–4 skeleton rows (pearl, `radius-md`, shimmer animation).
- **Background**: Gradient still visible behind liquid glass skeleton cards.

### 2. Empty / New User State

- **Profile card**: Default avatar with initials. Display name placeholder. Empty bio placeholder.
- **Checklist card** below profile: "Complete your profile" — `heading-md`, seafoam.
    - 5 steps as vertical list with check circles:
        - ⭕ Add a profile photo
        - ⭕ Write a short bio
        - ⭕ Set dietary preferences
        - ⭕ Choose notification settings
        - ⭕ Connect a social account
    - Completed steps: Green checkmark (`#4CAF7C`).
    - Active step: Seafoam circle with number.
    - "Skip for now" link (body-sm, slate) at bottom.

### 3. Unverified Email Banner

- **Top banner** (full width, above profile card):
    - Background: Warning (`#F5B041`) at 10% opacity, 1px warning border.
    - Content: Warning icon (20px, warning) + "Verify your email to unlock all features" — `body-md`, warning dark.
    - **Resend button**: "Resend email" — Secondary button (small, warning outline).
    - Dismiss: X icon (16px, slate) right.
- **Web**: Sticky below top bar.
- **Mobile**: Banner at top of scroll view.

### 4. Expired Subscription Banner

- **Top banner**:
    - Background: Coral (`#E8917A`) at 10% opacity, 1px coral border.
    - Content: "Your Pro subscription expired. Renew to keep private recipes." — `body-md`, coral dark.
    - **Renew button**: "Renew Pro" — Primary button (small, seafoam).
    - **Dismiss**: X icon.

### 5. Pending Changes Sticky Bar

- **Position**: Bottom of viewport, sticky.
- **Background**: Charcoal (`#2D3436`) with `shadow-xl`.
- **Content**: "You have unsaved changes" — `body-md`, white.
- **Buttons**: "Save" (primary seafoam, small pill) + "Discard" (tertiary ghost, small) right.
- **Mobile**: Full-width, 64px height, above bottom tab bar.
- **Web**: Floating bar, centered, max-width 400px, `radius-md` top corners.

### 6. Offline State

- **Badge**: "Changes will sync when you're back online" — `caption`, warning color, with cloud-slash icon. Position: top-right of profile card.
- **Editable fields**: Show current value with 50% opacity + offline indicator dot (warning, 8px) left of label.
- **Placeholder text on hover**: "Will update when connected" — `caption`, slate.
- **Buttons**: Disabled state with offline tooltip.

### 7. Data Export in Progress

- **Modal overlay** (web: centered; mobile: bottom sheet):
    - Background: White, `radius-lg`, `shadow-xl`.
    - Title: "Preparing your export..." — `heading-lg`.
    - **Circular progress**: 120px, seafoam stroke, pearl track, percentage in center (`heading-lg`).
    - Subtitle: "We'll email you when it's ready." — `body-sm`, slate.
    - Cancel button: "Cancel export" (tertiary).

### 8. Account Deletion Flow

- **3-step confirmation** (detailed in Danger Zone section above):
    - Step 1: Warning + data list + grace period explanation.
    - Step 2: Type "DELETE" + acknowledgment checkbox.
    - Step 3: Final confirm with 30-day recovery note.
- **Visual**: Modal border transitions from mist → warning → coral across steps.
- **Mobile**: Full-screen flow with step indicator dots top.

### 9. Success States (Toasts)

- **Toast notification**:
    - Background: `#2D3436` (dark) or `#5BA8A0` (success variant).
    - Text: White, `body-md`.
    - Icon left: Checkmark, warning, or info (20px, white).
    - Position: Top-center (web) or bottom (mobile).
    - Auto-dismiss: 4 seconds.
- **Examples**:
    - "Profile saved ✓"
    - "Avatar updated ✓"
    - "Google account connected ✓"
    - "Password changed ✓"
    - "Preferences saved ✓"

---

## Mobile-Specific Details

- **Bottom sheet for avatar picker**: `radius-xl` (24px) top corners, drag handle, backdrop `rgba(45,52,54,0.5)`. Options: Camera, Photo Library, Remove Photo, Cancel.
- **Native date picker**: Opens from Date of Birth field. iOS: wheel. Android: calendar.
- **Native share sheet**: From profile URL copy/share button.
- **Biometric auth prompt**: Face ID / Touch ID / Fingerprint icon overlay for sensitive changes (password change, delete account).
- **Pull-to-refresh**: On profile stats row. Spinner (seafoam) + "Refreshing..." caption.
- **Section index**: Right edge, small dots (8px) with section initials. Tap to jump.
- **Haptic feedback**: On all toggle switches, copy actions, and destructive confirmations.
- **Keyboard handling**: Inputs scroll into view when focused. Sticky bottom bar avoids keyboard.

---

## Web-Specific Details

- **Drag-and-drop avatar upload**: Drop zone highlight (2px dashed seafoam border, `rgba(91,168,160,0.1)` background) when dragging file over avatar area.
- **Keyboard shortcuts**:
    - `Tab`: Navigate between fields and buttons. Focus ring: 2px seafoam outline, `offset: 2px`.
    - `Enter`: Save active field / activate button.
    - `Escape`: Cancel inline edit / close modal.
- **Sticky section headers**: During scroll, section headers stick to top of right column (below top bar) with `backdrop-filter: blur(12px)` background.
- **Two-column layout**:
    - Left: Profile card (320px, sticky, top: 80px).
    - Right: Settings scrollable area (flex: 1, max-width 720px).
    - Gap: `space-6` (32px).
- **Hover tooltips**: On settings items with info icon. Tooltip: White background, `shadow-md`, `radius-md`, `body-sm`, slate. Delay: 300ms.
- **Bulk edit mode** (dietary preferences): Checkbox grid appears. "Save all" and "Cancel" buttons at top.

---

## Accessibility Requirements

- **All toggles**: Visible label + icon + color. Never rely on color alone. Switch has clear ON/OFF state with position and background color change.
- **Focus rings**: All interactive elements have 2px seafoam (`#5BA8A0`) outline with 2px offset. Visible on keyboard navigation.
- **Screen reader announcements**: Section changes announced ("Login and Security section expanded"). Live regions for save status and toast notifications.
- **Danger zone**: Additional confirmation step for screen readers. "This action is destructive. Are you sure?" read before button.
- **Skip link**: "Skip to main content" link at very top (visually hidden until focused).
- **Avatar**: Alt text "Profile photo of [Display Name]" or "Default profile icon with initials J C."
- **Stats**: Read as "47 recipes, 1.2 thousand followers, 384 following, 156 total cooks."
- **Color contrast**: All text meets WCAG 2.1 AA (4.5:1). Large text (headings) meets AAA (7:1) where possible.
- **Reduced motion**: Respect `prefers-reduced-motion`. Disable shimmer animations, smooth scroll, and accordion transitions. Instant state changes.
- **Reduced transparency**: Respect `prefers-reduced-transparency`. Liquid glass surfaces become solid white (`#FFFFFF`) or pearl (`#F5F5F5`).

---

## Component Specifications Summary

### Toggle Switch

- Track: 48px wide × 28px tall, `radius-full`.
- OFF: Pearl background (`#F5F5F5`), 1px mist border. Knob: white, 24px, left.
- ON: Seafoam background (`#5BA8A0`). Knob: white, 24px, right.
- Transition: 200ms ease.
- **Mobile**: Haptic feedback on change.

### Segmented Control

- Container: Pearl background, `radius-full`, padding 4px.
- Selected: Seafoam background, white text, `radius-full`.
- Unselected: Transparent, charcoal text.
- Transition: 200ms ease.

### Chip / Pill

- Selected: Seafoam background, white text, `radius-full`, padding `8px 16px`.
- Unselected: Pearl background, charcoal text, 1px mist border, `radius-full`.
- Hover: Background opacity increases.

### Section Card

- Background: White (`#FFFFFF`).
- Border radius: `radius-lg` (16px).
- Shadow: `shadow-md` (`0 4px 12px rgba(45,52,54,0.08)`).
- Padding: `space-5` (24px).
- Internal gap: `space-4` (16px) between subsections.

### Inline Edit Field

- Static: Text only, `body-md`, charcoal.
- Active: Input field style (white 60% blur background, 1px mist border, `radius-md`).
- Save icon: Checkmark in seafoam circle (24px).
- Cancel icon: X in pearl circle (24px).
- Focus: Seafoam border + subtle glow.

### Modal (Web)

- Max width: 560px.
- Background: White.
- Border radius: `radius-lg`.
- Shadow: `shadow-xl`.
- Backdrop: `rgba(45,52,54,0.6)` + `backdrop-filter: blur(4px)`.
- Padding: `space-6` (32px).

### Bottom Sheet (Mobile)

- Background: White.
- Top corners: `radius-xl` (24px).
- Drag handle: 36px wide, 4px tall, `#B2BEC3`, centered top, 12px from top edge.
- Backdrop: `rgba(45,52,54,0.5)`.
- Max height: 85% viewport.
- Snap points: 25%, 50%, 85%.

---

## Figma Make Instructions

Generate a **complete, high-fidelity mockup** of the Commise Profile & Account page. Create the following frames:

1. **Desktop — Default State** (1440px wide):
    - Full two-column layout with profile card left, all 9 settings sections right.
    - Side navigation left.
    - All fields populated with example data.
    - Show 3–4 settings sections expanded; others collapsed for scroll demonstration.

2. **Desktop — Empty / New User** (1440px wide):
    - Same layout but profile card shows default avatar + checklist.
    - Settings sections show empty/placeholder states.

3. **Desktop — Unverified Email + Pending Changes** (1440px wide):
    - Top warning banner.
    - Sticky bottom unsaved changes bar.
    - Some fields in edit mode.

4. **Desktop — Account Deletion Flow** (1440px wide):
    - Show Step 1 warning modal overlay.
    - Background dimmed.

5. **Mobile — Default State** (375px wide):
    - Single column, sticky profile header.
    - Accordion sections.
    - Bottom tab bar visible.
    - Show 2–3 sections expanded.

6. **Mobile — Offline State** (375px wide):
    - Offline badge visible.
    - Fields at 50% opacity.
    - One section open showing offline indicators.

7. **Mobile — Bottom Sheet (Avatar Picker)** (375px wide):
    - Show bottom sheet overlay with 4 options.
    - Backdrop visible.

**Style requirements**:

- Use the "Summer at the Beach" aesthetic throughout — warm, inviting, never clinical.
- Apply liquid glass surfaces to sticky/floating elements (profile card, top bar, bottom bar).
- Ensure all text is legible with WCAG AA contrast.
- Use Playfair Display for headings and display name; Inter for all body text.
- Maintain consistent 8px spacing rhythm.
- Show hover states on web interactive elements.
- Show active/focus states for accessibility demonstration.

**Deliverable**: A single Figma file with all 7 frames organized in a "Profile & Account" page. Name each frame clearly. Use auto-layout for all cards and sections. Apply the Commise color tokens consistently.
