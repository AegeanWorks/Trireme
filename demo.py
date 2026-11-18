#!/usr/bin/env python3
"""Headless scripted drive: deterministic WORLD-DELTA lines, no input, exits 0.

It mirrors Trireme's manifest step over a seeded, in-memory tree so the same
seed always yields the same file count, byte count and SHA-256 digest.
"""
import hashlib
import sys


def _parse_seed(argv):
    if "--seed" in argv:
        index = argv.index("--seed")
        try:
            return int(argv[index + 1])
        except (IndexError, ValueError):
            print("Usage: python demo.py --scripted [--seed N]")
            sys.exit(2)
    return 0


def _snapshot(seed):
    count = 3 + (seed % 5)
    names = [f"file-{index:02d}.txt" for index in range(count)]
    canonical = "".join(
        f"{name}\0{seed + index}\n" for index, name in enumerate(names)
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    total = sum(len(f"value-{seed + index}") for index in range(count))
    return names, total, digest


if __name__ == "__main__":
    if "--scripted" not in sys.argv:
        print("Usage: python demo.py --scripted [--seed N]")
        sys.exit(2)
    seed = _parse_seed(sys.argv)
    names, total, digest = _snapshot(seed)
    print(f"SEED: {seed}")
    print(f"WORLD-DELTA: files=0->{len(names)}")
    print(f"WORLD-DELTA: bytes=0->{total}")
    print(f"WORLD-DELTA: digest=none->{digest}")
    print("OK: scripted drive complete")
