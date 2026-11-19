# Hostinger deployment

> Security update: the session and data behavior below is superseded by the current implementation. Visitor and owner cookies now use revocable server-side sessions in the private data directory. A deployment of this update requires everyone to sign in once again; existing valid access codes remain usable. Visitor sessions are capped at seven days and at invite expiry. Owner sessions have a four-hour maximum, a 15-minute idle timeout, and require authentication within five minutes for invite generation. Sign-out revokes the server session. Provider keys default to browser-session storage unless explicitly remembered. Point-coordinate cache entries now expire after seven days and are capped at 40; archive cleanup runs daily while collecting data. See the deployment requirements below before rollout.

## Security rollout requirements

- Set `SKY_PEEK_DATA_DIR` to a private persistent writable directory outside every public web root, or verify the existing Hostinger `hbuilds` sibling detection. It holds `.sky-peek-sessions/` and `.sky-peek-limits/` as well as installed configuration and homepage text. All proxy/Node workers must share the same local filesystem and OS identity. Independent replicas without that shared storage are unsupported; use a transactional shared store before that deployment model. Do not expose, publish, reset or restore stale session files casually. Store failure denies protected access instead of silently reverting to stateless cookies.
- Preserve data across ordinary code deployments. Current session cookies intentionally reject the old signed format; existing visitor/owner browser sessions end once when the update is deployed. The code credentials themselves are not rotated by this migration.
- Login budgets persist across restarts and use an atomic directory lock. Defaults cap visitor verification at 120 attempts and owner verification at 40 attempts per 15-minute window across the app. This counts successful attempts too. These conservative small-beta limits may need tuning before a larger release. A crashed process can leave a lock: stop all Node workers before removing a stale `visitor.lock` or `owner.lock` inside `.sky-peek-limits`, then restart. Never remove a live worker's lock. No automatic stale-lock guessing is used.
- Incoming IP headers are ignored by default. Only set `SKY_PEEK_TRUSTED_IP_HEADER=x-real-ip` (or `x-forwarded-for`) after confirming the public proxy overwrites that header and direct Node access is blocked. This adds a per-client budget of 10 visitor or 8 owner attempts per window; it never disables the global budget.
- CSP is enforced with fresh script nonces and explicit provider connections; every HTML page is dynamically rendered and private/no-store. Keep CDN HTML caching disabled. Inline script/event handlers and unapproved script loads are blocked. Styles permit inline values for MapLibre/React; font stylesheet exceptions are limited to Google Fonts. The policy has unit/proxy coverage but requires actual browser testing of every enabled radar/provider mode in staging. Do not weaken script policy to hide a violation.
- Next proxy body cloning is limited to 16 KiB; mutation routes independently count received bytes at 1, 2 or 8 KiB before parsing. Add matching ingress limits and timeouts. HTTPS/HSTS and live proxy/log settings still require host verification; no HSTS deployment claim is made here.
- Run the test suite, production build, network-enabled dependency advisory scan, browser CSP/injection/radar checks, cookie replay/logout checks and sensitive-log review before widening beta access. No local listener smoke check could be completed in the restricted implementation environment (`listen EPERM`).
- No whole-device erasure button has been shipped in this stage. A comprehensive cross-tab/in-flight-safe purge, further provider/host retention checks, session-store quotas/metadata retention and operational hardening remain scheduled. The public `/privacy` page describes current behavior, including this limitation.

Sky Peek is a Next.js app with live API routes, a public homepage, and a server-side beta gate for `/app`. Deploy it as a **Node.js Web App**, not through Hostinger's PHP/HTML Git integration or as a static export. The existing `npm run build` and `npm run start` scripts are the build and start commands. MySQL is not needed for the current app.

## Before the first deploy

