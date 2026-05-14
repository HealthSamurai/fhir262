// Loads conformance run data into the same window globals the design's
// mock-data.js used to set: RUN_META, IMPLS, MODULES, STATUSES, RUN_HISTORY.
//
// Source: ./runs/index.json (list of available runs) + ./runs/<id>.json
// (the selected run). Selected run comes from ?run=<id> in the URL, or the
// most recent run in the index.

(function () {
  const qs = new URLSearchParams(location.search);

  function readJSON(url) {
    return fetch(url, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
      return r.json();
    });
  }

  function fatal(msg) {
    document.body.innerHTML =
      '<pre style="padding:24px;font:14px/1.5 ui-monospace,Menlo,monospace;color:#b91c1c">' +
      msg.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]) +
      "</pre>";
  }

  window.__loadRun = function (id) {
    qs.set("run", id);
    location.search = qs.toString();
  };

  window.__runDataReady = (async () => {
    let index;
    try {
      index = await readJSON("./runs/index.json");
    } catch (e) {
      fatal(
        "fhir262: failed to load runs/index.json.\n\n" +
          "If you are viewing the UI locally, build a dist first:\n" +
          "  make ui-dist\n" +
          "then serve dist/ (e.g. `python3 -m http.server -d dist 8000`).\n\n" +
          "Underlying error: " +
          e.message,
      );
      throw e;
    }

    const runs = Array.isArray(index.runs) ? index.runs : [];
    if (runs.length === 0) {
      fatal("fhir262: runs/index.json contains no runs.");
      throw new Error("empty index");
    }

    const requestedId = qs.get("run");
    const selected = (requestedId && runs.find((r) => r.id === requestedId)) || runs[0];

    let run;
    try {
      run = await readJSON(`./runs/${selected.id}.json`);
    } catch (e) {
      fatal(`fhir262: failed to load runs/${selected.id}.json: ${e.message}`);
      throw e;
    }

    window.RUN_META = run.meta;
    window.IMPLS = run.impls;
    window.MODULES = run.modules;
    window.STATUSES = run.statuses;
    window.RUN_HISTORY = runs.map((r) => ({
      ...r,
      isCurrent: r.id === selected.id,
    }));
  })();
})();
