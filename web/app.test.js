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
  calmChartText,
  compareSummary,
  csvCell,
  routeToCsv,
  routeCsvFilename,
  HISTORY_KEY,
  HISTORY_LIMIT,
  historyEntry,
  appendHistory,
  parseHistory,
  formatHistoryEntry,
  restoreEntry,
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
    "chart", "from", "to", "preset", "file", "plan", "compare", "save",
    "load", "import", "download", "export", "export-csv", "map", "compare-panel",
    "compare-summary", "compare-current", "compare-calm", "compare-delta",
    "history-title", "clear-history", "history-list",
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
    time: 240,
  };
  assert.equal(
    routeToCsv(route),
    "step,x,y,heading\n0,0,2,start\n1,1,2,E\n2,2,1,NE\n"
  );
  assert.equal(
    routeToCsv({ waypoints: [[3, 4]], steps: [] }),
    "step,x,y,heading\n0,3,4,start\n"
  );
  assert.throws(() => routeToCsv(null), /No route/);
  assert.throws(() => routeToCsv({ waypoints: [[1]], steps: [] }), /\[x,y\]/);
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
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /type="file" id="file" accept="\.txt,text\/plain"/);
});
