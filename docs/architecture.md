# Architecture

Payment Guard sits between an AI agent and PayPal. The agent never holds PayPal credentials: it sees PayPal's MCP tools through the guard, and every call is decided before it reaches PayPal.

```
your app ──API key──▶ /api/{support,billing,sales}/...   (app/api)
                         │
                         ▼
                      agent loop (lib/agent)  ── LLM provider (lib/llm)
                         │  MCP tool calls
                         ▼
                      payment guard (lib/guard/guard.ts)
                         │  allow / hold / block
                         ├─▶ PayPal agent toolkit (sandbox or live)
                         └─▶ black box: hash-chained audit log (Postgres or SQLite)
```

## Layers (hexagonal)

| Layer | Where | Depends on |
|---|---|---|
| Domain rules, pure functions, no I/O | [`lib/guard/domain`](../lib/guard/domain): refund policy and limits, invoices, orders, cancellations, disputes, privacy and redaction | nothing |
| Guard core | [`lib/guard/guard.ts`](../lib/guard/guard.ts): an MCP server that wraps the upstream toolkit, lets reads through when they belong to the task's customer, and decides each write: policy first, then the intent judge, which can only make a decision stricter | domain + ports |
| Ports | [`lib/guard/ports.ts`](../lib/guard/ports.ts): `IntentJudge`, `CaptureLookup`, `SubscriptionLookup`, `DisputeLookup`, `InvoiceLookup`, `CustomerDirectory`, `OrderBinder`, `AuditLog`/`BlackBox`, `HeldNotifier` | — |
| Adapters | [`lib/guard/adapters`](../lib/guard/adapters): PayPal lookups, LLM judge, Postgres and SQLite audit logs, webhook/email/SMTP/Telegram notifiers | the outside world |
| Wiring | [`lib/agent/handle-*.ts`](../lib/agent): one request = settings + toolkit + adapters + guard + agent | everything above |
| Delivery | `app/` (pages, API routes), [`proxy.ts`](../proxy.ts) and [`lib/auth`](../lib/auth) (owner session, API keys) | wiring |

The guard fails closed: a missing adapter, a failed lookup, a judge that times out or answers badly all mean **block**, never allow.

## Adapting the guard

- **Another source of truth.** Implement the port and pass it to `createPaymentGuard` in the matching `handle-*.ts`. For example, a `CustomerDirectory` over your CRM:

  ```ts
  const customers: CustomerDirectory = {
    isCustomer: async (email) => (await crm.findCustomer(email)) !== undefined,
  };
  ```

- **Another rule.** Add a pure function in `lib/guard/domain` returning a `Decision` (`allow`, `hold` or `block` with violation codes), unit-test it, and merge it in the tool's branch of `guard.ts` with `mergeDecisions`, which keeps the strictest verdict.
- **Another write tool.** Add it to `WRITES` in `guard.ts` with its decision; any tool the guard does not know is blocked.
- **Another LLM.** Any OpenAI-compatible endpoint, chosen in Settings; the judge and the agent may use different models.
- **Another storage.** Implement `BlackBox` (see the Postgres adapter: rows chained by hash, appends serialized).

## Data

One Postgres database, separate schemas: `auth` (the built-in owner account: `owner`, `sessions`), `neon_auth` (Neon Auth's users, when it is used), and `guard` (`audit_log`, `audit_head`, `settings`, `settings_key`, `api_keys`). Migrations in [`lib/db`](../lib/db) run on deploy (`npm run db:migrate`) and before the first query. Secrets saved in Settings are sealed with AES-256-GCM; API keys and session cookies are stored only as SHA-256 hashes, the owner's password only as a scrypt hash. Without a database the owner account is a SQLite file (`AUTH_DB`, default `data/auth.db`).

## Limits of this version

- One business per installation.
- Writes are serialized inside one process; several server instances would need a database lock for the daily caps.
- The dashboard reads the sandbox account only.
