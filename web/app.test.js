"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  PRESETS,
  point,
  swapEndpoints,
  applyPreset,
  chartFilename,
  validateChartText,
  chartIssues,
  formatChartIssues,
  calmChartText,
  calmRequestBody,
  parseCalmResponse,
  compareSummary,
  csvCell,
  routeToCsv,
  routeCsvFilename,
  formatStepTimes,
  formatRouteSummary,
  formatRouteCommand,
  formatMapForClipboard,
  formatRouteAsMarkdown,
  HISTORY_KEY,
  HISTORY_LIMIT,
  historyEntry,
  appendHistory,
  parseHistory,
  formatHistoryEntry,
  restoreEntry,
  historyToJson,
  historyJsonFilename,
  parseHistoryExport,
  mergeHistory,
  comparisonToCsv,
  comparisonCsvFilename,
  comparisonToJson,
  comparisonJsonFilename,
  comparisonToMarkdown,
  historyImportSummary,
  formatImportSummary,
  filterHistory,
  historyFilterSummary,
  historySummary,
  formatHistorySummary,
  formatHistorySummaryForClipboard,
  sortHistory,
  LOCAL_PRESETS_KEY,
  LOCAL_PRESET_LIMIT,
  normalizePresetName,
  buildLocalPreset,
  parseLocalPresets,
  mergeLocalPresets,
  localPresetsToJson,
  HELP_SECTIONS,
  formatHelpText,
  presetFilename,
  parsePresetsExport,
  mergePresetFiles,
  removeLocalPreset,
  removeLastHistoryEntry,
  LOCAL_DATA_KEYS,
  resetPlan,
  formatResetSummary,
  buildDataBundle,
  formatDataBundle,
  parseDataBundle,
  bundleFilename,
  bundleImportSummary,
  bundleApplyPreview,
  formatBundlePreview,
  defaultEditorState,
  renameLocalPreset,
  duplicateLocalPreset,
  filterLocalPresets,
  presetFilterSummary,
  sortLocalPresets,
  historyToCsv,
  historyCsvFilename,
  chartStats,
  formatChartStats,
  formatChartStatsForClipboard,
  formatPresetStatsForClipboard,
  formatChartForClipboard,
  diffCharts,
  formatChartDiff,
  formatDiffForClipboard,
  diffAgainstPreset,
  validatePresetLibrary,
  formatPresetValidation,
} = require("./app.js");

test("point accepts X,Y and rejects malformed endpoints", () => {
  assert.deepEqual(point("0,2"), [0, 2]);
  assert.deepEqual(point(" 7 , 0 "), [7, 0]);
  for (const bad of ["0", "0,", "a,0", "-1,0", "1,2,3"]) {
    assert.throws(() => point(bad), /X,Y/);
  }
});

test("every preset yields a parseable chart header and valid endpoints", () => {
  for (const name of Object.keys(PRESETS)) {
    const preset = applyPreset(name);
    assert.match(preset.chart, /^TRIREME-CHART v1\n/);
    assert.ok(preset.chart.includes("grid "));
    assert.ok(preset.chart.includes("wind "));
    assert.equal(point(preset.from).length, 2);
    assert.equal(point(preset.to).length, 2);
  }
  assert.throws(() => applyPreset("missing"), /Unknown preset/);
});

test("the page declares every control the script binds", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  for (const id of [
    "open-help", "help-panel", "help-text", "close-help", "bundle-file",
    "import-bundle", "copy-bundle", "reset-local", "bundle-preview",
    "bundle-preview-text", "apply-bundle", "cancel-bundle",
    "chart", "chart-stats", "copy-stats", "chart-issues", "copy-preset-stats", "from", "to",
    "swap-endpoints", "copy-chart",
    "preset", "preset-name", "save-preset",
    "local-preset", "preset-filter", "preset-sort", "preset-filter-status",
    "presets-file", "export-presets", "import-presets", "delete-preset",
    "rename-preset-name", "rename-preset",
    "duplicate-preset-name", "duplicate-preset",
    "diff-left", "diff-right", "compare-presets", "copy-diff", "diff-current",
    "validate-presets", "preset-validation", "diff-output",
    "file", "plan", "clear-editor", "compare", "save", "copy-command", "copy-map",
    "copy-markdown",
    "load", "import", "download", "export", "export-csv", "copy-summary", "map", "step-times",
    "compare-panel",
    "compare-summary", "compare-current", "compare-calm", "compare-delta",
    "export-compare-csv", "export-compare-json", "copy-compare-md",
    "history-title", "history-summary", "copy-history-summary", "undo-history",
    "clear-history", "export-history-csv",
    "export-history", "import-history",
    "history-file", "history-list", "history-filter", "history-sort",
    "history-filter-status",
    "import-preview", "import-preview-text",
    "apply-import", "cancel-import",
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'), "missing control: " + id);
  }
});

test("the client sends endpoints as coordinate arrays", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(source, /from: point\(from\.value\)/);
  assert.match(source, /to: point\(to\.value\)/);
});

test("chart filenames keep only a safe basename", () => {
  assert.equal(chartFilename("C:\\charts\\my chart.txt"), "my_chart.txt");
  assert.equal(chartFilename("../evil.txt"), "evil.txt");
  assert.equal(chartFilename("route"), "route.txt");
  assert.equal(chartFilename(""), "chart.txt");
  assert.equal(chartFilename("..hidden"), "hidden.txt");
});

test("chart issues name the offending line numbers", () => {
  const text =
    "TRIREME-CHART v1\n# comment\ngrid 4 3\nwind 2 0\nland x 2\nunknown 7\ncurrent 1 1 0 0\n";
  const issues = chartIssues(text);
  assert.deepEqual(issues, [
    { line: 4, message: "expected wind <dx> <dy> with components -1..1." },
    { line: 5, message: "expected land <x> <y>." },
    { line: 6, message: "unknown directive 'unknown'." },
  ]);
  assert.equal(
    formatChartIssues(issues),
    "line 4: expected wind <dx> <dy> with components -1..1.\n" +
      "line 5: expected land <x> <y>.\n" +
      "line 6: unknown directive 'unknown'."
  );
  assert.equal(formatChartIssues([]), "No chart issues.");
});

test("chart issues catch a wrong header and duplicate directives", () => {
  const noHeader = chartIssues("grid 2 2\nwind 0 0\n");
  assert.equal(noHeader[0].line, 1);
  assert.match(noHeader[0].message, /TRIREME-CHART v1/);
  const duplicate = chartIssues("TRIREME-CHART v1\ngrid 2 2\nwind 0 0\ngrid 3 3\nwind 1 0\n");
  assert.deepEqual(
    duplicate.map((issue) => issue.line),
    [4, 5]
  );
  const empty = chartIssues("");
  assert.equal(empty.length, 3);
  assert.throws(() => validateChartText("grid 2 2\nwind 0 0\n"), /line 1/);
});

test("chart import validates the header grid and wind", () => {
  const good = "TRIREME-CHART v1\r\n# note\r\ngrid 4 3\r\nwind 1 0\r\n";
  assert.equal(
    validateChartText(good),
    "TRIREME-CHART v1\n# note\ngrid 4 3\nwind 1 0\n"
  );
  for (const bad of [
    "grid 4 3\nwind 0 0\n",
    "TRIREME-CHART v1\nwind 0 0\n",
    "TRIREME-CHART v1\ngrid 4 3\n",
    "TRIREME-CHART v1\ngrid 4 3\nwind 2 0\n",
    "x".repeat(1000001),
  ]) {
    assert.throws(() => validateChartText(bad));
  }
});

