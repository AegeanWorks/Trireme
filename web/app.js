"use strict";

const HELP_SECTIONS = {
  commands: [
    ["chart <file> [--json] [--calm|--stats|--issues|--normalize|--fingerprint]", "Describe, calm, count, validate, sort or identify a chart"],
    ["compare <file> --from X,Y --to X,Y [--json]", "Compare wind with the calm baseline"],
    ["diff <left> <right> [--json]", "Show numbered chart line differences"],
    ["route <file> --from X,Y --to X,Y [--ascii] [--json]", "Plan the fastest route"],
    ["serve [--port N] [--project DIR]", "Serve this browser UI on 127.0.0.1"],
    ["help | --version", "Show CLI help or version"],
  ],
  syntax: [
    ["TRIREME-CHART v1", "Required first non-comment line"],
    ["grid <w> <h>", "Required grid size, exactly once"],
    ["wind <dx> <dy>", "Required wind vector, each -1..1"],
    ["land <x> <y>", "Impassable cell; repeatable"],
    ["current <x> <y> <dx> <dy>", "Local flow; repeatable"],
    ["# text / blank lines", "Ignored"],
  ],
  controls: [
    ["Ctrl+Enter", "Plan the current query"],
    ["Ctrl+Shift+C", "Compare with calm water"],
    ["Plan route", "Compute and show the route"],
    ["Clear editor", "Reset chart and endpoints to the default preset"],
    ["Swap endpoints", "Exchange the from and to coordinates"],
    ["Copy chart", "Copy the chart text with its endpoints noted"],
    ["Copy stats", "Copy grid, land, current and wind counts"],
    ["Copy issues", "Copy the chart validation report"],
    ["Canonicalize", "Replace the chart with its Rust-normalized form"],
    ["Copy fingerprint", "Copy the stable ID of the current chart"],
    ["Copy preset stats", "Copy stats for the selected saved preset"],
    ["Compare with calm", "Zero wind and currents, then compare"],
    ["Save as preset", "Store chart and endpoints locally"],
    ["Delete preset", "Remove the selected saved preset"],
    ["Rename preset", "Rename the selected saved preset"],
    ["Duplicate preset", "Copy the selected saved preset under a new name"],
    ["Filter presets", "Search saved presets by name, chart or endpoints"],
    ["Sort presets", "Order saved presets by name or chart size"],
    ["Compare presets", "Show a line-by-line diff of two saved charts"],
    ["Validate presets", "Check every saved chart and endpoint"],

    ["Copy diff", "Copy that chart diff to the clipboard"],
    ["Diff current", "Compare the editor chart with the right-hand preset"],
    ["Export route (JSON/CSV)", "Download the last route"],
    ["Copy summary", "Copy a plain-text report"],
    ["Copy command", "Copy the cargo command for this query"],
    ["Copy map", "Copy the ASCII route map with its legend"],
    ["Copy Markdown", "Copy a Markdown report of the route"],
    ["Export comparison", "Download the wind-vs-calm comparison as CSV or JSON"],
    ["Copy comparison Markdown", "Copy the comparison as a Markdown table"],
    ["Import / Export JSON", "Move route history between browsers"],
    ["Export history CSV", "Download the visible plans as a spreadsheet"],
    ["Copy history summary", "Copy the history overview to the clipboard"],
    ["Filter / Sort history", "Search and order saved plans"],
    ["Undo last plan", "Remove only the newest history entry"],
    ["Reset local data", "Click twice to clear chart, presets and history"],
    ["Copy all data", "Copy a versioned JSON bundle to the clipboard"],
    ["Import bundle", "Load a trireme.bundle/1 file into this browser"],
  ],
};

function formatHelpText(sections) {
  const source = sections || HELP_SECTIONS;
  const titles = [
    ["commands", "CLI COMMANDS"],
    ["syntax", "CHART SYNTAX"],
    ["controls", "UI CONTROLS AND SHORTCUTS"],
  ];
  const lines = ["TRIREME HELP", ""];
  for (const [key, title] of titles) {
    const rows = Array.isArray(source[key]) ? source[key] : [];
    const width = rows.reduce((widest, row) => Math.max(widest, String(row[0]).length), 0);
    lines.push(title);
    for (const row of rows) {
      lines.push("  " + String(row[0]).padEnd(width) + "  " + String(row[1]));
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

const PRESETS = {
  aegean: {
    chart:
      "TRIREME-CHART v1\ngrid 8 4\nwind 1 0\nland 3 2\nland 3 1\nland 4 1\n" +
      "current 5 2 0 -1\ncurrent 6 1 -1 0",
    from: "0,2",
    to: "7,0",
  },
  calm: {
    chart: "TRIREME-CHART v1\ngrid 8 1\nwind 0 0",
    from: "0,0",
    to: "7,0",
  },
  headwind: {
    chart: "TRIREME-CHART v1\ngrid 8 1\nwind -1 0",
    from: "0,0",
    to: "7,0",
  },
  detour: {
    chart:
      "TRIREME-CHART v1\ngrid 6 5\nwind 1 0\nland 3 1\nland 3 2\nland 3 3",
    from: "0,2",
    to: "5,2",
  },
};

function point(value) {
  const parts = value.split(",");
  if (parts.length !== 2 || parts.some((part) => !/^\d+$/.test(part.trim()))) {
    throw new Error("Enter each endpoint as X,Y with non-negative integers.");
  }
  return parts.map((part) => Number(part.trim()));
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error("Unknown preset: " + name);
  }
  return { chart: preset.chart, from: preset.from, to: preset.to };
}

function chartFilename(name) {
  const base = String(name || "").split(/[\\/]/).pop() || "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  if (!cleaned) {
    return "chart.txt";
  }
  return cleaned.endsWith(".txt") ? cleaned : cleaned + ".txt";
}

// Tooling/test-only fallback; the browser reads Rust issues from /api/issues.
function chartIssues(text) {
  const normalized = String(text).replace(/\r\n?/g, "\n");
  const issues = [];
  if (normalized.length > 1000000) {
    issues.push({ line: 0, message: "Chart is too large; the browser limit is 1 MB." });
  }
  const lines = normalized.split("\n");
  const meaningful = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((entry) => {
      const trimmed = entry.line.trim();
      return trimmed && !trimmed.startsWith("#");
    });

  if (!meaningful.length || meaningful[0].line.trim() !== "TRIREME-CHART v1") {
    issues.push({
      line: meaningful.length ? meaningful[0].number : 1,
      message: "Chart must start with 'TRIREME-CHART v1' after any comments.",
    });
  }

  const patterns = {
    grid: /^grid\s+\d+\s+\d+$/,
    wind: /^wind\s+-?[01]\s+-?[01]$/,
    land: /^land\s+\d+\s+\d+$/,
    current: /^current\s+\d+\s+\d+\s+-?[01]\s+-?[01]$/,
  };
  const hints = {
    grid: "grid <width> <height>",
    wind: "wind <dx> <dy> with components -1..1",
    land: "land <x> <y>",
    current: "current <x> <y> <dx> <dy>",
  };
  const seen = new Set();
  for (const entry of meaningful) {
    const trimmed = entry.line.trim();
    const directive = trimmed.split(/\s+/)[0];
    if (trimmed === "TRIREME-CHART v1") {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(patterns, directive)) {
      if (!patterns[directive].test(trimmed)) {
        issues.push({ line: entry.number, message: "expected " + hints[directive] + "." });
      }
      if (directive === "grid" || directive === "wind") {
        if (seen.has(directive)) {
          issues.push({ line: entry.number, message: "'" + directive + "' is declared more than once." });
        }
        seen.add(directive);
      }
    } else {
      issues.push({ line: entry.number, message: "unknown directive '" + directive + "'." });
    }
  }
  for (const directive of ["grid", "wind"]) {
    if (!seen.has(directive)) {
      issues.push({ line: 0, message: "Chart needs a '" + hints[directive] + "' line." });
    }
  }
  return issues;
}

function fingerprintRequestBody(text) {
  return JSON.stringify({ chart: String(text || "") });
}

function parseFingerprintResponse(result) {
  if (!result || !result.ok || typeof result.fingerprint !== "string") {
    throw new Error(
      result && result.error ? result.error : "Could not fingerprint the chart."
    );
  }
  return result.fingerprint;
}

function formatFingerprintForClipboard(value) {
  if (typeof value !== "string" || !value.length) {
    throw new Error("No chart fingerprint to copy.");
  }
  return "Trireme chart fingerprint: " + value + "\n";
}

function normalizeRequestBody(text) {
  return JSON.stringify({ chart: String(text || "") });
}

function parseNormalizeResponse(result) {
  if (!result || !result.ok || typeof result.chart !== "string") {
    throw new Error(
      result && result.error ? result.error : "Could not normalize the chart."
    );
  }
  return result.chart;
}

function issuesRequestBody(text) {
  return JSON.stringify({ chart: String(text || "") });
}

function parseIssuesResponse(result) {
  if (!result || !result.ok || !Array.isArray(result.issues)) {
    throw new Error(
      result && result.error ? result.error : "Could not validate the chart."
    );
  }
  return result.issues
    .filter((issue) => issue && typeof issue.line === "number" && typeof issue.message === "string")
    .map((issue) => ({ line: issue.line, message: issue.message }));
}

function formatIssuesForClipboard(issues) {
  if (!Array.isArray(issues)) {
    throw new Error("No chart issues to copy.");
  }
  const lines = issues.map((issue) =>
    (issue.line ? "line " + issue.line : "chart") + ": " + issue.message
  );
  return (
    "Trireme chart issues\n" +
    (lines.length ? lines.join("\n") : "No issues found.") +
    "\n"
  );
}

function formatChartIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return "No chart issues.";
  }
  return issues
    .map((issue) => "line " + (issue.line || "?") + ": " + issue.message)
    .join("\n");
}

function validateChartText(text) {
  const issues = chartIssues(text);
  if (issues.length > 0) {
    throw new Error(formatChartIssues(issues));
  }
  return String(text).replace(/\r\n?/g, "\n");
}

