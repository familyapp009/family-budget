# Family Budget

A small, mobile-first shared household spending tracker. Static GitHub Pages frontend; Supabase for authenticated household records.

**Core rule:** remaining = normal two-paycheck net income − total automatic monthly obligations − previous month shortfall − manually recorded purchases. Negative balances carry forward automatically until covered; positive balances reset to zero at the next month. Savings are intentionally **not** calculated, allocated, or tracked. Guidelines may go negative without moving money between categories.

## Current status

The frontend and database schema are implemented. A sample dashboard is accessible without credentials through `?demo=1`, but it uses only fictional amounts held temporarily in your browser.

The database is configured with row-level security. Live user invitations and household membership must be completed before recording family transactions. GitHub Pages activation is a separate step. Do not enter real financial records before both accounts have been authorized and access checks completed.

## Features

- Month navigation, with previous month's income, fixed obligations and guideline amounts offered as editable defaults
- Overall remaining monthly balance, automatic negative-only rollover from earlier months, spending guidelines, optional notes, transaction history and CSV export
- USD and EUR purchase entry; exchange rate fixed per purchase when first recorded
- Purchase edit and delete; household realtime refresh and refresh-on-return
- Separate authenticated users assigned to the same household
- Private, editable household-wide defaults for normal two-paycheck income, EUR/USD rate, and individual recurring obligations; new months use these defaults and keep historical snapshots
- Minimal month settings hidden from the main dashboard
- No saving allocations, account connection, card statements, or recurring-bill transaction entries

## Files

- `index.html`, `styles.css`, `app.js`, `budget-core.js`, `config.js`: static client
- `supabase/migrations/`: schema, security, and recurring-default migrations applied to the connected project
- `tests/` and `.github/workflows/checks.yml`: Node test suite and CI

`config.js` contains a **browser-safe Supabase publishable key**, not a service-role key or database password. The frontend is public source. Every private row requires membership and database-enforced row-level policies.

## Review demo

After enabling Pages for `main` → `/(root)`, visit:

`https://familyapp009.github.io/family-budget/?demo=1`

The sample entries stay only in memory and disappear on reload. The demo never writes to Supabase.

## Setup remaining

1. In GitHub repository **Settings → Pages**, choose **Deploy from a branch**, `main`, `/(root)` and save. Pages URLs and controls belong to GitHub, not Supabase.
2. In Supabase **Authentication → URL Configuration**, set Site URL to `https://familyapp009.github.io/family-budget/` and add the same redirect URL to the allowed redirect list. Use the trailing slash.
3. In Supabase **Authentication → Users**, use **Invite user** for each of the two adults. Review the invitation emails and sign in once. For an invitation link, the user can set a password from the application Settings panel after sign-in.
4. A single empty household has already been initialized in Supabase. After both invitations, assign their verified Auth user IDs to that existing household through the trusted Supabase SQL editor or authorized administrative action. **Never** commit actual identifiers or membership grants to this public repository.

5. In **Authentication settings**, disable public user self-registration. The app itself does not offer registration and requests magic links only for existing users.
6. Verify both accounts can see the same household, that a new/unassigned user sees only an awaiting-access message, and that database security advisors show no exposed anonymous privileged functions.
7. Open the normal Pages URL (without `?demo=1`) and create the first actual month. Do not import financial statements or bank credentials.

**Note:** GitHub Pages publishes a public frontend, not a private website. Security resides in Supabase authentication, explicit membership, least-privilege grants, and row-level policies.

## Tests

`npm test` (Node.js 22). Also run `node --check app.js` to check the browser module's syntax.

## Recurring default behavior

The two-paycheck net figure and seven confirmed automatic obligations have been seeded **privately in Supabase** rather than committed to this public repository. Review them from **Edit recurring defaults** before creating the first month. The car-paycheck allotment is already reflected in deposited net pay and is not counted again. Card-billed subscriptions that have not been reconciled and a possible additional future daycare cost were deliberately not included. No savings target or automatic savings transfer is used.

Changes to household defaults only prefill **new** months. To change an existing month, open its Monthly settings, optionally load the updated household defaults into the editable fields, and explicitly save. Purchases already recorded preserve their USD snapshot when the exchange rate changes.

## Automatic negative rollover

The dashboard's **Available this month** total subtracts any outstanding shortfall from previous configured months. When a month ends negative, that amount reduces the following month's spendable starting balance. If a later month has enough room to cover the shortfall, its excess does **not** roll forward as a credit. A still-uncovered portion carries forward again.

The app computes this adjustment from historical monthly plans and purchase totals on each load. It does **not** create a purchase, change category totals, edit prior records, or store a separate rollover ledger. Correcting an older purchase or updating its month's income/obligations recalculates affected future months on the next refresh or household sync. The adjustment appears as a separate **Previous month shortfall** line in the summary when applicable.

The rollover is provisional while a previous month is still being edited. If a month has no plan, the outstanding shortfall waits for the next configured month. All historical queries are scoped to the signed-in household with Supabase row-level security and paginated to avoid silently truncating a long purchase history.
