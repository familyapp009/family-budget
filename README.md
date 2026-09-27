# Family Budget

A small, mobile-first shared household spending tracker. Static GitHub Pages frontend; Supabase for authenticated household records.

**Core rule:** remaining = normal two-paycheck net income − total automatic monthly obligations − manually recorded purchases. Savings are intentionally **not** calculated, allocated, or tracked. Guidelines may go negative without moving money between categories.

## Current status

The frontend and database schema are implemented. A sample dashboard is accessible without credentials through `?demo=1`, but it uses only fictional amounts held temporarily in your browser.

The database is configured with row-level security. Live user invitations and household membership must be completed before recording family transactions. GitHub Pages activation is a separate step. Do not enter real financial records before both accounts have been authorized and access checks completed.

## Features

- Month navigation, with previous month's income, fixed obligations and guideline amounts offered as editable defaults
- Overall remaining monthly balance, spending guidelines, optional notes, transaction history and CSV export
- USD and EUR purchase entry; exchange rate fixed per purchase when first recorded
- Purchase edit and delete; household realtime refresh and refresh-on-return
- Separate authenticated users assigned to the same household
- Minimal month settings hidden from the main dashboard
- No saving allocations, account connection, card statements, or recurring-bill transaction entries

## Files

- `index.html`, `styles.css`, `app.js`, `budget-core.js`, `config.js`: static client
- `supabase/migrations/`: schema and security migrations already applied to the connected project
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
4. Assign the two resulting Auth user IDs to one household through the trusted Supabase SQL editor or an authorized administrative action. **Never** add user IDs or membership-insertion SQL with real values to this public repository. Template:

   ```sql
   insert into public.households(name) values ('Family') returning id;
   -- Use the returned household ID and verified Auth user IDs:
   insert into public.household_members(household_id,user_id,role)
   values ('HOUSEHOLD_UUID','FIRST_AUTH_USER_UUID','owner'),
          ('HOUSEHOLD_UUID','SECOND_AUTH_USER_UUID','member');
   ```

5. In **Authentication settings**, disable public user self-registration. The app itself does not offer registration and requests magic links only for existing users.
6. Verify both accounts can see the same household, that a new/unassigned user sees only an awaiting-access message, and that database security advisors show no exposed anonymous privileged functions.
7. Open the normal Pages URL (without `?demo=1`) and create the first actual month. Do not import financial statements or bank credentials.

**Note:** GitHub Pages publishes a public frontend, not a private website. Security resides in Supabase authentication, explicit membership, least-privilege grants, and row-level policies.

## Tests

`npm test` (Node.js 22). Also run `node --check app.js` to check the browser module's syntax.
