// Verify Slack request signatures.
// https://api.slack.com/authentication/verifying-requests-from-slack

import crypto from "crypto";

const SIGNATURE_VERSION = "v0";
const FIVE_MINUTES = 60 * 5;

export function verifySlackSignature(opts: {
  signingSecret: string;
  timestamp: string;
  signature: string;
  rawBody: string;
}): boolean {
  const { signingSecret, timestamp, signature, rawBody } = opts;
  if (!signingSecret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > FIVE_MINUTES) return false;

  const base = `${SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const expected =
    SIGNATURE_VERSION + "=" + crypto.createHmac("sha256", signingSecret).update(base).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
