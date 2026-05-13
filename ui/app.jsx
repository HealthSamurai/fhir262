// fhir262 — Matrix UI
// Single React app rendered into #root.
// Loads loader.js first, which fetches runs/index.json + the selected run
// JSON and populates RUN_META, IMPLS, MODULES, STATUSES, RUN_HISTORY on
// window. Render is deferred until window.__runDataReady resolves.

const { useState, useMemo, useEffect, useRef, useCallback } = React;

const STATUS_LABEL = { pass: "Pass", fail: "Fail", skipped: "Skipped" };

function statusFor(moduleId, testId, implId) {
  const m = window.STATUSES[moduleId];
  if (!m) return null;
  const t = m[testId];
  if (!t) return null;
  return t[implId] || null;
}

function aggregateByImpl(impls) {
  // Across all modules + tests
  const out = {};
  for (const impl of impls) out[impl.id] = { pass: 0, fail: 0, skipped: 0, total: 0, ms: 0 };
  for (const mod of window.MODULES) {
    for (const test of mod.tests) {
      for (const impl of impls) {
        const r = statusFor(mod.id, test.id, impl.id);
        if (!r) continue;
        out[impl.id][r.status]++;
        out[impl.id].total++;
        out[impl.id].ms += r.duration_ms || 0;
      }
    }
  }
  return out;
}

function aggregateModule(moduleId, impls) {
  const out = {};
  for (const impl of impls) out[impl.id] = { pass: 0, fail: 0, skipped: 0, total: 0 };
  const mod = window.MODULES.find(m => m.id === moduleId);
  if (!mod) return out;
  for (const test of mod.tests) {
    for (const impl of impls) {
      const r = statusFor(moduleId, test.id, impl.id);
      if (!r) continue;
      out[impl.id][r.status]++;
      out[impl.id].total++;
    }
  }
  return out;
}

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m ${r}s`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da} ${h}:${mi} UTC`;
}

function fmtRelative(iso) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return fmtDate(iso).slice(0, 10);
}

// ──────────────────────────────────────────────────────────────────────────
// Cell glyph
// ──────────────────────────────────────────────────────────────────────────
function StatusGlyph({ status }) {
  if (status === null) {
    return <span className="glyph glyph-none" aria-label="No data">—</span>;
  }
  const color = {
    pass: "var(--c-pass)",
    fail: "var(--c-fail)",
    skipped: "var(--c-skip)",
  }[status];
  return <span className="glyph glyph-dot" style={{ background: color }} />;
}

