"use strict";

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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
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
  };
}

if (typeof document !== "undefined") {
  const chart = document.getElementById("chart");
  const from = document.getElementById("from");
  const to = document.getElementById("to");
  const preset = document.getElementById("preset");
  const file = document.getElementById("file");
  const issuesPanel = document.getElementById("chart-issues");
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
  const clearHistory = document.getElementById("clear-history");
  const historyFile = document.getElementById("history-file");
  let lastRoute = null;
  let chartName = "chart.txt";

  function setState(message, kind) {
    status.textContent = message;
    status.className = "status " + kind;
  }

  function renderIssues() {
    const issues = chartIssues(chart.value);
    issuesPanel.hidden = issues.length === 0;
    issuesPanel.textContent = formatChartIssues(issues);
    return issues.length;
  }

  function renderHistory() {
    const entries = parseHistory(localStorage.getItem(HISTORY_KEY));
    historyList.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No routes planned yet.";
      historyList.appendChild(empty);
      return;
    }
    entries.forEach((entry, index) => {
      const row = document.createElement("li");
      const label = document.createElement("span");
      label.className = "history-text";
      label.textContent = formatHistoryEntry(entry);
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "restore secondary";
      restore.textContent = "Restore";
      restore.dataset.index = String(index);
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

  async function importHistory() {
    const picked = historyFile.files && historyFile.files[0];
    if (!picked) {
      setState("Choose a trireme.history.json file first.", "bad");
      return;
    }
    try {
      const incoming = parseHistoryExport(await picked.text());
      const current = parseHistory(localStorage.getItem(HISTORY_KEY));
      const merged = mergeHistory(current, incoming);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
      historyFile.value = "";
      renderHistory();
      setState("Imported " + incoming.length + " entries; " + merged.length + " kept.", "good");
    } catch (error) {
      setState(String(error.message), "bad");
    }
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
      const calm = { ...query, chart: calmChartText(query.chart) };
      const [withWind, still] = await Promise.all([ask(query), ask(calm)]);
      if (!withWind.ok || !still.ok) {
        comparePanel.hidden = true;
        setState(withWind.error || still.error || "No route found.", "bad");
        return;
      }
      comparePanel.hidden = false;
      compareSummaryText.textContent = compareSummary(withWind, still);
      compareCurrent.textContent = withWind.time + " units";
      compareCalm.textContent = still.time + " units";
      const saved = still.time - withWind.time;
      compareDelta.textContent =
        (saved > 0 ? "-" : saved < 0 ? "+" : "") + Math.abs(saved) + " units";
      lastRoute = withWind;
      remember(query, withWind, "calm water compared");
      show(withWind);
      setState("Compared the chart with calm water.", "good");
    } catch (error) {
      setState("Could not reach the planner: " + error, "bad");
    }
  }

  document.getElementById("plan").addEventListener("click", plan);
  document.getElementById("save").addEventListener("click", save);
  document.getElementById("load").addEventListener("click", load);
  document.getElementById("import").addEventListener("click", importChart);
  document.getElementById("download").addEventListener("click", downloadChart);
  document.getElementById("export").addEventListener("click", exportRoute);
  document.getElementById("export-csv").addEventListener("click", exportCsv);
  document.getElementById("copy-summary").addEventListener("click", copySummary);
  document.getElementById("compare").addEventListener("click", compare);
  clearHistory.addEventListener("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    setState("Route history cleared.", "good");
  });
  document.getElementById("export-history").addEventListener("click", exportHistory);
  document.getElementById("import-history").addEventListener("click", () => historyFile.click());
  historyFile.addEventListener("change", importHistory);
  historyList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-index]");
    if (button) {
      restoreHistory(Number(button.dataset.index));
    }
  });
  renderHistory();
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
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      compare();
    } else if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      plan();
    }
  });
}