test("calm charts keep the geometry but zero wind and currents", () => {
  const chart =
    "TRIREME-CHART v1\r\n# keep me\r\ngrid 6 4\r\nwind 1 -1\r\n" +
    "land 3 2\r\ncurrent 5 2 0 -1\r\ncurrent 6 1 -1 0\r\n";
  const calm = calmChartText(chart);
  assert.match(calm, /# keep me/);
  assert.match(calm, /grid 6 4/);
  assert.match(calm, /land 3 2/);
  assert.match(calm, /\nwind 0 0\n/);
  assert.match(calm, /current 5 2 0 0/);
  assert.match(calm, /current 6 1 0 0/);
  assert.doesNotMatch(calm, /wind 1 -1/);
  assert.equal(calmChartText(calm), calm);
  assert.throws(() => calmChartText("grid 2 2\nwind 0 0\n"));
});

test("calm API request and response helpers are strict", () => {
  const chartText = "TRIREME-CHART v1\ngrid 4 1\nwind 1 0\n";
  assert.equal(calmRequestBody(chartText), JSON.stringify({ chart: chartText }));
  assert.equal(parseCalmResponse({ ok: true, chart: "wind 0 0" }), "wind 0 0");
  assert.throws(() => parseCalmResponse(null), /Could not derive/);
  assert.throws(() => parseCalmResponse({ ok: false, error: "bad chart" }), /bad chart/);
  assert.throws(() => parseCalmResponse({ ok: true }), /Could not derive/);
});

test("comparison summaries say who was faster", () => {
  assert.equal(
    compareSummary({ time: 400 }, { time: 800 }),
    "Wind and current save 400 units (50% faster)."
  );
  assert.equal(
    compareSummary({ time: 600 }, { time: 400 }),
    "Wind and current cost 200 units (50% slower)."
  );
  assert.equal(
    compareSummary({ time: 300 }, { time: 300 }),
    "No difference: both routes take 300 units."
  );
  assert.equal(
    compareSummary({ time: 0 }, { time: 0 }),
    "No difference: both routes take 0 units."
  );
});

test("CSV export turns waypoints into one row per step", () => {
  const route = {
    waypoints: [[0, 2], [1, 2], [2, 1]],
    steps: ["E", "NE"],
    step_times: [83, 117],
    time: 200,
  };
  assert.equal(
    routeToCsv(route),
    "step,x,y,heading,time_units\n0,0,2,start,0\n1,1,2,E,83\n2,2,1,NE,117\n"
  );
  assert.equal(
    routeToCsv({ waypoints: [[3, 4]], steps: [], step_times: [] }),
    "step,x,y,heading,time_units\n0,3,4,start,0\n"
  );
  assert.throws(() => routeToCsv(null), /No route/);
  assert.throws(() => routeToCsv({ waypoints: [[1]], steps: [] }), /\[x,y\]/);
});

test("step times render each heading with its own cost", () => {
  assert.equal(
    formatStepTimes({ steps: ["E", "NE"], step_times: [83, 117] }),
    "E 83 units \u00b7 NE 117 units"
  );
  assert.equal(formatStepTimes({ steps: [], step_times: [] }), "(already there)");
  assert.equal(formatStepTimes({ steps: ["E"] }), "\u2014");
  assert.equal(formatStepTimes(null), "\u2014");
});

test("route summary is a plain-text clipboard block", () => {
  const route = {
    from: [0, 2],
    to: [7, 0],
    time: 647,
    explored: 26,
    steps: ["E", "NE"],
    step_times: [83, 116],
    waypoints: [[0, 2], [1, 2], [2, 1]],
  };
  assert.equal(
    formatRouteSummary(route),
    "Trireme route (0,2) -> (7,0)\n" +
      "Time: 647 units | Steps: 2 | Explored: 26 cells\n" +
      "Headings: E NE\n" +
      "Step times: E 83 units \u00b7 NE 116 units\n" +
      "Waypoints: (0,2) -> (1,2) -> (2,1)"
  );
  const sparse = formatRouteSummary({ steps: [], step_times: [], waypoints: [] });
  assert.match(sparse, /Time: \u2014/);
  assert.match(sparse, /Headings: \u2014/);
  assert.throws(() => formatRouteSummary(null), /No route/);
});

test("CSV cells quote commas and quotes, and filenames end in .csv", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(routeCsvFilename("my chart.txt"), "my_chart.csv");
  assert.equal(routeCsvFilename(""), "chart.csv");
});

test("history entries capture the query and the plan", () => {
  const route = { time: 647, steps: ["E", "NE"] };
  const query = {
    chart: "TRIREME-CHART v1\ngrid 8 4\nwind 1 0\n",
    from: [0, 2],
    to: [7, 0],
  };
  const entry = historyEntry(route, query, 1763550000000, "calm water compared");
  assert.deepEqual(entry, {
    at: 1763550000000,
    from: [0, 2],
    to: [7, 0],
    time: 647,
    steps: 2,
    heading: "E NE",
    note: "calm water compared",
    chart: query.chart,
  });
  assert.equal(historyEntry({ time: 0, steps: [] }, query, 1).heading, "(already there)");
  assert.throws(() => historyEntry(null, query, 1), /No route/);
});

test("history is newest first, capped, and tolerant of bad storage", () => {
  const first = historyEntry({ time: 1, steps: [] }, { from: [0, 0], to: [1, 1] }, 1);
  const second = historyEntry({ time: 2, steps: [] }, { from: [0, 0], to: [2, 2] }, 2);
  const appended = appendHistory([first, null, { at: "bad" }], second);
  assert.deepEqual(appended.map((entry) => entry.at), [2, 1]);
  const older = [10, 11, 12, 13].map((at) =>
    historyEntry({ time: at, steps: [] }, {}, at)
  );
  const capped = appendHistory(
    older,
    historyEntry({ time: 20, steps: [] }, {}, 20),
    3
  );
  assert.deepEqual(capped.map((entry) => entry.at), [20, 10, 11]);
  assert.equal(HISTORY_LIMIT, 10);
  assert.equal(HISTORY_KEY, "trireme.history");
  assert.deepEqual(parseHistory(null), []);
  assert.deepEqual(parseHistory("not json"), []);
  assert.deepEqual(parseHistory('{"at":1}'), []);
  assert.deepEqual(
    parseHistory('[{"at":1,"time":2},{"at":"x","time":3},null]').map((e) => e.at),
    [1]
  );
});

test("history rows are stable and readable", () => {
  const entry = historyEntry(
    { time: 400, steps: ["E", "E"] },
    { from: [0, 0], to: [2, 0] },
    Date.UTC(2026, 10, 19, 8, 30, 0)
  );
  assert.equal(
    formatHistoryEntry(entry),
    "2026-11-19T08:30:00.000Z \u00b7 (0,0)\u2192(2,0) \u00b7 400 units \u00b7 2 steps"
  );
});

test("restore reloads the stored chart and endpoints", () => {
  const chartText = "TRIREME-CHART v1\r\ngrid 8 4\r\nwind 1 0\r\n";
  const entry = historyEntry(
    { time: 647, steps: ["E"] },
    { chart: chartText, from: [0, 2], to: [7, 0] },
    7
  );
  const restored = restoreEntry(entry);
  assert.deepEqual(restored, {
    chart: "TRIREME-CHART v1\ngrid 8 4\nwind 1 0\n",
    from: "0,2",
    to: "7,0",
  });
  assert.equal(restored.from, entry.from.join(","));
  assert.throws(() => restoreEntry(null), /no chart/);
  assert.throws(() => restoreEntry({ chart: "" }), /no chart/);
  assert.throws(
    () => restoreEntry({ chart: chartText, from: "bad", to: "1,1" }),
    /X,Y/
  );
  const roundTrip = parseHistory(JSON.stringify([entry]));
  assert.deepEqual(restoreEntry(roundTrip[0]), restored);
});

test("comparison CSV has one row per scenario and a signed saving", () => {
  const comparison = {
    query: { from: [0, 2], to: [7, 0], chart: "x" },
    withWind: { time: 647, steps: ["E", "NE"], explored: 26 },
    still: { time: 780, steps: ["SE", "SE"], explored: 30 },
  };
  assert.equal(
    comparisonToCsv(comparison),
    "scenario,from,to,time,saved_vs_calm,steps,explored,headings\n" +
      "wind,\"0,2\",\"7,0\",647,133,2,26,E NE\n" +
      "calm,\"0,2\",\"7,0\",780,0,2,30,SE SE\n"
  );
  const slower = comparisonToCsv({
    withWind: { time: 900, steps: [], explored: 1 },
    still: { time: 600, steps: [], explored: 1 },
  });
  assert.match(slower, /wind,,,900,-300,0,1,/);
  assert.throws(() => comparisonToCsv(null), /No comparison/);
  assert.equal(comparisonCsvFilename(), "trireme-comparison.csv");
});

