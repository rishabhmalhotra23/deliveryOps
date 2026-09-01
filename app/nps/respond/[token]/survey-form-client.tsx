"use client";

import { useState } from "react";
import { AUTOMATION_TARGET_RANGES, AUTOMATION_FUNCTIONS } from "@/lib/supabase/types";

const inputClass =
  "w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-[color:var(--foreground)]">
        {label} <span className="text-red-500">*</span>
      </label>
      {children}
    </div>
  );
}

function ScaleField({
  value,
  onChange,
  min,
  max,
  lowLabel,
  highLabel,
}: {
  value: number | null;
  onChange: (n: number) => void;
  min: number;
  max: number;
  lowLabel: string;
  highLabel: string;
}) {
  const options = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-[color:var(--muted-foreground)] w-24">{lowLabel}</span>
      {options.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`w-8 h-8 rounded-full text-xs font-semibold border transition-colors ${
            value === n
              ? "bg-[color:var(--brand-yellow)] text-black border-[color:var(--brand-yellow)]"
              : "border-[var(--glass-border)] text-[color:var(--foreground)] hover:border-[color:var(--brand-yellow)]"
          }`}
        >
          {n}
        </button>
      ))}
      <span className="text-[11px] text-[color:var(--muted-foreground)] w-24 text-right">{highLabel}</span>
    </div>
  );
}

export function SurveyFormClient({
  token,
  respondentName,
  companyName,
  prefillScore,
}: {
  token: string;
  respondentName: string;
  companyName: string;
  prefillScore: number | null;
}) {
  const [name, setName] = useState(respondentName);
  const [company, setCompany] = useState(companyName);
  const [score, setScore] = useState<number | null>(prefillScore);
  const [satisfaction, setSatisfaction] = useState<number | null>(null);
  const [targetRange, setTargetRange] = useState("");
  const [functions, setFunctions] = useState<string[]>([]);
  const [functionsOther, setFunctionsOther] = useState("");
  const [easeCreating, setEaseCreating] = useState<number | null>(null);
  const [easeAcceptance, setEaseAcceptance] = useState<number | null>(null);
  const [easeBusinessCase, setEaseBusinessCase] = useState<number | null>(null);
  const [easeIdentifying, setEaseIdentifying] = useState<number | null>(null);
  const [easeSelfSufficiency, setEaseSelfSufficiency] = useState<number | null>(null);
  const [easeSupport, setEaseSupport] = useState<number | null>(null);
  const [journeyAgreement, setJourneyAgreement] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function toggleFunction(fn: string) {
    setFunctions((cur) => (cur.includes(fn) ? cur.filter((f) => f !== fn) : [...cur, fn]));
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/nps/respond/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          respondentName: name,
          companyName: company,
          score,
          productSatisfaction: satisfaction,
          automationTargetRange: targetRange,
          automationFunctions: functions,
          automationFunctionsOther: functionsOther,
          easeCreatingAutomation: easeCreating,
          easeBusinessUserAcceptance: easeAcceptance,
          easeBusinessCase,
          easeIdentifyingProcesses: easeIdentifying,
          easeSelfSufficiency,
          easeSupportGuidance: easeSupport,
          journeySuccessAgreement: journeyAgreement,
          feedback,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="glass-card p-8 text-center space-y-2">
        <div className="text-lg font-semibold text-[color:var(--foreground)]">Thank you!</div>
        <p className="text-sm text-[color:var(--muted-foreground)]">Your response has been recorded.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>

      <Field label="Company Name">
        <input value={company} onChange={(e) => setCompany(e.target.value)} className={inputClass} />
      </Field>

      <Field label="How likely are you to recommend us to colleagues and friends?">
        <ScaleField value={score} onChange={setScore} min={0} max={10} lowLabel="Not likely" highLabel="Very likely" />
      </Field>

      <Field label="How satisfied are you with Kognitos as a product?">
        <ScaleField
          value={satisfaction}
          onChange={setSatisfaction}
          min={1}
          max={5}
          lowLabel="Not satisfied"
          highLabel="Very satisfied"
        />
      </Field>

      <Field label="How many processes do you target automating in the next 12 months?">
        <select value={targetRange} onChange={(e) => setTargetRange(e.target.value)} className={inputClass}>
          <option value="">Select…</option>
          {AUTOMATION_TARGET_RANGES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>

      <Field label="What are the company functions where you plan to automate processes?">
        <div className="grid grid-cols-2 gap-2">
          {AUTOMATION_FUNCTIONS.map((fn) => (
            <label key={fn} className="flex items-center gap-2 text-sm text-[color:var(--foreground)]">
              <input type="checkbox" checked={functions.includes(fn)} onChange={() => toggleFunction(fn)} />
              {fn}
            </label>
          ))}
        </div>
        {functions.includes("Other") ? (
          <input
            value={functionsOther}
            onChange={(e) => setFunctionsOther(e.target.value)}
            placeholder="Please specify"
            className={`${inputClass} mt-2`}
          />
        ) : null}
      </Field>

      <Field label="How easy/difficult was your experience creating an automation?">
        <ScaleField
          value={easeCreating}
          onChange={setEaseCreating}
          min={1}
          max={5}
          lowLabel="Very Difficult"
          highLabel="Very Easy"
        />
      </Field>

      <Field label="How do you find: Managing Business User Acceptance">
        <ScaleField
          value={easeAcceptance}
          onChange={setEaseAcceptance}
          min={1}
          max={5}
          lowLabel="Very Difficult"
          highLabel="Very Easy"
        />
      </Field>

      <Field label="How do you find: Creating a Business Case to Automate a Process">
        <ScaleField
          value={easeBusinessCase}
          onChange={setEaseBusinessCase}
          min={1}
          max={5}
          lowLabel="Very Difficult"
          highLabel="Very Easy"
        />
      </Field>

      <Field label="How do you find: Identifying Suitable Processes to Automate">
        <ScaleField
          value={easeIdentifying}
          onChange={setEaseIdentifying}
          min={1}
          max={5}
          lowLabel="Very Difficult"
          highLabel="Very Easy"
        />
      </Field>

      <Field label="How do you find: Building Self Sufficiency with the Product">
        <ScaleField
          value={easeSelfSufficiency}
          onChange={setEaseSelfSufficiency}
          min={1}
          max={5}
          lowLabel="Very Difficult"
          highLabel="Very Easy"
        />
      </Field>

      <Field label="How do you find: Getting Support & Guidance from Kognitos">
        <ScaleField
          value={easeSupport}
          onChange={setEaseSupport}
          min={1}
          max={5}
          lowLabel="Very Difficult"
          highLabel="Very Easy"
        />
      </Field>

      <Field label="Would you agree that your automation journey with Kognitos is on the path to success?">
        <ScaleField
          value={journeyAgreement}
          onChange={setJourneyAgreement}
          min={1}
          max={5}
          lowLabel="Strongly Disagree"
          highLabel="Strongly Agree"
        />
      </Field>

      <Field label="Please share any other input/feedback">
        <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4} className={`${inputClass} resize-y`} />
      </Field>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="btn-primary rounded-full px-6 py-2.5 text-sm font-semibold disabled:opacity-60"
      >
        {busy ? "Submitting…" : "Submit"}
      </button>
    </div>
  );
}