// Tooling/test-only helper; the browser takes its calm baseline from the
// Rust implementation through POST /api/calm so both agree exactly.
function calmChartText(text) {
  return validateChartText(text)
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (/^wind\s+-?[01]\s+-?[01]$/.test(trimmed)) {
        return "wind 0 0";
      }
      const flow = /^(current\s+\d+\s+\d+\s+)-?[01]\s+-?[01]$/.exec(trimmed);
      if (flow) {
        return flow[1] + "0 0";
      }
      return line;
    })
    .join("\n");
}

// Tooling/test-only helpers; the browser comparison now uses POST /api/compare.
function calmRequestBody(text) {
  return JSON.stringify({ chart: String(text || "") });
}

function parseCalmResponse(result) {
  if (!result || !result.ok || typeof result.chart !== "string") {
    throw new Error(
      result && result.error ? result.error : "Could not derive the calm chart."
    );
  }
  return result.chart;
}

function compareRequestBody(chartText, from, to) {
  return JSON.stringify({
    chart: String(chartText || ""),
    from: point(from),
    to: point(to),
  });
}

function parseCompareResponse(result) {
  if (!result || !result.ok || !result.wind || !result.calm) {
    throw new Error(
      result && result.error ? result.error : "Could not compare this chart."
    );
  }
  return {
    from: result.from,
    to: result.to,
    saved: typeof result.saved === "number" ? result.saved : 0,
    wind: result.wind,
    calm: result.calm,
  };
}

function compareSummary(current, calm) {
  const delta = calm.time - current.time;
  if (delta === 0 || calm.time === 0) {
    return "No difference: both routes take " + current.time + " units.";
  }
  const percent = Math.round((Math.abs(delta) / calm.time) * 100);
  if (delta > 0) {
    return "Wind and current save " + delta + " units (" + percent + "% faster).";
  }
  return "Wind and current cost " + -delta + " units (" + percent + "% slower).";
}

function formatStepTimes(route) {
  if (!route || !Array.isArray(route.steps) || !Array.isArray(route.step_times)) {
    return "\u2014";
  }
  if (route.steps.length === 0) {
    return "(already there)";
  }
  return route.steps
    .map((step, index) => {
      const used = route.step_times[index];
      return step + " " + (used === undefined ? "?" : used) + " units";
    })
    .join(" \u00b7 ");
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function routeToCsv(route) {
  if (!route || !Array.isArray(route.waypoints) || !Array.isArray(route.steps)) {
    throw new Error("No route to export as CSV.");
  }
  const times = Array.isArray(route.step_times) ? route.step_times : [];
  const lines = ["step,x,y,heading,time_units"];
  route.waypoints.forEach((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new Error("Route waypoints must be [x,y] pairs.");
    }
    const heading = index === 0 ? "start" : route.steps[index - 1] || "";
    const spent = index === 0 ? 0 : times[index - 1] === undefined ? "" : times[index - 1];
    lines.push([index, point[0], point[1], heading, spent].map(csvCell).join(","));
  });
  return lines.join("\n") + "\n";
}

function routeCsvFilename(name) {
  return chartFilename(name).replace(/\.txt$/, "") + ".csv";
}

function formatRouteSummary(route) {
  if (!route || typeof route !== "object") {
    throw new Error("No route to copy.");
  }
  const point = (value) =>
    Array.isArray(value) ? "(" + value[0] + "," + value[1] + ")" : "\u2014";
  const steps = Array.isArray(route.steps) ? route.steps : [];
  const waypoints = Array.isArray(route.waypoints) ? route.waypoints : [];
  return [
    "Trireme route " + point(route.from) + " -> " + point(route.to),
    "Time: " +
      (typeof route.time === "number" ? route.time + " units" : "\u2014") +
      " | Steps: " +
      steps.length +
      " | Explored: " +
      (typeof route.explored === "number" ? route.explored + " cells" : "\u2014"),
    "Headings: " + (steps.length ? steps.join(" ") : "\u2014"),
    "Step times: " + formatStepTimes(route),
    "Waypoints: " +
      (waypoints.length ? waypoints.map(point).join(" -> ") : "\u2014"),
  ].join("\n");
}

function comparisonToCsv(comparison) {
  if (!comparison || !comparison.withWind || !comparison.still) {
    throw new Error("No comparison to export.");
  }
  const wind = comparison.withWind;
  const still = comparison.still;
  const asText = (point) =>
    Array.isArray(point) ? point.join(",") : String(point || "");
  const source = comparison.query || wind;
  const from = asText(source.from);
  const to = asText(source.to);
  const row = (name, route, saved) =>
    [
      name,
      from,
      to,
      typeof route.time === "number" ? route.time : "",
      saved,
      Array.isArray(route.steps) ? route.steps.length : "",
      typeof route.explored === "number" ? route.explored : "",
      Array.isArray(route.steps) ? route.steps.join(" ") : "",
    ]
      .map(csvCell)
      .join(",");
  return [
    "scenario,from,to,time,saved_vs_calm,steps,explored,headings",
    row("wind", wind, still.time - wind.time),
    row("calm", still, 0),
  ].join("\n") + "\n";
}

function comparisonCsvFilename() {
  return "trireme-comparison.csv";
}

const HISTORY_KEY = "trireme.history";
const HISTORY_LIMIT = 10;

function historyEntry(route, query, at, note) {
  if (!route || typeof route.time !== "number" || !Array.isArray(route.steps)) {
    throw new Error("No route to record in history.");
  }
  return {
    at: Number(at) || 0,
    from: query.from,
    to: query.to,
    time: route.time,
    steps: route.steps.length,
    heading: route.steps.join(" ") || "(already there)",
    note: String(note || ""),
    chart: String((query && query.chart) || ""),
  };
}

function restoreEntry(entry) {
  if (!entry || typeof entry.chart !== "string" || entry.chart.length === 0) {
    throw new Error("This history entry has no chart to restore.");
  }
  const chart = validateChartText(entry.chart);
  const asText = (point) =>
    Array.isArray(point) ? point.join(",") : String(point || "");
  const from = asText(entry.from);
  const to = asText(entry.to);
  point(from);
  point(to);
  return { chart, from, to };
}

function appendHistory(entries, entry, limit) {
  const clean = Array.isArray(entries)
    ? entries.filter((item) => item && typeof item.at === "number")
    : [];
  const cap = Number.isInteger(limit) && limit > 0 ? limit : HISTORY_LIMIT;
  return [entry, ...clean].slice(0, cap);
}

function parseHistory(raw) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item) =>
        item &&
        typeof item.at === "number" &&
        typeof item.time === "number"
    );
  } catch (error) {
    return [];
  }
}

function formatHistoryEntry(entry) {
  const date = new Date(entry.at).toISOString();
  const formatPoint = (point) =>
    Array.isArray(point) ? point.join(",") : String(point || "");
  const line =
    date +
    " \u00b7 (" +
    formatPoint(entry.from) +
    ")\u2192(" +
    formatPoint(entry.to) +
    ") \u00b7 " +
    entry.time +
    " units \u00b7 " +
    entry.steps +
    " steps";
  return entry.note ? line + " \u00b7 " + entry.note : line;
}

function historyToJson(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("No route history to export.");
  }
  const clean = entries
    .filter((entry) => entry && typeof entry.at === "number" && typeof entry.time === "number")
    .map((entry) => ({
      at: entry.at,
      from: entry.from,
      to: entry.to,
      time: entry.time,
      steps: entry.steps,
      heading: entry.heading,
      note: entry.note,
      chart: typeof entry.chart === "string" ? entry.chart : "",
    }));
  const document = {
    schema: "trireme.history/1",
    count: clean.length,
    entries: clean,
  };
  return JSON.stringify(document, null, 2) + "\n";
}

function historyJsonFilename() {
  return HISTORY_KEY + ".json";
}

function parseHistoryExport(raw) {
  let document;
  try {
    document = JSON.parse(String(raw));
  } catch (error) {
    throw new Error("History file is not valid JSON.");
  }
  if (!document || document.schema !== "trireme.history/1" || !Array.isArray(document.entries)) {
    throw new Error("History file must have schema 'trireme.history/1' and an entries array.");
  }
  const entries = [];
  for (const item of document.entries) {
    if (!item || typeof item.at !== "number" || typeof item.time !== "number") {
      continue;
    }
    try {
      restoreEntry(item);
    } catch (error) {
      continue;
    }
    entries.push({
      at: item.at,
      from: item.from,
      to: item.to,
      time: item.time,
      steps: Array.isArray(item.steps) ? item.steps : [],
      heading: String(item.heading || ""),
      note: String(item.note || ""),
      chart: item.chart,
    });
  }
  if (entries.length === 0) {
    throw new Error("History file contains no usable entries.");
  }
  return entries;
}