test("history JSON export keeps charts, endpoints and a stable schema", () => {
  const chartText = "TRIREME-CHART v1\ngrid 4 3\nwind 1 0\n";
  const entry = historyEntry(
    { time: 647, steps: ["E"] },
    { chart: chartText, from: [0, 2], to: [3, 0] },
    7,
    "calm water compared"
  );
  const raw = historyToJson([entry, null, { at: "bad" }]);
  const document = JSON.parse(raw);
  assert.equal(document.schema, "trireme.history/1");
  assert.equal(document.count, 1);
  assert.equal(document.entries[0].chart, chartText);
  assert.deepEqual(document.entries[0].from, [0, 2]);
  assert.deepEqual(document.entries[0].to, [3, 0]);
  assert.equal(document.entries[0].note, "calm water compared");
  assert.equal(historyToJson([entry]), raw);
  assert.throws(() => historyToJson(null), /No route history/);
  assert.equal(historyJsonFilename(), "trireme.history.json");
  assert.deepEqual(JSON.parse(historyToJson([])).entries, []);
});

test("history export round-trips through the schema validator", () => {
  const chartText = "TRIREME-CHART v1\ngrid 4 3\nwind 1 0\n";
  const entry = historyEntry(
    { time: 647, steps: ["E"] },
    { chart: chartText, from: [0, 2], to: [3, 0] },
    7
  );
  const parsed = parseHistoryExport(historyToJson([entry]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].chart, chartText);
  assert.deepEqual(parsed[0].from, [0, 2]);
  assert.equal(parsed[0].at, 7);
  assert.throws(() => parseHistoryExport("not json"), /not valid JSON/);
  assert.throws(() => parseHistoryExport('{"schema":"other","entries":[]}'), /schema/);
  assert.throws(() => parseHistoryExport('{"schema":"trireme.history/1","entries":[]}'), /no usable entries/);
  const badChart = {
    schema: "trireme.history/1",
    entries: [{ at: 1, time: 2, from: [0, 0], to: [1, 1], chart: "grid 2 2" }],
  };
  assert.throws(() => parseHistoryExport(JSON.stringify(badChart)), /no usable entries/);
});

test("merging histories dedupes, sorts newest first and caps the result", () => {
  const make = (at) => historyEntry({ time: at, steps: [] }, { chart: "TRIREME-CHART v1\ngrid 2 2\nwind 0 0\n", from: [0, 0], to: [1, 1] }, at);
  const current = [make(5), make(1)];
  const incoming = [make(3), make(5), make(9)];
  const merged = mergeHistory(current, incoming, 3);
  assert.deepEqual(merged.map((entry) => entry.at), [9, 5, 3]);
  assert.deepEqual(mergeHistory([], []), []);
  assert.equal(mergeHistory(current, incoming, 3).length, 3);
});

test("import preview counts new, duplicate and kept entries", () => {
  const make = (at) => historyEntry({ time: at, steps: [] }, { chart: "TRIREME-CHART v1\ngrid 2 2\nwind 0 0\n", from: [0, 0], to: [1, 1] }, at);
  const older = make(1000);
  const shared = make(2000);
  const newer = make(3000);
  const summary = historyImportSummary([older, shared, newer], [shared], 10);
  assert.deepEqual(summary, {
    total: 3,
    fresh: 2,
    duplicates: 1,
    kept: 3,
    oldest: 1000,
    newest: 3000,
  });
  assert.equal(
    formatImportSummary(summary),
    "File: 3 entries (2 new, 1 duplicates)\n" +
      "After merge: 3 entries kept\n" +
      "Range: 1970-01-01T00:00:01.000Z \u2192 1970-01-01T00:00:03.000Z"
  );
  assert.deepEqual(historyImportSummary([], [], 10), {
    total: 0, fresh: 0, duplicates: 0, kept: 0, oldest: null, newest: null,
  });
  assert.match(formatImportSummary({ total: 0, fresh: 0, duplicates: 0, kept: 0, oldest: null, newest: null }), /Range: \u2014/);
  assert.throws(() => formatImportSummary(null), /No import/);
});

test("history search matches endpoints, notes and chart text", () => {
  const make = (to, note, chart) =>
    historyEntry(
      { time: 400, steps: ["E"] },
      { chart, from: [0, 0], to },
      to[0] * 1000,
      note
    );
  const entries = [
    make([3, 0], "calm water compared", "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n"),
    make([5, 2], "fast run", "TRIREME-CHART v1\ngrid 6 3\nwind 1 0\nland 2 2\n"),
  ];
  assert.equal(filterHistory(entries, "").length, 2);
  assert.deepEqual(filterHistory(entries, "5,2").map((e) => e.to), [[5, 2]]);
  assert.equal(filterHistory(entries, "FAST RUN").length, 1);
  assert.equal(filterHistory(entries, "land 2 2").length, 1);
  assert.equal(filterHistory(entries, "400 units").length, 2);
  assert.equal(filterHistory(entries, "nothing matches").length, 0);
  assert.equal(filterHistory(null, "x").length, 0);
  assert.equal(historyFilterSummary(1, 2), "Showing 1 of 2 entries");
});

test("history sort orders by date or time without mutating input", () => {
  const make = (at, time) =>
    historyEntry({ time, steps: [] }, { chart: "TRIREME-CHART v1\ngrid 2 2\nwind 0 0\n", from: [0, 0], to: [1, 1] }, at);
  const entries = [make(100, 600), make(300, 200), make(200, 400)];
  const original = entries.slice();
  assert.deepEqual(sortHistory(entries, "newest").map((e) => e.at), [300, 200, 100]);
  assert.deepEqual(sortHistory(entries, "oldest").map((e) => e.at), [100, 200, 300]);
  assert.deepEqual(sortHistory(entries, "fastest").map((e) => e.time), [200, 400, 600]);
  assert.deepEqual(sortHistory(entries, "slowest").map((e) => e.time), [600, 400, 200]);
  assert.deepEqual(entries, original);
  assert.deepEqual(sortHistory(entries, "unknown"), sortHistory(entries, "newest"));
  assert.deepEqual(sortHistory(null, "newest"), []);
  const tied = [make(100, 100), make(100, 100)];
  assert.equal(sortHistory(tied, "newest").length, 2);
});

test("named presets validate, store and round-trip", () => {
  const chartText = "TRIREME-CHART v1\r\ngrid 4 3\r\nwind 1 0\r\n";
  assert.equal(normalizePresetName("  my  run "), "my run");
  for (const bad of ["", "a".repeat(33), "bad/name", "-start"]) {
    assert.throws(() => normalizePresetName(bad));
  }
  const preset = buildLocalPreset("My Run", chartText, "0,2", "3,0");
  assert.deepEqual(preset, {
    name: "My Run",
    chart: "TRIREME-CHART v1\ngrid 4 3\nwind 1 0\n",
    from: "0,2",
    to: "3,0",
  });
  assert.throws(() => buildLocalPreset("ok", "grid 2 2\nwind 0 0\n", "0,0", "1,1"), /TRIREME-CHART/);
  assert.throws(() => buildLocalPreset("ok", chartText, "bad", "1,1"), /X,Y/);

  const stored = localPresetsToJson([preset]);
  const parsed = parseLocalPresets(stored);
  assert.deepEqual(parsed, [preset]);
  assert.deepEqual(parseLocalPresets(null), []);
  assert.deepEqual(parseLocalPresets("not json"), []);
  assert.deepEqual(parseLocalPresets('{"schema":"other","presets":[]}'), []);
  assert.equal(LOCAL_PRESETS_KEY, "trireme.presets");
  assert.equal(LOCAL_PRESET_LIMIT, 20);
});