// ──────────────────────────────────────────────────────────────────────────
// Run history popover
// ──────────────────────────────────────────────────────────────────────────
function RunHistory({ open, anchorRect, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const repoUrl = window.RUN_META.repoUrl;
  const runs = window.RUN_HISTORY || [];

  // Position popover relative to the anchor element
  const style = anchorRect ? {
    top: anchorRect.bottom + 10,
    right: window.innerWidth - anchorRect.right,
  } : { top: 80, right: 32 };

  return (
    <>
      <div className="popover-scrim" onMouseDown={(e) => e.stopPropagation()} />
      <div className="run-pop" style={style} ref={ref}>
        <div className="run-pop-head">
          <div className="run-pop-title">Run history</div>
          <div className="run-pop-sub">{runs.length} recent runs</div>
        </div>
        <div className="run-pop-list">
          {runs.map(run => {
            const total = run.pass + run.fail + run.skipped;
            const passPct = pct(run.pass, total);
            const failPct = pct(run.fail, total);
            const skipPct = 100 - passPct - failPct;
            const onClick = () => {
              if (run.isCurrent) { onClose(); return; }
              if (typeof window.__loadRun === "function") window.__loadRun(run.id);
            };
            return (
              <div
                key={run.id}
                role="button"
                tabIndex={0}
                className={`run-row ${run.isCurrent ? "run-row-current" : ""}`}
                onClick={onClick}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
                title={run.isCurrent ? "Current run" : `Switch to ${run.id}`}
                style={{ cursor: run.isCurrent ? "default" : "pointer" }}
              >
                <div className="run-row-l">
                  <div className="run-row-top">
                    <span className="run-when">{fmtRelative(run.startedAt)}</span>
                    {run.isCurrent && <span className="run-current-tag">current</span>}
                    <span className="run-branch mono">{run.branch}</span>
                  </div>
                  <div className="run-msg">{run.commitMessage}</div>
                  <div className="run-row-meta">
                    <a className="run-commit mono" href={`${repoUrl}/commit/${run.commit}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                      {run.commit}
                    </a>
                    <span className="run-meta-dot" />
                    <span className="run-time">{fmtDate(run.startedAt).slice(5, 16)}</span>
                    <span className="run-meta-dot" />
                    <span className="run-dur mono">{fmtDuration(run.duration_ms)}</span>
                  </div>
                </div>
                <div className="run-row-r">
                  <div className="run-impls">
                    {run.impls.map(implId => {
                      const impl = window.IMPLS.find(i => i.id === implId);
                      return (
                        <span key={implId} className="run-impl-chip" title={impl ? impl.label : implId}>
                          {impl ? impl.label : implId}
                        </span>
                      );
                    })}
                  </div>
                  <div className="run-bar" title={`${run.pass} pass · ${run.fail} fail · ${run.skipped} skipped`}>
                    <span style={{ width: `${passPct}%` }} className="bar-seg bar-pass" />
                    <span style={{ width: `${failPct}%` }} className="bar-seg bar-fail" />
                    <span style={{ width: `${skipPct}%` }} className="bar-seg bar-skip" />
                  </div>
                  <div className="run-counts mono">
                    <span className="run-cnt run-cnt-pass">{run.pass}</span>
                    <span className="run-cnt run-cnt-fail">{run.fail}</span>
                    <span className="run-cnt run-cnt-skip">{run.skipped}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
function Header() {
  const meta = window.RUN_META;
  const totalTests = window.MODULES.reduce((acc, m) => acc + m.tests.length, 0);
  const [histOpen, setHistOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const btnRef = useRef(null);

  const openHist = useCallback(() => {
    if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect());
    setHistOpen(true);
  }, []);

  return (
    <header className="hdr">
      <div className="hdr-left">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.95" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.55" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.35" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.8" />
            </svg>
          </span>
          <div className="brand-text">
            <div className="brand-title">fhir262</div>
            <div className="brand-sub">conformance matrix</div>
          </div>
        </div>
      </div>
      <div className="hdr-meta">
        <div className="meta-row">
          <span className="meta-k">branch</span>
          <span className="meta-v mono">{meta.branch}</span>
          <span className="meta-dot" />
          <span className="meta-k">commit</span>
          <a className="meta-v mono link" href={`${meta.repoUrl}/commit/${meta.commit}`} target="_blank" rel="noopener noreferrer">{meta.commit}</a>
          <span className="meta-dot" />
          <span className="meta-k">suite</span>
          <span className="meta-v mono">v{meta.suiteVersion}</span>
        </div>
        <button
          className="meta-row meta-row-2 meta-row-btn"
          onClick={openHist}
          ref={btnRef}
          title="Show run history"
        >
          <span className="meta-k">{fmtDate(meta.startedAt)}</span>
          <span className="meta-dot" />
          <span className="meta-k">{fmtDuration(meta.duration_ms)}</span>
          <span className="meta-dot" />
          <span className="meta-k">{totalTests} tests · {window.IMPLS.length} impls · {window.MODULES.length} modules</span>
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" className="meta-row-chev">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
      <div className="hdr-right">
        <a className="hdr-repo" href={window.RUN_META.repoUrl} target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.29 9.4 7.86 10.92.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.04 1.78 2.72 1.27 3.39.97.1-.75.4-1.27.74-1.56-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.04 11.04 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.73.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.79.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
          </svg>
          repo
        </a>
      </div>
      <RunHistory open={histOpen} anchorRect={anchorRect} onClose={() => setHistOpen(false)} />
    </header>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Impl summary bars
// ──────────────────────────────────────────────────────────────────────────
function ImplSummaryStrip({ impls, hidden, onToggleHide }) {
  const agg = useMemo(() => aggregateByImpl(impls), [impls]);
  return (
    <section className="impl-strip">
      {impls.map(impl => {
        const a = agg[impl.id];
        const passPct = pct(a.pass, a.total);
        const failPct = pct(a.fail, a.total);
        const skipPct = 100 - passPct - failPct;
        const isHidden = hidden.has(impl.id);
        return (
          <button
            key={impl.id}
            className={`impl-card ${isHidden ? "impl-card-hidden" : ""}`}
            onClick={() => onToggleHide(impl.id)}
            title={isHidden ? "Click to show in matrix" : "Click to hide from matrix"}
          >
            <div className="impl-card-head">
              <div className="impl-card-id">
                <div className="impl-card-name">{impl.label}</div>
              </div>
              <div className="impl-card-pct">
                <div className="impl-card-pct-num">
                  {passPct}<span className="pct-sign">%</span>
                </div>
                <div className="impl-card-pct-lbl">pass</div>
              </div>
            </div>
            <div className="impl-bar" title={`${a.pass} pass · ${a.fail} fail · ${a.skipped} skipped`}>
              <span style={{ width: `${passPct}%` }} className="bar-seg bar-pass" />
              <span style={{ width: `${failPct}%` }} className="bar-seg bar-fail" />
              <span style={{ width: `${skipPct}%` }} className="bar-seg bar-skip" />
            </div>
            <div className="impl-counts">
              <span className="cnt cnt-pass"><span className="cnt-dot" /> {a.pass}</span>
              <span className="cnt cnt-fail"><span className="cnt-dot" /> {a.fail}</span>
              <span className="cnt cnt-skip"><span className="cnt-dot" /> {a.skipped}</span>
              <span className="cnt cnt-time mono">{fmtDuration(a.ms)}</span>
            </div>
            <span className="impl-card-eye" aria-hidden="true">
              {isHidden ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M3 3l18 18M10.6 6.2A10.5 10.5 0 0 1 12 6c5 0 9 4 10 6-.6 1.3-1.9 3-3.8 4.3M6.7 6.7C4 8.4 2.5 10.7 2 12c1 2 4 6 9 6 1.8 0 3.4-.5 4.7-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </span>
          </button>
        );
      })}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sidebar — module list
// ──────────────────────────────────────────────────────────────────────────
function Sidebar({ modules, selectedId, onSelect, impls }) {
  return (
    <aside className="side">
      <div className="side-head">Modules</div>
      <nav className="side-list">
        {modules.map(mod => {
          const agg = aggregateModule(mod.id, impls);
          let pass = 0, fail = 0, skip = 0, tot = 0;
          for (const k of Object.keys(agg)) {
            pass += agg[k].pass; fail += agg[k].fail; skip += agg[k].skipped; tot += agg[k].total;
          }
          const passPct = pct(pass, tot);
          const isSel = mod.id === selectedId;
          return (
            <button
              key={mod.id}
              className={`side-item ${isSel ? "side-item-sel" : ""}`}
              onClick={() => onSelect(mod.id)}
            >
              <div className="side-item-row">
                <div className="side-item-name">{mod.label}</div>
                <div className="side-item-pct mono">{passPct}%</div>
              </div>
              <div className="side-item-meta mono">
                {mod.tests.length} test{mod.tests.length === 1 ? "" : "s"}
              </div>
              <div className="side-bar">
                <span style={{ width: `${pct(pass, tot)}%` }} className="bar-seg bar-pass" />
                <span style={{ width: `${pct(fail, tot)}%` }} className="bar-seg bar-fail" />
                <span style={{ width: `${pct(skip, tot)}%` }} className="bar-seg bar-skip" />
              </div>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Failure detail (jest-style)
// ──────────────────────────────────────────────────────────────────────────
function CodeFrame({ frame }) {
  if (!frame || !frame.lines || frame.lines.length === 0) return null;
  const failLine = frame.line;
  const col = frame.col || 0;
  const widest = String(frame.lines[frame.lines.length - 1].number).length;
  const pad = (s) => String(s).padStart(widest, " ");
  return (
    <div className="code-frame">
      {frame.lines.map((ln) => {
        const isFail = ln.number === failLine;
        return (
          <React.Fragment key={ln.number}>
            <div className={`cf-row ${isFail ? "cf-row-fail" : ""}`}>
              <span className="cf-marker">{isFail ? ">" : " "}</span>
              <span className="cf-num">{pad(ln.number)}</span>
              <span className="cf-sep">|</span>
              <span className="cf-code">{ln.text || " "}</span>
            </div>
            {isFail && col > 0 && (
              <div className="cf-row cf-row-caret">
                <span className="cf-marker">{" "}</span>
                <span className="cf-num">{pad("")}</span>
                <span className="cf-sep">|</span>
                <span className="cf-code">{" ".repeat(Math.max(0, col - 1))}<span className="cf-caret">^</span></span>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function FailureDetail({ result, test, impl, blobUrl }) {
  if (!result || result.status !== "fail" || !result.error) return null;
  const e = result.error;
  const fileUrl = e.codeFrame
    ? blobUrl(e.codeFrame.file, e.codeFrame.line)
    : blobUrl(test.file, test.line);
  return (
    <div className="fail-detail">
      <div className="fail-head">
        <div className="fail-head-l">
          <span className="fail-tag">FAIL</span>
          <span className="fail-impl mono">{impl.label}</span>
          <span className="fail-arrow">›</span>
          <span className="fail-test">{test.title}</span>
        </div>
        <div className="fail-head-r mono">{result.duration_ms}ms</div>
      </div>
      <div className="fail-body">
        <pre className="jest-out">
          <div className="line line-bullet">
            <span className="bullet">●</span>
            {(test.fullName || test.title).split(" > ").map((seg, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="bullet-sep"> › </span>}
                {seg}
              </React.Fragment>
            ))}
          </div>
          <div className="line line-blank">{"\u00A0"}</div>
          <div className="line line-indent assertion-line">{e.assertion}</div>
          <div className="line line-blank">{"\u00A0"}</div>
          <div className="line line-indent">
            <span className="kw">Expected:</span> <span className="c-expected">{e.expected}</span>
          </div>
          <div className="line line-indent">
            <span className="kw">Received:</span> <span className="c-received">{e.received}</span>
          </div>
          <div className="line line-blank">{"\u00A0"}</div>
          {e.codeFrame && <CodeFrame frame={e.codeFrame} />}
          {e.codeFrame && <div className="line line-blank">{"\u00A0"}</div>}
          {e.stack && e.stack.map((s, i) => (
            <div key={i} className="line line-indent c-muted mono stack-line">{`  ${s}`}</div>
          ))}
        </pre>
        <div className="fail-actions">
          <a className="btn btn-ghost" href={fileUrl} target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.29 9.4 7.86 10.92.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.04 1.78 2.72 1.27 3.39.97.1-.75.4-1.27.74-1.56-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.04 11.04 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.73.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.79.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
            </svg>
            open test on GitHub
          </a>
          <span className="fail-file mono">{test.file}</span>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Matrix
// ──────────────────────────────────────────────────────────────────────────
function Matrix({ module: mod, impls, visibleImpls, filters, query }) {
  const [expanded, setExpanded] = useState(null); // {testId, implId} or null
  const [sortByImpl, setSortByImpl] = useState(null); // implId or null
  const { repoUrl, commit } = window.RUN_META;
  const blobUrl = (file, line) =>
    `${repoUrl}/blob/${commit}/${file}${line ? `#L${line}` : ""}`;

  // Derive group key from test.file: file basename (e.g. "validate-patient.test.ts").
  // Each unique file becomes one section.
  const groupForTest = useCallback((test) => {
    const parts = test.file.split("/");
    return parts[parts.length - 1];
  }, []);

  // Filter tests
  const filteredTests = useMemo(() => {
    return mod.tests.filter(test => {
      if (query) {
        const q = query.toLowerCase();
        const inTitle = test.title.toLowerCase().includes(q);
        const inId = test.id.toLowerCase().includes(q);
        const inGroup = groupForTest(test).toLowerCase().includes(q);
        if (!inTitle && !inId && !inGroup) return false;
      }
      const results = visibleImpls.map(i => statusFor(mod.id, test.id, i.id));
      if (filters.failingOnly) {
        if (!results.some(r => r && r.status === "fail")) return false;
      }
      return true;
    });
  }, [mod, visibleImpls, filters, query, groupForTest]);

  // Build either a sorted flat list (when sortByImpl) or a grouped list.
  const renderItems = useMemo(() => {
    if (sortByImpl) {
      const rank = (test) => {
        const r = statusFor(mod.id, test.id, sortByImpl);
        if (!r) return 2;
        if (r.status === "fail") return 0;
        if (r.status === "skipped") return 2;
        return 1;
      };
      const sorted = filteredTests
        .map((t, i) => ({ t, i, r: rank(t) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(x => x.t);
      return sorted.map(t => ({ kind: "test", test: t }));
    }
    // Grouped: preserve file order, emit group header whenever group changes.
    const out = [];
    let lastGroup = null;
    for (const test of filteredTests) {
      const g = groupForTest(test);
      if (g !== lastGroup) {
        out.push({ kind: "group", group: g, dir: test.file });
        lastGroup = g;
      }
      out.push({ kind: "test", test });
    }
    return out;
  }, [filteredTests, sortByImpl, mod, groupForTest]);

  // Reset expansion + sort when module changes
  useEffect(() => { setExpanded(null); setSortByImpl(null); }, [mod.id]);

  // Collapse expansion if its impl column got hidden.
  useEffect(() => {
    if (expanded && !visibleImpls.some(i => i.id === expanded.implId)) {
      setExpanded(null);
    }
  }, [visibleImpls, expanded]);

  const onImplHeaderClick = (implId) => {
    setSortByImpl(prev => prev === implId ? null : implId);
  };

  return (
    <div className="matrix-wrap">
      <div className="matrix-head">
        <div>
          <div className="matrix-title">{mod.label}</div>
        </div>
        <div className="matrix-meta">
          {sortByImpl && (
            <button className="sort-pill" onClick={() => setSortByImpl(null)} title="Reset to original order">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round"/></svg>
              sorted by {impls.find(i => i.id === sortByImpl)?.label} fails
              <span className="sort-pill-x">×</span>
            </button>
          )}
          <div className="matrix-count mono">
            {filteredTests.length} / {mod.tests.length} tests
          </div>
        </div>
      </div>
      <div className="matrix">
        <div className="matrix-grid" style={{ "--cols": visibleImpls.length }}>
          {/* Header row */}
          <div className="cell cell-corner" />
          {visibleImpls.map(impl => {
            const agg = aggregateModule(mod.id, impls)[impl.id];
            const passPct = pct(agg.pass, agg.total);
            const isSorted = sortByImpl === impl.id;
            return (
              <button
                key={impl.id}
                className={`cell cell-head cell-head-btn ${isSorted ? "cell-head-sorted" : ""}`}
                onClick={() => onImplHeaderClick(impl.id)}
                title={isSorted ? "Click to reset order" : `Sort tests by ${impl.label} fails`}
              >
                <div className="head-name">
                  {impl.label}
                  <span className="head-sort-icon" aria-hidden="true">
                    {isSorted ? (
                      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 10l5-5 5 5M7 14l5 5 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    )}
                  </span>
                </div>
                <div className="head-pct mono">{passPct}% pass</div>
                <div className="head-bar">
                  <span style={{ width: `${passPct}%` }} className="bar-seg bar-pass" />
                  <span style={{ width: `${pct(agg.fail, agg.total)}%` }} className="bar-seg bar-fail" />
                  <span style={{ width: `${pct(agg.skipped, agg.total)}%` }} className="bar-seg bar-skip" />
                </div>
              </button>
            );
          })}
          {/* Test rows */}
          {filteredTests.length === 0 && (
            <div className="cell cell-empty" style={{ gridColumn: `1 / span ${visibleImpls.length + 1}` }}>
              No tests match the current filters.
            </div>
          )}
          {visibleImpls.length === 0 && filteredTests.length > 0 && (
            <div className="cell cell-empty" style={{ gridColumn: `1 / span 1` }}>
              All impls hidden — click a card above to show.
            </div>
          )}
          {renderItems.map((item, idx) => {
            if (item.kind === "group") {
              return (
                <a
                  key={`g-${item.group}-${idx}`}
                  className="cell cell-group"
                  style={{ gridColumn: `1 / span ${visibleImpls.length + 1}` }}
                  href={blobUrl(item.dir)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${item.dir} on GitHub`}
                >
                  <div className="cell-group-inner">
                    <span className="group-name mono">{item.group}</span>
                    <span className="group-ext">↗</span>
                  </div>
                </a>
              );
            }
            const test = item.test;
            const exp = expanded && expanded.testId === test.id;
            const expandedImpl = exp ? visibleImpls.find(i => i.id === expanded.implId) : null;
            const expandedResult = exp ? statusFor(mod.id, test.id, expanded.implId) : null;
            return (
              <React.Fragment key={`t-${test.id}`}>
                <a
                  className="cell cell-row-name"
                  href={blobUrl(test.file, test.line)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${test.file} on GitHub`}
                >
                  <div className="row-name-title">{test.title}</div>
                  <span className="row-name-ext">↗</span>
                </a>
                {visibleImpls.map(impl => {
                  const r = statusFor(mod.id, test.id, impl.id);
                  const isExp = exp && expanded.implId === impl.id;
                  const isFail = r && r.status === "fail";
                  const clickable = isFail;
                  return (
                    <button
                      key={impl.id}
                      className={`cell cell-result cell-${r ? r.status : "none"} ${isExp ? "cell-expanded" : ""} ${clickable ? "cell-clickable" : ""}`}
                      onClick={() => {
                        if (!clickable) return;
                        if (isExp) setExpanded(null);
                        else setExpanded({ testId: test.id, implId: impl.id });
                      }}
                      title={
                        r ? `${impl.label} → ${STATUS_LABEL[r.status]}${r.duration_ms ? ` (${r.duration_ms}ms)` : ""}` : "no data"
                      }
                    >
                      <StatusGlyph status={r ? r.status : null} />
                    </button>
                  );
                })}
                {exp && expandedResult && (
                  <div className="cell-expansion" style={{ gridColumn: `1 / span ${visibleImpls.length + 1}` }}>
                    <FailureDetail
                      result={expandedResult}
                      test={test}
                      impl={expandedImpl}
                      blobUrl={blobUrl}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Toolbar
// ──────────────────────────────────────────────────────────────────────────
function Toolbar({ query, setQuery, filters, setFilters, hiddenCount, onShowAll }) {
  return (
    <div className="toolbar">
      <div className="search">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          placeholder="Search tests…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery("")} aria-label="Clear">×</button>
        )}
      </div>
      <div className="filters">
        <button
          className={`chip ${filters.failingOnly ? "chip-on" : ""}`}
          onClick={() => setFilters({ ...filters, failingOnly: !filters.failingOnly })}
        >
          <span className="chip-dot chip-dot-fail" />
          Failing only
        </button>
        {hiddenCount > 0 && (
          <button className="chip chip-ghost" onClick={onShowAll} title="Show all hidden impls">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            {hiddenCount} impl{hiddenCount > 1 ? "s" : ""} hidden
          </button>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// App
// ──────────────────────────────────────────────────────────────────────────
function App() {
  const impls = window.IMPLS;
  const modules = window.MODULES;
  const [selectedId, setSelectedId] = useState(modules[0].id);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ failingOnly: false });
  const [hidden, setHidden] = useState(new Set());

  const toggleHide = useCallback((implId) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(implId)) next.delete(implId);
      else next.add(implId);
      return next;
    });
  }, []);
  const showAll = useCallback(() => setHidden(new Set()), []);

  const visibleImpls = useMemo(() => impls.filter(i => !hidden.has(i.id)), [impls, hidden]);

  const mod = modules.find(m => m.id === selectedId) || modules[0];

  return (
    <div className="app">
      <Header />
      <ImplSummaryStrip impls={impls} hidden={hidden} onToggleHide={toggleHide} />
      <div className="page">
        <Sidebar modules={modules} selectedId={selectedId} onSelect={setSelectedId} impls={visibleImpls} />
        <main className="main">
          <Toolbar
            query={query} setQuery={setQuery}
            filters={filters} setFilters={setFilters}
            hiddenCount={hidden.size}
            onShowAll={showAll}
          />
          <Matrix
            module={mod}
            impls={impls}
            visibleImpls={visibleImpls}
            filters={filters}
            query={query}
          />
        </main>
      </div>
    </div>
  );
}

function renderApp() {
  ReactDOM.createRoot(document.getElementById("root")).render(<App />);
}

if (window.__runDataReady && typeof window.__runDataReady.then === "function") {
  window.__runDataReady.then(renderApp).catch(() => {
    // loader rendered a fatal error into <body> already.
  });
} else {
  renderApp();
}
