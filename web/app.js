"use strict";

const chart = document.getElementById("chart");
const from = document.getElementById("from");
const to = document.getElementById("to");
const status = document.getElementById("status");
const time = document.getElementById("time");
const stepsCount = document.getElementById("steps-count");
const explored = document.getElementById("explored");
const headings = document.getElementById("headings");
const waypoints = document.getElementById("waypoints");
const map = document.getElementById("map");

function show(route) {
  time.textContent = String(route.time) + " units";
  stepsCount.textContent = String(route.steps.length);
  explored.textContent = String(route.explored) + " cells";
  headings.textContent = route.steps.length ? route.steps.join(" ") : "(already there)";
  waypoints.textContent = route.waypoints
    .map((point) => "(" + point[0] + "," + point[1] + ")")
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
}

function point(value) {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error("Enter each endpoint as X,Y with non-negative integers.");
  }
  return parts;
}

async function plan() {
  status.textContent = "Planning\u2026";
  status.className = "status busy";
  reset();
  try {
    const response = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chart: chart.value, from: point(from.value), to: point(to.value) }),
    });
    const result = await response.json();
    if (result.ok) {
      status.textContent = "Route found.";
      status.className = "status good";
      show(result);
    } else {
      status.textContent = result.error || "No route found.";
      status.className = "status bad";
    }
  } catch (error) {
    status.textContent = "Could not reach the planner: " + error;
    status.className = "status bad";
  }
}

document.getElementById("plan").addEventListener("click", plan);
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    plan();
  }
});
