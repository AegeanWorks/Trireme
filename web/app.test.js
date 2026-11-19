"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { PRESETS, point, applyPreset } = require("./app.js");

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
  for (const id of ["chart", "from", "to", "preset", "plan", "save", "load", "export", "map"]) {
    assert.match(html, new RegExp('id="' + id + '"'), "missing control: " + id);
  }
});

test("the client sends endpoints as coordinate arrays", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(source, /from: point\(from\.value\)/);
  assert.match(source, /to: point\(to\.value\)/);
});
