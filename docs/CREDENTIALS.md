# DeliveryOps — credentials checklist

Every external service this app talks to, in the order I'd wire them. Tick the checkboxes as you go. Each section ends with a **Verify** command you can run to confirm the integration switched from `mocked` to `live`.

Until you've completed Tier 0, the agent can't think. Until you've completed Tier 1, every outbound call (Slack messages, emails, Drive uploads) goes to `/dev/outbox` instead of the real world. That's a feature — you can see exactly what would have shipped.

## Table of contents

- [Tier 0 — make the agent think (5 min)](#tier-0--make-the-agent-think-5-min)
- [Tier 1 — Phase 1.5 / 2 production integrations (~90 min total)](#tier-1--phase-15--2-production-integrations)
  - [1. Slack — Events API app](#1-slack--events-api-app)
  - [2. Google Cloud — OAuth + APIs + Pub/Sub](#2-google-cloud--oauth--apis--pubsub)
  - [3. Salesforce — Connected App](#3-salesforce--connected-app)
  - [4. Kognitos v2 — Personal Access Token](#4-kognitos-v2--personal-access-token)
  - [5. Monday.com — API token](#5-mondaycom--api-token)
- [Tier 2 — production deploy](#tier-2--production-deploy)
  - [6. Supabase Cloud](#6-supabase-cloud)
  - [7. Inngest Cloud](#7-inngest-cloud)
  - [8. Vercel](#8-vercel)
- [Tier 3 — optional / later](#tier-3--optional--later)
  - [9. ngrok — local webhook tunnel](#9-ngrok--local-webhook-tunnel)
  - [10. Kognitos v1 — legacy adapter](#10-kognitos-v1--legacy-adapter)
  - [11. Microsoft Teams](#11-microsoft-teams)
- [Tier 4 — brand assets](#tier-4--brand-assets)
- [Self-generated secrets](#self-generated-secrets)
- [Final `.env.local` example](#final-envlocal-example)
- [Production deploy checklist](#production-deploy-checklist)

## How to read this doc

- `[ ]` checkboxes are things you'll do.
- `code blocks` are things to paste literally — into `.env.local`, into a dashboard form field, or into your terminal.
- **Verify** commands assume `npm run dev` is running on `http://localhost:4001`.
- Anything marked **Phase 2** or **Phase 3** is for later. Skip those for now if you're focused on Phase 1.5.

---

# Tier 0 — make the agent think (5 min)

Without this, the chat / agent / Claude vision OCR can't run. This is the only thing you need *today* to validate the whole architecture end-to-end.

## Anthropic API key

- [ ] Open <https://console.anthropic.com>
- [ ] Sign in (or sign up — free)
- [ ] Click **Settings → API Keys → Create Key**
- [ ] Name it something like `deliveryops-dev`
- [ ] Copy the key (starts with `sk-ant-api03-…`)
- [ ] Add credits (Settings → Plans & Billing → Add Credits) — **$5 is plenty for development**
  - At Sonnet 4.5 rates ($3 / M input tokens, $15 / M output), $5 covers ~150 typical agent runs + ~50 PDF OCRs.
- [ ] Paste into `.env.local`:
  ```
  ANTHROPIC_API_KEY=sk-ant-api03-…
  CLAUDE_MODEL=claude-sonnet-4-5-20250929
  ```
- [ ] Save the file (Next.js auto-reloads — no restart needed)

**Verify:**
```bash
curl -s http://localhost:4001/dev | grep -A 1 "Anthropic"
# Should contain "live" instead of "mocked"
```

Or open <http://localhost:4001/dev/simulate>, pick "Slack message", type *"What's our renewal date?"*, hit **Simulate**. You should get a real agent response (it'll say there's no renewal date set, because the Acme profile is empty — that's the right answer).

**Gotchas:**
- If you see `Missing ANTHROPIC_API_KEY` after editing `.env.local`, restart `npm run dev` once. Next.js usually picks up env changes hot, but if you started before adding the file, it might not have any envs cached.
- Sonnet 4.5 is the default. If you want to test cheaper, set `CLAUDE_MODEL=claude-haiku-4-5-20250929` — the agent loop works on any tool-use-capable Anthropic model.

---

# Tier 1 — Phase 1.5 / 2 production integrations

These take ~90 min total. Each one is independent — you can wire just Slack and stop, the app works fine with the others mocked. The order below is the order I'd recommend (highest leverage first).

## 1. Slack — Events API app

~20 min. Free.

This is the highest-leverage integration. Once it's wired, customers literally type into a Slack channel and the agent answers them, ingests their dropped files, and logs every conversation.

### 1a. Create the app

- [ ] Open <https://api.slack.com/apps>
- [ ] Click **Create New App → From scratch**
- [ ] App name: `DeliveryOps`
- [ ] Pick your Kognitos workspace
- [ ] Click **Create App**

### 1b. Configure permissions

- [ ] Go to **OAuth & Permissions** in the left nav
- [ ] Scroll down to **Bot Token Scopes** → **Add an OAuth Scope** for each:
  ```
  app_mentions:read
  channels:history
  channels:read
  chat:write
  chat:write.public
  files:read
  groups:history
  groups:read
  im:history
  im:read
  im:write
  users:read
  ```
  Why each one matters:
  - `app_mentions:read` — for `@DeliveryOps` mentions in any channel
  - `channels:*` / `groups:*` — read messages + channel metadata in customer channels
  - `chat:write` / `chat:write.public` — post messages, even to channels the bot isn't in
  - `files:read` — download files dropped in customer channels for ingestion
  - `users:read` — resolve `<@USER123>` to a real name in conversation logs

### 1c. Set up event subscriptions

You need a public URL Slack can POST to. **For local dev, use ngrok** ([Tier 3 step 9](#9-ngrok--local-webhook-tunnel)). For prod, use your Vercel domain.

- [ ] Go to **Event Subscriptions** → toggle **Enable Events** ON
- [ ] **Request URL**: `https://<your-ngrok-or-vercel-domain>/api/slack/events`
  - Slack will validate the URL by sending a `url_verification` ping. Our route handles it. You'll see a green checkmark when it works.
- [ ] Under **Subscribe to bot events**, add:
  ```
  app_mention
  message.channels
  message.groups
  file_shared
  ```
- [ ] Click **Save Changes**

### 1d. Set up interactivity (for approval buttons)

- [ ] Go to **Interactivity & Shortcuts** → toggle **Interactivity** ON
- [ ] **Request URL**: `https://<your-ngrok-or-vercel-domain>/api/slack/interactive`
- [ ] Click **Save Changes**

### 1e. Install to workspace

- [ ] Go to **Install App** → **Install to Workspace**
- [ ] Approve the permissions

### 1f. Collect the credentials

- [ ] **Bot User OAuth Token** (starts `xoxb-…`) — copy from **OAuth & Permissions**
- [ ] **Signing Secret** — copy from **Basic Information → App Credentials → Signing Secret → Show**
- [ ] **App ID** — visible at the top of **Basic Information**

- [ ] Paste into `.env.local`:
  ```
  SLACK_BOT_TOKEN=xoxb-…
  SLACK_SIGNING_SECRET=…
  SLACK_APP_ID=A…
  ```

### 1g. Invite the bot + map a channel

- [ ] In Slack, create or open a channel for your test customer (e.g. `#acme`)
- [ ] Type `/invite @DeliveryOps` in the channel
- [ ] Make sure the channel name matches the `slack_channel` field on your customer in Supabase. (Acme is seeded with `slack_channel = "acme"`.)

**Verify:**
- The `/dev` page should show Slack as **live**.
- Type a message in `#acme` ("what's the renewal status?") — the agent should respond directly in Slack within a few seconds.
- Drop a PDF in `#acme` — the agent should acknowledge in Slack and the file should appear at `/customers/acme/documents` within ~30 seconds.

**Gotchas:**
- Slack times out webhooks at 3 seconds. Our route ACKs immediately and runs the agent in the background, so you might see the bot's typing indicator for 5-10 seconds before the actual reply lands. That's normal.
- If you regenerate the bot token, all existing webhook subscriptions stay valid — you just need to update `.env.local` and restart `npm run dev`.

## 2. Google Cloud — OAuth + APIs + Pub/Sub

~30 min. Free.

One Google Cloud project covers Drive + Gmail + Calendar + Slides. We use a single OAuth client (the kognitos.com service account or your CSM's account) for Phase 1; per-CSM OAuth lands in Phase 3.

### 2a. Create the GCP project

- [ ] Open <https://console.cloud.google.com>
- [ ] Top bar → **Select a project → New Project**
- [ ] Project name: `delivery-ops`
- [ ] No organization needed (or select kognitos.com if it's set up)
- [ ] **Create**

### 2b. Enable APIs

- [ ] In the project, search for and enable each of these (one at a time):
  - [ ] **Gmail API**
  - [ ] **Google Drive API**
  - [ ] **Google Calendar API**
  - [ ] **Cloud Pub/Sub API**
  - [ ] **Google Slides API** *(Phase 3 — QBR generator)*

### 2c. Configure OAuth consent screen

- [ ] **APIs & Services → OAuth consent screen**
- [ ] User type: **Internal** (only kognitos.com users can authorize) — you must be using a Google Workspace account; otherwise pick **External** and add yourself as a test user.
- [ ] App name: `DeliveryOps`
- [ ] User support email: your email
- [ ] App domain → Authorized domains: `kognitos.com`
- [ ] Developer contact email: your email
- [ ] **Save and continue**
- [ ] **Scopes** → **Add or Remove Scopes** → add each:
  ```
  https://www.googleapis.com/auth/gmail.send
  https://www.googleapis.com/auth/gmail.modify
  https://www.googleapis.com/auth/gmail.settings.basic
  https://www.googleapis.com/auth/drive.file
  https://www.googleapis.com/auth/calendar.readonly
  https://www.googleapis.com/auth/presentations
  ```
  Why each one:
  - `gmail.send` — outbound emails from customer aliases
  - `gmail.modify` — read inbound emails (Gmail watch + history) and mark them read
  - `gmail.settings.basic` — verify send-as aliases are configured
  - `drive.file` — create and read files the app itself owns (per-customer folders)
  - `calendar.readonly` — sync upcoming meetings into the dashboard
  - `presentations` — Phase 3 QBR deck generation
- [ ] **Save and continue** through the rest

### 2d. Create OAuth credentials

- [ ] **APIs & Services → Credentials → Create Credentials → OAuth client ID**
- [ ] Application type: **Web application**
- [ ] Name: `DeliveryOps web client`
- [ ] **Authorized redirect URIs** → add:
  - `http://localhost:4001/auth/callback`
  - `https://<your-vercel-domain>/auth/callback` (add when you deploy)
  - `https://developers.google.com/oauthplayground` *(only needed temporarily, for the refresh-token dance below — remove it once you have the token)*
- [ ] **Create**
- [ ] Download the JSON, or copy:
  - **Client ID** → `GOOGLE_CLIENT_ID`
  - **Client secret** → `GOOGLE_CLIENT_SECRET`
- [ ] Paste into `.env.local`:
  ```
  GOOGLE_CLIENT_ID=…apps.googleusercontent.com
  GOOGLE_CLIENT_SECRET=GOCSPX-…
  GOOGLE_REDIRECT_URI=http://localhost:4001/auth/callback
  ```

### 2e. Get a refresh token (one-time)

The cleanest way for Phase 1: use Google's OAuth Playground to complete the flow once and grab the resulting refresh token.

- [ ] Open <https://developers.google.com/oauthplayground>
- [ ] Click the gear ⚙ in the top right
- [ ] Tick **Use your own OAuth credentials**
- [ ] Paste your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- [ ] In the left pane, **Step 1 - Select & authorize APIs**, scroll to the bottom and paste each scope into the **Input your own scopes** box (one per line):
  ```
  https://www.googleapis.com/auth/gmail.send
  https://www.googleapis.com/auth/gmail.modify
  https://www.googleapis.com/auth/gmail.settings.basic
  https://www.googleapis.com/auth/drive.file
  https://www.googleapis.com/auth/calendar.readonly
  https://www.googleapis.com/auth/presentations
  ```
- [ ] Click **Authorize APIs** → sign in as the kognitos.com account that should own the customer Drive folders / send the customer emails
- [ ] You'll be redirected back to Playground at **Step 2** — click **Exchange authorization code for tokens**
- [ ] Copy the **Refresh token** (the value, not the label)
- [ ] Paste into `.env.local`:
  ```
  GOOGLE_REFRESH_TOKEN=1//…
  ```
- [ ] *(Optional)* Go back to GCP → Credentials and remove `https://developers.google.com/oauthplayground` from the redirect URIs

### 2f. Set up Pub/Sub for inbound Gmail

- [ ] In GCP, go to **Pub/Sub → Topics → Create Topic**
- [ ] Topic ID: `gmail-watch`
- [ ] **Add a default subscription**: leave checked
- [ ] **Create**
- [ ] Click into the topic → **Subscriptions** tab → click into the auto-created subscription → **Edit**
- [ ] Change **Delivery type** to **Push**
- [ ] **Endpoint URL**: `https://<your-vercel-domain>/api/gmail/push?token=<random-string-you-pick>`
  - Make up a random string for the token (e.g. `openssl rand -hex 16`). Save it as `GMAIL_PUBSUB_VERIFICATION_TOKEN` below.
- [ ] **Update**
- [ ] Now grant Gmail permission to publish to the topic:
  - [ ] Go back to the topic → **Permissions** tab → **Add Principal**
  - [ ] Principal: `gmail-api-push@system.gserviceaccount.com`
  - [ ] Role: **Pub/Sub Publisher**
  - [ ] **Save**
- [ ] Paste into `.env.local`:
  ```
  GMAIL_PUBSUB_VERIFICATION_TOKEN=<the random string>
  ```

**Verify:**
- `/dev` page should show Gmail, Drive, Calendar all as **live**.
- In `/dev/simulate` → "Email received" → submit. The agent runs in `source="email"` mode (gated mutations queue for approval).
- For real inbound: send a test email to your customer's `email_alias` (e.g. `acme@deliveryops.example`). The Gmail watch is set up by the cron job (Phase 1.5b TODO) — for now, you can manually trigger the watch by hitting `/api/gmail/watch` (TODO route).

**Gotchas:**
- The Gmail watch expires every 7 days. The cron job re-renews it weekly (Phase 1.5b — TODO). Until then, you'll need to manually re-call `users.watch` once a week.
- The `drive.file` scope only lets the app see files **it created or that were explicitly shared with it**. That's the right scope for the per-customer folder model. If you want to sync a customer's existing Drive folder, share that folder with the OAuth account first.
- The OAuth Playground refresh token is tied to the Google account you signed in with. If you want a different account to send emails / own Drive folders, redo the flow signed in as that account.

## 3. Salesforce — Connected App

~20 min. Free with your existing Salesforce edition.

### 3a. Create the Connected App

- [ ] Salesforce setup (top-right gear → **Setup**)
- [ ] In the Quick Find box, type **App Manager** → click it
- [ ] Top right → **New Connected App** → **Create a Connected App**
- [ ] Connected App Name: `DeliveryOps`
- [ ] API Name: `DeliveryOps` (auto-fills)
- [ ] Contact Email: your email

### 3b. Enable OAuth

- [ ] Tick **Enable OAuth Settings**
- [ ] **Callback URL**:
  ```
  http://localhost:4001/auth/salesforce/callback
  https://<your-vercel-domain>/auth/salesforce/callback
  ```
- [ ] **Selected OAuth Scopes** → add:
  - `Manage user data via APIs (api)`
  - `Perform requests at any time (refresh_token, offline_access)`
  - `Access the identity URL service (id, profile, email, address, phone)`
- [ ] **Save**

### 3c. Wait + collect credentials

- [ ] **Wait 10 minutes** — Salesforce takes time to propagate connected apps. (No, really, this is documented behaviour. Skip this and the OAuth dance will fail with a confusing error.)
- [ ] Back at **App Manager**, find your DeliveryOps app → **View** → **Manage Consumer Details**
- [ ] You'll be 2FA-prompted. Then you see:
  - **Consumer Key** → `SALESFORCE_CLIENT_ID`
  - **Consumer Secret** → `SALESFORCE_CLIENT_SECRET`
- [ ] **Instance URL**: just the root of your Salesforce, e.g. `https://kognitos.my.salesforce.com` (no path)

- [ ] Paste into `.env.local`:
  ```
  SALESFORCE_CLIENT_ID=3MVG9…
  SALESFORCE_CLIENT_SECRET=…
  SALESFORCE_INSTANCE_URL=https://kognitos.my.salesforce.com
  ```

**Verify:** *(Phase 2 — sync function not yet built)*
Once the Phase 2 `sync-salesforce` Inngest function lands, you'll trigger it via `/dev/simulate` (or it runs on a schedule) and see Acme's Salesforce account / opportunities / cases populated in the dashboard.

**Gotchas:**
- The 10-minute propagation wait is real. The error if you skip it is `invalid_client_id`, which is misleading.
- Salesforce limits OAuth refresh-token age to 90 days unless you change the policy on the connected app to **Refresh token is valid until revoked** (under "Manage" → Edit Policies after creation).
- The `Manage user data via APIs` scope is sufficient for read-only sync. If you want the agent to write back to Salesforce later (e.g. log activities), upgrade to `Full access (full)`.

## 4. Kognitos v2 — Personal Access Token

~5 min. Free, internal.

### 4a. Generate a PAT

- [ ] Open <https://app.us-1.kognitos.com>
- [ ] Sign in with your kognitos.com account
- [ ] Pick the workspace you want DeliveryOps to talk to (the same one your customer's automations live in, ideally)
- [ ] Top-right avatar → **Settings** → **Personal Access Tokens**
- [ ] Click **Create Token** → name it `deliveryops` → **Create**
- [ ] Copy the token (starts `kgn_pat_…`) — **you won't see it again**

### 4b. Find your org and workspace IDs

- [ ] Inside any workspace, look at the URL bar. It looks like:
  ```
  https://app.us-1.kognitos.com/organizations/<ORG_ID>/workspaces/<WORKSPACE_ID>/…
  ```
- [ ] Copy both UUIDs

### 4c. Set the env vars

- [ ] Paste into `.env.local`:
  ```
  KOGNITOS_V2_TOKEN=kgn_pat_…
  KOGNITOS_V2_BASE_URL=https://app.us-1.kognitos.com
  KOGNITOS_V2_ORG_ID=…uuid…
  KOGNITOS_V2_WORKSPACE_ID=…uuid…
  ```

**Verify:** *(Phase 2 — sync function not yet built)*
Once the Phase 2 `sync-kognitos-v2` Inngest function lands, the dashboard's overview tab will show real credit usage, recent runs, and exception counts pulled from the v2 API.

**Gotchas:**
- The PAT inherits *your* permissions. If you're an admin of the workspace, the token is too — be careful where you store it. Treat it like a password.
- The base URL differs by region. `us-1` is the default; if you're on a different cluster, find the right URL by going to your Kognitos console and looking at the URL bar.

## 5. Monday.com — API token

~5 min. Included in your monday.com plan.

### 5a. Generate the token

- [ ] Open <https://monday.com>, sign in
- [ ] Bottom-left avatar → **Developers** → **My access tokens**
- [ ] Click **Show** under your existing API v2 Token, or **Generate new** if it doesn't exist
- [ ] Copy the token

### 5b. Set the env var

- [ ] Paste into `.env.local`:
  ```
  MONDAY_API_TOKEN=eyJhbGciOiJIUzI1NiJ9.…
  ```

**Verify:** *(Phase 2 — sync function not yet built)*
Once Phase 2 `sync-monday` ships, the customer overview gets a "Pending items" panel showing dev + CS items with status, owner, due date.

**Gotchas:**
- The token inherits your monday.com permissions. To sync a customer's project board, you need at least viewer access to that board.
- Monday rate-limits API calls fairly aggressively — the sync function uses GraphQL batching to stay under the limits. You won't hit them in dev.

---

# Tier 2 — production deploy

Skip these for now if you're staying on localhost. When you're ready to put DeliveryOps on the internet:

## 6. Supabase Cloud

~5 min. Free up to 500 MB DB + 1 GB Storage + 50K monthly active users.

### 6a. Create the project

- [ ] Open <https://supabase.com/dashboard>
- [ ] **New Project**
- [ ] Project name: `delivery-ops-prod` (recommended: also create `delivery-ops-staging` first)
- [ ] Database password: generate a strong one and save it in 1Password — **you can't recover it later**
- [ ] Region: closest to your users (most likely `us-east-1` or `us-west-1`)
- [ ] Pricing plan: **Free** to start
- [ ] **Create new project** (~2 min to provision)

### 6b. Push the schema

- [ ] In your local terminal:
  ```bash
  supabase link --project-ref <ref-from-the-project-url>
  # The ref is the part of the URL like "abcdefghijklmnop" in
  # https://supabase.com/dashboard/project/abcdefghijklmnop
  supabase db push
  # Applies 0001_init.sql + 0002_chat.sql to the cloud project.
  # Does NOT apply seed.sql — production should not have a fake "Acme" customer.
  ```

### 6c. Enable Google OAuth (kognitos.com only)

- [ ] In Supabase dashboard → **Authentication → Providers → Google** → toggle ON
- [ ] **Client ID**: paste your `GOOGLE_CLIENT_ID` from Tier 1 step 2
- [ ] **Client Secret**: paste your `GOOGLE_CLIENT_SECRET`
- [ ] **Authorized Client IDs**: leave empty
- [ ] Save
- [ ] Scroll up to **URL Configuration** → set **Site URL** to your Vercel domain
- [ ] **Authentication → Settings → Email Auth** → optionally tighten the **Allowed Email Domains** to `kognitos.com` (Phase 3 multi-tenant work will widen this)

### 6d. Collect credentials for Vercel

- [ ] **Project Settings → API**:
  - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
  - **anon (public) key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (server-only — never ship to browser)

You don't paste these into your local `.env.local`. They go into Vercel's environment variables (Tier 2 step 8).

**Gotchas:**
- The free tier pauses your project after 7 days of inactivity. It auto-resumes when traffic arrives but the first request takes ~10s. Worth upgrading to Pro ($25/mo) once you have real users.
- `supabase db push` will refuse if the local + remote schemas have drifted. If that happens, run `supabase db diff` to see what's different.

## 7. Inngest Cloud

~5 min. Free up to 50K function runs / month.

### 7a. Create the environment

- [ ] Open <https://app.inngest.com>
- [ ] Sign in with GitHub
- [ ] **New environment** → name it `delivery-ops`
- [ ] (Recommended: also create a `delivery-ops-staging` environment for preview deploys)

### 7b. Collect keys

- [ ] In the environment → **Manage** tab:
  - **Event key** → `INNGEST_EVENT_KEY`
  - **Signing key** → `INNGEST_SIGNING_KEY`
- [ ] These go into Vercel's env vars (Tier 2 step 8).

### 7c. Sync your functions

After your first Vercel deploy, in the Inngest dashboard:
- [ ] **Apps → Sync new app** → paste your Vercel `/api/inngest` URL → **Sync**
- [ ] You should see all 7 functions listed: `ingest-document`, `digest-monthly`, `sync-salesforce`, `sync-kognitos-v2`, `sync-calendar`, `sync-monday`, `run-task`.

**Gotchas:**
- The Inngest cloud key tells the SDK to register itself with the cloud rather than the local dev server. If both are set in `.env.local`, cloud wins — make sure your local `.env.local` leaves both empty.

## 8. Vercel

~10 min. Free for hobby plan.

### 8a. Import the project

- [ ] Open <https://vercel.com>, sign in with GitHub
- [ ] **Add New → Project → Import** → select `rishabhmalhotra23/deliveryOps`
- [ ] Framework: Next.js (auto-detected)
- [ ] Build command, output directory: leave defaults
- [ ] **Don't deploy yet** — env vars first

### 8b. Set environment variables

- [ ] In the import flow → **Environment Variables**, add every var from your `.env.local` **except** the local-Supabase + local-Inngest defaults (use the cloud values from Tier 2 steps 6 + 7 instead). The full list:
  ```
  ANTHROPIC_API_KEY
  CLAUDE_MODEL
  NEXT_PUBLIC_SUPABASE_URL          # cloud, not http://127.0.0.1
  NEXT_PUBLIC_SUPABASE_ANON_KEY     # cloud
  SUPABASE_SERVICE_ROLE_KEY         # cloud
  INNGEST_EVENT_KEY                 # cloud
  INNGEST_SIGNING_KEY               # cloud
  SLACK_BOT_TOKEN
  SLACK_SIGNING_SECRET
  SLACK_APP_ID
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  GOOGLE_REDIRECT_URI               # https://<your-domain>/auth/callback
  GOOGLE_REFRESH_TOKEN
  GMAIL_PUBSUB_VERIFICATION_TOKEN
  SALESFORCE_CLIENT_ID
  SALESFORCE_CLIENT_SECRET
  SALESFORCE_INSTANCE_URL
  KOGNITOS_V2_TOKEN
  KOGNITOS_V2_BASE_URL
  KOGNITOS_V2_ORG_ID
  KOGNITOS_V2_WORKSPACE_ID
  MONDAY_API_TOKEN
  SESSION_SECRET                    # generate fresh
  CRON_SECRET                       # generate fresh
  ALLOWED_EMAIL_DOMAIN=kognitos.com
  DELIVERY_OPS_DEV_MODE=off         # production = no mocks, fail loudly on missing creds
  ```
- [ ] Click **Deploy**

### 8c. Wire the domain

- [ ] Once deployed, **Settings → Domains** → add your domain (or use the auto `delivery-ops.vercel.app`)
- [ ] Update everything that pointed at `<your-vercel-domain>`:
  - Slack → Event Subscriptions → Request URL
  - Slack → Interactivity → Request URL
  - Google Cloud → OAuth client → Authorized redirect URIs
  - Google Cloud → Pub/Sub subscription → Endpoint URL
  - Salesforce → Connected App → Callback URL
  - Supabase → Authentication → URL Configuration → Site URL

### 8d. Verify cron is wired

- [ ] **Settings → Cron Jobs** — you should see `/api/cron/run-tasks` running every minute. (`vercel.json` declares it.)

**Gotchas:**
- The hobby plan caps function execution at 10 seconds. The agent often takes 5–15 seconds. We've already set `maxDuration = 60` on the chat / Slack routes, but on hobby that's capped at 10. **Upgrade to Pro ($20/mo)** once real users hit the agent — without it, longer requests truncate.
- Set `DELIVERY_OPS_DEV_MODE=off` in production so a missing token throws loudly instead of silently routing to the outbox.

---

# Tier 3 — optional / later

## 9. ngrok — local webhook tunnel

~5 min. Free tier works for development.

You only need ngrok if you want Slack and Gmail to send real webhooks to your local Next.js (instead of just driving things via `/dev/simulate`). For Phase 2 testing, ngrok is the cleanest way to wire real Slack messages → real agent loop without deploying.

### 9a. Install + sign up

- [ ] `brew install ngrok` (already have Homebrew now)
- [ ] Open <https://ngrok.com>, sign up
- [ ] Dashboard → **Your Authtoken** → copy it
- [ ] `ngrok config add-authtoken <token>`

### 9b. Tunnel localhost:4001

- [ ] In a new terminal:
  ```bash
  ngrok http 4001
  ```
- [ ] Copy the `https://….ngrok.app` URL it prints
- [ ] Use that URL as the base for:
  - Slack → Event Subscriptions → Request URL: `https://….ngrok.app/api/slack/events`
  - Slack → Interactivity → Request URL: `https://….ngrok.app/api/slack/interactive`
  - Google Pub/Sub → Subscription → Endpoint URL: `https://….ngrok.app/api/gmail/push?token=…`

**Gotchas:**
- The free ngrok URL changes every time you restart `ngrok http`. To get a stable URL, claim a static domain on the free plan (`ngrok config edit` → add `domain: your-name.ngrok.app`).
- When you stop using ngrok and switch to Vercel, **remove the ngrok URLs** from Slack / Pub/Sub / Salesforce or your laptop will receive duplicates.

## 10. Kognitos v1 — legacy adapter

Phase 3. Same internal Kognitos account, separate API.

- [ ] Visit your Kognitos v1 console (the older `rest-api.app.kognitos.com` interface)
- [ ] Generate an API key
- [ ] Paste into `.env.local`:
  ```
  KOGNITOS_V1_API_KEY=…
  KOGNITOS_V1_BASE_URL=https://rest-api.app.kognitos.com
  ```

The v1 adapter ports in Phase 3 alongside the QBR generator.

## 11. Microsoft Teams

Phase 3. Microsoft Graph subscription + Teams app manifest. Mirror of the Slack listener at `app/api/teams/events/route.ts`. Detailed instructions land in the Phase 3 plan when we get there.

---

# Tier 4 — brand assets

Not credentials, but you'll want these eventually for the licensed brand fonts.

## Neue Machina + Neue Montreal .woff2 files

The repo ships 48-byte placeholder stubs at `app/fonts/Neue*.woff2`. Today, Inter and Inter Tight (loaded from Google Fonts) drive every UI string. The brand looks ~95% right.

To use the real licensed fonts:

- [ ] Get the licensed `.woff2` files from the brand asset library
- [ ] Replace each placeholder, keeping the filenames identical:
  ```
  app/fonts/NeueMachina-Regular.woff2
  app/fonts/NeueMachina-Medium.woff2
  app/fonts/NeueMachina-Bold.woff2
  app/fonts/NeueMontreal-Regular.woff2
  app/fonts/NeueMontreal-Medium.woff2
  app/fonts/NeueMontreal-Bold.woff2
  ```
- [ ] Open `app/fonts.ts` and follow the in-file 5-step uncomment guide:
  1. Uncomment `import localFont from "next/font/local"`
  2. Uncomment the `neueMachina` block
  3. Uncomment the `neueMontreal` block
  4. Add `neueMachina.variable, neueMontreal.variable` to `fontVariables`
  5. Restart `npm run dev`

The display + body fonts switch automatically because `globals.css` uses `var(--font-neue-machina, var(--font-inter-tight))` — once `--font-neue-machina` is defined, it wins; until then, Inter Tight does.

---

# Self-generated secrets

These are random strings you make up locally. Use `openssl rand -hex 32` (or any password generator).

- [ ] `SESSION_SECRET` — used for cookie signing later (Phase 3 auth work)
  ```bash
  echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env.local
  ```

- [ ] `CRON_SECRET` — Vercel sends this in the `Authorization: Bearer …` header on cron triggers. Required in production so randos can't hit `/api/cron/run-tasks`.
  ```bash
  echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env.local
  ```
  - **Make sure to set the same value in Vercel env vars** (Tier 2 step 8).

- [ ] `GMAIL_PUBSUB_VERIFICATION_TOKEN` — random string used as a query-string secret on the Pub/Sub push URL. Already covered in Tier 1 step 2f.

---

# Final `.env.local` example

Once everything's wired (or partially wired — empty values just mean "stay mocked"), your `.env.local` should look like:

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-api03-…
CLAUDE_MODEL=claude-sonnet-4-5-20250929

# Supabase (local CLI stack — replace with cloud values for production)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_…
SUPABASE_SERVICE_ROLE_KEY=sb_secret_…

# Inngest (leave empty for local dev — uses dev server at :8288)
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Slack
SLACK_BOT_TOKEN=xoxb-…
SLACK_SIGNING_SECRET=…
SLACK_APP_ID=A…

# Google
GOOGLE_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-…
GOOGLE_REDIRECT_URI=http://localhost:4001/auth/callback
GOOGLE_REFRESH_TOKEN=1//…
GMAIL_PUBSUB_VERIFICATION_TOKEN=…

# Salesforce
SALESFORCE_CLIENT_ID=3MVG9…
SALESFORCE_CLIENT_SECRET=…
SALESFORCE_INSTANCE_URL=https://kognitos.my.salesforce.com

# Kognitos v2
KOGNITOS_V2_TOKEN=kgn_pat_…
KOGNITOS_V2_BASE_URL=https://app.us-1.kognitos.com
KOGNITOS_V2_ORG_ID=…
KOGNITOS_V2_WORKSPACE_ID=…

# Kognitos v1 (Phase 3)
KOGNITOS_V1_API_KEY=
KOGNITOS_V1_BASE_URL=https://rest-api.app.kognitos.com

# Monday.com
MONDAY_API_TOKEN=eyJhbGc…

# App
SESSION_SECRET=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 32>
ALLOWED_EMAIL_DOMAIN=kognitos.com

# Dev mode (auto = mock missing integrations; on = mock everything; off = throw on missing)
DELIVERY_OPS_DEV_MODE=auto
```

---

# Production deploy checklist

When you're ready to ship, in this order:

- [ ] Tier 0 done (Anthropic key)
- [ ] Tier 1 integrations done (Slack + Google + Salesforce + Kognitos + Monday)
- [ ] All `/dev` page integrations show **live** locally
- [ ] Pilot customer named, mapped to:
  - [ ] Salesforce account ID
  - [ ] Kognitos workspace ID
  - [ ] Primary contact email + calendar
  - [ ] Monday board ID
  - [ ] Slack channel name
  - [ ] Drive folder ID
  - [ ] Email alias (set up the alias in Gmail "send mail as" first)
- [ ] Tier 2 done — Supabase Cloud + Inngest Cloud + Vercel
- [ ] Production env vars set in Vercel, including `DELIVERY_OPS_DEV_MODE=off`
- [ ] Slack / Pub/Sub / Salesforce callback URLs updated to point at the Vercel domain (not ngrok / localhost)
- [ ] Production Vercel deploy successful, smoke test:
  - [ ] `https://<your-domain>/dev` shows every integration as **live**
  - [ ] Slack message in the pilot customer's channel triggers an agent reply
  - [ ] PDF dropped in the pilot customer's channel gets ingested + classified
  - [ ] Cron runs visible in Vercel dashboard
  - [ ] Inngest dashboard shows function executions on every relevant event
- [ ] (Optional) Tier 4 — drop in licensed Neue Machina + Neue Montreal fonts

---

# Where to ask for help

- **In this repo:** open an issue, or for ad-hoc help mention me in your next prompt and I'll dig into the specific step.
- **External docs:**
  - Anthropic: <https://docs.anthropic.com>
  - Slack: <https://api.slack.com/start/building/bolt-js> (we don't use Bolt, but the event reference is useful)
  - Google: <https://developers.google.com/identity/protocols/oauth2>
  - Supabase: <https://supabase.com/docs>
  - Inngest: <https://www.inngest.com/docs>
  - Vercel: <https://vercel.com/docs>
