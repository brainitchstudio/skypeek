# Sky Peek folder upload installation

This package is for shared hosting with a persistent **Node.js 22 or newer web app** and HTTPS. A PHP-only or static file hosting folder cannot run Sky Peek's server routes. No database is needed.

Create the zip with `npm ci` and `npm run package:shared` on the same OS and CPU architecture as the hosting server. Next.js may bundle platform-specific native dependencies. The installer token is unique to each package, so keep the zip private. A package made on macOS is useful for local testing but should be rebuilt on Linux for a typical shared host.

1. In Hostinger, open the existing `skypeek.brainitch.studio` Node.js Web App, or create one with **Websites → Create site → Web App** if that domain is not yet assigned. Choose **Upload your files** for the ZIP. Use Node.js 22 or newer. If Hostinger does not recognize the prebuilt app, select **Other**, set Build command to **None**, and Entry file to `server.js`. Do not use the PHP/HTML website upload flow.
2. Upload `sky-peek-shared-hosting.zip`. Include hidden files and folders such as `.next` and `.sky-peek-install-token`. Hostinger serves the Node app behind its own web server; the app root must not be exposed as raw files.
3. Start or restart the Node app. Open your HTTPS domain. It redirects to `/install`.
4. Read the installation token privately from `.sky-peek-install-token` in the package or private app folder. It is no longer printed to build logs. Choose a visitor access code of at least 12 characters and a distinct owner code of at least 20 characters. Save both codes privately.
5. After setup, the domain shows the public homepage. Its **Log in** link opens `/access`; a valid visitor code opens `/app`. The owner page is `/beta-admin`, where you can also edit homepage text. The setup page is now locked, and the token file is deleted.

The setup creates a private `.sky-peek-config.json` with permissions for the Node user. On Hostinger it lives at `domains/skypeek.brainitch.studio/.sky-peek-data/`, outside the replaceable `hbuilds` deployment folder. It contains salted hashes of both codes and a random session signing secret. Homepage edits are stored there too. Back up this folder securely. Never put it under `public_html`, `public`, or source control. If the Node process cannot write there, set `SKY_PEEK_DATA_DIR` in Hostinger's environment variables to another private persistent writable folder, restart, and retry setup.

The security update also keeps revocable sessions and shared login budgets under this private data directory. Preserve it across deployments and share it between Node workers on the same host. Everyone must sign in once after the session-format migration; valid access codes remain usable. See the Security rollout requirements in `docs/hostinger-deployment.md` before deployment.

For ongoing app code changes, connect the repository through Hostinger's **GitHub deployment** option. Pushes trigger new builds automatically, so there is no manual file upload for each change. Next.js still needs a new build for code changes. The private setup data remains outside Hostinger's replaced deployment folders. For ZIP updates, upload a new package; its token is ignored after installation. Keep the `.sky-peek-data` folder when updating or switching deployment methods.

If `skypeek.brainitch.studio` already has valid `BETA_*` environment variables, the app is treated as configured and the installer stays locked. Keep that setup or remove those variables before using this wizard. Do not remove them from a live deployment until the replacement is ready. See `docs/hostinger-deployment.md` for the GitHub deployment path.
