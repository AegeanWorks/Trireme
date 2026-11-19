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
    "load", "import", "download", "export", "map", "compare-panel",
    "compare-summary", "compare-current", "compare-calm", "compare-delta",
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

test("the page wires file import and chart download", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(source, /getElementById\("import"\)\.addEventListener/);
  assert.match(source, /getElementById\("download"\)\.addEventListener/);
  assert.match(source, /link\.download = chartName/);
  assert.match(source, /getElementById\("compare"\)\.addEventListener/);
  assert.match(source, /Promise\.all\(\[ask\(query\), ask\(calm\)\]\)/);
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /type="file" id="file" accept="\.txt,text\/plain"/);
});
