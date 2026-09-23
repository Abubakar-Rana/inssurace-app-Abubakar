"use client";

// Small form kit shared by sign-in, Settings and the Nestnic admin console.
// Kept deliberately plain: the same tokens and radii as the rest of the app,
// so these screens read as part of CertFlow rather than a bolted-on panel.

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-ink-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] leading-snug text-ink-400">{hint}</span>}
    </label>
  );
}

export function Input(props) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-line bg-white px-3 py-2 text-[13.5px] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15 disabled:bg-surface-shell disabled:text-ink-500 ${props.className || ""}`}
    />
  );
}

export function Select({ children, ...props }) {
  return (
    <select
      {...props}
      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13.5px] text-ink-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
    >
      {children}
    </select>
  );
}

export function Button({ variant = "primary", busy, children, ...props }) {
  const styles = {
    primary: "bg-brand-500 text-white hover:bg-brand-600",
    secondary: "border border-line bg-white text-ink-700 hover:bg-surface-hover",
    danger: "border border-red-200 bg-white text-red-600 hover:bg-red-50",
    ghost: "text-ink-600 hover:bg-surface-hover",
  };
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition active:scale-[0.98] disabled:opacity-50 ${styles[variant]} ${props.className || ""}`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 flex-none rounded-full transition ${checked ? "bg-brand-500" : "bg-ink-300"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`}
        />
      </button>
      <span>
        <span className="block text-[13.5px] font-medium text-ink-900">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">{hint}</span>}
      </span>
    </label>
  );
}

/** One notice line. `tone` is ok | error | info. */
export function Notice({ tone = "info", children }) {
  if (!children) return null;
  const styles = {
    ok: "bg-emerald-50 text-emerald-800",
    error: "bg-red-50 text-red-700",
    info: "bg-surface-shell text-ink-600",
  };
  return <div className={`rounded-lg px-3.5 py-2.5 text-[13px] leading-snug ${styles[tone]}`}>{children}</div>;
}

export function Section({ title, description, children, actions }) {
  return (
    <section className="rounded-2xl border border-line bg-white">
      <div className="flex items-start gap-4 border-b border-line-soft px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-500">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

/** A temporary password shown exactly once, with a copy button. */
export function OneTimeSecret({ label, value, onDone }) {
  if (!value) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-[13px] font-semibold text-amber-900">{label}</p>
      <p className="mt-1 text-[12px] text-amber-800">
        Copy it now and send it to the user privately. It will not be shown again. They must change it when they first sign in.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-white px-3 py-1.5 font-mono text-[14px] text-ink-900 ring-1 ring-amber-200">{value}</code>
        <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(value)}>
          Copy
        </Button>
        {onDone && (
          <Button variant="ghost" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}

/** fetch + JSON with the error message surfaced. Never redirects. */
export async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
