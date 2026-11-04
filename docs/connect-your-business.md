# Connect your business

From a fresh clone to your shop's own app calling the guarded agents, first on the sandbox, then with real money. About 30 minutes.

## 1. Deploy it

1. **Database.** Any Postgres: your own server, a hosted one, or locally `docker compose up -d` ([`docker-compose.yml`](../docker-compose.yml)). Put its connection string in `DATABASE_URL`. Without one, the app keeps its data in local files (development only).
   **Login.** Nothing to set up: the app keeps the owner's account in the same database (or in `data/auth.db` without one). Optionally use Neon Auth instead, for recovery by emailed code: create a free [Neon](https://neon.com) project with Auth (`neon init`, then `neon deploy`; [`neon.ts`](../neon.ts) asks for it), which writes `NEON_AUTH_BASE_URL` and that project's `DATABASE_URL`: Neon Auth keeps the owner's account in the same database, so the data lives in Neon too.
2. **Environment.** `cp env.example .env.local` and fill in what is left: `SETTINGS_SECRET` (16+ random characters), `APP_URL`, and with Neon Auth `NEON_AUTH_COOKIE_SECRET` (`openssl rand -base64 32`). Nothing else goes in the environment; the rest is set in the app.
3. **Host.** On Render (or any Node 24 host): build `npm ci && npm run build && npm run db:migrate`, start `npm run start`, and the same variables in the service's environment. With Neon Auth, also trust the site there: `neon neon-auth domain add https://your-app.onrender.com`.
4. **Owner.** Open the site: `/login` offers **Create the owner account** once. Forgot the password later: run `npm run owner:reset` on the server. With Neon Auth, close sign-up there too: `neon neon-auth config email-password update --disable-sign-up true`.

## 2. Set it up in Settings

| Section | What to enter |
|---|---|
| Business | Shop name, contact emails, and your refund policy in plain words: the agent follows it and the judge checks every call against it |
| Limits | Currency, the refund amount that runs on its own, the amount above which a person must approve (above the second: blocked), daily cap |
| AI model | Any OpenAI-compatible provider and key; **Test connection**, then the agent and judge models |
| PayPal app | Your **Sandbox app** (client ID and secret from [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox)); leave Live empty for now |
| Notifications | Where a held action is announced: Slack/Discord webhook, email, Telegram |
| API keys | **Create key** for your shop's app; it is shown once |

## 3. Try it on the sandbox

1. `npm run seed` (locally, with the same `.env.local`) creates three paid sample orders for ana, ben and carla.
2. **Test a model › Support** sends a ticket through the real agent and guard; the decision appears in **Guard log**. **Evaluate a model** runs the business and attack bench against your chosen model.
3. Call it from your app with the key. Every request field, response and error is in **API docs** (`/api-docs`, Swagger UI with *Try it out*), and the raw document at `/api/openapi` feeds any OpenAPI client generator.

   ```bash
   curl -X POST "$APP_URL/api/support/tickets" \
     -H "Authorization: Bearer $PAYMENT_GUARD_KEY" \
     -H "Content-Type: application/json" \
     -d '{"customerEmail":"ana@example.com","message":"My mug arrived broken."}'
   ```

   Show your customer `reply`; keep `steps` (each PayPal call and the guard's decision) for your logs; check `environment` (`live` or `sandbox`) before telling them money really moved.

   `customerEmail` is the customer your app has already identified (a signed-in user, the sender of a help-desk ticket). The guard lets the agent act only on that customer's orders, so never take it from what the customer typed.

## 4. Fit it to your shop

These pieces are demo data today. Each sits behind a small interface, so replacing it does not touch the guard:

| What | Today | Replace with |
|---|---|---|
| Who owns an order | `custom_id` of the PayPal purchase unit, which the demo sets to the customer's email when it charges | Have your checkout set `custom_id` to your customer's id or email on every order |
| Your customers (billing) | The seeded sample customers ([`seed-customer-directory.ts`](../lib/guard/adapters/seed-customer-directory.ts)) | A `CustomerDirectory` that asks your own customer records |
| Your catalogue (sales) | [`lib/shop/catalogue.ts`](../lib/shop/catalogue.ts) | Your products and prices, from your store or database |
| Agent instructions | Business › refund policy, and the built-in prompts in [`lib/agent`](../lib/agent) | Your policy text; edit the prompts only to change the agent's role |

See [architecture.md](architecture.md) for the ports and how to add a check.

## 5. Go live

Only when the sandbox behaves as you expect:

1. Set `ALLOW_LIVE_MODE=true` on the host.
2. Settings › PayPal app › **Live app**: the client ID and secret from the Live tab of your PayPal app.
3. Settings › PayPal app › Mode › **Live**, type `LIVE`. The server checks the credentials with live PayPal first.

From then on, requests with an API key run on live PayPal; the test pages and the evaluation stay on the sandbox. Every decision records its environment in the guard log. **Test** switches back at once.
