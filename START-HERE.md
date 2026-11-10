# Sky Peek beta: start here

This folder contains the source for the official public [Sky Peek repository](https://github.com/brainitchstudio/skypeek). It includes the beta access gate, owner code manager, radar and forecast features, tests, lockfile, and GitHub Actions verification. It excludes local dependencies, build output, and real secrets. The beta gate controls app access; repository visitors can read the source.

1. In Hostinger, create your domain or subdomain as a **Node.js Web App** and import `brainitchstudio/skypeek` from GitHub. Choose Node.js 22, a repository root of `/`, `npm run build` to build, and `npm run start` to start. Use the npm lockfile for installation; choose `npm ci` if Hostinger offers an install-command field.
2. In Hostinger's Web App environment settings, add three independent private values: `BETA_ACCESS_CODE` (`openssl rand -hex 16`), `BETA_SESSION_SECRET` (`openssl rand -hex 32`), and `BETA_ADMIN_CODE` (`openssl rand -hex 24`). Keep all three out of GitHub. The shared code is optional to distribute but required to configure the current gate.
3. After deployment, open `/beta-admin` on your domain and sign in with the owner code. Generate a 7, 30, or 90 day access code, then test it in a private browser window at `/access`. Share access codes privately; never share the owner code or signing secret.
4. Check forecast, radar, alerts, and place search on the live domain before inviting testers. The GitHub workflow checks tests and build, but the real domain and hosting resources still need this live check.

See [the deployment guide](docs/hostinger-deployment.md) for details. A PHP-only or static Git hosting flow cannot run the app's server routes. Generated codes can be reused until expiry; there is no per-code revocation or tester list. Rotating the signing secret invalidates all generated codes and active tester sessions.

This standalone folder passed 888 tests and a production build on November 10, 2026. The beta access flow was also checked against a local production server. It has not been deployed to Hostinger from this folder.