test("saving a preset replaces a name and keeps names sorted", () => {
  const make = (name, time) =>
    buildLocalPreset(
      name,
      "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n",
      "0,0",
      "3,0"
    );
  const alpha = make("alpha");
  const zeta = make("zeta");
  const updated = buildLocalPreset("alpha", "TRIREME-CHART v1\ngrid 5 1\nwind 1 0\n", "0,0", "4,0");
  const merged = mergeLocalPresets([zeta, alpha], updated);
  assert.deepEqual(merged.map((p) => p.name), ["alpha", "zeta"]);
  assert.equal(merged[0].chart, updated.chart);
  assert.equal(mergeLocalPresets([], alpha, 1).length, 1);
  const doc = JSON.parse(localPresetsToJson(merged));
  assert.equal(doc.schema, "trireme.presets/1");
});

test("help text covers CLI commands, chart syntax and shortcuts", () => {
  const text = formatHelpText();
  assert.match(text, /^TRIREME HELP\n/);
  assert.match(text, /CLI COMMANDS/);
  assert.match(text, /CHART SYNTAX/);
  assert.match(text, /UI CONTROLS AND SHORTCUTS/);
  assert.match(text, /route <file> --from X,Y --to X,Y/);
  assert.match(text, /TRIREME-CHART v1/);
  assert.match(text, /Ctrl\+Shift\+C/);
  assert.equal(text, formatHelpText());
  assert.equal(formatHelpText({ commands: [["x", "does x"]], syntax: [], controls: [] }),
    "TRIREME HELP\n\nCLI COMMANDS\n  x  does x\n\nCHART SYNTAX\n\nUI CONTROLS AND SHORTCUTS\n");
  assert.equal(Object.keys(HELP_SECTIONS).length, 3);
});

test("preset files are versioned, validated and merged by name", () => {
  const make = (name, chart) =>
    buildLocalPreset(name, chart || "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n", "0,0", "3,0");
  const a = make("alpha");
  const b = make("beta", "TRIREME-CHART v1\ngrid 5 1\nwind 1 0\n");
  const file = localPresetsToJson([a, b]);
  assert.equal(presetFilename(), "trireme.presets.json");
  assert.deepEqual(parsePresetsExport(file), [a, b]);
  assert.throws(() => parsePresetsExport("nope"), /not valid JSON/);
  assert.throws(() => parsePresetsExport('{"schema":"other","presets":[]}'), /schema/);
  assert.throws(() => parsePresetsExport('{"schema":"trireme.presets/1","presets":[]}'), /no usable presets/);
  const changed = make("alpha", "TRIREME-CHART v1\ngrid 6 1\nwind -1 0\n");
  const merged = mergePresetFiles([a], [changed, b]);
  assert.deepEqual(merged.map((p) => p.name), ["alpha", "beta"]);
  assert.equal(merged[0].chart, changed.chart);
  assert.deepEqual(mergePresetFiles([], [], 3), []);
  assert.equal(JSON.parse(file).schema, "trireme.presets/1");
});

test("deleting a preset removes it by name without mutating the list", () => {
  const a = buildLocalPreset("alpha", "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n", "0,0", "3,0");
  const b = buildLocalPreset("beta", "TRIREME-CHART v1\ngrid 5 1\nwind 1 0\n", "0,0", "4,0");
  const original = [a, b];
  const remaining = removeLocalPreset(original, "alpha");
  assert.deepEqual(remaining.map((p) => p.name), ["beta"]);
  assert.deepEqual(original.map((p) => p.name), ["alpha", "beta"]);
  assert.deepEqual(removeLocalPreset(original, "missing"), original);
  assert.deepEqual(removeLocalPreset(null, "alpha"), []);
  assert.throws(() => removeLocalPreset(original, "bad/name"));
});

test("reset plan names the local storage keys deterministically", () => {
  assert.deepEqual(LOCAL_DATA_KEYS, [
    "trireme.chart",
    "trireme.from",
    "trireme.to",
    "trireme.presets",
    "trireme.history",
  ]);
  assert.deepEqual(resetPlan(), LOCAL_DATA_KEYS);
  assert.deepEqual(resetPlan(["a", "b", "a", "", null]), ["a", "b"]);
  assert.deepEqual(resetPlan(null), LOCAL_DATA_KEYS);
  assert.equal(
    formatResetSummary(),
    "Reset 5 local keys: trireme.chart, trireme.from, trireme.to, trireme.presets, trireme.history."
  );
  assert.equal(formatResetSummary(["x"]), "Reset 1 local keys: x.");
  assert.match(formatHelpText(), /Reset local data/);
});

test("a data bundle versions and round-trips chart, presets and history", () => {
  const chartText = "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n";
  const preset = buildLocalPreset("My Route", chartText, "0,0", "3,0");
  const entry = historyEntry({ time: 300, steps: [] }, { chart: chartText, from: [0, 0], to: [3, 0] }, 7);
  const bundle = buildDataBundle(chartText, "0,0", "3,0", [preset], [entry]);
  assert.equal(bundle.schema, "trireme.bundle/1");
  assert.deepEqual(bundle.chart, { chart: chartText, from: "0,0", to: "3,0" });
  assert.equal(bundle.presets.length, 1);
  assert.equal(bundle.history.length, 1);
  const text = formatDataBundle(bundle);
  assert.deepEqual(parseDataBundle(text), bundle);
  assert.equal(text, formatDataBundle(bundle));
  assert.equal(bundleFilename(), "trireme-bundle.json");
  assert.throws(() => parseDataBundle("nope"), /not valid JSON/);
  assert.throws(() => parseDataBundle('{"schema":"other"}'), /schema/);
  assert.throws(() => formatDataBundle({ schema: "other" }), /trireme.bundle\/1/);
  const broken = JSON.parse(text);
  broken.chart.chart = "grid 2 2\nwind 0 0\n";
  assert.throws(() => parseDataBundle(JSON.stringify(broken)), /invalid chart/);
  const empty = buildDataBundle(chartText, "0,0", "3,0", [], []);
  assert.deepEqual(parseDataBundle(formatDataBundle(empty)), empty);
});

test("bundle import summary reports chart and record counts", () => {
  const chartText = "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n";
  const preset = buildLocalPreset("P", chartText, "0,0", "3,0");
  const entry = historyEntry({ time: 3, steps: [] }, { chart: chartText, from: [0, 0], to: [3, 0] }, 1);
  const bundle = buildDataBundle(chartText, "0,0", "3,0", [preset], [entry]);
  assert.equal(bundleImportSummary(bundle), "Bundle: chart 35 chars, 1 presets, 1 plans");
  assert.equal(bundleImportSummary(buildDataBundle(chartText, "0,0", "3,0", [], [])),
    "Bundle: chart 35 chars, 0 presets, 0 plans");
  assert.throws(() => bundleImportSummary(null), /trireme.bundle\/1/);
  assert.throws(() => bundleImportSummary({ schema: "other" }), /trireme.bundle\/1/);
  assert.match(formatHelpText(), /Import bundle/);
});

test("bundle preview reports incoming and kept counts before applying", () => {
  const chartText = "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n";
  const preset = buildLocalPreset("P", chartText, "0,0", "3,0");
  const entry = historyEntry({ time: 3, steps: [] }, { chart: chartText, from: [0, 0], to: [3, 0] }, 1);
  const bundle = buildDataBundle(chartText, "0,0", "3,0", [preset], [entry]);
  const preview = bundleApplyPreview(bundle, [preset], [entry]);
  assert.deepEqual(preview, {
    from: "0,0",
    to: "3,0",
    chartChars: 35,
    presetsIn: 1,
    historyIn: 1,
    presetsKept: 1,
    historyKept: 1,
  });
  assert.equal(
    formatBundlePreview(preview),
    "Chart: 35 chars, 0,0 -> 3,0\n" +
      "Presets: 1 incoming, 1 kept after merge\n" +
      "History: 1 incoming, 1 kept after merge"
  );
  assert.throws(() => bundleApplyPreview(null), /trireme.bundle\/1/);
  assert.throws(() => formatBundlePreview(null), /No bundle preview/);
});

