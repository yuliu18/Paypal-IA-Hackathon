> [!TIP]
> **PayPal AI Hackathon**
> 
> Win part of $69,750 in total prizes
> 
> Build What's Next with PayPal and AI is a global online hackathon inviting developers, designers, founders, students, and builders to create something new using PayPal and AI.
> 
> There are no prescribed problem statements and no set of tracks. Build an agent, an app, an automation, a new payment experience, a business tool, a social product, or something we haven't thought of yet.
> 
> https://paypalaihackathon.devpost.com

# PayPal SDK data pages

A Next.js app that reads PayPal sandbox data over the [PayPal REST API](https://developer.paypal.com/api/rest/), and puts a payment guard between an AI support agent and PayPal:

- **Endpoint pages**: one [AG Grid](https://www.ag-grid.com/react-data-grid/) per PayPal endpoint the demo calls, showing what each returns.
- **Dashboard** (`/dashboard`): an [AG Studio](https://www.ag-grid.com/studio/) report over all of that data, joined together, which you can edit and save in the browser.
- **Payment guard** (`/support`, `/guard`): an AI support agent answers tickets with PayPal's MCP tools, and every call it makes goes through a guard that allows, holds for a person, or blocks it, and writes the decision to a tamper-evident log. See [Payment guard](#payment-guard).

## Run locally

Requires Node.js 24 or later (the payment guard's log uses the built-in `node:sqlite`) and a PayPal sandbox REST app ([developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox)). The transactions and balances pages also need the app's **Transaction search** feature enabled.

```bash
npm install
cp env.example .env.local   # then fill in the values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Next.js only loads the dotted `.env.local`; it is git-ignored, so credentials stay out of the repo.

Other scripts: `npm run build` (production build), `npm run start` (serve the build), `npm run lint`.

### AG Studio licence (optional)

Set `AG_STUDIO` in `.env.local` to your AG Studio licence key. The dashboard passes it to `AgStudioProvider`.

### AI assistant (optional)

The AG Studio dashboard at `/dashboard` has an AI assistant backed by OpenAI. The key is taken from the first of these that is set; with neither, the assistant is hidden:

1. `AG_STUDIO_OPENAI_API_KEY`, specific to this app. Put it in `.env.local` to choose the key for this demo.
2. `OPENAI_API_KEY`, the name OpenAI's own tools use. If you already export one (e.g. in `~/.zshrc`), the demo uses it with no setup, and spends against it.

A separate name is needed because Next.js prefers variables already in the environment over `.env.local`, so a globally exported `OPENAI_API_KEY` can't be overridden per project. The server logs which variable it used (never the key) the first time the assistant is configured.

`OPENAI_MODELS` lists the model ids the assistant may use, comma-separated, first one the default (`gpt-5.4-mini` when unset); with two or more, the chat offers a model picker.

The key never reaches the browser. Studio's adapter ([`openai-adapter.ts`](app/dashboard/studio/openai-adapter.ts), copied from the AG Studio docs) runs client-side and posts to this app's own [`/api/ai/responses`](app/api/ai/responses/route.ts), which adds the key, only allows the configured models, caps output tokens, and streams OpenAI's reply back.

In production `.env.local` isn't deployed: set the variable in your host's environment (e.g. Vercel project settings, `docker run --env-file`, or a secrets manager), as with the PayPal credentials. The route has no auth or rate limiting, so don't deploy it publicly with a real key without adding one.

## How it works

```
lib/paypal.ts            Every PayPal call: OAuth token, paging, retries, response types
lib/dashboard-data.ts    Turns those responses into the dashboard's related tables
app/(endpoints)/         One page per endpoint, each rendering an AG Grid
app/dashboard/           The AG Studio dashboard
app/api/ai/responses/    Server-side proxy for the dashboard's AI assistant
lib/agent/               The AI support agent and the wiring of one ticket (handle-ticket.ts)
lib/guard/               The payment guard: policy, intent judge, audit log, approvals
app/support/             Support desk: send a ticket to the agent
app/(endpoints)/guard/   Guard log, approval queue and black box check
```

[`lib/paypal.ts`](lib/paypal.ts) calls the REST API with plain `fetch`, no SDK. It gets an OAuth access token with the client-credentials grant and caches it until just before it expires. It follows `page`/`total_pages` paging, and retries on 401, 429 and 5xx responses. Its types are hand-written for the fields this demo reads, in the API's own snake_case.

Every page is a server component that calls `await connection()`, so it renders per request with live data instead of being prerendered at build time. PayPal credentials never leave the server.

## Endpoint pages

Each page in [`app/(endpoints)`](app/(endpoints)) calls one function in `lib/paypal.ts`, maps the response to flat rows, and passes them with plain column definitions to the shared [`DataGrid`](app/(endpoints)/data-grid.tsx). The page header shows the REST calls behind it.

| Page | `lib/paypal.ts` function | REST calls |
|---|---|---|
| [`/products`](app/(endpoints)/products/page.tsx) | `listProducts()` | `GET /v1/catalogs/products`, then `GET /v1/catalogs/products/{id}` per product |
| [`/plans`](app/(endpoints)/plans/page.tsx) | `listPlans()` | `GET /v1/billing/plans`, then `GET /v1/billing/plans/{id}` per plan |
| [`/invoices`](app/(endpoints)/invoices/page.tsx) | `listInvoices()` | `GET /v2/invoicing/invoices`, then `GET /v2/invoicing/invoices/{id}` per invoice |
| [`/transactions`](app/(endpoints)/transactions/page.tsx) | `searchTransactions(start, end)` | `GET /v1/reporting/transactions` |
| [`/balances`](app/(endpoints)/balances/page.tsx) | `getBalances()` | `GET /v1/reporting/balances` |

Things worth knowing about these endpoints:

- **List endpoints return summaries.** Products have no type or category, plans no billing cycles, and invoices no line items, payments or refunds. So each record is fetched again in full, which is why these pages take a second or two.
- **Billing plans keep their price in `billing_cycles`.** There is an optional `TRIAL` cycle, then the `REGULAR` cycle; `total_cycles: 0` means it bills until cancelled.
- **Transaction Search covers at most 31 days per request** and rejects fractional seconds in dates. New activity can take up to three hours to appear. `fields=all` adds `payer_info` to each `transaction_info`. Event codes are [PayPal T-codes](https://developer.paypal.com/docs/transaction-search/transaction-event-codes/) (`T0001` = payout); status is `S` success, `P` pending, `D` denied, `V` reversed or `F` partially refunded.
- **Amounts are decimal strings with a currency**, e.g. `{ "value": "2.99", "currency_code": "USD" }`. `amountOf()` turns them into numbers, and the grid formats money columns in each row's currency.

### The grid

Pages are server components, so the column definitions they pass to the grid must be plain data, with no functions. Money columns use the `type: 'money'` column type, defined in `data-grid.tsx`, which formats the value in the row's `currency`. Date columns use AG Grid's built-in `cellDataType: 'dateString'` or `'dateTimeString'`. Every column can be sorted and filtered, and the search box filters across all columns.

## Dashboard

[`/dashboard`](app/dashboard/page.tsx) fetches all five endpoints at once. [`lib/dashboard-data.ts`](lib/dashboard-data.ts) turns them into related tables: customers, invoices, invoice line items, invoice payments, products, plans, transactions, payouts and balances. It adds the payment guard's decisions from its audit log ([`lib/guard/dashboard-rows.ts`](lib/guard/dashboard-rows.ts)) as two more tables, guard decisions and guard violations. AG Studio's data sources, relationships, theme, default report and AI assistant are configured in [`app/dashboard/studio`](app/dashboard/studio). Reports you create or edit are saved in the browser's localStorage; a browser that saved the built-in report keeps that copy, so use **Reset demo** to see pages added to it later, such as Payment guard.

## Payment guard

An AI agent with refund tools can be talked into refunding the wrong order, the wrong customer or too much: a ticket is untrusted text, and a prompt injection in it reaches the agent's instructions. The payment guard is an MCP server that sits between the agent and [PayPal's agent toolkit](https://github.com/paypal/agent-toolkit). The agent only ever talks to the guard; the guard decides what reaches PayPal.

### Try it

1. Fill in the LLM variables in `.env.local` (`LLM_BASE_URL`, `LLM_API_KEY`, `AGENT_MODEL`, optionally `JUDGE_MODEL`); any OpenAI-compatible endpoint works.
2. `npm run seed` charges three sandbox payments (ana 49.99, ben 120.00, carla 35.50 USD) and writes their capture ids to `data/seed.json`. Run it again before each demo: a refunded order can't be refunded twice.
3. Open `/support`, pick a sample ticket and send it. Each tool call the agent made is listed; held ones show in amber and blocked ones in red. Tick **Vulnerable agent** to make the agent obey whatever the ticket says, and watch the guard stop it.
4. Open `/guard` to see every decision, approve or reject held refunds, and check the black box.

### What it decides

Reads pass through only for single records that belong to the ticket customer (`get_order`). Any tool not listed is blocked by default. A refund (`create_refund`) is checked against the shop's policy in [`lib/guard/domain/policy.ts`](lib/guard/domain/policy.ts), using the capture as PayPal reports it, and against an LLM intent judge that compares the call with the ticket and the shop's instructions. The stricter answer wins: block over hold over allow.

| Refund | Result |
|---|---|
| Breaks a rule: other customer, more than is refundable, other currency, over the daily limit | Blocked |
| Over 250 USD | Blocked |
| Over 100 and up to 250 USD | Held for a person |
| The judge is unsure (answers `review`) | Held for a person |
| Up to 100 USD, no rule broken, judge agrees | Runs |

The limits (100 / 250 USD per refund, 200 USD per day) are set in [`lib/agent/handle-ticket.ts`](lib/agent/handle-ticket.ts) for a small shop and the seeded payments. If the judge, PayPal or the audit log can't be reached, the guard blocks: it fails closed.

### Approving a held refund

A held refund moves no money; the agent is told a person will review it. On `/guard`, **Approve** checks the refund again against the policy as it is now (refundable amount, customer, the 250 USD ceiling, the daily limit, no other refund of that capture still unsettled) and only then calls PayPal. **Reject** records the rejection. Each held refund can be decided once, even if two people click at the same time (decisions are queued within the server process, so run one instance); if PayPal can't be reached during the check, nothing is recorded and the refund stays held. The page is behind `DEMO_PASSWORD`, so for this demo anyone with the password can approve.

### The black box

Every decision is written to a SQLite file (`data/guard-audit.db`, or `GUARD_AUDIT_DB`) before the call runs, and its outcome is appended as a separate row afterwards, so no row is ever rewritten. Each row stores `sha256` of the previous row's hash and its own content. `/guard` checks the chain on every visit and shows either **Black box intact** with the head hash, or **Black box tampered** with the first bad row:

- an edited row no longer matches its hash;
- a deleted row breaks the link of the row after it, or leaves a gap in the row ids when it was the newest.

What it can't see: someone with write access who rewrites the whole chain with fresh hashes, or also edits SQLite's id counter. To catch that, keep a copy of the head hash somewhere else and compare. New rows are checked on every visit; older ones are re-checked in full at least once a minute, so an edit to an already verified row can take up to a minute to show.

Several processes can write to the same file: each append locks the database before reading the last hash, so the chain can't fork. A log written before the chain existed (table `audit`) is copied into the chain once, renumbered from 1, the first time the new version opens it; the old table is left as it was.

The **Payment guard** page of the dashboard report shows the same log as charts: money protected (the requested amount of blocked refunds; a full refund with no stated amount isn't counted), money refunded through the guard, refunds awaiting approval, decisions by verdict, rules broken, and decisions per day.