function mergeHistory(current, incoming, limit) {
  const seen = new Set();
  const cap = Number.isInteger(limit) && limit > 0 ? limit : HISTORY_LIMIT;
  const sources = [...(Array.isArray(incoming) ? incoming : []), ...(Array.isArray(current) ? current : [])];
  return sources
    .filter((entry) => entry && typeof entry.at === "number")
    .sort((a, b) => b.at - a.at)
    .filter((entry) => {
      const key = JSON.stringify([entry.at, entry.from, entry.to, entry.time]);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, cap);
}

function historyImportSummary(incoming, current, limit) {
  const added = Array.isArray(incoming) ? incoming : [];
  const existing = Array.isArray(current) ? current : [];
  const key = (entry) =>
    JSON.stringify([entry.at, entry.from, entry.to, entry.time]);
  const known = new Set(existing.map(key));
  const fresh = added.filter((entry) => !known.has(key(entry))).length;
  const times = added
    .filter((entry) => typeof entry.at === "number")
    .map((entry) => entry.at);
  return {
    total: added.length,
    fresh,
    duplicates: added.length - fresh,
    kept: mergeHistory(existing, added, limit).length,
    oldest: times.length ? Math.min(...times) : null,
    newest: times.length ? Math.max(...times) : null,
  };
}

function formatImportSummary(summary) {
  if (!summary) {
    throw new Error("No import to summarize.");
  }
  const date = (value) =>
    value === null || value === undefined ? "\u2014" : new Date(value).toISOString();
  return [
    "File: " +
      summary.total +
      " entries (" +
      summary.fresh +
      " new, " +
      summary.duplicates +
      " duplicates)",
    "After merge: " + summary.kept + " entries kept",
    "Range: " + date(summary.oldest) + " \u2192 " + date(summary.newest),
  ].join("\n");
}

function filterHistory(entries, query) {
  const source = Array.isArray(entries) ? entries : [];
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return source.slice();
  }
  return source.filter((entry) => {
    const haystack = [
      formatHistoryEntry(entry),
      typeof entry.heading === "string" ? entry.heading : "",
      typeof entry.chart === "string" ? entry.chart : "",
      JSON.stringify([entry.from, entry.to, entry.steps]),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

function historyFilterSummary(shown, total) {
  return "Showing " + shown + " of " + total + " entries";
}

function filterLocalPresets(presets, query) {
  const source = Array.isArray(presets) ? presets : [];
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return source.slice();
  }
  return source.filter((item) =>
    [item.name, item.chart, item.from, item.to]
      .map((value) => String(value || ""))
      .join(" ")
      .toLowerCase()
      .includes(needle)
  );
}

function presetFilterSummary(shown, total) {
  return "Showing " + shown + " of " + total + " presets";
}

function sortLocalPresets(presets, mode) {
  const source = Array.isArray(presets) ? presets.slice() : [];
  const byName = (a, b) => a.name.localeCompare(b.name);
  const chartSize = (item) => String(item.chart || "").length;
  switch (mode) {
    case "name-desc":
      return source.sort((a, b) => -byName(a, b));
    case "chart-asc":
      return source.sort((a, b) => chartSize(a) - chartSize(b) || byName(a, b));
    case "chart-desc":
      return source.sort((a, b) => chartSize(b) - chartSize(a) || byName(a, b));
    case "name":
    default:
      return source.sort(byName);
  }
}

function sortHistory(entries, mode) {
  const source = Array.isArray(entries) ? entries.slice() : [];
  const key = (entry) => JSON.stringify([entry.at, entry.from, entry.to, entry.time]);
  const byTime = (a, b) => (b.at || 0) - (a.at || 0) || key(a).localeCompare(key(b));
  switch (mode) {
    case "oldest":
      return source.sort((a, b) => -byTime(a, b));
    case "fastest":
      return source.sort((a, b) => (a.time || 0) - (b.time || 0) || byTime(a, b));
    case "slowest":
      return source.sort((a, b) => (b.time || 0) - (a.time || 0) || byTime(a, b));
    case "newest":
    default:
      return source.sort(byTime);
  }
}

const LOCAL_PRESETS_KEY = "trireme.presets";
const LOCAL_PRESET_LIMIT = 20;
const LOCAL_DATA_KEYS = [
  "trireme.chart",
  "trireme.from",
  "trireme.to",
  LOCAL_PRESETS_KEY,
  HISTORY_KEY,
];

function resetPlan(keys) {
  const source = Array.isArray(keys) && keys.length ? keys : LOCAL_DATA_KEYS;
  return [...new Set(source.filter((key) => typeof key === "string" && key).map(String))];
}

function formatResetSummary(keys) {
  const list = resetPlan(keys);
  return "Reset " + list.length + " local keys: " + list.join(", ") + ".";
}

function normalizePresetName(raw) {
  const name = String(raw || "").trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(name)) {
    throw new Error("Preset name must be 1-32 letters, digits, spaces, '-' or '_'.");
  }
  return name;
}

function buildLocalPreset(name, chartText, fromValue, toValue) {
  const cleanName = normalizePresetName(name);
  const cleanChart = validateChartText(chartText);
  point(fromValue);
  point(toValue);
  return { name: cleanName, chart: cleanChart, from: fromValue, to: toValue };
}

function parseLocalPresets(raw) {
  if (!raw) {
    return [];
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    return [];
  }
  if (!document || document.schema !== "trireme.presets/1" || !Array.isArray(document.presets)) {
    return [];
  }
  return document.presets
    .filter((preset) => {
      if (!preset || typeof preset.name !== "string") {
        return false;
      }
      try {
        normalizePresetName(preset.name);
        validateChartText(preset.chart);
        point(preset.from);
        point(preset.to);
        return true;
      } catch (error) {
        return false;
      }
    })
    .map((preset) => ({
      name: normalizePresetName(preset.name),
      chart: String(preset.chart),
      from: String(preset.from),
      to: String(preset.to),
    }));
}

function mergeLocalPresets(presets, preset, limit) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : LOCAL_PRESET_LIMIT;
  const list = Array.isArray(presets) ? presets.filter((item) => item && item.name) : [];
  const rest = list.filter((item) => normalizePresetName(item.name) !== preset.name);
  return [preset, ...rest]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, cap);
}

function localPresetsToJson(presets) {
  const clean = Array.isArray(presets) ? presets : [];
  const sorted = clean.slice().sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify({ schema: "trireme.presets/1", presets: sorted }, null, 2) + "\n";
}

function presetFilename() {
  return LOCAL_PRESETS_KEY + ".json";
}

function parsePresetsExport(raw) {
  let document;
  try {
    document = JSON.parse(String(raw));
  } catch (error) {
    throw new Error("Preset file is not valid JSON.");
  }
  if (!document || document.schema !== "trireme.presets/1" || !Array.isArray(document.presets)) {
    throw new Error("Preset file must have schema 'trireme.presets/1' and a presets array.");
  }
  const presets = parseLocalPresets(JSON.stringify(document));
  if (presets.length === 0) {
    throw new Error("Preset file contains no usable presets.");
  }
  return presets;
}

function mergePresetFiles(current, incoming, limit) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : LOCAL_PRESET_LIMIT;
  const byName = new Map();
  for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (item && typeof item.name === "string") {
      byName.set(normalizePresetName(item.name), item);
    }
  }
  return [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, cap);
}

function removeLocalPreset(presets, name) {
  const target = normalizePresetName(name);
  if (!Array.isArray(presets)) {
    return [];
  }
  return presets.filter(
    (item) => !item || normalizePresetName(item.name) !== target
  );
}

function buildDataBundle(chartText, fromValue, toValue, presets, history) {
  const cleanChart = validateChartText(chartText);
  point(fromValue);
  point(toValue);
  const presetDoc = localPresetsToJson(
    parseLocalPresets(localPresetsToJson(Array.isArray(presets) ? presets : []))
  );
  const historyEntries = Array.isArray(history) ? history : [];
  const cleanHistory = historyEntries.length
    ? parseHistoryExport(historyToJson(historyEntries))
    : [];
  return {
    schema: "trireme.bundle/1",
    chart: { chart: cleanChart, from: fromValue, to: toValue },
    presets: JSON.parse(presetDoc).presets,
    history: cleanHistory,
  };
}

function formatDataBundle(bundle) {
  if (!bundle || bundle.schema !== "trireme.bundle/1") {
    throw new Error("Only a trireme.bundle/1 document can be formatted.");
  }
  return JSON.stringify(bundle, null, 2) + "\n";
}

function parseDataBundle(raw) {
  let document;
  try {
    document = JSON.parse(String(raw));
  } catch (error) {
    throw new Error("Bundle is not valid JSON.");
  }
  if (!document || document.schema !== "trireme.bundle/1") {
    throw new Error("Bundle must have schema 'trireme.bundle/1'.");
  }
  try {
    return buildDataBundle(
      document.chart && document.chart.chart,
      document.chart && document.chart.from,
      document.chart && document.chart.to,
      document.presets,
      document.history
    );
  } catch (error) {
    throw new Error("Bundle contains an invalid chart, endpoints, presets or history.");
  }
}

function bundleFilename() {
  return "trireme-bundle.json";
}

function bundleImportSummary(bundle) {
  if (!bundle || bundle.schema !== "trireme.bundle/1") {
    throw new Error("Only a trireme.bundle/1 document can be imported.");
  }
  return (
    "Bundle: chart " +
    String(bundle.chart.chart).length +
    " chars, " +
    (Array.isArray(bundle.presets) ? bundle.presets.length : 0) +
    " presets, " +
    (Array.isArray(bundle.history) ? bundle.history.length : 0) +
    " plans"
  );
}

function bundleApplyPreview(bundle, currentPresets, currentHistory) {
  if (!bundle || bundle.schema !== "trireme.bundle/1") {
    throw new Error("Only a trireme.bundle/1 document can be previewed.");
  }
  const presets = Array.isArray(bundle.presets) ? bundle.presets : [];
  const plans = Array.isArray(bundle.history) ? bundle.history : [];
  return {
    from: bundle.chart.from,
    to: bundle.chart.to,
    chartChars: String(bundle.chart.chart).length,
    presetsIn: presets.length,
    historyIn: plans.length,
    presetsKept: mergePresetFiles(currentPresets, presets).length,
    historyKept: mergeHistory(currentHistory, plans).length,
  };
}

function formatBundlePreview(preview) {
  if (!preview) {
    throw new Error("No bundle preview to format.");
  }
  return [
    "Chart: " + preview.chartChars + " chars, " + preview.from + " -> " + preview.to,
    "Presets: " + preview.presetsIn + " incoming, " + preview.presetsKept + " kept after merge",
    "History: " + preview.historyIn + " incoming, " + preview.historyKept + " kept after merge",
  ].join("\n");
}

function defaultEditorState(presets) {
  const source = presets && typeof presets === "object" ? presets : PRESETS;
  const chosen = source.aegean || source[Object.keys(source)[0]];
  if (!chosen) {
    throw new Error("No default preset available.");
  }
  return {
    chart: validateChartText(chosen.chart),
    from: String(chosen.from),
    to: String(chosen.to),
  };
}