test("clear editor restores the default chart and endpoints", () => {
  const first = defaultEditorState();
  assert.equal(first.from, "0,2");
  assert.equal(first.to, "7,0");
  assert.match(first.chart, /^TRIREME-CHART v1\n/);
  assert.deepEqual(defaultEditorState(), first);
  const custom = {
    probe: { chart: "TRIREME-CHART v1\ngrid 2 2\nwind 0 0\n", from: [1, 1], to: [0, 0] },
  };
  assert.deepEqual(defaultEditorState(custom), {
    chart: "TRIREME-CHART v1\ngrid 2 2\nwind 0 0\n",
    from: "1,1",
    to: "0,0",
  });
  assert.throws(() => defaultEditorState({}), /No default preset/);
  assert.match(formatHelpText(), /Clear editor/);
});

test("renaming a preset keeps content and sorts the list", () => {
  const a = buildLocalPreset("alpha", "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n", "0,0", "3,0");
  const b = buildLocalPreset("zeta", "TRIREME-CHART v1\ngrid 5 1\nwind 1 0\n", "0,0", "4,0");
  const original = [a, b];
  const renamed = renameLocalPreset(original, "alpha", "beta run");
  assert.deepEqual(renamed.map((p) => p.name), ["beta run", "zeta"]);
  assert.equal(renamed[0].chart, a.chart);
  assert.equal(renamed[0].from, a.from);
  assert.deepEqual(original.map((p) => p.name), ["alpha", "zeta"]);
  assert.throws(() => renameLocalPreset(original, "missing", "x"), /not found/);
  assert.throws(() => renameLocalPreset(original, "alpha", "zeta"), /already exists/);
  assert.throws(() => renameLocalPreset(original, "alpha", "bad/name"));
  assert.deepEqual(renameLocalPreset(original, "alpha", "Alpha"), [{ ...a, name: "Alpha" }, b]);
  assert.match(formatHelpText(), /Rename preset/);
});

test("duplicating a preset copies its content under a new name", () => {
  const a = buildLocalPreset("alpha", "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n", "0,0", "3,0");
  const original = [a];
  const copies = duplicateLocalPreset(original, "alpha", "beta copy");
  assert.deepEqual(copies.map((p) => p.name), ["alpha", "beta copy"]);
  assert.equal(copies[1].chart, a.chart);
  assert.equal(copies[1].from, a.from);
  assert.equal(copies[1].to, a.to);
  assert.notEqual(copies[1], a);
  assert.deepEqual(original.map((p) => p.name), ["alpha"]);
  assert.throws(() => duplicateLocalPreset(original, "missing", "x"), /not found/);
  assert.throws(() => duplicateLocalPreset(original, "alpha", "alpha"), /already exists/);
  assert.throws(() => duplicateLocalPreset(original, "alpha", "bad/name"));
  assert.match(formatHelpText(), /Duplicate preset/);
});

test("saved presets filter by name, chart and endpoints", () => {
  const alpha = buildLocalPreset("alpha", "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n", "0,0", "3,0");
  const beta = buildLocalPreset("beta", "TRIREME-CHART v1\ngrid 6 3\nwind 1 0\nland 2 2\n", "0,2", "5,0");
  const original = [alpha, beta];
  assert.deepEqual(filterLocalPresets(original, ""), original);
  assert.deepEqual(filterLocalPresets(original, "BETA").map((p) => p.name), ["beta"]);
  assert.deepEqual(filterLocalPresets(original, "land 2 2").map((p) => p.name), ["beta"]);
  assert.deepEqual(filterLocalPresets(original, "5,0").map((p) => p.name), ["beta"]);
  assert.deepEqual(filterLocalPresets(original, "wind 0 0").map((p) => p.name), ["alpha"]);
  assert.deepEqual(filterLocalPresets(original, "nothing"), []);
  assert.deepEqual(filterLocalPresets(null, "x"), []);
  assert.deepEqual(original.map((p) => p.name), ["alpha", "beta"]);
  assert.equal(presetFilterSummary(1, 2), "Showing 1 of 2 presets");
  assert.match(formatHelpText(), /Filter presets/);
});

test("saved presets sort by name or chart size without mutating", () => {
  const shortChart = "TRIREME-CHART v1\ngrid 2 2\nwind 0 0\n";
  const longChart = "TRIREME-CHART v1\ngrid 8 4\nwind 1 0\nland 2 2\nland 3 1\n";
  const alpha = buildLocalPreset("alpha", longChart, "0,0", "7,0");
  const beta = buildLocalPreset("beta", shortChart, "0,0", "1,1");
  const original = [alpha, beta];
  assert.deepEqual(sortLocalPresets(original, "name").map((p) => p.name), ["alpha", "beta"]);
  assert.deepEqual(sortLocalPresets(original, "name-desc").map((p) => p.name), ["beta", "alpha"]);
  assert.deepEqual(sortLocalPresets(original, "chart-asc").map((p) => p.name), ["beta", "alpha"]);
  assert.deepEqual(sortLocalPresets(original, "chart-desc").map((p) => p.name), ["alpha", "beta"]);
  assert.deepEqual(sortLocalPresets(original, "unknown"), sortLocalPresets(original, "name"));
  assert.deepEqual(sortLocalPresets(null, "name"), []);
  assert.deepEqual(original.map((p) => p.name), ["alpha", "beta"]);
  assert.match(formatHelpText(), /Sort presets/);
});

test("history CSV carries chart, endpoints, time and note with escaping", () => {
  const chartText = "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n";
  const entry = historyEntry({ time: 300, steps: ["E"] }, { chart: chartText, from: [0, 0], to: [3, 0] }, 7, "quick, run");
  const csv = historyToCsv([entry, null]);
  assert.match(csv, /^at,from,to,time,steps,heading,note,chart\n/);
  assert.match(csv, /"0,0","3,0",300,1,E,"quick, run"/);
  assert.match(csv, /"TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n"/);
  assert.equal(historyToCsv([]), "at,from,to,time,steps,heading,note,chart\n");
  assert.equal(historyCsvFilename(), "trireme.history.csv");
  assert.throws(() => historyToCsv(null), /No route history/);
  const parsed = JSON.parse(historyToJson([entry]));
  assert.equal(historyToCsv(parsed.entries), csv);
  assert.match(formatHelpText(), /Export history CSV/);
});

test("chart statistics summarize grid, land, currents and wind", () => {
  const text =
    "# note\r\nTRIREME-CHART v1\r\ngrid 8 4\r\nwind 1 -1\r\n" +
    "land 2 2\r\nland 3 1\r\ncurrent 5 2 0 -1\r\n";
  const stats = chartStats(text);
  assert.deepEqual(stats, { width: 8, height: 4, cells: 32, land: 2, currents: 1, wind: [1, -1] });
  assert.equal(
    formatChartStats(stats),
    "8x4 grid \u00b7 32 cells \u00b7 2 land \u00b7 1 currents \u00b7 wind (1,-1)"
  );
  assert.deepEqual(chartStats(""), { width: 0, height: 0, cells: 0, land: 0, currents: 0, wind: [0, 0] });
  assert.deepEqual(chartStats("grid x 3\nwind 2 0\n").wind, [2, 0]);
  assert.throws(() => formatChartStats(null), /No chart statistics/);
});

test("chart diff reports changed, added and removed lines", () => {
  const left = "TRIREME-CHART v1\r\ngrid 4 1\r\nwind 0 0";
  const right = "TRIREME-CHART v1\ngrid 4 1\nwind 1 0\nland 2 0\n";
  const diff = diffCharts(left, right);
  assert.equal(diff.changed, 1);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 0);
  assert.equal(
    formatChartDiff(diff),
    "Chart diff: 1 changed, 1 added, 0 removed\n" +
      "3 - wind 0 0\n" +
      "3 + wind 1 0\n" +
      "4 + land 2 0"
  );
  const identical = diffCharts(left, left.replace(/\r\n/g, "\n"));
  assert.equal(formatChartDiff(identical), "Chart diff: 0 changed, 0 added, 0 removed");
  const shorter = diffCharts("a\nb\nc", "a\nb");
  assert.equal(shorter.removed, 1);
  assert.match(formatChartDiff(shorter), /3 - c/);
  assert.throws(() => formatChartDiff(null), /No chart diff/);
});

