# Setup and configuration

Running it, the database, sign-in, API keys, live mode and every setting. For a step-by-step path to a real shop, see [Connect your business](connect-your-business.md).

## Run locally

Requires Node.js 24 or later (the payment guard's log uses the built-in `node:sqlite`) and a PayPal sandbox REST app ([developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox)). The transactions and balances pages also need the app's **Transaction search** feature enabled.

```bash
npm install
cp env.example .env.local   # database, login and secrets only; the rest is set on /settings
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Next.js only loads the dotted `.env.local`; it is git-ignored, so credentials stay out of the repo.

Other scripts: `npm run build` (production build), `npm run start` (serve the build), `npm run lint`.

### Database (Postgres, optional locally)

Without `DATABASE_URL` the guard keeps its black box in `data/guard-audit.db` (SQLite) and the settings in `data/settings.json`. With `DATABASE_URL` set (a Postgres connection string, e.g. Neon's pooled one) both live in Postgres instead, so they survive restarts on hosts without a persistent disk. The database holds two separate stores: schema `auth` for the owner's account and schema `guard` for the black box (`guard.audit_log`) and the settings (`guard.settings`, one row per installation). Neon Auth keeps its own users in schema `neon_auth`.

- `npm run db:migrate` creates or updates the schemas; it is safe to run on every deploy, and the server also runs it before its first query. It uses `DATABASE_URL_UNPOOLED` (Neon's direct connection) when set.
- `npm run db:probe` checks the Postgres stores against the real database inside a throwaway schema (`guard_probe_…`) that it drops at the end, so the real `guard` schema gets no test rows.
- `npm run db:copy-sqlite` copies a local `data/guard-audit.db` into an empty Postgres black box, keeping every row's id, order and hash.

Setting `SETTINGS_FILE` keeps the settings in that file even when `DATABASE_URL` is set.

**Any Postgres works**, not only Neon: the app speaks plain Postgres through [`pg`](https://node-postgres.com) and was checked with `npm run db:probe` against a non-Neon server. Pick one:

| Where | `DATABASE_URL` |
|---|---|
| Nothing (local) | unset: SQLite file and `data/settings.json` |
| Docker (local) | `docker compose up -d` with the repo's [`docker-compose.yml`](../docker-compose.yml), then `postgres://guard:guard@localhost:5432/payment_guard` |
| Neon, Supabase, RDS, Render Postgres, your own server | that provider's connection string (`sslmode=require` is upgraded to full certificate checks) |

Connections with `sslmode=require` check the server's certificate and host name. A provider whose certificate is signed by its own authority (Supabase, Amazon RDS) then needs that authority's certificate: download it from the provider and add `&sslrootcert=/path/to/ca.pem` to `DATABASE_URL`. A certificate error at start-up means exactly that.

Only **Neon Auth** ties you to Neon: it keeps its users in the Neon database (schema `neon_auth`), and the app finds the owner there, so with Neon Auth `DATABASE_URL` must be that Neon database (see [Sign-in](#sign-in)). With any other Postgres, or none, the built-in owner login protects the app. [`neon.ts`](../neon.ts) is only read by the `neon` CLI.

**On Render:** build command `npm ci && npm run build && npm run db:migrate`, start command `npm run start`. Set `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) in the service's environment, and `SETTINGS_SECRET` (16+ characters) so saved keys are encrypted with a key that is not stored in the same database.

## Sign-in

Every page and API route is protected ([`proxy.ts`](../proxy.ts), [`lib/auth/gate.ts`](../lib/auth/gate.ts)); static files are not. Which protection applies depends on the environment:

| Mode | When | How you get in |
|---|---|---|
| Built-in owner login | `NEON_AUTH_BASE_URL` is not set | The installation's one owner signs in on `/login` with an email and password the app keeps itself: in `DATABASE_URL`'s `auth` schema (tables `owner` and `sessions`), or without a database in a SQLite file, `AUTH_DB` (default `data/auth.db`, created readable by the server's user only). |
| Neon Auth | `NEON_AUTH_BASE_URL` is set | The same, with the account kept by [Neon Auth](https://neon.com/docs/auth/overview), which adds recovery by emailed code. |

In both, pages without the owner's session go to `/login` and API routes answer 401; **Sign out** is at the bottom of the side menu.

**Built-in owner login.** Open the app: with no owner yet, `/login` shows **Create the owner account** (email, and a password of at least 12 characters with a lowercase letter, an uppercase letter and a digit). That account is the owner; creating it is atomic, so from then on `/login` only signs in and any second set-up is refused. The password is stored only as a scrypt hash (random 16-byte salt, N=2^15, r=8, p=1, 64-byte key) and checked in constant time; a sign-in with another address costs the same hash, so the timing doesn't reveal the owner's address. A session is a random 32-byte token in the `pg_session` cookie (HttpOnly, SameSite=Lax, Secure over https) that lasts 7 days; the server keeps only its SHA-256, so signing out ends it for good. If the account store can't be read, requests count as signed out.

**Forgot the password (built in):** there is no email; whoever can run commands on the server runs `npm run owner:reset` there (with the app's `DATABASE_URL` or `AUTH_DB`). It sets a new random password that meets the rule, prints it once, and signs out every session; with no owner yet it says so and changes nothing. `/login` shows this instead of a "Forgot your password?" link, and `/login/forgot` and `/login/reset` lead back to `/login`.

**Neon Auth** needs, besides `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (signs the session cookies; 32 characters or more, e.g. `openssl rand -base64 32`) and `DATABASE_URL` (the owner is looked up in Neon Auth's `neon_auth.user` table). If either is missing the app refuses every request with 503 instead of falling back to a weaker gate; if Neon Auth or the database can't be reached, requests count as signed out.

Set it up once:

1. Enable Neon Auth on the Neon project (`auth: true` in [`neon.ts`](../neon.ts), then `neon deploy`, which writes `NEON_AUTH_BASE_URL` to `.env.local`), and add `NEON_AUTH_COOKIE_SECRET`. On the host, set the same variables and add the site's origin to Neon Auth's trusted domains: `neon neon-auth domain add https://your-app.onrender.com` (localhost is trusted by default).
2. Open the app: with no owner yet, `/login` shows **Create the owner account** (email, and a password of at least 12 characters with a lowercase letter, an uppercase letter and a digit). That account is the owner; from then on `/login` only signs in, and the app refuses any second set-up.
3. Close sign-up at Neon Auth too, so nobody can create accounts directly against its endpoint: `neon neon-auth config email-password update --disable-sign-up true`. The app already lets in only the owner (the oldest account), whatever other accounts exist; this keeps the user table clean.

**Forgot your password? (Neon Auth)** on `/login` leads to `/login/forgot`: type the owner's email and Neon Auth emails a code (from its shared sender `auth@mail.myneon.app` until you set up custom SMTP, which production needs: [checklist](https://neon.com/docs/auth/production-checklist.md); codes work on the shared sender, reset links would not). Enter the code with a new password (same rule as above) on `/login/reset`; every session of the owner is then signed out (a browser's cached session lasts up to 5 more minutes). The page answers the same for any address and only the owner's address gets a code; a client may ask 5 times per 15 minutes, the owner's address gets at most one code a minute, and wrong codes count toward the sign-in lockouts (below). With the built-in login these pages are not offered.

**Brute force:** in both modes, two lockouts guard the sign-in (and Neon Auth's reset code). Per client, 10 failures lock it out for 15 minutes; but the client is told by headers a caller can forge, so for the owner's account, from any client, the 5th failure in a row locks it for 1 minute, and every further failure doubles the wait (2, 4, 8, 16, 32, then 60 minutes at most); signing in or resetting the password, or a day with no failure, starts the count over. While locked, the password is not checked at all, and each try is counted before it is checked, so guesses sent at the same moment can't slip past the count. Other addresses get the same answers from a separate count, so "locked" never reveals the owner's address, and flooding it with addresses can't clear the owner's lock. Under an attack the owner is locked out too, at most an hour at a time. Both are kept in memory per server process (a restart clears them).

To start over (a new owner) with the built-in login, delete the `owner` row (and `sessions`) from the `auth` schema or `AUTH_DB`. With Neon Auth, delete the owner with `neon neon-auth user delete <user-id>` and turn sign-up back on with `--disable-sign-up false`; the set-up form returns within 5 minutes (the owner is cached per server process).

### API keys

Your shop's own app (a checkout, a help-desk integration) calls the agents with a key instead of signing in. Keys need `DATABASE_URL`; without it the section explains that and no key is accepted.

1. **Create:** the **API** page (`/api-docs`), **API keys**: give the key a name, **Create key**. The whole key (`pg_` and 43 more characters) is shown once: copy it into your app's secrets. Only its SHA-256 hash and last 4 characters are stored (`guard.api_keys`).
2. **Call:** send it as a bearer token:

   ```bash
   curl -X POST https://your-app.onrender.com/api/support/tickets \
     -H "Authorization: Bearer pg_your_key_here" \
     -H "Content-Type: application/json" \
     -d '{"customerEmail":"ana@example.com","message":"My mug arrived broken."}'
   ```

   The answer is JSON: `reply` is the text to show your customer (for a sale, with the PayPal link where they pay); `steps` lists each PayPal call the agent tried and what the guard decided, for your logs and staff, not for the customer; `environment` says whether real money could move (`live`) or only test money (`sandbox`). Every field and error is in [API docs](#api-reference).

3. **Revoke:** **Revoke** next to the key in the list; calls with it get 401 at once. The list shows when each key was created and last used (updated at most once a minute).

**Scope:** a key opens exactly three endpoints, `POST /api/support/tickets`, `POST /api/billing/tasks` and `POST /api/sales/chats`, with either sign-in. Nothing else accepts it: not the pages, not `/api/guard/*`, not `/api/auth/*`, not Server Actions. A wrong or revoked key gets `401 {"error":"Invalid or revoked API key."}`, never a redirect. The proxy tells the route a request came in with a key in the `x-pg-auth: api-key:<key id>` request header, after removing any copy the client sent.

### API reference

**API** in the menu (`/api-docs`) shows your API keys and the three agent endpoints in [Swagger UI](https://swagger.io/tools/swagger-ui/): each request field and its limits, the reply with every guarded tool call, and every error. **Authorize** takes an API key so *Try it out* calls them as your app would (on live PayPal while live mode is on); without a key the calls use your session and run on the sandbox. The OpenAPI 3.1 document itself is at `/api/openapi` ([`lib/api/openapi.ts`](../lib/api/openapi.ts)), for client generators; its server is `APP_URL`. Both need the owner's sign-in; an API key does not open them. Swagger UI is loaded from jsDelivr at a pinned version checked with Subresource Integrity, so the app gains no dependency.

### Live mode

Payment Guard starts in **test mode**: every PayPal call runs on the sandbox, with fictitious money. **Live mode** lets your shop's own app move real money through the guard, with your live PayPal app.

**Requirements**, all checked again on every request (otherwise everything runs on the sandbox, and Settings, the overview and the guard log say why):

1. The server allows it: `ALLOW_LIVE_MODE=true` in its environment. The public demo leaves it unset, so nobody can turn live mode on there.
2. The live app is saved: Settings › **PayPal app** › **Live app (real money)**, the client ID and secret from the Live tab of Apps & Credentials in the PayPal Developer Dashboard. It is encrypted like the other keys and never read from the environment.
3. The owner turns it on: Settings › PayPal app › **Mode** › **Live**. A dialog explains what it does and asks you to type `LIVE`; the server then asks live PayPal (`api-m.paypal.com`) for a token with the live app's credentials, and only if PayPal accepts them does live mode turn on. Saving another live app (client ID or secret) turns it off again, so a new app is always checked first. A read-only server (`SETTINGS_LOCKED=true`) can't turn it on.

**What goes live:** only requests to the three agent endpoints that come in with an [API key](#api-keys) (your shop's app): their toolkit, the guard's lookups, the order approval links, and the shop's capture when the buyer comes back from a live order. A held live call is approved on live PayPal, and only while live mode is on (it can always be rejected). Every guard decision records its environment, shown in the guard log's **Environment** column and in its CSV/JSON download, and the overview and the guard log show a **Live mode** notice while it is on. The vulnerable agent never runs live (`400`).

**What never goes live:** the test pages (Support, Billing, Sales) and the evaluation, which use the owner's session, the sample data buttons and `npm run seed`, and the dashboard, which always reads the sandbox account (live dashboard data is on the roadmap). The guard's daily limits count sandbox and live decisions together.

**Switching back:** Settings › PayPal app › Mode › **Test**. It takes effect at once, needs no confirmation and works even on a read-only server. Unsetting `ALLOW_LIVE_MODE`, or removing the live app's secret, also puts every request back on the sandbox at once.

## Settings

`/settings` configures everything the agent and the guard use. [`env.example`](../env.example) lists only what the server needs before anyone signs in (database, login, secrets, live-mode permission); the older variables (`PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `LLM_BASE_URL`, `LLM_API_KEY`, `SHOP_CONTACT_EMAIL` and the notification ones below) are still read as fallbacks when a setting is empty:

| Section | What it sets |
|---|---|
| Business and rules | **Your business:** name, contact emails replies may include, and the refund policy the agent follows and the judge checks against. **Refund limits:** currency, refunds that run on their own, refunds a person approves (above: blocked), daily cap. **From your documents:** paste or load (.txt, .md) your refund policy, terms or handbook; the AI model proposes the refund policy and refund limits they state, each with the sentence it comes from. A proposal is kept only when that sentence really is in the document. Stricter limits start ticked; looser limits and a new policy text start unticked with a warning. Nothing is saved until you apply, and applying goes through the same checks as the form |
| AI | Provider from the catalog, base URL, API key, agent and judge models; **Test connection** lists the provider's models |
| PayPal | Two apps: the sandbox app (client ID and secret, test money) and the live app (real money, saved here only); **Test connection** asks the sandbox, or live PayPal for the live app, for a token. The **Mode** switch, Test or Live ([Live mode](#live-mode)) |
| Notifications | Where every refund held for a person is announced, each optional: a Slack or Discord webhook URL (or `GUARD_WEBHOOK_URL`); email to the contact emails through your own mail server over SMTP (or `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`) or through Resend, with its API key (or `RESEND_API_KEY`), from a sender address (or `NOTIFY_EMAIL_FROM`); a Telegram bot token and chat id (or `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) |

The AI catalog ([`lib/settings/catalog.ts`](../lib/settings/catalog.ts)) comes from [models.dev](https://models.dev), the open provider and model database OpenCode and Pi use: every provider it serves through an OpenAI-compatible API, and for each only the models that can call tools, with context size and price. Verified presets ([`lib/settings/providers.ts`](../lib/settings/providers.ts)) come first: Anthropic, OpenAI, Gemini, Mistral, xAI, DeepSeek, Qwen, Kimi, GLM, MiniMax, OpenRouter, Groq, OpenCode Go, and local Ollama and LM Studio. Any other OpenAI-compatible URL works as **Custom**. The catalog is fetched once every 6 hours; if models.dev can't be reached, the presets still work and models can be typed.

A model on your own machine or network (localhost, a private address or a `.local` name: Ollama, LM Studio, a llama.cpp or vLLM server) gets longer waits than a hosted one ([`lib/llm/timeouts.ts`](../lib/llm/timeouts.ts)): 3 minutes per agent answer and 5 per ticket instead of 1 and 1½, 1 minute per judge verdict instead of 15 seconds, 2 minutes for the guard assistant instead of 30 seconds, and 5 minutes to read a document instead of 2½.

Settings are saved in `data/settings.json` (`SETTINGS_FILE` moves it), or in Postgres when `DATABASE_URL` is set (see [Database](#database-postgres-optional-locally)). Keys (the Resend key, SMTP password and Telegram bot token included), and the webhook URL (it embeds a token), are encrypted with AES-256-GCM and the page only ever shows their last 4 characters. The encryption key is `SETTINGS_SECRET` when set (best kept in the host's secrets manager); otherwise a random key is generated in `data/settings.key`, readable only by the server account (on Postgres: in `guard.settings_key`), which protects a copied `settings.json` but not a copied `data/` folder (or database). A key is only sent to the URL or PayPal client ID it was saved or set for: changing the URL on the page never sends an existing key elsewhere. `SETTINGS_LOCKED=true` makes the page read-only and turns off the connection tests, for a public demo. On hosts with an ephemeral disk (Render's free plan), saved settings last until the next deploy unless `DATABASE_URL` is set; the environment variables are the durable configuration there.

### AG Studio licence (optional)

Set `AG_STUDIO` in `.env.local` to your AG Studio licence key. The dashboard passes it to `AgStudioProvider`.

### AI assistant (optional)

The AG Studio dashboard at `/dashboard` has an AI assistant backed by OpenAI. The key is taken from the first of these that is set; with neither, the assistant is hidden:

1. `AG_STUDIO_OPENAI_API_KEY`, specific to this app. Put it in `.env.local` to choose the key for this demo.
2. `OPENAI_API_KEY`, the name OpenAI's own tools use. If you already export one (e.g. in `~/.zshrc`), the demo uses it with no setup, and spends against it.

A separate name is needed because Next.js prefers variables already in the environment over `.env.local`, so a globally exported `OPENAI_API_KEY` can't be overridden per project. The server logs which variable it used (never the key) the first time the assistant is configured.

`OPENAI_MODELS` lists the model ids the assistant may use, comma-separated, first one the default (`gpt-5.4-mini` when unset); with two or more, the chat offers a model picker.

The key never reaches the browser. Studio's adapter ([`openai-adapter.ts`](../app/dashboard/studio/openai-adapter.ts), copied from the AG Studio docs) runs client-side and posts to this app's own [`/api/ai/responses`](../app/api/ai/responses/route.ts), which adds the key, only allows the configured models, caps output tokens, and streams OpenAI's reply back.

In production `.env.local` isn't deployed: set the variable in your host's environment (e.g. Vercel project settings, `docker run --env-file`, or a secrets manager), as with the PayPal credentials. The route sits behind the owner's sign-in like every page, but has no rate limit of its own, so give the key a spending cap at the provider.
