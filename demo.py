#!/usr/bin/env python3
"""Headless scripted drive: deterministic WORLD-DELTA lines, no input, exits 0.

It mirrors Trireme's integer-cost routing over a seeded, in-memory chart so the
same seed always yields the same step count, time and explored-cell count.
"""
import heapq
import sys

MOVES = (
    ("N", 0, -1, 10), ("NE", 1, -1, 14), ("E", 1, 0, 10), ("SE", 1, 1, 14),
    ("S", 0, 1, 10), ("SW", -1, 1, 14), ("W", -1, 0, 10), ("NW", -1, -1, 14),
)


def _parse_seed(argv):
    if "--seed" in argv:
        index = argv.index("--seed")
        try:
            return int(argv[index + 1])
        except (IndexError, ValueError):
            print("Usage: python demo.py --scripted [--seed N]")
            sys.exit(2)
    return 0


def _chart(seed):
    width = 6 + (seed % 3)
    height = 5
    land = {(min(2 + seed % 2, width - 1), 2), (min(3, width - 1), 1)}
    wind = (1, 0)
    return width, height, land, wind


def _route(seed):
    width, height, land, wind = _chart(seed)
    start, goal = (0, height - 1), (width - 1, 0)
    best = {start: 0}
    queue = [(0, start[0], start[1])]
    explored = 0
    while queue:
        time, x, y = heapq.heappop(queue)
        if best.get((x, y)) != time:
            continue
        if (x, y) == goal:
            return time, explored
        explored += 1
        for _name, dx, dy, distance in MOVES:
            nx, ny = x + dx, y + dy
            if not (0 <= nx < width and 0 <= ny < height) or (nx, ny) in land:
                continue
            push = wind[0] * dx + wind[1] * dy
            speed = max(1, 10 + 2 * push)
            cost = time + distance * 100 // speed
            if cost < best.get((nx, ny), 10**18):
                best[(nx, ny)] = cost
                heapq.heappush(queue, (cost, nx, ny))
    return None, explored


if __name__ == "__main__":
    if "--scripted" not in sys.argv:
        print("Usage: python demo.py --scripted [--seed N]")
        sys.exit(2)
    seed = _parse_seed(sys.argv)
    width, height, land, _wind = _chart(seed)
    time, explored = _route(seed)
    print(f"SEED: {seed}")
    print(f"WORLD-DELTA: grid=0->{width}x{height}")
    print(f"WORLD-DELTA: land=0->{len(land)}")
    print(f"WORLD-DELTA: time=0->{time}")
    print(f"WORLD-DELTA: explored=0->{explored}")
    print("OK: scripted drive complete")
