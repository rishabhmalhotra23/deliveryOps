# Google setup plan — DeliveryOps

Step-by-step checklist for wiring `ai.cx@kognitos.com` + GCP `delivery-ops` project to DeliveryOps. Every link below is a URL you'll need to open.

Read [`docs/CREDENTIALS.md` § Google Cloud](./CREDENTIALS.md#2-google-cloud--oauth--apis--pubsub) for the long-form rationale; this file is the URL-only "do these clicks" version.

## What we're building

```
   Google Workspace user             OAuth 2.0 Client
   ai.cx@kognitos.com                (in delivery-ops GCP project)
            │                                │
            │  one-time consent + refresh    │
            └─────────────► refresh token ◄──┘
                                  │
                                  ▼
              GOOGLE_REFRESH_TOKEN in .env
                                  │
                                  ▼
                DeliveryOps server-side code
                (Gmail / Drive / Calendar / Slides API)
```

**We're using OAuth on a Workspace user, not a GCP IAM service account.** See [`docs/CREDENTIALS.md`](./CREDENTIALS.md) for why — short version: Gmail/Drive/Calendar/Slides are per-user products, and a Workspace Admin (for service-account Domain-Wide Delegation) is more friction than we need for Phase 1/2.

---

## Phase A — Google Workspace user (you need a Workspace admin)

We need `ai.cx@kognitos.com` as a **real licensed Workspace user**, not a Google Group. (The group was the reason mail wasn't being received.)

- [ ] Open the Workspace Admin Console: <https://admin.google.com/>
- [ ] Sign in as a `kognitos.com` admin
- [ ] **Directory → Users** → <https://admin.google.com/ac/users>
- [ ] If `ai.cx@kognitos.com` exists as a **group**, delete it first (or rename it temporarily): <https://admin.google.com/ac/groups>
- [ ] Back at Users → **Add new user** → first name `AI`, last name `CX`, primary email `ai.cx@kognitos.com`
- [ ] Set a strong password, save it in 1Password
- [ ] Assign a Google Workspace license (Business Starter is enough — needs Gmail + Drive + Calendar + Slides, all included)
- [ ] After creation, click the user → **Security → 2-Step Verification → Enforce** (mandatory for a shared service identity)
- [ ] Sign in once as `ai.cx@kognitos.com` at <https://mail.google.com/> and complete 2FA setup (use 1Password TOTP or a hardware key — not SMS)
- [ ] Send a test email **to** `ai.cx@kognitos.com` from any external account → confirm it lands in the inbox

**Verify:** you can sign in to Gmail as this user and you see one received message in the inbox.

---

## Phase B — GCP `delivery-ops` project

You said this project already exists. Confirm it's the one we'll use.

- [ ] Open the GCP console: <https://console.cloud.google.com/>
- [ ] Top bar → project picker → make sure **`delivery-ops`** is selected: <https://console.cloud.google.com/projectselector2/home/dashboard>
- [ ] Note the **project ID** (lowercase, hyphenated) and **project number** from the dashboard — useful when debugging IAM later

### B1. Enable APIs

Enable each of these one at a time. Click "Enable" on each page.

- [ ] Gmail API: <https://console.cloud.google.com/apis/library/gmail.googleapis.com>
- [ ] Google Drive API: <https://console.cloud.google.com/apis/library/drive.googleapis.com>
- [ ] Google Calendar API: <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>
- [ ] Google Slides API: <https://console.cloud.google.com/apis/library/slides.googleapis.com>
- [ ] Cloud Pub/Sub API: <https://console.cloud.google.com/apis/library/pubsub.googleapis.com>

**Verify:** <https://console.cloud.google.com/apis/dashboard> lists all five as enabled.

### B2. OAuth consent screen

- [ ] Open: <https://console.cloud.google.com/apis/credentials/consent>
- [ ] User type: **Internal** (requires Workspace; this means only `kognitos.com` users can authorize the app)
- [ ] **App name:** `DeliveryOps`
- [ ] **User support email:** `ai.cx@kognitos.com` (or your own)
- [ ] **App domain → Authorized domains:** add `kognitos.com`
- [ ] **Developer contact email:** your email
- [ ] **Save and continue**
- [ ] **Scopes** screen → **Add or remove scopes** → paste each into the filter and tick the checkbox:
  ```
  https://www.googleapis.com/auth/gmail.send
  https://www.googleapis.com/auth/gmail.modify
  https://www.googleapis.com/auth/gmail.settings.basic
  https://www.googleapis.com/auth/drive.file
  https://www.googleapis.com/auth/calendar.readonly
  https://www.googleapis.com/auth/presentations
  ```
- [ ] **Save and continue** through the rest

### B3. OAuth 2.0 Client ID

This is **not** a service account. Make sure you click "OAuth client ID", not "Service account".

- [ ] Open: <https://console.cloud.google.com/apis/credentials>
- [ ] **+ Create Credentials → OAuth client ID**
- [ ] **Application type:** Web application
- [ ] **Name:** `DeliveryOps web client`
- [ ] **Authorized redirect URIs** → add all three:
  ```
  http://localhost:4001/auth/callback
  https://delivery-ops-delta.vercel.app/auth/callback
  https://developers.google.com/oauthplayground
  ```
  (The last one is temporary — remove it after Phase C is done.)
- [ ] **Create**
- [ ] Copy both values from the modal:
  - **Client ID** → save as `GOOGLE_CLIENT_ID`
  - **Client secret** → save as `GOOGLE_CLIENT_SECRET`

---

## Phase C — One-time refresh token

We need a single refresh token tied to `ai.cx@kognitos.com`. The OAuth Playground is the cleanest way to do this without writing throwaway code.

- [ ] Open the OAuth Playground: <https://developers.google.com/oauthplayground/>
- [ ] **Sign out first** of any other Google account, then sign in as `ai.cx@kognitos.com` (top right)
- [ ] Click the gear ⚙ in the top right of the Playground
- [ ] Tick **Use your own OAuth credentials**
- [ ] Paste the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from Phase B3
- [ ] Close the gear
- [ ] In the left panel **Step 1 - Select & authorize APIs**, scroll all the way down to **Input your own scopes** and paste:
  ```
  https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.settings.basic https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/presentations
  ```
  (One line, space-separated. Six scopes.)
- [ ] Click **Authorize APIs** → sign in as `ai.cx@kognitos.com` again → grant the requested permissions
- [ ] You'll be redirected back to the Playground at **Step 2** → click **Exchange authorization code for tokens**
- [ ] Copy the **Refresh token** value (the long string, not the label) → save as `GOOGLE_REFRESH_TOKEN`

**If the refresh token comes back missing**, it means Google didn't issue a new one (you've authorized this app before with the same account). Fix:

- [ ] Open: <https://myaccount.google.com/permissions> (signed in as `ai.cx@kognitos.com`)
- [ ] Find `DeliveryOps` → **Remove access**
- [ ] Re-run Phase C from the top

**Verify:** the refresh token starts with `1//` and is ~100+ characters long.

### Optional cleanup

- [ ] After the refresh token is captured, go back to <https://console.cloud.google.com/apis/credentials>, edit the OAuth client, and remove `https://developers.google.com/oauthplayground` from authorized redirect URIs.

---

## Phase D — Pub/Sub for inbound Gmail

The Gmail watch publishes a notification to a Pub/Sub topic every time a new message arrives. Pub/Sub then HTTP-pushes that to `/api/gmail/push` on Vercel.

### D1. Topic

- [ ] Open: <https://console.cloud.google.com/cloudpubsub/topic/list>
- [ ] **+ Create topic**
- [ ] **Topic ID:** `gmail-watch`
- [ ] Leave **Add a default subscription** ticked
- [ ] **Create**

### D2. Grant Gmail permission to publish to the topic

- [ ] Click into the `gmail-watch` topic
- [ ] Right panel → **Permissions** tab → **Add Principal**
- [ ] **New principals:** `gmail-api-push@system.gserviceaccount.com`
- [ ] **Role:** Pub/Sub Publisher
- [ ] **Save**

### D3. Configure the push subscription

- [ ] Generate a random verification token first:
  ```bash
  openssl rand -hex 16
  ```
  Save the output as `GMAIL_PUBSUB_VERIFICATION_TOKEN`.
- [ ] Open: <https://console.cloud.google.com/cloudpubsub/subscription/list>
- [ ] Click into the auto-created `gmail-watch-sub` (or whatever name)
- [ ] **Edit** at the top
- [ ] **Delivery type:** Push
- [ ] **Endpoint URL:**
  ```
  https://delivery-ops-delta.vercel.app/api/gmail/push?token=<your verification token>
  ```
  (For local-dev testing via ngrok, you'd swap the host. Production stays on Vercel.)
- [ ] **Enable authentication:** leave off — we authenticate via the query-string token
- [ ] **Update**

---

## Phase E — Wire it into DeliveryOps

Paste the values into `.env.local` (local) and Vercel env vars (production).

### E1. Local `.env.local`

- [ ] Add or update these five lines:
  ```env
  GOOGLE_CLIENT_ID=...apps.googleusercontent.com
  GOOGLE_CLIENT_SECRET=GOCSPX-...
  GOOGLE_REDIRECT_URI=http://localhost:4001/auth/callback
  GOOGLE_REFRESH_TOKEN=1//...
  GMAIL_PUBSUB_VERIFICATION_TOKEN=...
  ```

### E2. Vercel env vars

- [ ] Open the project's env vars: <https://vercel.com/dashboard> → `delivery-ops` project → **Settings → Environment Variables**
- [ ] Add the same five, with `GOOGLE_REDIRECT_URI` set to `https://delivery-ops-delta.vercel.app/auth/callback` for production
- [ ] Redeploy or wait for the next push

### E3. Verify

- [ ] Restart `npm run dev` to pick up new env vars
- [ ] Open <http://localhost:4001/dev> — Gmail, Drive, Calendar should all show **live** instead of mocked
- [ ] Open <http://localhost:4001/dev/simulate> → pick "Email received" → submit. The agent should run in `source="email"` mode

---

## Phase F — Per-customer send-as aliases

For each customer we pilot with, set up a send-as alias on `ai.cx@kognitos.com`'s Gmail. This is what makes outbound emails appear to come from `acme@kognitos.com` (per-customer) while still being routed through the shared mailbox.

### Prerequisite: alias creation (Workspace admin)

You can either create real alias addresses on `ai.cx@kognitos.com` (recommended) or set up a catch-all forwarder. For the recommended path:

- [ ] Workspace admin: <https://admin.google.com/ac/users> → click `ai.cx@kognitos.com` → **User information → Email aliases** → add `acme@kognitos.com` (and one per pilot customer)
- [ ] Wait ~5 minutes for the alias to propagate

### Per-customer: add as "Send mail as"

- [ ] Sign in as `ai.cx@kognitos.com` at <https://mail.google.com/>
- [ ] Settings (gear icon) → **See all settings** → **Accounts and Import** tab → **Send mail as → Add another email address**
- [ ] **Name:** the customer-facing display name (e.g. `Acme — DeliveryOps`)
- [ ] **Email address:** `acme@kognitos.com`
- [ ] Untick "Treat as alias" if you want it to send through Gmail's regular SMTP; tick it if it's a true alias on the same mailbox (recommended)
- [ ] **Next step → Send Verification** → since the alias forwards to the same inbox, the verification email lands right there. Click the verification link.
- [ ] In DeliveryOps, set the customer's `email_alias` in the `customers` table to `acme@kognitos.com`

### Verify

- [ ] In Gmail Settings → Accounts → "Send mail as", the new alias shows status **Confirmed**
- [ ] Send a test message via `/dev/simulate → Send email`. Recipient sees `From: Acme — DeliveryOps <acme@kognitos.com>`.

---

## All URLs in one place (quick reference)

### Workspace admin
- Admin console — <https://admin.google.com/>
- Users — <https://admin.google.com/ac/users>
- Groups — <https://admin.google.com/ac/groups>
- Domain-wide delegation (only for Phase 3 multi-tenant work) — <https://admin.google.com/ac/owl/domainwidedelegation>

### Google Cloud Platform
- Console home — <https://console.cloud.google.com/>
- Project selector — <https://console.cloud.google.com/projectselector2/home/dashboard>
- APIs dashboard — <https://console.cloud.google.com/apis/dashboard>
- OAuth consent screen — <https://console.cloud.google.com/apis/credentials/consent>
- Credentials (OAuth client + service accounts) — <https://console.cloud.google.com/apis/credentials>
- Pub/Sub topics — <https://console.cloud.google.com/cloudpubsub/topic/list>
- Pub/Sub subscriptions — <https://console.cloud.google.com/cloudpubsub/subscription/list>
- IAM permissions (if ever needed) — <https://console.cloud.google.com/iam-admin/iam>

### API library (enable these)
- Gmail API — <https://console.cloud.google.com/apis/library/gmail.googleapis.com>
- Drive API — <https://console.cloud.google.com/apis/library/drive.googleapis.com>
- Calendar API — <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>
- Slides API — <https://console.cloud.google.com/apis/library/slides.googleapis.com>
- Pub/Sub API — <https://console.cloud.google.com/apis/library/pubsub.googleapis.com>

### OAuth flow
- OAuth Playground (one-time refresh token) — <https://developers.google.com/oauthplayground/>
- Revoke / inspect granted apps — <https://myaccount.google.com/permissions>

### Gmail (sign in as `ai.cx@kognitos.com`)
- Gmail — <https://mail.google.com/>
- Send-as settings — <https://mail.google.com/mail/u/0/#settings/accounts>

### Application
- Local dev console — <http://localhost:4001/dev>
- Local dev simulate — <http://localhost:4001/dev/simulate>
- Production — <https://delivery-ops-delta.vercel.app/>
- Vercel dashboard — <https://vercel.com/dashboard>

---

## Values you'll hand back to me

After Phase E, you should be able to paste this block (with the placeholders filled in) into chat or `.env.local`:

```env
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:4001/auth/callback
GOOGLE_REFRESH_TOKEN=1//...
GMAIL_PUBSUB_VERIFICATION_TOKEN=...
```

That's everything DeliveryOps needs on the Google side. The per-customer alias work in Phase F continues as we onboard each pilot.

---

## Related reading

- [`docs/CREDENTIALS.md`](./CREDENTIALS.md) — long-form context for every credential in the project, including non-Google ones
- [`docs/RUNBOOK.md`](./RUNBOOK.md) — what to do when things break
- [`.cursor/rules/destructive-operations.mdc`](../.cursor/rules/destructive-operations.mdc) — data safety guardrails