function renameLocalPreset(presets, fromName, toName) {
  const from = normalizePresetName(fromName);
  const to = normalizePresetName(toName);
  if (!Array.isArray(presets)) {
    throw new Error("No presets to rename.");
  }
  if (!presets.some((item) => item && normalizePresetName(item.name) === from)) {
    throw new Error("Preset '" + from + "' not found.");
  }
  if (from !== to && presets.some((item) => item && normalizePresetName(item.name) === to)) {
    throw new Error("Preset '" + to + "' already exists.");
  }
  return presets
    .map((item) =>
      item && normalizePresetName(item.name) === from
        ? { ...item, name: to }
        : item
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

function duplicateLocalPreset(presets, name, newName) {
  const sourceName = normalizePresetName(name);
  const copyName = normalizePresetName(newName);
  if (!Array.isArray(presets)) {
    throw new Error("No presets to duplicate.");
  }
  const source = presets.find(
    (item) => item && normalizePresetName(item.name) === sourceName
  );
  if (!source) {
    throw new Error("Preset '" + sourceName + "' not found.");
  }
  if (presets.some((item) => item && normalizePresetName(item.name) === copyName)) {
    throw new Error("Preset '" + copyName + "' already exists.");
  }
  return [...presets, { ...source, name: copyName }].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

function historyToCsv(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("No route history to export as CSV.");
  }
  const asText = (point) =>
    Array.isArray(point) ? point.join(",") : String(point || "");
  const lines = ["at,from,to,time,steps,heading,note,chart"];
  for (const entry of entries) {
    if (!entry || typeof entry.at !== "number") {
      continue;
    }
    lines.push(
      [
        entry.at,
        asText(entry.from),
        asText(entry.to),
        typeof entry.time === "number" ? entry.time : "",
        typeof entry.steps === "number"
          ? entry.steps
          : Array.isArray(entry.steps)
            ? entry.steps.length
            : "",
        String(entry.heading || ""),
        String(entry.note || ""),
        typeof entry.chart === "string" ? entry.chart : "",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\n") + "\n";
}

function historyCsvFilename() {
  return HISTORY_KEY + ".csv";
}

// Tooling/test-only fallback; the browser panel uses Rust counts from
// POST /api/stats so the CLI and UI report the same numbers.
function chartStats(text) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const stats = { width: 0, height: 0, cells: 0, land: 0, currents: 0, wind: [0, 0] };
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts[0] === "grid" && parts.length === 3) {
      const width = Number(parts[1]);
      const height = Number(parts[2]);
      if (Number.isInteger(width) && Number.isInteger(height) && width >= 0 && height >= 0) {
        stats.width = width;
        stats.height = height;
        stats.cells = width * height;
      }
    } else if (parts[0] === "wind" && parts.length === 3) {
      const dx = Number(parts[1]);
      const dy = Number(parts[2]);
      if (Number.isInteger(dx) && Number.isInteger(dy)) {
        stats.wind = [dx, dy];
      }
    } else if (parts[0] === "land") {
      stats.land += 1;
    } else if (parts[0] === "current") {
      stats.currents += 1;
    }
  }
  return stats;
}

function statsRequestBody(text) {
  return JSON.stringify({ chart: String(text || "") });
}

function parseStatsResponse(result) {
  if (!result || !result.ok || typeof result.cells !== "number") {
    throw new Error(
      result && result.error ? result.error : "Could not derive chart statistics."
    );
  }
  return {
    width: result.width,
    height: result.height,
    cells: result.cells,
    land: result.land,
    currents: result.currents,
    wind: Array.isArray(result.wind) ? result.wind : [0, 0],
  };
}

function formatChartStats(stats) {
  if (!stats) {
    throw new Error("No chart statistics to format.");
  }
  return (
    stats.width +
    "x" +
    stats.height +
    " grid \u00b7 " +
    stats.cells +
    " cells \u00b7 " +
    stats.land +
    " land \u00b7 " +
    stats.currents +
    " currents \u00b7 wind (" +
    stats.wind[0] +
    "," +
    stats.wind[1] +
    ")"
  );
}

// Tooling/test-only fallback; the preset diff panel uses Rust via /api/chart-diff.
function diffCharts(leftText, rightText) {
  const lines = (text) => {
    const all = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    if (all.length && all[all.length - 1] === "") {
      all.pop();
    }
    return all;
  };
  const left = lines(leftText);
  const right = lines(rightText);
  const rows = [];
  const total = Math.max(left.length, right.length);
  const counts = { added: 0, removed: 0, changed: 0 };
  for (let index = 0; index < total; index += 1) {
    const before = left[index];
    const after = right[index];
    if (before === after) {
      continue;
    }
    if (before === undefined) {
      rows.push({ line: index + 1, kind: "added", left: "", right: after });
      counts.added += 1;
    } else if (after === undefined) {
      rows.push({ line: index + 1, kind: "removed", left: before, right: "" });
      counts.removed += 1;
    } else {
      rows.push({ line: index + 1, kind: "changed", left: before, right: after });
      counts.changed += 1;
    }
  }
  return { rows, ...counts };
}

function chartDiffRequestBody(left, right) {
  return JSON.stringify({ left: String(left || ""), right: String(right || "") });
}

function parseChartDiffResponse(result) {
  if (!result || !result.ok || !Array.isArray(result.rows)) {
    throw new Error(result && result.error ? result.error : "Could not diff these charts.");
  }
  return result.rows
    .filter((row) => row && typeof row.line === "number" && typeof row.kind === "string")
    .map((row) => ({
      line: row.line,
      kind: row.kind,
      left: String(row.left || ""),
      right: String(row.right || ""),
    }));
}

function chartDiffFromRows(rows) {
  return {
    rows,
    changed: rows.filter((row) => row.kind === "changed").length,
    added: rows.filter((row) => row.kind === "added").length,
    removed: rows.filter((row) => row.kind === "removed").length,
  };
}

function formatChartDiff(diff) {
  if (!diff || !Array.isArray(diff.rows)) {
    throw new Error("No chart diff to format.");
  }
  const lines = [
    "Chart diff: " +
      diff.changed +
      " changed, " +
      diff.added +
      " added, " +
      diff.removed +
      " removed",
  ];
  for (const row of diff.rows) {
    if (row.kind === "changed") {
      lines.push(row.line + " - " + row.left);
      lines.push(row.line + " + " + row.right);
    } else if (row.kind === "added") {
      lines.push(row.line + " + " + row.right);
    } else {
      lines.push(row.line + " - " + row.left);
    }
  }
  return lines.join("\n");
}

function formatDiffForClipboard(diff, leftName, rightName) {
  if (!diff || !Array.isArray(diff.rows)) {
    throw new Error("No chart diff to copy.");
  }
  return (
    "Trireme chart diff: " +
    String(leftName || "left") +
    " -> " +
    String(rightName || "right") +
    "\n" +
    formatChartDiff(diff) +
    "\n"
  );
}

// Tooling/test-only fallback; the diff panel now uses POST /api/chart-diff.
function diffAgainstPreset(currentText, preset) {
  if (!preset || typeof preset.chart !== "string") {
    throw new Error("No saved preset to compare against.");
  }
  return {
    diff: diffCharts(currentText, preset.chart),
    label: "Current chart -> " + preset.name,
  };
}

function validatePresetLibrary(presets) {
  const list = Array.isArray(presets) ? presets : [];
  const invalid = [];
  for (const item of list) {
    try {
      normalizePresetName(item && item.name);
      validateChartText(item && item.chart);
      point(item && item.from);
      point(item && item.to);
    } catch (error) {
      invalid.push({
        name: item && item.name ? String(item.name) : "(unnamed)",
        reason: error.message,
      });
    }
  }
  return { total: list.length, valid: list.length - invalid.length, invalid };
}

function formatPresetValidation(report) {
  if (!report || typeof report.total !== "number") {
    throw new Error("No preset validation report to format.");
  }
  const lines = ["Presets: " + report.valid + " valid of " + report.total];
  for (const item of report.invalid) {
    lines.push("- " + item.name + ": " + item.reason);
  }
  return lines.join("\n");
}

function swapEndpoints(from, to) {
  const a = point(from);
  const b = point(to);
  return {
    from: b.join(","),
    to: a.join(","),
  };
}

function formatChartForClipboard(text, from, to) {
  const clean = validateChartText(text);
  const start = point(from);
  const goal = point(to);
  return (
    "# Trireme chart from (" +
    start.join(",") +
    ") to (" +
    goal.join(",") +
    ")\n" +
    (clean.endsWith("\n") ? clean : clean + "\n")
  );
}

function historySummary(entries) {
  const list = Array.isArray(entries)
    ? entries.filter((item) => item && typeof item.time === "number")
    : [];
  if (list.length === 0) {
    return {
      count: 0,
      totalSteps: 0,
      uniqueCharts: 0,
      fastest: null,
      slowest: null,
      average: null,
      oldest: null,
      newest: null,
    };
  }
  const times = list.map((item) => item.time);
  const stamps = list
    .map((item) => item.at)
    .filter((value) => typeof value === "number");
  return {
    count: list.length,
    totalSteps: list.reduce(
      (sum, item) => sum + (typeof item.steps === "number" ? item.steps : 0),
      0
    ),
    uniqueCharts: new Set(list.map((item) => item.chart || "")).size,
    fastest: Math.min(...times),
    slowest: Math.max(...times),
    average: Math.round(times.reduce((a, b) => a + b, 0) / list.length),
    oldest: stamps.length ? Math.min(...stamps) : null,
    newest: stamps.length ? Math.max(...stamps) : null,
  };
}

function formatHistorySummary(summary) {
  if (!summary || typeof summary.count !== "number") {
    throw new Error("No history summary to format.");
  }
  if (summary.count === 0) {
    return "No saved plans yet.";
  }
  const date = (value) =>
    value === null ? "\u2014" : new Date(value).toISOString();
  return [
    "Plans: " + summary.count + " \u00b7 total steps: " + summary.totalSteps +
      " \u00b7 unique charts: " + summary.uniqueCharts,
    "Time: fastest " + summary.fastest + ", slowest " + summary.slowest +
      ", average " + summary.average + " units",
    "Range: " + date(summary.oldest) + " \u2192 " + date(summary.newest),
  ].join("\n");
}

function formatHistorySummaryForClipboard(summary) {
  return "Trireme history summary\n" + formatHistorySummary(summary) + "\n";
}

function formatRouteCommand(chartFile, from, to) {
  const start = point(from);
  const goal = point(to);
  const file = String(chartFile || "").trim() || "chart.txt";
  const quoted = /[\s"']/.test(file) ? '"' + file.replace(/"/g, '\\"') + '"' : file;
  return (
    "cargo run -- route " +
    quoted +
    " --from " +
    start.join(",") +
    " --to " +
    goal.join(",") +
    " --ascii"
  );
}

function formatMapForClipboard(route, from, to) {
  if (!route || typeof route.ascii !== "string") {
    throw new Error("No route map to copy.");
  }
  const point = (value) => (Array.isArray(value) ? value.join(",") : String(value || "?"));
  return (
    "Trireme map " +
    point(from || route.from) +
    " -> " +
    point(to || route.to) +
    "\nS start \u00b7 G goal \u00b7 o route \u00b7 # land \u00b7 ~ water\n" +
    route.ascii +
    "\n"
  );
}

function formatRouteAsMarkdown(route) {
  if (!route || !Array.isArray(route.steps) || typeof route.time !== "number") {
    throw new Error("No route to format as Markdown.");
  }
  const point = (value) =>
    Array.isArray(value) ? "(" + value[0] + "," + value[1] + ")" : String(value || "?");
  const lines = [
    "## Trireme route " + point(route.from) + " \u2192 " + point(route.to),
    "",
    "| Metric | Value |",
    "| --- | --- |",
    "| Time | " + route.time + " units |",
    "| Steps | " + route.steps.length + " |",
    "| Explored | " + (typeof route.explored === "number" ? route.explored : "?") + " cells |",
    "",
    "### Headings",
    "",
    route.steps.length ? route.steps.join(" \u2192 ") : "(already there)",
    "",
    "### Step times",
    "",
    "| Step | Heading | Units |",
    "| --- | --- | --- |",
  ];
  const times = Array.isArray(route.step_times) ? route.step_times : [];
  if (route.steps.length === 0) {
    lines.push("| \u2014 | \u2014 | 0 |");
  } else {
    route.steps.forEach((step, index) => {
      lines.push(
        "| " + (index + 1) + " | " + step + " | " +
          (times[index] === undefined ? "?" : times[index]) + " |"
      );
    });
  }
  lines.push("", "### Map", "", "```text");
  for (const line of String(route.ascii || "").split("\n")) {
    lines.push(line);
  }
  lines.push("```", "");
  return lines.join("\n");
}

function formatChartStatsForClipboard(stats) {
  return "Trireme chart stats\n" + formatChartStats(stats) + "\n";
}

function formatPresetStatsForClipboard(preset) {
  if (!preset || typeof preset.chart !== "string" || typeof preset.name !== "string") {
    throw new Error("No saved preset to summarize.");
  }
  return (
    "Trireme preset: " +
    preset.name +
    "\n" +
    formatChartStats(chartStats(preset.chart)) +
    "\nFrom " +
    String(preset.from || "?") +
    " to " +
    String(preset.to || "?") +
    "\n"
  );
}

function removeLastHistoryEntry(entries, note) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(note || "No history entry to remove.");
  }
  return entries.slice(1);
}

function comparisonToJson(comparison) {
  if (!comparison || !comparison.withWind || !comparison.still) {
    throw new Error("No comparison to export as JSON.");
  }
  const wind = comparison.withWind;
  const calm = comparison.still;
  const source = comparison.query || wind;
  const scenario = (route) => ({
    time: typeof route.time === "number" ? route.time : null,
    steps: Array.isArray(route.steps) ? route.steps.length : 0,
    step_times: Array.isArray(route.step_times) ? route.step_times : [],
    explored: typeof route.explored === "number" ? route.explored : null,
  });
  return JSON.stringify(
    {
      schema: "trireme.comparison/1",
      from: source.from || wind.from,
      to: source.to || wind.to,
      saved: (typeof calm.time === "number" ? calm.time : 0) -
        (typeof wind.time === "number" ? wind.time : 0),
      wind: scenario(wind),
      calm: scenario(calm),
    },
    null,
    2
  ) + "\n";
}

function comparisonJsonFilename() {
  return "trireme-comparison.json";
}

function comparisonToMarkdown(comparison) {
  if (!comparison || !comparison.withWind || !comparison.still) {
    throw new Error("No comparison to format as Markdown.");
  }
  const wind = comparison.withWind;
  const calm = comparison.still;
  const source = comparison.query || wind;
  const point = (value) =>
    Array.isArray(value) ? "(" + value[0] + "," + value[1] + ")" : String(value || "?");
  const saved = (typeof calm.time === "number" ? calm.time : 0) -
    (typeof wind.time === "number" ? wind.time : 0);
  const percent = calm.time
    ? Math.round((Math.abs(saved) / calm.time) * 100)
    : 0;
  const verdict = saved === 0
    ? "No difference (" + wind.time + " units)."
    : saved > 0
      ? "Saving: " + saved + " units (" + percent + "% faster)."
      : "Cost: " + -saved + " units (" + percent + "% slower).";
  const row = (name, route) =>
    "| " + name + " | " + (typeof route.time === "number" ? route.time : "?") +
    " | " + (Array.isArray(route.steps) ? route.steps.length : "?") +
    " | " + (typeof route.explored === "number" ? route.explored : "?") + " |";
  return [
    "## Trireme comparison " + point(source.from) + " \u2192 " + point(source.to),
    "",
    "| Scenario | Time (units) | Steps | Explored |",
    "| --- | --- | --- | --- |",
    row("Wind", wind),
    row("Calm", calm),
    "",
    verdict,
    "",
  ].join("\n");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HISTORY_KEY,
    HISTORY_LIMIT,
    historyEntry,
    appendHistory,
    removeLastHistoryEntry,
    parseHistory,
    formatHistoryEntry,
    restoreEntry,
    historyToJson,
    historyJsonFilename,
    historyToCsv,
    historyCsvFilename,
    parseHistoryExport,
    mergeHistory,
    historyImportSummary,
    formatImportSummary,
    filterHistory,
    historyFilterSummary,
    historySummary,
    formatHistorySummary,
    formatHistorySummaryForClipboard,
    sortHistory,
    filterLocalPresets,
    presetFilterSummary,
    sortLocalPresets,
    HELP_SECTIONS,
    formatHelpText,
    LOCAL_PRESETS_KEY,
    LOCAL_PRESET_LIMIT,
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
    normalizePresetName,
    buildLocalPreset,
    parseLocalPresets,
    mergeLocalPresets,
    localPresetsToJson,
    presetFilename,
    parsePresetsExport,
    mergePresetFiles,
    removeLocalPreset,
    renameLocalPreset,
    duplicateLocalPreset,
    validatePresetLibrary,
    formatPresetValidation,
    PRESETS,
    point,
    swapEndpoints,
    applyPreset,
    defaultEditorState,
    chartFilename,
    validateChartText,
    chartIssues,
    formatChartIssues,
    issuesRequestBody,
    parseIssuesResponse,
    normalizeRequestBody,
    parseNormalizeResponse,
    fingerprintRequestBody,
    parseFingerprintResponse,
    formatFingerprintForClipboard,
    formatIssuesForClipboard,
    chartStats,
    formatChartStats,
    statsRequestBody,
    parseStatsResponse,
    formatChartStatsForClipboard,
    formatPresetStatsForClipboard,
    formatChartForClipboard,
    diffCharts,
    formatChartDiff,
    chartDiffRequestBody,
    parseChartDiffResponse,
    chartDiffFromRows,
    formatDiffForClipboard,
    diffAgainstPreset,
    calmChartText,
    calmRequestBody,
    parseCalmResponse,
    compareRequestBody,
    parseCompareResponse,
    compareSummary,
    csvCell,
    routeToCsv,
    routeCsvFilename,
    formatStepTimes,
    formatRouteSummary,
    formatRouteCommand,
    formatMapForClipboard,
    formatRouteAsMarkdown,
    comparisonToCsv,
    comparisonCsvFilename,
    comparisonToJson,
    comparisonJsonFilename,
    comparisonToMarkdown,
  };
}

