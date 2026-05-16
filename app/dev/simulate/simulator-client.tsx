"use client";

import { useState } from "react";

interface Customer {
  key: string;
  display_name: string;
  slack_channel: string | null;
  email_alias: string | null;
}

type Mode = "slack" | "email" | "upload";

interface Result {
  ok: boolean;
  message?: string;
  agent_response?: string;
  raw?: unknown;
  error?: string;
}

export function SimulatorClient({ customers }: { customers: Customer[] }) {
  const [customerKey, setCustomerKey] = useState(customers[0]?.key ?? "");
  const [mode, setMode] = useState<Mode>("slack");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Slack form state
  const [slackUser, setSlackUser] = useState("Alice");
  const [slackText, setSlackText] = useState("What's the renewal status?");

  // Email form state
  const [emailFrom, setEmailFrom] = useState("alice@acme.example");
  const [emailSubject, setEmailSubject] = useState("Quick question on the SOW");
  const [emailBody, setEmailBody] = useState(
    "Hey — can you remind me what the renewal date looks like for our contract? Thanks."
  );

  // Upload form state
  const [file, setFile] = useState<File | null>(null);

  const customer = customers.find((c) => c.key === customerKey);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      let res: Response;
      if (mode === "slack") {
        res = await fetch("/api/dev/simulate/slack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerKey, userName: slackUser, text: slackText }),
        });
      } else if (mode === "email") {
        res = await fetch("/api/dev/simulate/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerKey, from: emailFrom, subject: emailSubject, body: emailBody }),
        });
      } else {
        if (!file) {
          setResult({ ok: false, error: "Pick a file first." });
          setBusy(false);
          return;
        }
        const fd = new FormData();
        fd.append("file", file);
        res = await fetch(`/api/customers/${customerKey}/upload`, {
          method: "POST",
          body: fd,
        });
      }
      const data = (await res.json()) as Result;
      setResult({ ...data, ok: res.ok });
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={submit} className="space-y-4 rounded-md border border-[color:var(--brand-metal)] bg-white p-5">
        <div>
          <label className="block text-xs uppercase tracking-wider text-[color:var(--brand-gray)] mb-1">
            Customer
          </label>
          <select
            value={customerKey}
            onChange={(e) => setCustomerKey(e.target.value)}
            className="w-full rounded-md border border-[color:var(--brand-metal)] bg-white px-3 py-2 text-sm"
          >
            {customers.map((c) => (
              <option key={c.key} value={c.key}>
                {c.display_name} ({c.key})
              </option>
            ))}
          </select>
          {customer ? (
            <div className="text-xs text-[color:var(--brand-gray)] mt-1">
              {customer.slack_channel ? `#${customer.slack_channel}` : "no Slack channel"}
              {" · "}
              {customer.email_alias ?? "no email alias"}
            </div>
          ) : null}
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-[color:var(--brand-gray)] mb-1">
            Inbound type
          </label>
          <div className="flex gap-1 rounded-md border border-[color:var(--brand-metal)] p-1">
            {(["slack", "email", "upload"] as Mode[]).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded text-sm py-1.5 ${
                  mode === m
                    ? "bg-[color:var(--brand-yellow)] text-[color:var(--brand-night)] font-medium"
                    : "text-[color:var(--brand-gray)] hover:text-[color:var(--brand-night)]"
                }`}
              >
                {m === "slack" ? "Slack message" : m === "email" ? "Email received" : "File uploaded"}
              </button>
            ))}
          </div>
        </div>

        {mode === "slack" ? (
          <>
            <Field label="From (display name)">
              <input
                value={slackUser}
                onChange={(e) => setSlackUser(e.target.value)}
                className="w-full rounded-md border border-[color:var(--brand-metal)] bg-white px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Message">
              <textarea
                value={slackText}
                onChange={(e) => setSlackText(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-[color:var(--brand-metal)] bg-white px-3 py-2 text-sm"
              />
            </Field>
          </>
        ) : null}

        {mode === "email" ? (
          <>
            <Field label="From">
              <input
                value={emailFrom}
                onChange={(e) => setEmailFrom(e.target.value)}
                className="w-full rounded-md border border-[color:var(--brand-metal)] bg-white px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Subject">
              <input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full rounded-md border border-[color:var(--brand-metal)] bg-white px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Body">
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={6}
                className="w-full rounded-md border border-[color:var(--brand-metal)] bg-white px-3 py-2 text-sm"
              />
            </Field>
          </>
        ) : null}

        {mode === "upload" ? (
          <>
            <Field label="File">
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm"
              />
            </Field>
            <p className="text-xs text-[color:var(--brand-gray)]">
              Drops the file in the customer&rsquo;s storage bucket and dispatches the ingestion
              background job. PDFs and images get OCR&rsquo;d via Claude vision; the result lands
              in the customer&rsquo;s documents tab.
            </p>
          </>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Simulate"}
        </button>
      </form>

      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-5">
        <h2 className="font-medium mb-2">Result</h2>
        {result ? (
          <div className="space-y-3">
            <div
              className={`text-xs uppercase tracking-wider ${
                result.ok ? "text-[color:var(--brand-night)]" : "text-red-700"
              }`}
            >
              {result.ok ? "Success" : "Error"}
            </div>
            {result.message ? <div className="text-sm">{result.message}</div> : null}
            {result.agent_response ? (
              <div>
                <div className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)] mb-1">
                  Agent response
                </div>
                <pre className="text-xs whitespace-pre-wrap leading-relaxed bg-[color:var(--brand-seasalt)] rounded p-3">
                  {result.agent_response}
                </pre>
              </div>
            ) : null}
            {result.error ? (
              <pre className="text-xs whitespace-pre-wrap leading-relaxed text-red-700">
                {result.error}
              </pre>
            ) : null}
            {result.raw ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-[color:var(--brand-gray)]">raw</summary>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(result.raw, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[color:var(--brand-gray)]">
            Submit the form to send a simulated inbound message. The agent runs against the same code
            paths Slack and Gmail use in production.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-[color:var(--brand-gray)] mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
