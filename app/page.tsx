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

const STATUS_LABEL: Record<string, string> = {
  queued: "Dialing…",
  ringing: "Ringing the phone…",
  "in-progress": "Live — agent is talking",
  ended: "Call ended",
  failed: "Call failed",
  unknown: "…",
};

function pillClass(s?: string) {
  if (s === "in-progress") return "pill live";
  if (s === "ringing" || s === "queued") return "pill ringing";
  if (s === "ended") return "pill ended";
  if (s === "failed") return "pill failed";
  return "pill";
}

function YesNo({ value }: { value?: boolean }) {
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

  // load allowlist (masked) + provider
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
      if (!res.ok) {
        throw new Error(data.error || "Failed to start call");
      }

      setCall({ id: data.callId, status: "queued" });

      // elapsed timer
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
  const showResults =
    call?.status === "ended" || call?.status === "failed";

  return (
    <main className="wrap">
      <div className="brand">
        <span className="dot" />
        Sunrise Interiors
        <small>· Bengaluru</small>
      </div>

      <h1>Get a callback in seconds.</h1>
      <p className="lede">
        Click below and our AI design assistant will call the lead right now —
        in Hindi, Hinglish or English — qualify the requirement, and book a
        designer slot. Built for the live demo moment.
      </p>

      {!configured && (
        <div className="error" style={{ marginBottom: 18 }}>
          Server not configured yet. Set <code>ALLOWED_NUMBERS</code> and the
          provider keys in your environment variables.
        </div>
      )}

      <div className="card">
        <div className="row">
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="field">Lead to call (allowlisted)</label>
            <select
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
          <div style={{ alignSelf: "flex-end" }}>
            <button
              className="call"
              onClick={startCall}
              disabled={calling || numbers.length === 0}
            >
              {calling ? "Calling…" : "📞 Call me now"}
            </button>
          </div>
        </div>

        {provider && (
          <div style={{ marginTop: 14 }}>
            <span className="badge">provider: {provider}</span>{" "}
            <span className="muted">
              Numbers are enforced server-side. The page can only pick from the
              allowlist — never a raw number.
            </span>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {call && (
        <div className="card">
          <div className="row">
            <span className={pillClass(call.status)}>
              <span className="led" />
              {STATUS_LABEL[call.status] || call.status}
            </span>
            <span className="timer">
              {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
              {String(elapsed % 60).padStart(2, "0")}
            </span>
          </div>
          {call.status === "queued" && (
            <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
              Placing the call — the phone should ring within ~10 seconds.
            </p>
          )}
          {call.endedReason && call.status === "failed" && (
            <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
              Reason: {call.endedReason}
            </p>
          )}
        </div>
      )}

      {showResults && s && (
        <div className="card">
          <p className="section-title">Qualification (auto-extracted)</p>
          <div className="grid">
            <div className="kv">
              <div className="k">Right person</div>
              <YesNo value={s.caller_is_right_person} />
            </div>
            <div className="kv">
              <div className="k">Interested</div>
              <YesNo value={s.interested} />
            </div>
            <div className="kv">
              <div className="k">Need</div>
              <div className="v">{s.need || "—"}</div>
            </div>
            <div className="kv">
              <div className="k">Urgency</div>
              <div className="v">{s.urgency || "—"}</div>
            </div>
            <div className="kv">
              <div className="k">Slot offered</div>
              <div className="v">{s.slot_offered || "—"}</div>
            </div>
            <div className="kv">
              <div className="k">Slot confirmed</div>
              <YesNo value={s.slot_confirmed} />
            </div>
            <div className="kv">
              <div className="k">Language</div>
              <div className="v">{s.language || "—"}</div>
            </div>
            <div className="kv">
              <div className="k">Booking</div>
              <div className="v">
                {s.slot_confirmed && s.slot_offered
                  ? `📅 ${s.slot_offered}`
                  : "Not booked"}
              </div>
            </div>
          </div>
        </div>
      )}

      {showResults && (call?.costInr !== undefined || call?.costUsd !== undefined) && (
        <div className="card">
          <p className="section-title">Cost of this call</p>
          <div className="cost">
            {call?.costInr !== undefined
              ? `₹${call.costInr.toFixed(2)}`
              : `$${call?.costUsd?.toFixed(3)}`}
          </div>
          {call?.costUsd !== undefined && (
            <p className="muted" style={{ marginTop: 6 }}>
              (${call.costUsd.toFixed(3)} · rate USD→INR{" "}
              {process.env.NEXT_PUBLIC_USD_TO_INR || "≈86"})
            </p>
          )}
        </div>
      )}

      {showResults && call?.summary && (
        <div className="card">
          <p className="section-title">Summary</p>
          <p style={{ margin: 0 }}>{call.summary}</p>
        </div>
      )}

      {showResults && call?.transcript && (
        <div className="card">
          <p className="section-title">Transcript</p>
          <div className="transcript">{call.transcript}</div>
        </div>
      )}

      <p className="foot">
        This demo dials only consented, allowlisted numbers. Automated outbound
        calls to Indian mobiles are regulated (TRAI/DLT) — see DECISIONS.md for
        what would change before real-customer use.
      </p>
    </main>
  );
}