1. Confirm the hosting plan supports Node.js Web Apps (Hostinger Business/Unlimited or Cloud). A plan limited to PHP/HTML cannot run the API routes or beta gate. Check the exact plan in hPanel before connecting the repository.
2. Use the official public repository at [brainitchstudio/skypeek](https://github.com/brainitchstudio/skypeek). The beta gate controls app access; public visitors can read the repository source. Keep `.env` files, API keys, `node_modules`, `.next`, the Python virtual environment, and local diagnostics out of Git. The `.gitignore` in this project covers those paths.
3. The repository root must contain `package.json` and `package-lock.json`. The generated `public/maplibre-gl-worker.js` is created automatically before build; it is not checked in. Hostinger serves `.mjs` as `text/plain`, which browsers reject for a module worker.

The repository includes a GitHub Actions verification workflow. It runs `npm ci`, the tests and the production build on Node 22 for every push and pull request. Hostinger still needs its own Node.js Web App deployment; the workflow does not publish the site or carry secrets.

If you are updating the official repository from a local checkout, review the working changes before pushing:

```sh
git add .
git status --short
git commit -m "Prepare Sky Peek for Hostinger deployment"
git push -u origin main
```

The project root is the checkout linked to the official repository. Commit and push from this directory. Include hidden files such as `.github`, `.gitignore`, `.nvmrc`, and `.env.example`; `.env.example` contains no secret values.

## Set up the subdomain

In Hostinger, use **Websites → Create site → Web App → Import Git Repository**. Enter the desired subdomain as a **separate website** during setup. Do not create it as a subfolder of the main site. Connect `brainitchstudio/skypeek` and select `main` for automatic deployment. Hostinger's Node.js web app flow is separate from its PHP/HTML Git integration.

Review the detected settings:

| Setting | Value |
| --- | --- |
| Framework | Next.js |
| Node.js | 22.x (24.x also meets the project requirement) |
| Project root | Repository root |
| Install | `npm ci` (Hostinger detects `package-lock.json`) |
| Build | `npm run build` |
| Start | `npm run start` |
| Output | Next.js server build (`.next`), not static `out` |

The app serves from `/` on the subdomain, so no Next.js `basePath` or `assetPrefix` is needed. Hostinger manages the public host and port; no hard-coded port or domain belongs in this repository.

The beta code gate is at `/`; the public information page is at `/info`, and the visitor app is at `/app`. The owner can update information page wording at `/beta-admin/homepage` without a build. Those edits are stored in the private `domains/skypeek.brainitch.studio/.sky-peek-data/` directory, outside Hostinger's replaced `hbuilds` versions. Keep a backup of that directory. If Hostinger does not allow the Node process to write there, set `SKY_PEEK_DATA_DIR` to another private persistent writable directory in the app environment settings.

For continuing app development, keep GitHub automatic deployments enabled. Pushes build and deploy a new version without a manual ZIP upload. Hostinger replaces its managed build folders on each deployment, so changes to Next.js code still require a new build; editing individual deployed files is not a durable update method.

### Beta gate variables

If valid beta variables are already configured, the browser installer is locked. The installer is an alternative first setup path for a new deployment; see [the upload installer guide](shared-hosting-install.md). Keep working variables in place on an existing live site.

Before starting the production app, add these **runtime** variables in Hostinger's Web App environment settings:

| Variable | Value |
| --- | --- |
| `BETA_ACCESS_CODE_HASHES` | Comma-separated salted `scrypt` hashes of shared access codes. This takes priority over `BETA_ACCESS_CODE`, so those codes do not need to be stored as plaintext. |
| `BETA_ACCESS_CODE` | Legacy plaintext fallback, at least 12 characters. Remove it after configuring the hash. |
| `BETA_SESSION_SECRET` | An independent random signing secret of at least 32 characters. Generate with `openssl rand -hex 32`; never share it. |
| `BETA_ADMIN_CODE` | Your private owner code for `/beta-admin`, at least 20 characters. Generate independently with `openssl rand -hex 24`; never share it with testers. |

Do not prefix these names with `NEXT_PUBLIC_` or commit the values to GitHub. The tracked `.env.example` contains names only. Set either valid hashes or a plaintext fallback code, plus the signing secret. A malformed nonempty hash list fails closed even if a plaintext code remains. If the shared codes or signing secret are missing or invalid, the production app returns a temporary-unavailable message instead of opening the beta. If the owner code is missing, normal beta access still works but `/beta-admin` cannot generate codes. Local `npm run dev` remains open when no gate variables are set. A tester session lasts seven days. Changing the shared codes or signing secret invalidates existing tester sessions; changing the signing secret also invalidates generated codes. Changing the owner code invalidates owner sessions. [Restart the Node.js app](https://www.hostinger.com/support/how-to-edit-or-add-environment-variables-after-deployment/) after changing runtime variables.

Keep the same public domain and `BETA_SESSION_SECRET` when deploying ordinary GitHub updates. Browser storage is scoped to the domain, and replacing the signing secret ends active beta sessions. Updating application code does not require new gate variables.

### Generate codes after deployment

1. Visit `https://skypeek.brainitch.studio/beta-admin` over HTTPS and sign in with `BETA_ADMIN_CODE`.
2. Choose 7, 30, or 90 days and select **Generate access code**. Copy the code shown and send it privately to a tester. Repeat for each tester or group.
3. Test one code in a private browser window at `/`. The owner page is intentionally separate from the app navigation.

Generated codes are self-contained signed tokens; no database or redeployment is needed to create them. They can be reused and forwarded until expiry. Expiry stops new sign-ins, while a session already issued can last up to seven more days. Individual code revocation and tester tracking are not available; rotating `BETA_SESSION_SECRET` invalidates every generated code and every tester session. Keep the owner code and signing secret in a password manager, since Hostinger does not retain a history of environment values.

## Verify the deployment

1. Confirm Hostinger reports a successful build. Open `https://skypeek.brainitch.studio/` in a private browser window; the beta code gate should load. Choose **Learn more** to open `/info`, then return to `/`. Enter a wrong code, then a generated code, and verify that `/app`, `/lab`, and `/design` open after access is granted. Check that leaving beta from Settings returns to `/`.
2. Check the live weather routes: search for a US street address, open the radar SpotCheck storm outlines, and enable map-wide alerts. A build can succeed even if one of these external services is temporarily unavailable; inspect the deployment logs when an endpoint consistently fails.
3. Check the browser console and network requests for missing MapLibre worker assets and failed weather/radar requests.
4. In Hostinger's resource usage, watch memory, process count, and 503 responses during the beta. Weather collection runs largely in each visitor's browser, while the weather and beta API routes use the Hostinger Node.js process. More visitors also mean more upstream weather requests; the current request ledger is per browser, not account-wide.

## Beta access and data

This deployment uses the implemented [beta code gate](beta-code-gate-plan.md). The shared fallback code and expiring generated codes both open the same app. The fuller [admin backend plan](beta-admin-plan.md), with per-tester revocation and tracking, is deferred. Saved places and settings live in each browser's localStorage; accuracy records live in IndexedDB. They will not follow a tester to another device. Optional provider keys entered in Settings are stored in that browser and should not be shared or committed.

## Weather request budgets

Open-Meteo place search, extended forecasts, point weather, and wind/temperature grids now share a browser budget of 60 point units per minute, 240 per hour, and 1,500 per day. One grid location counts as one unit; the grid uses fewer locations and caches a view for 30 minutes. Optional grids stop before they consume capacity reserved for search and forecasts. IEM storm tracks have a separate browser budget of 10 requests per minute, 60 per hour, and 600 per day; historical replay stops before live storm reports. A provider's 429 response also pauses further calls temporarily. Active NWS alerts and NOAA radar are unaffected by these two budgets.

These are conservative app limits, not provider guarantees. The ledger is stored in each browser, so multiple devices, private windows, or cleared storage do not share one total. For a small beta this limits ordinary usage without a database. If you need a strict whole-app ceiling or usage reporting across all testers, route these providers through the Node.js server and store a shared counter and response cache there before inviting a larger group.

## References

- [Hostinger: Add a Node.js web app](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Hostinger: Node.js limits](https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/)
- [Hostinger: Subdomains](https://www.hostinger.com/support/1583405-how-to-create-and-delete-subdomains-in-hostinger/)
- [Next.js: Deploying](https://nextjs.org/docs/app/getting-started/deploying)
