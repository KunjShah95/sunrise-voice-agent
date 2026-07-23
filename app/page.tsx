"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface PublicNumber {
  index: number;
  label: string;
  masked: string;
}

interface Structured {
  caller_is_right_person?: boolean;
  service?: string;
  event_date?: string;
  guest_count?: string;
  location?: string;
  proposal_agreed?: boolean;
  interested?: boolean;
  language?: string;
}

interface Turn {
  role: "assistant" | "user";
  text: string;
}

interface CallState {
  id: string;
  status: "queued" | "ringing" | "in-progress" | "ended" | "failed" | "unknown";
  endedReason?: string;
  transcript?: string;
  turns?: Turn[];
  summary?: string;
  structured?: Structured;
  costUsd?: number;
  costInr?: number;
  recordingUrl?: string;
  conversationDuration?: number;
  error?: string;
  manualFetch?: boolean; // Flag to indicate this was manually fetched, not from a live call
}

const STATE_LABEL: Record<string, string> = {
  queued: "Dialing the lead",
  ringing: "Ringing",
  "in-progress": "Live — Ria is speaking",
  ended: "Call complete",
  failed: "Call failed",
  unknown: "Connecting",
};

function SpecVal({ value }: { value?: boolean }) {
  if (value === undefined) return <span className="v">—</span>;
  return <span className={`v ${value ? "yes" : "no"}`}>{value ? "Yes" : "No"}</span>;
}