test("clipboard diff includes both preset names and the change list", () => {
  const diff = diffCharts("a\nb", "a\nc");
  const text = formatDiffForClipboard(diff, "calm", "windy");
  assert.match(text, /^Trireme chart diff: calm -> windy\n/);
  assert.match(text, /Chart diff: 1 changed, 0 added, 0 removed/);
  assert.match(text, /2 - b\n2 \+ c/);
  assert.match(formatDiffForClipboard(diff, null, null), /left -> right/);
  assert.throws(() => formatDiffForClipboard(null, "a", "b"), /No chart diff/);
  assert.match(formatHelpText(), /Copy diff/);
});

test("current chart diffs against a saved preset with a clear label", () => {
  const preset = buildLocalPreset(
    "baseline",
    "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n",
    "0,0",
    "3,0"
  );
  const result = diffAgainstPreset("TRIREME-CHART v1\ngrid 4 1\nwind 1 0\n", preset);
  assert.equal(result.label, "Current chart -> baseline");
  assert.equal(result.diff.changed, 1);
  assert.match(formatChartDiff(result.diff), /3 - wind 1 0/);
  assert.match(formatChartDiff(result.diff), /3 \+ wind 0 0/);
  assert.throws(() => diffAgainstPreset("x", null), /No saved preset/);
  assert.throws(() => diffAgainstPreset("x", { name: "empty" }), /No saved preset/);
  assert.match(formatHelpText(), /Diff current/);
});

test("preset validation reports valid and broken saved charts", () => {
  const good = buildLocalPreset("good", "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n", "0,0", "3,0");
  const broken = { name: "bad/name", chart: "grid 2 2\nwind 0 0\n", from: "0,0", to: "1,1" };
  const report = validatePresetLibrary([good, broken]);
  assert.equal(report.total, 2);
  assert.equal(report.valid, 1);
  assert.equal(report.invalid.length, 1);
  assert.equal(report.invalid[0].name, "bad/name");
  assert.equal(formatPresetValidation(report),
    "Presets: 1 valid of 2\n- bad/name: Preset name must be 1-32 letters, digits, spaces, '-' or '_'.");
  assert.equal(formatPresetValidation(validatePresetLibrary([good])), "Presets: 1 valid of 1");
  assert.equal(formatPresetValidation(validatePresetLibrary(null)), "Presets: 0 valid of 0");
  assert.throws(() => formatPresetValidation(null), /No preset validation report/);
  assert.match(formatHelpText(), /Validate presets/);
});

test("swapping endpoints validates and normalizes both coordinates", () => {
  assert.deepEqual(swapEndpoints("0,2", "7,0"), { from: "7,0", to: "0,2" });
  assert.deepEqual(swapEndpoints(" 1 , 1 ", "2,3"), { from: "2,3", to: "1,1" });
  assert.deepEqual(swapEndpoints("4,4", "4,4"), { from: "4,4", to: "4,4" });
  assert.throws(() => swapEndpoints("bad", "1,1"), /X,Y/);
  assert.throws(() => swapEndpoints("0,0", "-1,0"), /X,Y/);
  assert.match(formatHelpText(), /Swap endpoints/);
});

test("clipboard chart keeps its text and notes the endpoints", () => {
  const chartText = "TRIREME-CHART v1\r\ngrid 4 1\r\nwind 0 0";
  assert.equal(
    formatChartForClipboard(chartText, "0,0", "3,0"),
    "# Trireme chart from (0,0) to (3,0)\n" +
      "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n"
  );
  assert.throws(() => formatChartForClipboard("grid 2 2\nwind 0 0\n", "0,0", "1,1"), /TRIREME-CHART/);
  assert.throws(() => formatChartForClipboard(chartText, "bad", "1,1"), /X,Y/);
  assert.match(formatHelpText(), /Copy chart/);
});

test("history summary aggregates plans, time and charts", () => {
  const chartA = "TRIREME-CHART v1\ngrid 4 1\nwind 0 0\n";
  const chartB = "TRIREME-CHART v1\ngrid 6 1\nwind 1 0\n";
  const entries = [
    historyEntry({ time: 200, steps: ["E"] }, { chart: chartA, from: [0, 0], to: [1, 0] }, 1000),
    historyEntry({ time: 400, steps: ["E", "E"] }, { chart: chartA, from: [0, 0], to: [2, 0] }, 2000),
    historyEntry({ time: 600, steps: ["E", "E", "E"] }, { chart: chartB, from: [0, 0], to: [3, 0] }, 3000),
  ];
  const summary = historySummary(entries);
  assert.equal(summary.count, 3);
  assert.equal(summary.totalSteps, 6);
  assert.equal(summary.uniqueCharts, 2);
  assert.equal(summary.fastest, 200);
  assert.equal(summary.slowest, 600);
  assert.equal(summary.average, 400);
  assert.equal(
    formatHistorySummary(summary),
    "Plans: 3 \u00b7 total steps: 6 \u00b7 unique charts: 2\n" +
      "Time: fastest 200, slowest 600, average 400 units\n" +
      "Range: 1970-01-01T00:00:01.000Z \u2192 1970-01-01T00:00:03.000Z"
  );
  assert.equal(formatHistorySummary(historySummary([])), "No saved plans yet.");
  assert.equal(formatHistorySummary(historySummary(null)), "No saved plans yet.");
  assert.throws(() => formatHistorySummary(null), /No history summary/);
});

test("clipboard history summary is a labelled plain-text block", () => {
  const text = formatHistorySummaryForClipboard(
    historySummary([
      historyEntry({ time: 300, steps: ["E"] }, { chart: "c", from: [0, 0], to: [1, 0] }, 7),
    ])
  );
  assert.match(text, /^Trireme history summary\n/);
  assert.match(text, /Plans: 1 \u00b7 total steps: 1 \u00b7 unique charts: 1/);
  assert.match(text, /Time: fastest 300, slowest 300, average 300 units/);
  assert.equal(text, formatHistorySummaryForClipboard(historySummary([
    historyEntry({ time: 300, steps: ["E"] }, { chart: "c", from: [0, 0], to: [1, 0] }, 7),
  ])));
  assert.match(formatHistorySummaryForClipboard(historySummary([])), /No saved plans yet\./);
  assert.throws(() => formatHistorySummaryForClipboard(null), /No history summary/);
  assert.match(formatHelpText(), /Copy history summary/);
});

test("CLI command formatter quotes paths and normalizes endpoints", () => {
  assert.equal(
    formatRouteCommand("aegean.txt", "0,2", "7,0"),
    "cargo run -- route aegean.txt --from 0,2 --to 7,0 --ascii"
  );
  assert.equal(
    formatRouteCommand("my chart.txt", " 0 , 2 ", "7,0"),
    'cargo run -- route "my chart.txt" --from 0,2 --to 7,0 --ascii'
  );
  assert.equal(
    formatRouteCommand("", "0,0", "1,1"),
    "cargo run -- route chart.txt --from 0,0 --to 1,1 --ascii"
  );
  assert.throws(() => formatRouteCommand("x.txt", "bad", "1,1"), /X,Y/);
  assert.match(formatHelpText(), /Copy command/);
});

test("clipboard map keeps the drawing and its legend", () => {
  const route = { from: [0, 0], to: [2, 0], ascii: "SoG\n~~~" };
  assert.equal(
    formatMapForClipboard(route, route.from, route.to),
    "Trireme map 0,0 -> 2,0\n" +
      "S start \u00b7 G goal \u00b7 o route \u00b7 # land \u00b7 ~ water\n" +
      "SoG\n~~~\n"
  );
  assert.match(formatMapForClipboard(route, null, null), /Trireme map 0,0 -> 2,0/);
  assert.throws(() => formatMapForClipboard(null, [0, 0], [1, 1]), /No route map/);
  assert.throws(() => formatMapForClipboard({}, [0, 0], [1, 1]), /No route map/);
  assert.match(formatHelpText(), /Copy map/);
});

