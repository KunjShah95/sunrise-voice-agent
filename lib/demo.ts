// Demo mode — an EXPLICIT, env-gated relaxation of the allowlist so you can
// dial a number typed straight into the frontend during a live demo (e.g. the
// client's own phone, in front of them). OFF by default.
//
// Why gated: the production posture is "the browser never sends a raw dialable
// number" (allowlist by index, or OTP-verified token). Demo mode intentionally
// allows a typed number — so it must NEVER be on for a public deployment. Set
// DEMO_MODE=1 only on your local/demo machine.

export function demoEnabled(): boolean {
  return process.env.DEMO_MODE === "1";
}
