# Quickstart: try public versions locally (once built)

Nothing here runs today. The feature is planned, not built.

1. Bring up the local stack: `npm run local:up` (LocalStack and Postgres). Run the recipe migrations.
2. Turn the feature switch on for the local stage only. Every market is on at launch (ADR-0093 §6a).
3. Point the worker at a stub writer, or at Bedrock with a scoped, non-root profile (the default profile is root).
4. Paste a blog page with JSON-LD into Add a recipe on web. Finish the match review.
5. Choose "For everyone". Wait for the review. Check:
    - the steps are new, and every amount, time and temperature matches the paste.
    - "Show my copy" shows the pasted steps.
    - the credit and licence lines show, and no page photo.
6. Publish. The recipe reads "Checking". Edit its steps back to the pasted wording. The save is refused.
7. Repeat with a paid-site page newer than 6 months: one line, "Save my copy", no other choice. With an older one,
   the choice shows and the credit names no site.
8. Fill 50 private slots on a Free test cook. Paste a paid-site page. The dead end shows. Try "Not now".
9. Repeat 4 to 8 on Android and iOS through the mobile app.

Clean up: stop the local stack, delete the test cook's recipes, and remove any stub writer files.