test("Markdown route report includes metrics, step costs and a fenced map", () => {
  const route = {
    from: [0, 0],
    to: [2, 0],
    time: 200,
    explored: 9,
    steps: ["E", "E"],
    step_times: [100, 100],
    ascii: "SoG\n~~~",
  };
  const md = formatRouteAsMarkdown(route);
  assert.match(md, /^## Trireme route \(0,0\) \u2192 \(2,0\)\n/);
  assert.match(md, /\| Time \| 200 units \|/);
  assert.match(md, /\| Explored \| 9 cells \|/);
  assert.match(md, /E \u2192 E/);
  assert.match(md, /\| 2 \| E \| 100 \|/);
  assert.match(md, /```text\nSoG\n~~~\n```/);
  assert.equal(md, formatRouteAsMarkdown(route));
  assert.match(formatRouteAsMarkdown({ ...route, steps: [], step_times: [], time: 0 }), /\(already there\)/);
  assert.throws(() => formatRouteAsMarkdown(null), /No route/);
  assert.throws(() => formatRouteAsMarkdown({ time: 1 }), /No route/);
  assert.match(formatHelpText(), /Copy Markdown/);
});

test("clipboard chart stats are labelled and reuse the panel format", () => {
  const stats = chartStats("TRIREME-CHART v1\ngrid 8 4\nwind 1 0\nland 2 2\ncurrent 5 2 0 -1\n");
  assert.equal(
    formatChartStatsForClipboard(stats),
    "Trireme chart stats\n" + formatChartStats(stats) + "\n"
  );
  assert.match(formatChartStatsForClipboard(stats), /8x4 grid \u00b7 32 cells/);
  assert.match(formatChartStatsForClipboard(chartStats("")), /0x0 grid/);
  assert.throws(() => formatChartStatsForClipboard(null), /No chart statistics/);
  assert.match(formatHelpText(), /Copy stats/);
});

test("preset stats clipboard block names the preset and its chart", () => {
  const preset = buildLocalPreset(
    "Aegean",
    "TRIREME-CHART v1\ngrid 8 4\nwind 1 0\nland 2 2\ncurrent 5 2 0 -1\n",
    "0,2",
    "7,0"
  );
  assert.equal(
    formatPresetStatsForClipboard(preset),
    "Trireme preset: Aegean\n" +
      "8x4 grid \u00b7 32 cells \u00b7 1 land \u00b7 1 currents \u00b7 wind (1,0)\n" +
      "From 0,2 to 7,0\n"
  );
  assert.throws(() => formatPresetStatsForClipboard(null), /No saved preset/);
  assert.throws(() => formatPresetStatsForClipboard({ name: "x" }), /No saved preset/);
  assert.match(formatHelpText(), /Copy preset stats/);
});

test("undo drops only the newest history entry without mutating", () => {
  const c = "TRIREME-CHART v1\ngrid 2 2\nwind 0 0\n";
  const a = historyEntry({ time: 1, steps: [] }, { chart: c, from: [0, 0], to: [1, 1] }, 1);
  const b = historyEntry({ time: 2, steps: [] }, { chart: c, from: [0, 0], to: [1, 1] }, 2);
  const original = [b, a];
  assert.deepEqual(removeLastHistoryEntry(original), [a]);
  assert.deepEqual(original.map((item) => item.at), [2, 1]);
  assert.deepEqual(removeLastHistoryEntry([b]), []);
  assert.throws(() => removeLastHistoryEntry([]), /No history entry/);
  assert.throws(() => removeLastHistoryEntry(null), /No history entry/);
  assert.throws(() => removeLastHistoryEntry([], "custom"), /custom/);
  assert.match(formatHelpText(), /Undo last plan/);
});

test("comparison JSON is versioned and mirrors the two scenarios", () => {
  const comparison = {
    query: { from: [0, 2], to: [7, 0], chart: "x" },
    withWind: { time: 647, steps: ["E", "NE"], step_times: [83, 116], explored: 26 },
    still: { time: 780, steps: ["SE"], step_times: [156], explored: 30 },
  };
  const doc = JSON.parse(comparisonToJson(comparison));
  assert.equal(doc.schema, "trireme.comparison/1");
  assert.deepEqual(doc.from, [0, 2]);
  assert.deepEqual(doc.to, [7, 0]);
  assert.equal(doc.saved, 133);
  assert.equal(doc.wind.time, 647);
  assert.deepEqual(doc.wind.step_times, [83, 116]);
  assert.equal(doc.calm.time, 780);
  assert.equal(comparisonJsonFilename(), "trireme-comparison.json");
  assert.equal(comparisonToJson(comparison), comparisonToJson(comparison));
  assert.throws(() => comparisonToJson(null), /No comparison/);
  assert.match(formatHelpText(), /Export comparison/);
});

test("comparison Markdown is a labelled table with the saving", () => {
  const comparison = {
    query: { from: [0, 2], to: [7, 0] },
    withWind: { time: 647, steps: ["E", "NE"], explored: 26 },
    still: { time: 780, steps: ["SE"], explored: 30 },
  };
  assert.equal(
    comparisonToMarkdown(comparison),
    "## Trireme comparison (0,2) \u2192 (7,0)\n\n" +
      "| Scenario | Time (units) | Steps | Explored |\n" +
      "| --- | --- | --- | --- |\n" +
      "| Wind | 647 | 2 | 26 |\n" +
      "| Calm | 780 | 1 | 30 |\n\n" +
      "Saving: 133 units (17% faster).\n"
  );
  const slower = comparisonToMarkdown({
    withWind: { time: 900, steps: [], explored: 1 },
    still: { time: 600, steps: [], explored: 1 },
  });
  assert.match(slower, /Cost: 300 units \(50% slower\)\./);
  assert.throws(() => comparisonToMarkdown(null), /No comparison/);
  assert.match(formatHelpText(), /Copy comparison Markdown/);
});

test("the page wires file import and chart download", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(source, /getElementById\("import"\)\.addEventListener/);
  assert.match(source, /getElementById\("download"\)\.addEventListener/);
  assert.match(source, /link\.download = chartName/);
  assert.match(source, /getElementById\("compare"\)\.addEventListener/);
  assert.match(source, /Promise\.all\(\[ask\(query\), ask\(calm\)\]\)/);
  assert.match(source, /fetch\("\/api\/calm"/);
  assert.match(source, /const calmChart = await askCalm\(query\.chart\)/);
  assert.match(source, /getElementById\("export-csv"\)\.addEventListener/);
  assert.match(source, /routeCsvFilename\(chartName\)/);
  assert.match(source, /const clearHistory = document\.getElementById\("clear-history"\)/);
  assert.match(source, /clearHistory\.addEventListener\("click"/);
  assert.match(source, /localStorage\.setItem\(HISTORY_KEY/);
  assert.match(source, /historySort\.addEventListener\("change", renderHistory\)/);
  assert.match(source, /sortHistory\(/);
  assert.match(source, /getElementById\("save-preset"\)/);
  assert.match(source, /savePresetButton\.addEventListener\("click", saveNamedPreset\)/);
  assert.match(source, /localPreset\.addEventListener\("change", applyLocalPreset\)/);
  assert.match(source, /getElementById\("open-help"\)\.addEventListener\("click", openHelp\)/);
  assert.match(source, /getElementById\("close-help"\)\.addEventListener\("click", closeHelp\)/);
  assert.match(source, /helpText\.textContent = formatHelpText\(\)/);
  assert.match(source, /exportPresetsButton\.addEventListener\("click", exportPresets\)/);
  assert.match(source, /presetsFile\.addEventListener\("change", importPresets\)/);
  assert.match(source, /parsePresetsExport\(await picked\.text\(\)\)/);
  assert.match(source, /deletePresetButton\.addEventListener\("click", deleteSelectedPreset\)/);
  assert.match(source, /removeLocalPreset\(storedPresets\(\), name\)/);
  assert.match(source, /getElementById\("reset-local"\)\.addEventListener\("click", handleResetLocal\)/);
  assert.match(source, /for \(const key of keys\) \{/);
  assert.match(source, /getElementById\("copy-bundle"\)\.addEventListener\("click", copyDataBundle\)/);
  assert.match(source, /buildDataBundle\(/);
  assert.match(source, /getElementById\("import-bundle"\)\.addEventListener/);
  assert.match(source, /bundleFile\.addEventListener\("change", importBundle\)/);
  assert.match(source, /parseDataBundle\(await picked\.text\(\)\)/);
  assert.match(source, /applyBundleButton\.addEventListener\("click", applyPendingBundle\)/);
  assert.match(source, /cancelBundleButton\.addEventListener\("click", cancelPendingBundle\)/);
  assert.match(source, /bundleApplyPreview\(/);
  assert.match(source, /getElementById\("clear-editor"\)\.addEventListener\("click", clearEditor\)/);
  assert.match(source, /defaultEditorState\(\)/);
  assert.match(source, /const renamePresetButton = document\.getElementById\("rename-preset"\)/);
  assert.match(source, /renamePresetButton\.addEventListener\("click", renameSelectedPreset\)/);
  assert.match(source, /renameLocalPreset\(storedPresets\(\), from, to\)/);
  assert.match(source, /const duplicatePresetButton = document\.getElementById\("duplicate-preset"\)/);
  assert.match(source, /duplicatePresetButton\.addEventListener\("click", duplicateSelectedPreset\)/);
  assert.match(source, /duplicateLocalPreset\(storedPresets\(\), from, to\)/);
  assert.match(source, /presetFilter\.addEventListener\("input", renderLocalPresets\)/);
  assert.match(source, /filterLocalPresets\(saved, presetFilter\.value\)/);
  assert.match(source, /presetSort\.addEventListener\("change", renderLocalPresets\)/);
  assert.match(source, /sortLocalPresets\(/);
  assert.match(source, /getElementById\("export-history-csv"\)\.addEventListener\("click", exportHistoryCsv\)/);
  assert.match(source, /historyToCsv\(entries\)/);
  assert.match(source, /getElementById\("compare-presets"\)/);
  assert.match(source, /comparePresetsButton\.addEventListener\("click", compareSavedPresets\)/);
  assert.match(source, /diffCharts\(left\.chart, right\.chart\)/);
  assert.match(source, /getElementById\("copy-diff"\)/);
  assert.match(source, /copyDiffButton\.addEventListener\("click", copyChartDiff\)/);
  assert.match(source, /formatDiffForClipboard\(lastDiff/);
  assert.match(source, /getElementById\("diff-current"\)/);
  assert.match(source, /diffCurrentButton\.addEventListener\("click", diffCurrentAgainstPreset\)/);
  assert.match(source, /diffAgainstPreset\(chart\.value, preset\)/);
  assert.match(source, /getElementById\("validate-presets"\)/);
  assert.match(source, /validatePresetsButton\.addEventListener\("click", validateSavedPresets\)/);
  assert.match(source, /formatPresetValidation\(report\)/);
  assert.match(source, /getElementById\("swap-endpoints"\)/);
  assert.match(source, /swapEndpointsButton\.addEventListener\("click", swapEditorEndpoints\)/);
  assert.match(source, /swapEndpoints\(from\.value, to\.value\)/);
  assert.match(source, /getElementById\("copy-chart"\)/);
  assert.match(source, /copyChartButton\.addEventListener\("click", copyCurrentChart\)/);
  assert.match(source, /formatChartForClipboard\(chart\.value, from\.value, to\.value\)/);
  assert.match(source, /getElementById\("history-summary"\)/);
  assert.match(source, /formatHistorySummary\(historySummary\(entries\)\)/);
  assert.match(source, /getElementById\("copy-history-summary"\)/);
  assert.match(source, /copyHistorySummaryButton\.addEventListener\("click", copyHistorySummary\)/);
  assert.match(source, /formatHistorySummaryForClipboard\(historySummary\(entries\)\)/);
  assert.match(source, /getElementById\("copy-command"\)/);
  assert.match(source, /copyCommandButton\.addEventListener\("click", copyRouteCommand\)/);
  assert.match(source, /formatRouteCommand\(chartName, from\.value, to\.value\)/);
  assert.match(source, /getElementById\("copy-map"\)/);
  assert.match(source, /copyMapButton\.addEventListener\("click", copyRouteMap\)/);
  assert.match(source, /formatMapForClipboard\(lastRoute/);
  assert.match(source, /getElementById\("copy-stats"\)/);
  assert.match(source, /copyStatsButton\.addEventListener\("click", copyChartStats\)/);
  assert.match(source, /formatChartStatsForClipboard\(chartStats\(chart\.value\)\)/);
  assert.match(source, /getElementById\("copy-preset-stats"\)/);
  assert.match(source, /copyPresetStatsButton\.addEventListener\("click", copyPresetStats\)/);
  assert.match(source, /formatPresetStatsForClipboard\(preset\)/);
  assert.match(source, /getElementById\("undo-history"\)/);
  assert.match(source, /undoHistoryButton\.addEventListener\("click", undoLastHistoryEntry\)/);
  assert.match(source, /removeLastHistoryEntry\(entries\)/);
  assert.match(source, /getElementById\("copy-markdown"\)/);
  assert.match(source, /copyMarkdownButton\.addEventListener\("click", copyRouteMarkdown\)/);
  assert.match(source, /formatRouteAsMarkdown\(lastRoute\)/);
  assert.match(source, /getElementById\("chart-stats"\)/);
  assert.match(source, /formatChartStats\(chartStats\(chart\.value\)\)/);
  assert.match(source, /const visible = sortHistory\(/);
  assert.match(source, /historyList\.addEventListener\("click"/);
  assert.match(source, /function restoreHistory\(index\)/);
  assert.match(source, /stepTimes\.textContent = formatStepTimes\(route\)/);
  assert.match(source, /chart\.addEventListener\("input", renderIssues\)/);
  assert.match(source, /event\.ctrlKey && event\.shiftKey && event\.key\.toLowerCase\(\) === "c"/);
  assert.match(source, /function renderIssues\(\)/);
  assert.match(source, /getElementById\("copy-summary"\)\.addEventListener/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /formatRouteSummary\(lastRoute\)/);
  assert.match(source, /getElementById\("export-history"\)\.addEventListener/);
  assert.match(source, /historyToJson\(entries\)/);
  assert.match(source, /getElementById\("import-history"\)\.addEventListener/);
  assert.match(source, /historyFile\.addEventListener\("change", importHistory\)/);
  assert.match(source, /parseHistoryExport\(await picked\.text\(\)\)/);
  assert.match(source, /getElementById\("export-compare-csv"\)\.addEventListener/);
  assert.match(source, /getElementById\("export-compare-json"\)/);
  assert.match(source, /comparisonToJson\(lastComparison\)/);
  assert.match(source, /getElementById\("copy-compare-md"\)/);
  assert.match(source, /comparisonToMarkdown\(lastComparison\)/);
  assert.match(source, /lastComparison = \{ withWind, still, query \}/);
  assert.match(source, /const applyImport = document\.getElementById\("apply-import"\)/);
  assert.match(source, /const cancelImport = document\.getElementById\("cancel-import"\)/);
  assert.match(source, /applyImport\.addEventListener\("click"/);
  assert.match(source, /cancelImport\.addEventListener\("click"/);
  assert.match(source, /historyImportSummary\(incoming, current\)/);
  assert.match(source, /historyFilter\.addEventListener\("input", renderHistory\)/);
  assert.match(source, /restore\.dataset\.index = String\(entries\.indexOf\(entry\)\)/);
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /type="file" id="file" accept="\.txt,text\/plain"/);
});
