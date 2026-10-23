#!/usr/bin/env python3
"""summary.py rss FILE... | keys FILE...  (see README.md)

rss   page and host resident memory: the mean of the first and the last sixth of the samples, the range, the slope.
keys  the probe's key -> paint samples: count, median, p95, max; and, for a cold-list run, the first 35 keys against the rest.
      For a first-j run it also splits the 100 `j` where the list ends: only the rows the page has mounted (about 20) are list
      moves, the next `j` steps into the message box, and the rest are caret moves in the empty box. The step into the box is
      taken to be the last key of 100 ms or more among the first 40 (it is a guess from the timings alone).
"""
import json
import statistics as st
import sys


def quantile(values, p):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(p * len(ordered)))]


def rss(path):
    rows = [line.split() for line in open(path) if line[:1].isdigit() and len(line.split()) == 3]
    t = [int(r[0]) for r in rows]
    page = [int(r[1]) / 1024 for r in rows]
    host = [int(r[2]) / 1024 for r in rows]
    k = max(1, len(rows) // 6)
    minutes = (t[-1] - t[0]) / 60
    slope = (st.mean(page[-k:]) - st.mean(page[:k])) / minutes if minutes else 0
    print(
        f"{path}: {len(rows)} samples, {minutes:.1f} min | page {st.mean(page[:k]):.0f} -> {st.mean(page[-k:]):.0f} MB "
        f"(min {min(page):.0f}, max {max(page):.0f}, {slope:+.2f} MB/min) | host {host[0]:.0f} -> {host[-1]:.0f} MB"
    )


def keys(path):
    data = json.load(open(path))
    samples = [ms for _, ms in data["samples"]]
    if not samples:
        print(f"{path}: no samples")
        return
    def line(label, values):
        return f"{label} n={len(values)} median {st.median(values):.0f} p95 {quantile(values, .95):.0f} max {max(values):.0f} ms"
    print(f"{path}: {line('all', samples)}")
    if "first-" in path and len(samples) > 40:
        print(f"    first 35: {line('', samples[:35])}\n    rest:     {line('', samples[35:])}")
    if "first-j" in path and len(samples) > 40:
        slow = [i for i, ms in enumerate(samples[:40]) if ms >= 100]
        if slow:
            step = slow[-1]
            print(
                f"    list moves: {line('', samples[:step])}\n"
                f"    step into the box: key {step + 1} = {samples[step]:.0f} ms\n"
                f"    box keys:   {line('', samples[step + 1:])}"
            )


if __name__ == "__main__":
    kind, files = sys.argv[1], sys.argv[2:]
    for f in files:
        {"rss": rss, "keys": keys}[kind](f)