if (typeof document !== "undefined") {
  const bundleFile = document.getElementById("bundle-file");
  const bundlePreview = document.getElementById("bundle-preview");
  const bundlePreviewText = document.getElementById("bundle-preview-text");
  const applyBundleButton = document.getElementById("apply-bundle");
  const cancelBundleButton = document.getElementById("cancel-bundle");
  const helpPanel = document.getElementById("help-panel");
  const helpText = document.getElementById("help-text");
  const chart = document.getElementById("chart");
  const from = document.getElementById("from");
  const to = document.getElementById("to");
  const preset = document.getElementById("preset");
  const presetName = document.getElementById("preset-name");
  const savePresetButton = document.getElementById("save-preset");
  const localPreset = document.getElementById("local-preset");
  const presetFilter = document.getElementById("preset-filter");
  const presetSort = document.getElementById("preset-sort");
  const diffLeft = document.getElementById("diff-left");
  const diffRight = document.getElementById("diff-right");
  const diffOutput = document.getElementById("diff-output");
  const comparePresetsButton = document.getElementById("compare-presets");
  const copyDiffButton = document.getElementById("copy-diff");
  const diffCurrentButton = document.getElementById("diff-current");
  const validatePresetsButton = document.getElementById("validate-presets");
  const presetValidationOutput = document.getElementById("preset-validation");
  const presetFilterStatus = document.getElementById("preset-filter-status");
  const presetsFile = document.getElementById("presets-file");
  const exportPresetsButton = document.getElementById("export-presets");
  const importPresetsButton = document.getElementById("import-presets");
  const deletePresetButton = document.getElementById("delete-preset");
  const renamePresetName = document.getElementById("rename-preset-name");
  const renamePresetButton = document.getElementById("rename-preset");
  const duplicatePresetName = document.getElementById("duplicate-preset-name");
  const duplicatePresetButton = document.getElementById("duplicate-preset");
  const file = document.getElementById("file");
  const swapEndpointsButton = document.getElementById("swap-endpoints");
  const copyChartButton = document.getElementById("copy-chart");
  const copyCommandButton = document.getElementById("copy-command");
  const copyMapButton = document.getElementById("copy-map");
  const copyMarkdownButton = document.getElementById("copy-markdown");
  const issuesPanel = document.getElementById("chart-issues");
  const copyIssuesButton = document.getElementById("copy-issues");
  const canonicalizeButton = document.getElementById("canonicalize");
  const copyFingerprintButton = document.getElementById("copy-fingerprint");
  const chartStatsOutput = document.getElementById("chart-stats");
  const copyStatsButton = document.getElementById("copy-stats");
  const copyPresetStatsButton = document.getElementById("copy-preset-stats");
  const status = document.getElementById("status");
  const time = document.getElementById("time");
  const stepsCount = document.getElementById("steps-count");
  const explored = document.getElementById("explored");
  const headings = document.getElementById("headings");
  const stepTimes = document.getElementById("step-times");
  const waypoints = document.getElementById("waypoints");
  const map = document.getElementById("map");
  const comparePanel = document.getElementById("compare-panel");
  const compareSummaryText = document.getElementById("compare-summary");
  const compareCurrent = document.getElementById("compare-current");
  const compareCalm = document.getElementById("compare-calm");
  const compareDelta = document.getElementById("compare-delta");
  const historyList = document.getElementById("history-list");
  const historySummaryOutput = document.getElementById("history-summary");
  const copyHistorySummaryButton = document.getElementById("copy-history-summary");
  const undoHistoryButton = document.getElementById("undo-history");
  const historyFilter = document.getElementById("history-filter");
  const historySort = document.getElementById("history-sort");
  const historyFilterStatus = document.getElementById("history-filter-status");
  const clearHistory = document.getElementById("clear-history");
  const historyFile = document.getElementById("history-file");
  const importPreview = document.getElementById("import-preview");
  const importPreviewText = document.getElementById("import-preview-text");
  const applyImport = document.getElementById("apply-import");
  const cancelImport = document.getElementById("cancel-import");
  let lastRoute = null;
  let lastComparison = null;
  let pendingImport = null;
  let resetArmed = false;
  let pendingBundle = null;
  let lastDiff = null;
  let lastDiffNames = ["", ""];
  let chartName = "chart.txt";

  function setState(message, kind) {
    status.textContent = message;
    status.className = "status " + kind;
  }

  async function renderIssues() {
    renderStats();
    const request = ++issuesRequest;
    try {
      const response = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: issuesRequestBody(chart.value),
      });
      const issues = parseIssuesResponse(await response.json());
      if (request === issuesRequest) {
        lastIssues = issues;
        issuesPanel.hidden = issues.length === 0;
        issuesPanel.textContent = formatChartIssues(issues);
      }
    } catch (error) {
      if (request === issuesRequest) {
        lastIssues = [];
        issuesPanel.hidden = false;
        issuesPanel.textContent = "Chart validation unavailable.";
      }
    }
  }

  function clearEditor() {
    const state = defaultEditorState();
    chart.value = state.chart;
    renderIssues();
    from.value = state.from;
    to.value = state.to;
    chartName = "chart.txt";
    reset();
    setState("Editor reset to the default chart.", "good");
  }

  function swapEditorEndpoints() {
    try {
      const swapped = swapEndpoints(from.value, to.value);
      from.value = swapped.from;
      to.value = swapped.to;
      reset();
      setState("Endpoints swapped.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  async function copyCurrentChart() {
    try {
      const text = formatChartForClipboard(chart.value, from.value, to.value);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("Chart copied to the clipboard.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  async function copyChartFingerprint() {
    try {
      const response = await fetch("/api/fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: fingerprintRequestBody(chart.value),
      });
      const value = parseFingerprintResponse(await response.json());
      const text = formatFingerprintForClipboard(value);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("Chart fingerprint copied to the clipboard.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  async function canonicalizeChart() {
    try {
      const response = await fetch("/api/normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: normalizeRequestBody(chart.value),
      });
      const canonical = parseNormalizeResponse(await response.json());
      chart.value = canonical;
      renderIssues();
      setState("Chart canonicalized from the Rust parser.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  async function copyChartIssues() {
    const text = formatIssuesForClipboard(lastIssues);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("Chart issues copied to the clipboard.", "good");
    } catch (error) {
      setState("Clipboard unavailable: " + error, "bad");
    }
  }

  async function copyChartStats() {
    const text = formatChartStatsForClipboard(chartStats(chart.value));
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("Chart statistics copied to the clipboard.", "good");
    } catch (error) {
      setState("Clipboard unavailable: " + error, "bad");
    }
  }

  function openHelp() {
    helpText.textContent = formatHelpText();
    helpPanel.hidden = false;
  }

  function closeHelp() {
    helpPanel.hidden = true;
  }

  async function copyDataBundle() {
    try {
      const bundle = buildDataBundle(
        chart.value,
        from.value,
        to.value,
        storedPresets(),
        parseHistory(localStorage.getItem(HISTORY_KEY))
      );
      const text = formatDataBundle(bundle);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("Copied " + bundleFilename() + " (" + bundle.presets.length + " presets, " + bundle.history.length + " plans).", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  async function importBundle() {
    const picked = bundleFile.files && bundleFile.files[0];
    if (!picked) {
      setState("Choose a trireme.bundle.json file first.", "bad");
      return;
    }
    try {
      const bundle = parseDataBundle(await picked.text());
      const preview = bundleApplyPreview(
        bundle,
        storedPresets(),
        parseHistory(localStorage.getItem(HISTORY_KEY))
      );
      pendingBundle = bundle;
      bundlePreviewText.textContent = formatBundlePreview(preview);
      bundlePreview.hidden = false;
      setState("Bundle validated; review the preview before applying.", "busy");
    } catch (error) {
      pendingBundle = null;
      bundlePreview.hidden = true;
      setState(String(error.message), "bad");
    }
  }

  function applyPendingBundle() {
    if (!pendingBundle) {
      setState("No bundle waiting to be applied.", "bad");
      return;
    }
    const bundle = pendingBundle;
    const summary = bundleImportSummary(bundle);
    chart.value = bundle.chart.chart;
    renderIssues();
    from.value = bundle.chart.from;
    to.value = bundle.chart.to;
    chartName = "imported-chart.txt";
    const presets = mergePresetFiles(storedPresets(), bundle.presets);
    localStorage.setItem(LOCAL_PRESETS_KEY, localPresetsToJson(presets));
    const history = mergeHistory(
      parseHistory(localStorage.getItem(HISTORY_KEY)),
      bundle.history
    );
    localStorage.setItem(HISTORY_KEY, historyToJson(history));
    pendingBundle = null;
    bundlePreview.hidden = true;
    bundleFile.value = "";
    renderLocalPresets();
    renderHistory();
    reset();
    setState(summary + "; " + presets.length + " presets and " + history.length + " plans kept.", "good");
  }

  function cancelPendingBundle() {
    pendingBundle = null;
    bundlePreview.hidden = true;
    bundleFile.value = "";
    setState("Bundle import cancelled.", "busy");
  }

  function handleResetLocal() {
    if (!resetArmed) {
      resetArmed = true;
      setState("Click Reset local data again to confirm.", "busy");
      return;
    }
    const keys = resetPlan();
    for (const key of keys) {
      localStorage.removeItem(key);
    }
    resetArmed = false;
    renderHistory();
    renderLocalPresets();
    reset();
    setState(formatResetSummary(keys), "good");
  }

  function storedPresets() {
    return parseLocalPresets(localStorage.getItem(LOCAL_PRESETS_KEY));
  }

  function renderLocalPresets() {
    const saved = storedPresets();
    const visible = sortLocalPresets(
      filterLocalPresets(saved, presetFilter.value),
      presetSort.value
    );
    presetFilterStatus.textContent = presetFilterSummary(visible.length, saved.length);
    localPreset.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = visible.length
      ? "Load a saved preset…"
      : saved.length
        ? "No presets match the filter"
        : "No saved presets";
    localPreset.appendChild(placeholder);
    for (const item of visible) {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = item.name;
      localPreset.appendChild(option);
    }
    if (visible.length && !visible.some((item) => item.name === localPreset.value)) {
      localPreset.value = "";
    }
    renderDiffSelects(saved);
  }

  function renderDiffSelects(saved) {
    const previous = [diffLeft.value, diffRight.value];
    for (const select of [diffLeft, diffRight]) {
      select.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = saved.length ? "Select a preset…" : "No saved presets";
      select.appendChild(placeholder);
      for (const item of saved) {
        const option = document.createElement("option");
        option.value = item.name;
        option.textContent = item.name;
        select.appendChild(option);
      }
    }
    if (previous[0] && saved.some((item) => item.name === previous[0])) {
      diffLeft.value = previous[0];
    }
    if (previous[1] && saved.some((item) => item.name === previous[1])) {
      diffRight.value = previous[1];
    }
  }

  async function fetchChartDiff(leftText, rightText) {
    const response = await fetch("/api/chart-diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: chartDiffRequestBody(leftText, rightText),
    });
    return chartDiffFromRows(parseChartDiffResponse(await response.json()));
  }

  async function compareSavedPresets() {
    const saved = storedPresets();
    const left = saved.find((item) => item.name === diffLeft.value);
    const right = saved.find((item) => item.name === diffRight.value);
    if (!left || !right) {
      setState("Choose two saved presets to compare.", "bad");
      return;
    }
    if (left.name === right.name) {
      diffOutput.textContent = "Select two different presets.";
      setState("Select two different presets.", "bad");
      return;
    }
    try {
      lastDiff = await fetchChartDiff(left.chart, right.chart);
      lastDiffNames = [left.name, right.name];
      diffOutput.textContent = formatChartDiff(lastDiff);
      setState("Compared '" + left.name + "' with '" + right.name + "'.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  function saveNamedPreset() {
    try {
      const item = buildLocalPreset(presetName.value, chart.value, from.value, to.value);
      const merged = mergeLocalPresets(storedPresets(), item);
      localStorage.setItem(LOCAL_PRESETS_KEY, localPresetsToJson(merged));
      presetName.value = "";
      localPreset.value = item.name;
      renderLocalPresets();
      localPreset.value = item.name;
      setState("Preset '" + item.name + "' saved locally.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  function exportPresets() {
    const presets = storedPresets();
    const blob = new Blob([localPresetsToJson(presets)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const name = presetFilename();
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    setState("Exported " + presets.length + " presets as " + name + ".", "good");
  }

  async function importPresets() {
    const picked = presetsFile.files && presetsFile.files[0];
    if (!picked) {
      setState("Choose a trireme.presets.json file first.", "bad");
      return;
    }
    try {
      const incoming = parsePresetsExport(await picked.text());
      const merged = mergePresetFiles(storedPresets(), incoming);
      localStorage.setItem(LOCAL_PRESETS_KEY, localPresetsToJson(merged));
      presetsFile.value = "";
      renderLocalPresets();
      setState("Imported " + incoming.length + " presets; " + merged.length + " kept.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  function deleteSelectedPreset() {
    const name = localPreset.value;
    if (!name) {
      setState("Select a saved preset to delete.", "bad");
      return;
    }
    const remaining = removeLocalPreset(storedPresets(), name);
    localStorage.setItem(LOCAL_PRESETS_KEY, localPresetsToJson(remaining));
    renderLocalPresets();
    setState("Preset '" + name + "' deleted.", "good");
  }

  function renameSelectedPreset() {
    const from = localPreset.value;
    if (!from) {
      setState("Select a saved preset to rename.", "bad");
      return;
    }
    try {
      const to = normalizePresetName(renamePresetName.value);
      const renamed = renameLocalPreset(storedPresets(), from, to);
      localStorage.setItem(LOCAL_PRESETS_KEY, localPresetsToJson(renamed));
      renamePresetName.value = "";
      renderLocalPresets();
      localPreset.value = to;
      setState("Preset '" + from + "' renamed to '" + to + "'.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  function duplicateSelectedPreset() {
    const from = localPreset.value;
    if (!from) {
      setState("Select a saved preset to duplicate.", "bad");
      return;
    }
    try {
      const to = normalizePresetName(duplicatePresetName.value);
      const copies = duplicateLocalPreset(storedPresets(), from, to);
      localStorage.setItem(LOCAL_PRESETS_KEY, localPresetsToJson(copies));
      duplicatePresetName.value = "";
      renderLocalPresets();
      localPreset.value = to;
      setState("Preset '" + from + "' copied to '" + to + "'.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  function applyLocalPreset() {
    const item = storedPresets().find((entry) => entry.name === localPreset.value);
    if (!item) {
      return;
    }
    chart.value = item.chart;
    renderIssues();
    from.value = item.from;
    to.value = item.to;
    chartName = "preset-" + item.name.replace(/\s+/g, "-") + ".txt";
    reset();
    setState("Preset '" + item.name + "' loaded.", "good");
  }

  let statsRequest = 0;
  let issuesRequest = 0;
  let lastIssues = [];

  async function renderStats() {
    const request = ++statsRequest;
    try {
      const response = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: statsRequestBody(chart.value),
      });
      const stats = parseStatsResponse(await response.json());
      if (request === statsRequest) {
        chartStatsOutput.textContent = formatChartStats(stats);
      }
    } catch (error) {
      if (request === statsRequest) {
        chartStatsOutput.textContent = "Statistics unavailable.";
      }
    }
  }

  async function diffCurrentAgainstPreset() {
    const preset = storedPresets().find((item) => item.name === diffRight.value);
    if (!preset) {
      setState("Select a saved preset to compare against.", "bad");
      return;
    }
    try {
      lastDiff = await fetchChartDiff(chart.value, preset.chart);
      lastDiffNames = ["Current chart", preset.name];
      diffOutput.textContent =
        "Current chart -> " + preset.name + "\n" + formatChartDiff(lastDiff);
      setState("Compared the editor chart with '" + preset.name + "'.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  function validateSavedPresets() {
    const report = validatePresetLibrary(storedPresets());
    presetValidationOutput.textContent = formatPresetValidation(report);
    setState(
      report.invalid.length
        ? "Found " + report.invalid.length + " invalid saved preset(s)."
        : "All " + report.total + " saved presets are valid.",
      report.invalid.length ? "bad" : "good"
    );
  }

  async function copyChartDiff() {
    if (!lastDiff) {
      setState("Compare two presets before copying their diff.", "bad");
      return;
    }
    const text = formatDiffForClipboard(lastDiff, lastDiffNames[0], lastDiffNames[1]);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("Chart diff copied to the clipboard.", "good");
    } catch (error) {
      setState("Clipboard unavailable: " + error, "bad");
    }
  }

  function renderHistory() {
    const entries = parseHistory(localStorage.getItem(HISTORY_KEY));
    historySummaryOutput.textContent = formatHistorySummary(historySummary(entries));
    const visible = sortHistory(
      filterHistory(entries, historyFilter.value),
      historySort.value
    );
    historyFilterStatus.textContent = historyFilterSummary(visible.length, entries.length);
    historyList.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No routes planned yet.";
      historyList.appendChild(empty);
      return;
    }
    if (visible.length === 0) {
      const none = document.createElement("li");
      none.textContent = "No history entries match this filter.";
      historyList.appendChild(none);
      return;
    }
    visible.forEach((entry) => {
      const row = document.createElement("li");
      const label = document.createElement("span");
      label.className = "history-text";
      label.textContent = formatHistoryEntry(entry);
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "restore secondary";
      restore.textContent = "Restore";
      restore.dataset.index = String(entries.indexOf(entry));
      row.appendChild(label);
      row.appendChild(restore);
      historyList.appendChild(row);
    });
  }

  function remember(query, route, note) {
    const entry = historyEntry(route, query, Date.now(), note);
    const updated = appendHistory(parseHistory(localStorage.getItem(HISTORY_KEY)), entry);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      renderHistory();
    } catch (error) {
      setState("History storage is full; this plan was not saved.", "bad");
    }
  }

  function restoreHistory(index) {
    const entries = parseHistory(localStorage.getItem(HISTORY_KEY));
    const entry = entries[index];
    try {
      const restored = restoreEntry(entry);
      chart.value = restored.chart;
      renderIssues();
      from.value = restored.from;
      to.value = restored.to;
      chartName = "restored-chart.txt";
      reset();
      setState("History entry restored into the editor.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  function undoLastHistoryEntry() {
    const entries = parseHistory(localStorage.getItem(HISTORY_KEY));
    try {
      const remaining = removeLastHistoryEntry(entries);
      localStorage.setItem(HISTORY_KEY, historyToJson(remaining));
      renderHistory();
      setState("Removed the newest history entry; " + remaining.length + " plans kept.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  function exportHistory() {
    const entries = parseHistory(localStorage.getItem(HISTORY_KEY));
    const name = historyJsonFilename();
    const blob = new Blob([historyToJson(entries)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    setState("History exported as " + name + " (" + entries.length + " entries).", "good");
  }

  async function copyPresetStats() {
    const preset = storedPresets().find((item) => item.name === localPreset.value);
    if (!preset) {
      setState("Select a saved preset before copying its stats.", "bad");
      return;
    }
    const text = formatPresetStatsForClipboard(preset);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("Preset statistics copied to the clipboard.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  async function copyHistorySummary() {
    const entries = parseHistory(localStorage.getItem(HISTORY_KEY));
    const text = formatHistorySummaryForClipboard(historySummary(entries));
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("History summary copied to the clipboard.", "good");
    } catch (error) {
      setState("Clipboard unavailable: " + error, "bad");
    }
  }

  function exportHistoryCsv() {
    const entries = sortHistory(
      filterHistory(
        parseHistory(localStorage.getItem(HISTORY_KEY)),
        historyFilter.value
      ),
      historySort.value
    );
    const blob = new Blob([historyToCsv(entries)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const name = historyCsvFilename();
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    setState("Exported " + entries.length + " plans as " + name + ".", "good");
  }

  async function importHistory() {
    const picked = historyFile.files && historyFile.files[0];
    if (!picked) {
      setState("Choose a trireme.history.json file first.", "bad");
      return;
    }
    try {
      const incoming = parseHistoryExport(await picked.text());
      const current = parseHistory(localStorage.getItem(HISTORY_KEY));
      pendingImport = incoming;
      const summary = historyImportSummary(incoming, current);
      importPreviewText.textContent = formatImportSummary(summary);
      importPreview.hidden = false;
      setState("Import parsed; review the preview before applying.", "busy");
    } catch (error) {
      pendingImport = null;
      importPreview.hidden = true;
      setState(String(error.message), "bad");
    }
  }

  function applyPendingImport() {
    if (!pendingImport) {
      setState("No import waiting to be applied.", "bad");
      return;
    }
    const current = parseHistory(localStorage.getItem(HISTORY_KEY));
    const merged = mergeHistory(current, pendingImport);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
    const count = pendingImport.length;
    pendingImport = null;
    importPreview.hidden = true;
    historyFile.value = "";
    renderHistory();
    setState("Imported " + count + " entries; " + merged.length + " kept.", "good");
  }

  function cancelPendingImport() {
    pendingImport = null;
    importPreview.hidden = true;
    historyFile.value = "";
    setState("Import cancelled.", "busy");
  }

  function show(route) {
    time.textContent = String(route.time) + " units";
    stepsCount.textContent = String(route.steps.length);
    explored.textContent = String(route.explored) + " cells";
    headings.textContent = route.steps.length ? route.steps.join(" ") : "(already there)";
    stepTimes.textContent = formatStepTimes(route);
    waypoints.textContent = route.waypoints
      .map((p) => "(" + p[0] + "," + p[1] + ")")
      .join(" -> ");
    map.textContent = route.ascii;
  }

  function reset() {
    time.textContent = "\u2014";
    stepsCount.textContent = "\u2014";
    explored.textContent = "\u2014";
    headings.textContent = "\u2014";
    stepTimes.textContent = "\u2014";
    waypoints.textContent = "\u2014";
    map.textContent = "\u2014";
    comparePanel.hidden = true;
    lastRoute = null;
    lastComparison = null;
  }

  function save() {
    try {
      point(from.value);
      point(to.value);
      localStorage.setItem("trireme.chart", chart.value);
      localStorage.setItem("trireme.from", from.value);
      localStorage.setItem("trireme.to", to.value);
      setState("Chart saved in this browser.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  function load() {
    const saved = localStorage.getItem("trireme.chart");
    if (saved === null) {
      setState("No saved chart in this browser.", "bad");
      return;
    }
    chart.value = saved;
    renderIssues();
    from.value = localStorage.getItem("trireme.from") || "0,0";
    to.value = localStorage.getItem("trireme.to") || "1,1";
    setState("Saved chart loaded.", "good");
    chartName = "chart.txt";
    reset();
  }

  async function importChart() {
    const picked = file.files && file.files[0];
    if (!picked) {
      setState("Choose a .txt chart file first.", "bad");
      return;
    }
    try {
      const text = validateChartText(await picked.text());
      chart.value = text;
      chartName = chartFilename(picked.name);
      renderIssues();
      file.value = "";
      setState("Imported " + chartName + ".", "good");
      reset();
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  function downloadChart() {
    try {
      validateChartText(chart.value);
    } catch (error) {
      setState(String(error.message), "bad");
      return;
    }
    const blob = new Blob([chart.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = chartName;
    link.click();
    URL.revokeObjectURL(url);
    setState("Chart downloaded as " + chartName + ".", "good");
  }

  function exportRoute() {
    if (lastRoute === null) {
      setState("Plan a route before exporting it.", "bad");
      return;
    }
    const blob = new Blob([JSON.stringify(lastRoute, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "trireme-route.json";
    link.click();
    URL.revokeObjectURL(url);
    setState("Route exported as trireme-route.json.", "good");
  }

  function exportCsv() {
    if (lastRoute === null) {
      setState("Plan a route before exporting it.", "bad");
      return;
    }
    let csv;
    try {
      csv = routeToCsv(lastRoute);
    } catch (error) {
      setState(String(error.message), "bad");
      return;
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = routeCsvFilename(chartName);
    link.click();
    URL.revokeObjectURL(url);
    setState("Route exported as " + link.download + ".", "good");
  }

  async function copySummary() {
    if (lastRoute === null) {
      setState("Plan a route before copying its summary.", "bad");
      return;
    }
    const text = formatRouteSummary(lastRoute);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("Route summary copied to the clipboard.", "good");
    } catch (error) {
      setState("Clipboard unavailable: " + error, "bad");
    }
  }

  async function copyRouteCommand() {
    try {
      const command = formatRouteCommand(chartName, from.value, to.value);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(command);
      } else {
        const area = document.createElement("textarea");
        area.value = command;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("CLI command copied to the clipboard.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  async function copyRouteMap() {
    if (lastRoute === null) {
      setState("Plan a route before copying its map.", "bad");
      return;
    }
    const text = formatMapForClipboard(lastRoute, lastRoute.from, lastRoute.to);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("Route map copied to the clipboard.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  async function copyRouteMarkdown() {
    if (lastRoute === null) {
      setState("Plan a route before copying Markdown.", "bad");
      return;
    }
    const text = formatRouteAsMarkdown(lastRoute);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("Route Markdown copied to the clipboard.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  async function copyComparisonMarkdown() {
    if (lastComparison === null) {
      setState("Run a comparison before copying Markdown.", "bad");
      return;
    }
    const text = comparisonToMarkdown(lastComparison);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setState("Comparison Markdown copied to the clipboard.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
  }

  function exportComparisonJson() {
    if (lastComparison === null) {
      setState("Run a comparison before exporting it.", "bad");
      return;
    }
    const blob = new Blob([comparisonToJson(lastComparison)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const name = comparisonJsonFilename();
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    setState("Comparison exported as " + name + ".", "good");
  }

  function exportComparisonCsv() {
    if (lastComparison === null) {
      setState("Run a comparison before exporting it.", "bad");
      return;
    }
    const blob = new Blob([comparisonToCsv(lastComparison)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const name = comparisonCsvFilename();
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    setState("Comparison exported as " + name + ".", "good");
  }

  async function ask(query) {
    const response = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
    return response.json();
  }

  function currentQuery() {
    validateChartText(chart.value);
    return { chart: chart.value, from: point(from.value), to: point(to.value) };
  }

  async function plan() {
    setState("Planning\u2026", "busy");
    reset();
    let query;
    try {
      query = currentQuery();
    } catch (error) {
      setState(String(error.message), "bad");
      return;
    }
    try {
      const result = await ask(query);
      if (result.ok) {
        lastRoute = result;
        comparePanel.hidden = true;
        remember(query, result);
        setState("Route found.", "good");
        show(result);
      } else {
        setState(result.error || "No route found.", "bad");
      }
    } catch (error) {
      setState("Could not reach the planner: " + error, "bad");
    }
  }

  async function compare() {
    setState("Comparing\u2026", "busy");
    let query;
    try {
      query = currentQuery();
    } catch (error) {
      setState(String(error.message), "bad");
      return;
    }
    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: compareRequestBody(query.chart, query.from, query.to),
      });
      const result = parseCompareResponse(await response.json());
      const wind = result.wind;
      comparePanel.hidden = false;
      compareSummaryText.textContent = compareSummary(wind, result.calm);
      compareCurrent.textContent = wind.time + " units";
      compareCalm.textContent = result.calm.time + " units";
      const saved = result.saved;
      compareDelta.textContent =
        (saved > 0 ? "-" : saved < 0 ? "+" : "") + Math.abs(saved) + " units";
      lastRoute = wind;
      lastComparison = { withWind: wind, still: result.calm, query };
      remember(query, wind, "calm water compared");
      show(wind);
      setState("Compared the chart with calm water.", "good");
    } catch (error) {
      comparePanel.hidden = true;
      setState(String(error.message), "bad");
    }
  }

  document.getElementById("plan").addEventListener("click", plan);
  document.getElementById("clear-editor").addEventListener("click", clearEditor);
  swapEndpointsButton.addEventListener("click", swapEditorEndpoints);
  copyChartButton.addEventListener("click", copyCurrentChart);
  copyStatsButton.addEventListener("click", copyChartStats);
  copyIssuesButton.addEventListener("click", copyChartIssues);
  canonicalizeButton.addEventListener("click", canonicalizeChart);
  copyFingerprintButton.addEventListener("click", copyChartFingerprint);
  copyPresetStatsButton.addEventListener("click", copyPresetStats);
  document.getElementById("save").addEventListener("click", save);
  document.getElementById("load").addEventListener("click", load);
  document.getElementById("import").addEventListener("click", importChart);
  document.getElementById("download").addEventListener("click", downloadChart);
  document.getElementById("export").addEventListener("click", exportRoute);
  document.getElementById("export-csv").addEventListener("click", exportCsv);
  document.getElementById("copy-summary").addEventListener("click", copySummary);
  copyCommandButton.addEventListener("click", copyRouteCommand);
  copyMapButton.addEventListener("click", copyRouteMap);
  copyMarkdownButton.addEventListener("click", copyRouteMarkdown);
  document.getElementById("compare").addEventListener("click", compare);
  document.getElementById("export-compare-csv").addEventListener("click", exportComparisonCsv);
  document.getElementById("export-compare-json").addEventListener("click", exportComparisonJson);
  document.getElementById("copy-compare-md").addEventListener("click", copyComparisonMarkdown);
  clearHistory.addEventListener("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    setState("Route history cleared.", "good");
  });
  undoHistoryButton.addEventListener("click", undoLastHistoryEntry);
  document.getElementById("export-history").addEventListener("click", exportHistory);
  document.getElementById("export-history-csv").addEventListener("click", exportHistoryCsv);
  copyHistorySummaryButton.addEventListener("click", copyHistorySummary);
  document.getElementById("import-history").addEventListener("click", () => historyFile.click());
  historyFile.addEventListener("change", importHistory);
  applyImport.addEventListener("click", applyPendingImport);
  cancelImport.addEventListener("click", cancelPendingImport);
  historyList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-index]");
    if (button) {
      restoreHistory(Number(button.dataset.index));
    }
  });
  renderHistory();
  renderLocalPresets();
  presetFilter.addEventListener("input", renderLocalPresets);
  presetSort.addEventListener("change", renderLocalPresets);
  savePresetButton.addEventListener("click", saveNamedPreset);
  localPreset.addEventListener("change", applyLocalPreset);
  exportPresetsButton.addEventListener("click", exportPresets);
  importPresetsButton.addEventListener("click", () => presetsFile.click());
  presetsFile.addEventListener("change", importPresets);
  deletePresetButton.addEventListener("click", deleteSelectedPreset);
  renamePresetButton.addEventListener("click", renameSelectedPreset);
  duplicatePresetButton.addEventListener("click", duplicateSelectedPreset);
  comparePresetsButton.addEventListener("click", compareSavedPresets);
  copyDiffButton.addEventListener("click", copyChartDiff);
  diffCurrentButton.addEventListener("click", diffCurrentAgainstPreset);
  validatePresetsButton.addEventListener("click", validateSavedPresets);
  historyFilter.addEventListener("input", renderHistory);
  historySort.addEventListener("change", renderHistory);
  renderIssues();
  chart.addEventListener("input", renderIssues);
  preset.addEventListener("change", () => {
    const selection = applyPreset(preset.value);
    chart.value = selection.chart;
    renderIssues();
    from.value = selection.from;
    to.value = selection.to;
    chartName = "chart-" + preset.value + ".txt";
    setState("Preset loaded.", "busy");
    reset();
  });
  document.getElementById("open-help").addEventListener("click", openHelp);
  document.getElementById("close-help").addEventListener("click", closeHelp);
  document.getElementById("reset-local").addEventListener("click", handleResetLocal);
  document.getElementById("copy-bundle").addEventListener("click", copyDataBundle);
  document.getElementById("import-bundle").addEventListener("click", () => bundleFile.click());
  bundleFile.addEventListener("change", importBundle);
  applyBundleButton.addEventListener("click", applyPendingBundle);
  cancelBundleButton.addEventListener("click", cancelPendingBundle);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !helpPanel.hidden) {
      closeHelp();
    } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      compare();
    } else if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      plan();
    }
  });
}
