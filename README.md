# sandstone website

The public website is live at [sand-282.github.io/Sandstone.github.io](https://sand-282.github.io/Sandstone.github.io/). Source lives in [Sand-282/Sandstone.github.io](https://github.com/Sand-282/Sandstone.github.io).

The private commission app is deployed at [sandstone-commissions.sandstone-sand-282.workers.dev](https://sandstone-commissions.sandstone-sand-282.workers.dev). [Owner sign-in](https://sandstone-commissions.sandstone-sand-282.workers.dev/admin) and [client access](https://sandstone-commissions.sandstone-sand-282.workers.dev/portal) run there.

## Finish owner setup

The owner email is **cjgsinclare@gmail.com**. In the Cloudflare Worker’s **Settings → Runtime variables and secrets**, add **ADMIN_PASSWORD** as a **Secret**. Choose a unique password of at least 16 characters, save it in your password manager, and click **Add variable and deploy**. Enter and save this credential yourself; do not send it in chat.

[Open the Worker settings](https://dash.cloudflare.com/6304c08e04178cd8f0cce3ad290575bd/workers/services/view/sandstone-commissions/production/settings).

Until this password exists, owner sign-in and new commission submissions stay disabled. Saved client commissions and private files require valid access links or owner sessions.

## Hosting and costs

The public page uses GitHub Pages, with publishing enabled through GitHub Actions. Source changes on **main** automatically publish the public website. The **BACKEND_URL** repository variable connects it to the deployed private app.

The private app uses Cloudflare Workers and D1. **R2 is not activated or used.** No paid plan, subscription, payment details or charge was approved during setup. Keep the account on **Workers Free**.

Attachments and portfolio images use capped D1 storage. Files are split into 256 KB database chunks and streamed through the same access-controlled file endpoint. Combined stored file content is capped at **200 MiB**, leaving space within D1’s 500 MB free database limit for other records and database overhead. A full file store refuses new attachments and keeps existing files; clients can email references instead. Cloudflare Free limits also apply to traffic and database operations: exceeding them makes requests fail rather than enabling a paid plan. [D1 Free limits and pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

The database is **sandstone-commissions-db**. Its numbered migrations in **drizzle/** are applied and recorded in **d1_migrations**. Do not rerun applied SQL manually or delete existing data when redeploying.

## Email still needs setup

The app is prepared to use Resend for new requests, acceptance or decline messages, access recovery, and both directions of chat notifications. Email is currently unconfigured: saved requests and messages are retained, and the interface truthfully reports unsent notifications.

To activate delivery, create or use a Resend account and a sending domain you own, verify the domain in Resend, then add these Worker settings:

| Setting | Type | Value |
| --- | --- | --- |
| RESEND_API_KEY | Secret | Your Resend sending API key |
| EMAIL_FROM | Variable | An address on your verified domain |

Keep credentials out of chat and public source. Gmail can receive owner notifications, but Resend requires a verified domain for sending to clients. [Resend domain guide](https://resend.com/docs/dashboard/domains/introduction). No domain or email plan has been purchased.

Clients must save the private link shown after submitting while email is unavailable. Email-based access recovery also needs delivery configured. After setup, use **Retry unsent** in the owner notification panel. Test a request, acceptance and messages in both directions using inboxes you control, and check provider delivery activity and spam folders.

## Daily use

Sign in on the owner page to view requests, accept or decline them, manage their status, write notes, reply to clients, and update public content and images.

Clients use their own private links without creating accounts. Chat opens after acceptance. Access links expire after 180 days and browser sessions after 30 days. Keep links private.

The content editor changes branding, introduction, availability, project examples and screenshots without editing source. Portfolio images are public; request attachments are private. Placeholder examples are labelled illustrative concepts; replace them with your actual work.

The copy explains that you provide scripting and behaviour work and can implement supplied textures and models. Supported attachments: PNG, JPEG, GIF, WebP, PDF, ZIP, MCPACK, MCADDON, JSON and TXT. Five files maximum, 10 MB per file, 20 MB combined; portfolio images up to 8 MB.

## Future source deployments

Public source changes publish automatically. Owner content edits are served from the database and require no source commit.

Backend code publication is separate. The included **Publish secure commission system** workflow is an optional manual route for future deployments. It requires repository Secrets **CLOUDFLARE_API_TOKEN**, **CLOUDFLARE_ACCOUNT_ID**, and **ADMIN_PASSWORD**. Use a Cloudflare token restricted to this account with **Workers Scripts: Edit**, **D1: Edit**, and **Account Settings: Read**. R2 permissions are unnecessary. Optional email settings are the **RESEND_API_KEY** Secret and **EMAIL_FROM** Variable. Existing credentials are not copied into GitHub automatically.

The workflow builds the app, reuses or creates the named database, installs secrets, applies pending migrations, deploys, and checks that private records reject unauthenticated requests. It removes the unused R2 binding from generated production configuration and sets **FILE_STORAGE=d1**.

For deployment through the connected Cloudflare service, **scripts/package-direct-worker.mjs** packages compiled JavaScript modules and text assets for the Workers multipart upload API. This route needs no new provider API token. Static modules are served with content hashes and cache headers. Preserve existing secret bindings on code uploads.

## Development and validation

Install with **npm ci**, build with **npm run build**, and build the GitHub Pages frontend with **node scripts/build-pages.mjs**. Node.js 24 is used in GitHub Actions. Set **PAGES_BACKEND_URL** to the verified private app origin when building the public frontend.

Checks: **node tests/standalone-security.mjs**, **node tests/email-outbox.mjs**, **node --test scripts/deploy-cloudflare.test.mjs**, and TypeScript compilation. These exercise real route source and SQLite migrations, mocked delivery and deployment, access restrictions, multi-chunk file integrity, quota rejection and atomic rollback. They do not prove live inbox delivery.

Current live checks confirmed database and uploads configured, password-based authentication selected, and anonymous access to commission records denied. Owner password and email delivery require the setup above.

The full source archive excludes secrets, local preview data, dependencies and generated builds. The retained Sites build bindings support the local preview; production uses standalone owner authentication.
