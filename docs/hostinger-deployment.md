# Hostinger deployment

Sky Peek is a Next.js app with live API routes and a server-side beta gate. Deploy it as a **Node.js Web App**, not through Hostinger's PHP/HTML Git integration or as a static export. The existing `npm run build` and `npm run start` scripts are the build and start commands. MySQL is not needed for the current app.

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

### Beta gate variables

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
3. Test one code in a private browser window at `/access`. The owner page is intentionally separate from the app navigation.

Generated codes are self-contained signed tokens; no database or redeployment is needed to create them. They can be reused and forwarded until expiry. Expiry stops new sign-ins, while a session already issued can last up to seven more days. Individual code revocation and tester tracking are not available; rotating `BETA_SESSION_SECRET` invalidates every generated code and every tester session. Keep the owner code and signing secret in a password manager, since Hostinger does not retain a history of environment values.

## Verify the deployment

1. Confirm Hostinger reports a successful build. Open `https://skypeek.brainitch.studio/` in a private browser window; it should redirect to `/access`. Enter a wrong code, then a generated code, and verify that `/`, `/lab`, and `/design` open after access is granted. Check that leaving beta from Settings returns to `/access`.
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
