"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface PublicNumber {
  index: number;
  label: string;
  masked: string;
}

interface Structured {
  caller_is_right_person?: boolean;
  need?: string;
  urgency?: string;
  slot_offered?: string;
  slot_confirmed?: boolean;
  interested?: boolean;
  language?: string;
}

interface CallState {
  id: string;
  status: "queued" | "ringing" | "in-progress" | "ended" | "failed" | "unknown";
  endedReason?: string;
  transcript?: string;
  summary?: string;
  structured?: Structured;
  costUsd?: number;
  costInr?: number;
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

  const [calling, setCalling] = useState(false);
  const [call, setCall] = useState<CallState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        setNumbers(d.numbers || []);
        setProvider(d.provider || "");
        setConfigured(!!d.configured);
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
          if (d.status === "ended" || d.status === "failed") {
            stopPolling();
            setCalling(false);
          }
        } catch {
          /* transient — keep polling */
        }
      }, 2000);
    },
    [stopPolling],
  );

  async function startCall() {
    setError(null);
    setCall(null);
    setElapsed(0);
    setCalling(true);

    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: selected }),
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

  const s = call?.structured;
  const showResults = call?.status === "ended" || call?.status === "failed";
  const live = call?.status === "in-progress";
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="frame">
      <header className="topbar reveal d1">
        <div className="mark">
          <span className="sun" aria-hidden />
          <div>
            <div className="name">Sunrise Interiors</div>
            <div className="place">Bengaluru · Interiors</div>
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
            A lead just enquired about doing up their new flat. They&apos;re hot
            for about five minutes — then they&apos;ve filled three
            competitors&apos; forms too. <b>Whoever calls first usually wins.</b>
          </p>
          <div className="count">
            Our AI designer-assistant dials back in
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
                {numbers.length === 0 && <option>No numbers configured</option>}
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
                Dials <b>only</b> allowlisted numbers, enforced server-side. The
                page picks an index — never a raw number
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

                {call.status === "queued" && (
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

      <div className="results">
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
                  <span className="k">Need</span>
                  <span className="v">{s.need || "—"}</span>
                </div>
                <div className="row">
                  <span className="k">Urgency</span>
                  <span className="v">{s.urgency || "—"}</span>
                </div>
                <div className="row">
                  <span className="k">Slot offered</span>
                  <span className="v">{s.slot_offered || "—"}</span>
                </div>
                <div className="row">
                  <span className="k">Slot confirmed</span>
                  <SpecVal value={s.slot_confirmed} />
                </div>
                <div className="row">
                  <span className="k">Language</span>
                  <span className="v">{s.language || "—"}</span>
                </div>
              </div>

              {s.slot_confirmed && s.slot_offered && (
                <div style={{ marginTop: 20 }}>
                  <span className="booking">📅 Booked — {s.slot_offered}</span>
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
                  {call?.costUsd !== undefined && (
                    <div className="sub">
                      ${call.costUsd.toFixed(3)} · billed by the provider,
                      converted at the configured USD→INR rate
                    </div>
                  )}
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

        {showResults && call?.transcript && (
          <div className="panel">
            <div className="panel-h">
              <span className="t">Transcript</span>
              <span className="n">verbatim</span>
            </div>
            <div className="panel-b">
              <div className="transcript">{call.transcript}</div>
            </div>
          </div>
        )}
      </div>

      <footer className="foot">
        This demo dials only consented, allowlisted numbers. Automated outbound
        calls to Indian mobiles are regulated (TRAI / DLT) — see DECISIONS.md for
        what would change before real-customer use.
      </footer>
    </div>
  );
}
