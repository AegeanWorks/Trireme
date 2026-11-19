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

function validateChartText(text) {
  const normalized = String(text).replace(/\r\n?/g, "\n");
  if (normalized.length > 1000000) {
    throw new Error("Chart is too large; the browser limit is 1 MB.");
  }
  const lines = normalized.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("#");
  });
  if (lines[0] !== "TRIREME-CHART v1") {
    throw new Error("Chart must start with 'TRIREME-CHART v1' after any comments.");
  }
  if (!lines.some((line) => /^grid\s+\d+\s+\d+$/.test(line.trim()))) {
    throw new Error("Chart needs a 'grid <width> <height>' line.");
  }
  if (!lines.some((line) => /^wind\s+-?[01]\s+-?[01]$/.test(line.trim()))) {
    throw new Error("Chart needs a 'wind <dx> <dy>' line with components -1..1.");
  }
  return normalized;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PRESETS,
    point,
    applyPreset,
    chartFilename,
    validateChartText,
  };
}

if (typeof document !== "undefined") {
  const chart = document.getElementById("chart");
  const from = document.getElementById("from");
  const to = document.getElementById("to");
  const preset = document.getElementById("preset");
  const file = document.getElementById("file");
  const status = document.getElementById("status");
  const time = document.getElementById("time");
  const stepsCount = document.getElementById("steps-count");
  const explored = document.getElementById("explored");
  const headings = document.getElementById("headings");
  const waypoints = document.getElementById("waypoints");
  const map = document.getElementById("map");
  let lastRoute = null;
  let chartName = "chart.txt";

  function setState(message, kind) {
    status.textContent = message;
    status.className = "status " + kind;
  }

  function show(route) {
    time.textContent = String(route.time) + " units";
    stepsCount.textContent = String(route.steps.length);
    explored.textContent = String(route.explored) + " cells";
    headings.textContent = route.steps.length ? route.steps.join(" ") : "(already there)";
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
    waypoints.textContent = "\u2014";
    map.textContent = "\u2014";
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

  async function plan() {
    setState("Planning\u2026", "busy");
    reset();
    let query;
    try {
      query = { chart: chart.value, from: point(from.value), to: point(to.value) };
    } catch (error) {
      setState(String(error.message), "bad");
      return;
    }
    try {
      const response = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      const result = await response.json();
      if (result.ok) {
        lastRoute = result;
        setState("Route found.", "good");
        show(result);
      } else {
        setState(result.error || "No route found.", "bad");
      }
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
  preset.addEventListener("change", () => {
    const selection = applyPreset(preset.value);
    chart.value = selection.chart;
    from.value = selection.from;
    to.value = selection.to;
    chartName = "chart-" + preset.value + ".txt";
    setState("Preset loaded.", "busy");
    reset();
  });
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      plan();
    }
  });
}
