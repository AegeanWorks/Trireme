"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  PRESETS,
  point,
  applyPreset,
  chartFilename,
  validateChartText,
  chartIssues,
  formatChartIssues,
  calmChartText,
  compareSummary,
  csvCell,
  routeToCsv,
  routeCsvFilename,
  formatStepTimes,
  formatRouteSummary,
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
    "chart", "chart-issues", "from", "to", "preset", "file", "plan", "compare", "save",
    "load", "import", "download", "export", "export-csv", "copy-summary", "map", "step-times",
    "compare-panel",
    "compare-summary", "compare-current", "compare-calm", "compare-delta",
    "export-compare-csv",
    "history-title", "clear-history", "export-history", "import-history",
    "history-file", "history-list",
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

test("the page wires file import and chart download", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(source, /getElementById\("import"\)\.addEventListener/);
  assert.match(source, /getElementById\("download"\)\.addEventListener/);
  assert.match(source, /link\.download = chartName/);
  assert.match(source, /getElementById\("compare"\)\.addEventListener/);
  assert.match(source, /Promise\.all\(\[ask\(query\), ask\(calm\)\]\)/);
  assert.match(source, /getElementById\("export-csv"\)\.addEventListener/);
  assert.match(source, /routeCsvFilename\(chartName\)/);
  assert.match(source, /const clearHistory = document\.getElementById\("clear-history"\)/);
  assert.match(source, /clearHistory\.addEventListener\("click"/);
  assert.match(source, /localStorage\.setItem\(HISTORY_KEY/);
  assert.match(source, /restore\.dataset\.index = String\(index\)/);
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
  assert.match(source, /lastComparison = \{ withWind, still, query \}/);
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /type="file" id="file" accept="\.txt,text\/plain"/);
});
