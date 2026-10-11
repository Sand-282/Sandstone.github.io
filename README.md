# sandstone website setup

The repository is [Sand-282/Sandstone.github.io](https://github.com/Sand-282/Sandstone.github.io). Its public website address is [sand-282.github.io/Sandstone.github.io](https://sand-282.github.io/Sandstone.github.io/).

GitHub access is already connected. The remaining setup is to enable GitHub Pages and connect a Cloudflare account for the private commission system. Email delivery also needs a sending service and a verified domain you own.

The animated public page runs on GitHub Pages. Cloudflare runs commission requests, private files, owner review, client access links, and chat. The public page stays usable while the private system is unconnected and displays a setup notice with request submission disabled. GitHub Pages hosts static files; the separate backend is needed for these private features. [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

## 1. Enable the public website

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Open **Actions → Publish public website → Run workflow**, choose **main**, and run it.
4. Once it finishes, open the public website address above.

Future source changes pushed to **main** publish the public page automatically. GitHub supplies the publishing token; no extra GitHub password or personal access token is needed. The workflow uses GitHub's official Pages actions. [GitHub publishing guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## 2. Connect the secure commission system

1. Sign in to [Cloudflare](https://dash.cloudflare.com/) and choose the account you want to use.
2. Enable **Workers & Pages** and **R2** on that account if prompted. Choose your account's **workers.dev subdomain** in Workers & Pages settings. The deployment needs this existing subdomain to create the correct private-link address.
3. Copy the Cloudflare **Account ID** from the dashboard.
4. Create a Cloudflare API token restricted to this account. Give it **Workers Scripts: Edit**, **D1: Edit**, **Workers R2 Storage: Edit**, and **Account Settings: Read** permissions. Use an API token rather than your global account key. [Cloudflare token guide](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) and [Cloudflare GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
5. In the GitHub repository, open **Settings → Secrets and variables → Actions**. On the **Secrets** tab, add the three required secrets below.

| Secret name | What to enter |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | The Cloudflare API token you just created |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID: 32 letters/numbers |
| `ADMIN_PASSWORD` | A unique owner password of 16–256 characters; keep it in your password manager |

The owner email defaults to **cjgsinclare@gmail.com**. To change it, add an Actions **variable** named `ADMIN_EMAIL` with your chosen email address. Owner sign-in uses the password above; clients use their own private links and do not need an account.

6. Open **Actions → Publish secure commission system → Run workflow**, choose **main**, and run it.
7. Open the successful run's **Summary**. It contains the actual commission system address and owner sign-in link.
8. In **Settings → Secrets and variables → Actions → Variables**, add `BACKEND_URL` with that complete address, without a trailing slash. Do not use a guessed address.
9. Rerun **Publish public website**. The public page can now load your content and submit requests to the secured system.

The secure publishing workflow stays manual. It checks the password, reuses or creates the database and private file bucket, installs owner credentials before deploying application code, applies pending database migrations, and checks live storage, password authentication, public-page access, and denial of unauthenticated access to commission records.

Its Cloudflare resources are named **sandstone-commissions**, **sandstone-commissions-db**, and **sandstone-commissions-uploads**. Rerunning it keeps these resources and existing data. It stops if the upload bucket has public access enabled; commission files must remain private. It does not remove resources or empty storage.

Cloudflare and email credentials have not been supplied or verified as part of the local preparation. A successful local build or helper test does not mean the remote backend has been deployed.

## 3. Connect email delivery

The application uses Resend for request receipts, owner notifications, acceptance/rejection messages, access recovery, and chat notifications.

1. Create or use a [Resend account](https://resend.com/).
2. Add a sending domain you own and complete the DNS verification shown by Resend. Your Gmail address can receive owner notifications, but the sending address must use your verified domain. [Resend verified-domain guide](https://resend.com/docs/dashboard/domains/introduction)
3. Create a Resend API key with sending permission.
4. Add these settings in the GitHub repository's Actions settings.

| Where | Name | What to enter |
| --- | --- | --- |
| Secrets | `RESEND_API_KEY` | Your Resend sending key |
| Variables | `EMAIL_FROM` | A sender on your verified domain, for example `sandstone <commissions@your-domain.com>` |

Add both email settings together, then rerun **Publish secure commission system**. No source-file editing is required. The deployment computes the correct website address for private links automatically.

Until email is connected, requests and messages are saved but notifications remain unsent. Clients must save the private link displayed after submitting a request. Email-based access recovery needs the provider to be connected. In the owner notification panel, use **Retry unsent** after configuring email to process pending notifications.

Verify delivery with inboxes you control: one submitted request, one acceptance, one client message, and one owner reply. Check that both parties receive the expected messages and that private links open the correct commission. Provider acceptance alone does not prove inbox delivery; check Resend's delivery activity and spam folders.

## Daily use

Open the owner sign-in link from the secure workflow's Summary and enter your owner password. Review requests, accept or reject them, write notes, chat with clients, and review private attachments there.

Clients open only their own private access link. After acceptance, that link gives them access to the private conversation. Links expire after 180 days and browser sessions expire after 30 days. Keep access links private and use the owner controls to revoke or replace them when needed.

Use the owner content editor to change the introduction, availability, branding, project examples, and project screenshots. Supply your real completed work and screenshots. Portfolio images are public; commission attachments are restricted to the owner and the matching client.

The service copy explains that you provide scripting and behaviour work and can implement client-supplied models, textures, and other assets. Clients may attach up to five files, each up to 10 MB, with a 20 MB combined limit. Supported formats are PNG, JPEG, GIF, WebP, PDF, ZIP, MCPACK, MCADDON, JSON, and TXT.

Public source changes publish through the GitHub Pages workflow. Backend source changes need a separate run of **Publish secure commission system**. Owner content edits take effect through the connected backend without a source commit. If you change the owner password, update `ADMIN_PASSWORD` in GitHub Secrets and rerun the secure workflow.

## If publishing fails

- **Public page not found:** confirm Pages source is **GitHub Actions**, and check the latest public workflow run.
- **Cloudflare setup check failed:** check the three required secret names and password length.
- **Cloudflare rejected a request:** confirm the account ID, token permissions, and that Workers/R2 are enabled on the same account. The helper prints HTTP/error codes without printing credentials.
- **Missing workers.dev subdomain:** choose one in the Cloudflare account's Workers & Pages settings and rerun.
- **Storage privacy check failed:** turn off the upload bucket's public r2.dev address and public custom domains before rerunning.
- **Live check failed:** review the Cloudflare Worker deployment and bindings before setting `BACKEND_URL`.
- **Page says setup is incomplete:** copy the successful backend run's actual address into `BACKEND_URL`, then rerun the public workflow.
- **Emails remain unsent:** confirm both email settings, verify your sender domain, rerun the secure workflow, and use **Retry unsent** in the owner panel.

## Technical notes

The source uses Node.js 24 in GitHub Actions, the locked npm dependencies, Vinext, Cloudflare D1, and R2. The existing Sites build integration and `DB`/`BUCKET` binding names are preserved. The standalone deployment changes only generated build configuration; it replaces placeholder storage identifiers with the resources returned by Cloudflare.

Runtime settings are `AUTH_MODE=standalone`, the owner email, `PAGES_ORIGIN=https://sand-282.github.io`, the real backend `SITE_URL`, and optional `EMAIL_FROM`. The password and optional Resend key go to Cloudflare as secrets through the publishing process's standard input, rather than command-line arguments or temporary secret files.

The backend address follows Cloudflare's Worker-name/account-subdomain format and is derived from the account API response. [Cloudflare workers.dev documentation](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

Database migrations are the numbered SQL files in `drizzle/`, applied remotely before code publication. Migration history prevents rerunning successful migrations. The deploy helper preserves the generated `index.js` entry point, unbundled build, and client asset directory. [Cloudflare migrations guide](https://developers.cloudflare.com/d1/reference/migrations/)

For local work, install with `npm ci`, build with `npm run build`, and run the public build with `node scripts/build-pages.mjs`. Run `node --test scripts/deploy-cloudflare.test.mjs` to validate deployment behavior without credentials, live API calls, or email delivery. Seven helper checks passed during preparation, covering missing secrets, resource creation/reuse, secret-before-code ordering, bucket privacy, failed secret upload, live private-access rejection, and sanitized API errors.
