# Hosting Thaloroot on Cloudflare

The game runs on Cloudflare's free plan:

- A **Worker** serves the web app and opens rooms.
- Each room is a **Durable Object**. It holds the live connections to the TV and phones, runs the computer players, and saves the game after every move.
- Rooms nobody has used for three days are cleared away.

Settings live in `packages/server/wrangler.jsonc`, and the code is `packages/server/src/worker.ts`. The game logic is the same `Room` the local server uses (`packages/server/src/room.ts`).

## One-time setup

1. **Pick your workers.dev address.** In the Cloudflare dashboard, open **Workers & Pages**. If it asks you to choose a subdomain, pick one, for example `josh`. The game will live at `https://thaloroot.<subdomain>.workers.dev`.
2. **Copy your account ID.** On the same **Workers & Pages** page, find **Account Details** and select the copy button next to **Account ID**. (Or press Ctrl+K or Cmd+K anywhere in the dashboard and search for "Copy account ID.")
3. **Create an API token.**
   1. Go to **Manage account**, then **Account API tokens**, and select **Create Token**.
   2. Under the permission templates, choose **Edit Cloudflare Workers**.
   3. Scope it to your account only.
   4. Create the token and copy it. Cloudflare shows it once.
4. **Give both to GitHub.**
   1. In the GitHub repository, go to **Settings**, then **Secrets and variables**, then **Actions**.
   2. Select **New repository secret** and add:
      - `CLOUDFLARE_API_TOKEN`: the token
      - `CLOUDFLARE_ACCOUNT_ID`: the account ID
   3. Never paste the token anywhere else, including chats and commits.

## Deploying

- Every merge to `main` runs the **Deploy** workflow. It tests, builds, and publishes.
- To publish without a merge, open the repository's **Actions** tab, choose **Deploy**, and select **Run workflow**.
- Until both secrets exist, the workflow skips the publish step with a warning instead of failing.

From a computer with the token in `CLOUDFLARE_API_TOKEN`, this also works: `npm run build && npm run deploy -w @thaloroot/server`

## Trying it locally exactly as Cloudflare runs it

```sh
npm run build
npm run cf:dev -w @thaloroot/server     # http://localhost:8787, using Cloudflare's own runtime
```

Rooms persist in `packages/server/.wrangler/` between runs.

## Limits worth knowing (free plan)

- **About 100,000 requests a day.** A move from a phone counts as a fraction of a request, so this covers a very large number of games.
- **Saved games are capped at 2 MB.** A long 8-player game saves at about 230 KB.
- **No custom domain yet.** A custom domain can be added later from the dashboard.