export default function Home() {
  const [numbers, setNumbers] = useState<PublicNumber[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [selected, setSelected] = useState(0);
  const [configured, setConfigured] = useState(true);

  // Source of the number to dial: an allowlisted lead, or the visitor's own
  // OTP-verified number.
  const [mode, setMode] = useState<"lead" | "own">("lead");
  const [verifyEnabled, setVerifyEnabled] = useState(false);
  // Demo mode: dial a number typed straight in, no OTP (env-gated on server).
  const [demoMode, setDemoMode] = useState(false);

  // "Call my own number" (OTP) flow.
  const [ownNumber, setOwnNumber] = useState("");
  // Demo raw-dial: require an explicit consent tick before dialing a typed number.
  const [consent, setConsent] = useState(false);
  const [otpStep, setOtpStep] = useState<"enter" | "code" | "verified">("enter");
  const [code, setCode] = useState("");
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null);
  const [verifiedMasked, setVerifiedMasked] = useState<string>("");
  const [otpBusy, setOtpBusy] = useState(false);

  const [calling, setCalling] = useState(false);
  const [call, setCall] = useState<CallState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Time from clicking dial to the call actually connecting (dial -> pickup).
  // Doubles as the "call arrives within 10-15s" P0 proof.
  const [connectMs, setConnectMs] = useState<number | null>(null);

  // Manual transcript fetch by execution ID
  const [executionId, setExecutionId] = useState("");
  const [fetchingManual, setFetchingManual] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endPollsRef = useRef(0);
  const startedAtRef = useRef(0);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        setNumbers(d.numbers || []);
        setProvider(d.provider || "");
        setConfigured(!!d.configured);
        setVerifyEnabled(!!d.verify);
        setDemoMode(!!d.demo);
        // Lead with the "enter your number" path whenever it's available — that's
        // the primary live-demo flow (client types their own number). Fall back
        // to the allowlist tab only when self-serve isn't configured.
        if (d.verify || d.demo) setMode("own");
        else setMode("lead");
      })
      .catch(() => setConfigured(false));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    pollRef.current = null;
    timerRef.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(
    (id: string) => {
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/call-status?id=${encodeURIComponent(id)}`);
          const d: CallState = await r.json();
          if (!r.ok) return;
          setCall(d);

          // First moment the call is actually live -> record connect latency.
          if (
            (d.status === "in-progress" || d.status === "ringing") &&
            startedAtRef.current
          ) {
            setConnectMs((prev) =>
              prev === null ? Date.now() - startedAtRef.current : prev,
            );
          }

          if (d.status === "ended" || d.status === "failed") {
            // Call is over — but Bolna finalizes the cost + transcript + analysis + recording
            // a few seconds AFTER the status flips to "ended". Unlock the UI now,
            // but keep polling until the real cost/analysis/recording land (or we give up),
            // otherwise the cost reads ₹0 and fields come back empty.
            setCalling(false);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            endPollsRef.current += 1;

            const haveCost =
              typeof d.costUsd === "number" && d.costUsd > 0;
            const haveReport = !!(d.transcript || d.summary || d.structured);
            const haveRecording = !!d.recordingUrl;

            if ((haveCost && haveReport && haveRecording) || endPollsRef.current >= 15) {
              stopPolling();
            }
          }
        } catch {
          /* transient — keep polling */
        }
      }, 2000);
    },
    [stopPolling],
  );

  // --- OTP flow for "call my own number" ------------------------------------
  async function sendCode() {
    setError(null);
    setOtpBusy(true);
    try {
      const res = await fetch("/api/verify/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: ownNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send the code");
      setOtpStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code");
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyCode() {
    setError(null);
    setOtpBusy(true);
    try {
      const res = await fetch("/api/verify/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: ownNumber, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      setVerifiedToken(data.verifiedToken);
      setVerifiedMasked(data.masked || "");
      setOtpStep("verified");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setOtpBusy(false);
    }
  }

  function resetOwn() {
    setOtpStep("enter");
    setCode("");
    setVerifiedToken(null);
    setVerifiedMasked("");
    setError(null);
  }

  async function startCall() {
    setError(null);
    setCall(null);
    setElapsed(0);
    setConnectMs(null);
    setCalling(true);
    endPollsRef.current = 0;
    startedAtRef.current = Date.now();

    // Payload by path:
    //  - lead        -> allowlist index
    //  - own + demo  -> the typed number (DEMO_MODE gate on server)
    //  - own + OTP   -> single-use verified token
    const payload =
      mode === "lead"
        ? { index: selected }
        : demoMode
          ? { number: ownNumber }
          : { verifiedToken };

    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start call");

      setCall({ id: data.callId, status: "queued" });

      const t0 = Date.now();
      timerRef.current = setInterval(
        () => setElapsed(Math.floor((Date.now() - t0) / 1000)),
        1000,
      );
      poll(data.callId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setCalling(false);
      stopPolling();
    }
  }

  async function fetchTranscriptByExecutionId() {
    setError(null);
    setFetchingManual(true);
    try {
      const res = await fetch(`/api/transcript?executionId=${encodeURIComponent(executionId)}`);
      const data: CallState = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch transcript");
      setCall({ ...data, manualFetch: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch transcript");
    } finally {
      setFetchingManual(false);
    }
  }

  const s = call?.structured;
  const showResults = call?.status === "ended" || call?.status === "failed" || call?.manualFetch;
  const live = call?.status === "in-progress";
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="frame">
      <header className="topbar reveal d1">
        <div className="mark">
          <span className="sun" aria-hidden />
          <div>
            <div className="name">X-Plosiv Events</div>
            <div className="place">Delhi · Event Management</div>
          </div>
        </div>
        <span className="status-chip">
          <span className="beat" />
          Callback engine · live
        </span>
      </header>

      <section className="hero">
        <div className="reveal d2">
          <p className="eyebrow">The five-minute window</p>
          <h1>
            Call them back<br />
            before they <em>cool.</em>
          </h1>
        </div>
        <div className="reveal d3">
          <p className="lede">
            A lead just enquired about an event — a wedding, a corporate do,
            catering. They&apos;re hot for about five minutes — then they&apos;ve
            filled three competitors&apos; forms too.{" "}
            <b>Whoever calls first usually wins.</b>
          </p>
          <div className="count">
            Our AI event-assistant dials back in
            <strong>~10 seconds</strong>
          </div>
        </div>
      </section>

      {!configured && (
        <div className="alert reveal d3">
          Not configured yet — set <code>ALLOWED_NUMBERS</code> and the provider
          keys in the environment.
        </div>
      )}

      <section className="stage reveal d4">
        <div className="console">
          <div className="console-head">
            <span className="tag">Callback console</span>
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
          </div>

          <div className="console-body">
            {(verifyEnabled || demoMode) && numbers.length > 0 && (
              <div className="tabs" role="tablist">
                <button
                  className={`tab ${mode === "own" ? "on" : ""}`}
                  role="tab"
                  aria-selected={mode === "own"}
                  onClick={() => setMode("own")}
                  disabled={calling}
                >
                  Call my number
                </button>
                <button
                  className={`tab ${mode === "lead" ? "on" : ""}`}
                  role="tab"
                  aria-selected={mode === "lead"}
                  onClick={() => setMode("lead")}
                  disabled={calling}
                >
                  Allowlisted lead
                </button>
              </div>
            )}

            {mode === "lead" && (
              <>
                <label className="lbl" htmlFor="lead">
                  Lead on the allowlist
                </label>
                <div className="select-wrap">
                  <select
                    id="lead"
                    value={selected}
                    onChange={(e) => setSelected(Number(e.target.value))}
                    disabled={calling || numbers.length === 0}
                  >
                    {numbers.length === 0 && (
                      <option>No numbers configured</option>
                    )}
                    {numbers.map((n) => (
                      <option key={n.index} value={n.index}>
                        {n.label} — {n.masked}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="dial"
                  onClick={startCall}
                  disabled={calling || numbers.length === 0}
                >
                  {calling ? "Placing the callback…" : "Place the callback"}
                  {!calling && <span className="arrow">→</span>}
                </button>
              </>
            )}

            {mode === "own" && (
              <>
                <label className="lbl" htmlFor="own">
                  Your phone number
                </label>
                <input
                  id="own"
                  className="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  value={ownNumber}
                  onChange={(e) => {
                    setOwnNumber(e.target.value);
                    if (otpStep !== "enter") resetOwn();
                  }}
                  disabled={calling || (!demoMode && otpStep === "verified")}
                />

                {demoMode && (
                  <>
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                        disabled={calling}
                      />
                      <span>
                        I have this person&apos;s consent to place an automated
                        call to this number.
                      </span>
                    </label>
                    <button
                      className="dial"
                      onClick={startCall}
                      disabled={calling || ownNumber.trim().length < 8 || !consent}
                    >
                      {calling ? "Calling…" : "Call now"}
                      {!calling && <span className="arrow">→</span>}
                    </button>
                  </>
                )}

                {!demoMode && otpStep === "enter" && (
                  <button
                    className="dial"
                    onClick={sendCode}
                    disabled={otpBusy || ownNumber.trim().length < 8}
                  >
                    {otpBusy ? "Sending code…" : "Send me a code"}
                    {!otpBusy && <span className="arrow">→</span>}
                  </button>
                )}

                {otpStep === "code" && (
                  <>
                    <label className="lbl" htmlFor="otp" style={{ marginTop: 18 }}>
                      Enter the code we texted you
                    </label>
                    <input
                      id="otp"
                      className="phone"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      disabled={otpBusy}
                    />
                    <button
                      className="dial"
                      onClick={verifyCode}
                      disabled={otpBusy || code.trim().length < 4}
                    >
                      {otpBusy ? "Verifying…" : "Verify number"}
                      {!otpBusy && <span className="arrow">→</span>}
                    </button>
                    <button className="linkbtn" onClick={resetOwn} disabled={otpBusy}>
                      Use a different number
                    </button>
                  </>
                )}

                {otpStep === "verified" && (
                  <>
                    <div className="verified-note">
                      ✓ {verifiedMasked} verified — this is your number.
                    </div>
                    <button
                      className="dial"
                      onClick={startCall}
                      disabled={calling}
                    >
                      {calling ? "Calling you…" : "Call me now"}
                      {!calling && <span className="arrow">→</span>}
                    </button>
                    <button
                      className="linkbtn"
                      onClick={resetOwn}
                      disabled={calling}
                    >
                      Use a different number
                    </button>
                  </>
                )}
              </>
            )}

            <div className="guard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 10V8a6 6 0 1 1 12 0v2m-9 0h6a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Z"
                  stroke="#7a6f62"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              <span>
                {demoMode ? (
                  <>
                    <b>Demo mode</b> — dials the number you type (validated +
                    rate-limited). Turn off <code>DEMO_MODE</code> in production;
                    it then dials only allowlisted or OTP-verified numbers
                  </>
                ) : (
                  <>
                    Dials <b>only</b> allowlisted leads (picked by index) or a
                    number you&apos;ve <b>verified by OTP</b> as your own —
                    enforced server-side, never a raw number from the browser
                  </>
                )}
                {provider && (
                  <>
                    {" · "}
                    <b>{provider}</b>
                  </>
                )}
                .
              </span>
            </div>

            {call && (
              <div className="live">
                <div className="live-top">
                  <span className="state" data-s={call.status}>
                    <span className="led" />
                    {STATE_LABEL[call.status] || call.status}
                  </span>
                  <span className="clock">
                    {mm}:{ss}
                  </span>
                </div>

                <div className={`wave ${live ? "on" : ""}`} aria-hidden>
                  {Array.from({ length: 15 }).map((_, i) => (
                    <i key={i} />
                  ))}
                </div>

                {connectMs !== null && (
                  <p className="hint connected">
                    <span className="tick">✓</span> Connected in{" "}
                    <b>{(connectMs / 1000).toFixed(1)}s</b>
                    {connectMs <= 15000 && " — within the 10–15s window"}
                  </p>
                )}
                {call.status === "queued" && connectMs === null && (
                  <p className="hint">
                    Placing the call — the phone should ring within ~10 seconds.
                  </p>
                )}
                {call.status === "failed" && call.endedReason && (
                  <p className="hint">Reason: {call.endedReason}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {error && <div className="alert">{error}</div>}

      <section className="stage reveal d4">
        <div className="console">
          <div className="console-head">
            <span className="tag">Fetch existing transcript</span>
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
          </div>

          <div className="console-body">
            <label className="lbl" htmlFor="exec-id">
              Bolna execution ID
            </label>
            <input
              id="exec-id"
              className="phone"
              type="text"
              placeholder="15be8375-e327-4979-a2bd-0da8b1874b79"
              value={executionId}
              onChange={(e) => setExecutionId(e.target.value)}
              disabled={fetchingManual}
            />
            <button
              className="dial"
              onClick={fetchTranscriptByExecutionId}
              disabled={fetchingManual || executionId.trim().length === 0}
            >
              {fetchingManual ? "Fetching…" : "Fetch transcript"}
              {!fetchingManual && <span className="arrow">→</span>}
            </button>
            <p className="hint">
              Paste an execution ID from a previous Bolna call to retrieve its transcript and analysis.
            </p>
          </div>
        </div>
      </section>

      <div className="results">
        {showResults && (
          <div className="callmeta reveal">
            {!call?.manualFetch && (
              <>
                <div className="metric">
                  <span className="ml">Connected in</span>
                  <span className="mv">
                    {connectMs !== null ? `${(connectMs / 1000).toFixed(1)}s` : "—"}
                  </span>
                </div>
                <div className="metric">
                  <span className="ml">Talk time</span>
                  <span className="mv">
                    {mm}:{ss}
                  </span>
                </div>
              </>
            )}
            <div className="metric">
              <span className="ml">Cost</span>
              <span className="mv accent">
                {call?.costInr !== undefined
                  ? `₹${call.costInr.toFixed(2)}`
                  : "—"}
              </span>
            </div>
            <div className="metric">
              <span className="ml">Result</span>
              <span className="mv">
                {call?.status === "failed"
                  ? "Failed"
                  : s?.proposal_agreed
                    ? "Proposal agreed"
                    : s?.interested === false
                      ? "Not interested"
                      : "Completed"}
              </span>
            </div>
          </div>
        )}

        {showResults && s && (
          <div className="panel">
            <div className="panel-h">
              <span className="t">Qualification</span>
              <span className="n">auto-extracted</span>
            </div>
            <div className="panel-b">
              <div className="spec">
                <div className="row">
                  <span className="k">Right person</span>
                  <SpecVal value={s.caller_is_right_person} />
                </div>
                <div className="row">
                  <span className="k">Interested</span>
                  <SpecVal value={s.interested} />
                </div>
                <div className="row">
                  <span className="k">Service / occasion</span>
                  <span className="v">{s.service || "—"}</span>
                </div>
                <div className="row">
                  <span className="k">Event date</span>
                  <span className="v">{s.event_date || "—"}</span>
                </div>
                <div className="row">
                  <span className="k">Guest count</span>
                  <span className="v">{s.guest_count || "—"}</span>
                </div>
                <div className="row">
                  <span className="k">Location</span>
                  <span className="v">{s.location || "—"}</span>
                </div>
                <div className="row">
                  <span className="k">Proposal agreed</span>
                  <SpecVal value={s.proposal_agreed} />
                </div>
                <div className="row">
                  <span className="k">Language</span>
                  <span className="v">{s.language || "—"}</span>
                </div>
              </div>

              {s.proposal_agreed && (
                <div style={{ marginTop: 20 }}>
                  <span className="booking">
                    📲 Proposal / quote to be sent on WhatsApp
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {showResults &&
          (call?.costInr !== undefined || call?.costUsd !== undefined) && (
            <div className="panel">
              <div className="panel-h">
                <span className="t">Cost of this call</span>
                <span className="n">metered</span>
              </div>
              <div className="panel-b">
                <div className="receipt">
                  <div className="amt">
                    {call?.costInr !== undefined ? (
                      <>
                        <span>₹</span>
                        {call.costInr.toFixed(2)}
                      </>
                    ) : (
                      `$${call?.costUsd?.toFixed(3)}`
                    )}
                  </div>
                  <div className="sub">
                    {provider === "bolna" ? (
                      <>
                        Billed by Bolna in ₹ — Sarvam voice + Indian telephony
                        (domestic). {call?.costUsd !== undefined && `≈ $${call.costUsd.toFixed(3)}`}
                      </>
                    ) : (
                      call?.costUsd !== undefined && (
                        <>
                          ${call.costUsd.toFixed(3)} · billed by the provider,
                          converted at the configured USD→INR rate
                        </>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        {showResults && call?.summary && (
          <div className="panel">
            <div className="panel-h">
              <span className="t">Summary</span>
              <span className="n">post-call</span>
            </div>
            <div className="panel-b">
              <p className="summary">{call.summary}</p>
            </div>
          </div>
        )}

        {showResults && call?.recordingUrl && (
          <div className="panel">
            <div className="panel-h">
              <span className="t">Call Recording</span>
              <span className="n">verify transcript</span>
            </div>
            <div className="panel-b">
              <p style={{ marginBottom: 16, fontSize: 13, color: "#666" }}>
                Listen to the actual call recording to verify the transcript accuracy:
              </p>
              <audio controls style={{ width: "100%", marginBottom: 12 }}>
                <source src={call.recordingUrl} type="audio/mpeg" />
                Your browser does not support the audio element.
              </audio>
              <p style={{ fontSize: 12, color: "#999" }}>
                Duration: {call.conversationDuration ? `${Math.floor(call.conversationDuration / 60)}m ${call.conversationDuration % 60}s` : "—"}
              </p>
            </div>
          </div>
        )}

        {showResults && (call?.turns?.length || call?.transcript) && (
          <div className="panel">
            <div className="panel-h">
              <span className="t">Complete Transcript</span>
              <span className="n">full conversation</span>
            </div>
            <div className="panel-b">
              <p style={{ marginBottom: 16, fontSize: 13, color: "#666" }}>
                Below is the complete word-for-word conversation between Ria (AI assistant) and the customer. You can verify this transcript against the call recording above.
              </p>
              {call?.turns?.length ? (
                <div className="chat">
                  {call.turns.map((turn, i) => (
                    <div key={i} className={`turn ${turn.role}`}>
                      <span className="who">
                        {turn.role === "assistant" ? "🤖 Ria" : "👤 Customer"}
                      </span>
                      <span className="bubble">{turn.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="transcript">{call.transcript}</div>
              )}
              {call?.turns?.length && (
                <p style={{ marginTop: 16, fontSize: 12, color: "#999" }}>
                  Total exchanges: {call.turns.length} • Transcript automatically generated and synced from call recording
                </p>
              )}
            </div>
          </div>
        )}

        {showResults &&
          !s &&
          !call?.summary &&
          !call?.turns?.length &&
          !call?.transcript && (
            <div className="panel">
              <div className="panel-b empty">
                {call?.status === "failed" ? (
                  <>The call didn&apos;t connect, so there&apos;s no transcript to show.</>
                ) : (
                  <>
                    Call ended. The provider is still finalising the transcript
                    and analysis — this can take a few seconds after hang-up.
                  </>
                )}
              </div>
            </div>
          )}
      </div>

      <footer className="foot">
        {demoMode
          ? "Demo mode is on — only call numbers you have consent to dial. "
          : "This app dials only allowlisted or OTP-verified numbers. "}
        Automated outbound calls to Indian mobiles are regulated (TRAI / DLT) —
        see DECISIONS.md for what would change before real-customer use.
      </footer>
    </div>
  );
}
