# Beta code gate

Status: implemented locally. Production deployment on Hostinger still needs to be completed and checked on the actual domain.

## Tester access

Visitors enter a code at `/access`. A valid code creates a signed, `HttpOnly`, `Secure`, `SameSite=Lax` cookie lasting up to seven days. Next.js Proxy redirects anonymous page requests to `/access` and returns `401` for protected API requests. The app supports multiple shared access codes as comma-separated salted hashes in `BETA_ACCESS_CODE_HASHES` in the hosting environment. The older plaintext `BETA_ACCESS_CODE` works only when no hash is set.

The gate keeps casual visitors out of a small beta. It does not hide client JavaScript or public weather sources, and it is not an account system. Testers can share codes with others. Data such as saved places, optional weather-provider keys and diagnostics remain in each tester's browser.

## Owner code generation

Set a separate `BETA_ADMIN_CODE` and visit `/beta-admin`. After owner sign-in, generate an access code valid for 7, 30 or 90 days. The code is signed with the server-only `BETA_SESSION_SECRET`, so it can be verified without a database. The owner session uses a separate `HttpOnly`, `Secure`, `SameSite=Strict` cookie lasting 12 hours. The generation endpoint checks that requests come from the same origin and requires the owner cookie. Failed owner sign-ins have a small in-memory throttle.

Generated codes are reusable until expiry. A tester who signed in before expiry keeps their session for up to seven days. There is no list of previously generated codes, usage log, per-code revocation or individual tester identity. Rotate `BETA_SESSION_SECRET` in the hosting dashboard and restart the app to invalidate all generated codes and sessions. Rotate `BETA_ADMIN_CODE` to end owner sessions. The throttle resets when the server restarts.

## Deployment

Follow [Hostinger deployment](hostinger-deployment.md) for the GitHub connection, supported hosting plan, runtime variables and production verification steps. Never put real codes or secrets in the repository, client JavaScript or shareable URLs.

The deferred [admin backend plan](beta-admin-plan.md) covers individual invites, revocation and a persistent audit log if the beta grows beyond a small trusted group.
