#!/usr/bin/env python3
"""Full-unit-test coverage inventory and gate for craft-workbench.

The inventory is derived from the tree on every run: every executable module
under ``web/`` (``app.js`` included) and every Node script under
``desktop/scripts/`` and ``scripts/`` must be named by a coverage include and
must reach 100% lines, branches and functions.

One ``node --test`` process runs the whole suite with ``NODE_V8_COVERAGE`` so
shared test state is exercised the way the project's own gate runs it. The raw
V8 ranges are then merged per file and inspected range by range: a line is
covered when its innermost range ran, and a branch is a non-root range that
never ran inside a range that did. That is what makes the failure output name
the exact line and branch instead of only a percentage.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Module:
    path: Path
    include: str


@dataclass(frozen=True)
class Range:
    start: int
    end: int
    count: int


@dataclass
class FunctionRange:
    start: int
    end: int
    count: int


@dataclass
class FileCoverage:
    ranges: list[Range] = field(default_factory=list)
    functions: list[FunctionRange] = field(default_factory=list)
    loaded: bool = False


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def read_source(path: Path) -> str:
    """Read source exactly as V8 saw it (no CRLF newline translation)."""
    return path.read_bytes().decode("utf8")


def discover_modules() -> list[Module]:
    modules = [Module(source, relative(source))
               for source in sorted((ROOT / "web").glob("*.js"))]
    for folder in ("desktop/scripts", "scripts"):
        modules += [Module(source, relative(source))
                    for source in sorted((ROOT / folder).glob("*.mjs"))]
    return modules


def discover_tests() -> list[Path]:
    return sorted((ROOT / "tests").glob("*.test.ts")) + sorted((ROOT / "tests").glob("*.test.mjs"))


def coverage_command(modules: list[Module], tests: list[Path]) -> list[str]:
    command = [
        "node", "--experimental-strip-types", "--test",
        "--test-isolation=none", "--test-concurrency=1",
        "--experimental-test-coverage",
        "--test-coverage-lines=100", "--test-coverage-functions=100",
        "--test-coverage-branches=100",
    ]
    command += [f"--test-coverage-include={module.include}" for module in modules]
    command += [relative(test) for test in tests]
    return command


def url_to_path(url: str) -> Path | None:
    parsed = urlparse(url)
    if parsed.scheme != "file":
        return None
    path = Path(unquote(parsed.path))
    if parsed.netloc and len(parsed.netloc) == 2:
        return Path(f"{parsed.netloc}:{parsed.path}")
    if parsed.netloc:
        return None
    # Windows file URLs arrive as file:///D:/... and keep the leading slash.
    if len(path.as_posix()) > 2 and path.as_posix()[0] == "/" and path.as_posix()[2] == ":":
        return Path(path.as_posix()[1:])
    return path


def collect_coverage(directory: Path, modules: list[Module]) -> dict[Path, FileCoverage]:
    files: dict[Path, FileCoverage] = {}
    merged: dict[Path, dict[tuple[int, int], int]] = {}
    merged_functions: dict[Path, dict[tuple[int, int], int]] = {}
    by_path = {module.path.resolve(): module for module in modules}
    for entry in sorted(directory.rglob("coverage-*.json")):
        data = json.loads(entry.read_text(encoding="utf8"))
        for script in data.get("result", []):
            path = url_to_path(script.get("url", ""))
            if path is None:
                continue
            path = path.resolve()
            if path not in by_path:
                continue
            files.setdefault(path, FileCoverage()).loaded = True
            ranges = merged.setdefault(path, {})
            functions = merged_functions.setdefault(path, {})
            for function in script.get("functions", []):
                for index, rng in enumerate(function.get("ranges", [])):
                    start = int(rng["startOffset"])
                    end = int(rng["endOffset"])
                    count = int(rng["count"])
                    key = (start, end)
                    ranges[key] = ranges.get(key, 0) + count
                    if index == 0:
                        functions[key] = functions.get(key, 0) + count
    for path, ranges in merged.items():
        current = files[path]
        current.ranges = [Range(start, end, count) for (start, end), count in ranges.items()]
        current.functions = [FunctionRange(start, end, count)
                             for (start, end), count in merged_functions[path].items()]
    return files


def line_starts(source: str) -> list[int]:
    starts = [0]
    for index, char in enumerate(source):
        if char == "\n":
            starts.append(index + 1)
    return starts


def line_at(starts: list[int], offset: int) -> int:
    low, high = 0, len(starts)
    position = max(0, min(offset, starts[-1]))
    while low < high:
        middle = (low + high) // 2
        if starts[middle] <= position:
            low = middle + 1
        else:
            high = middle
    return low


def innermost(ranges: list[Range], offset: int) -> Range | None:
    hits = [rng for rng in ranges if rng.start <= offset < rng.end]
    if not hits:
        return None
    return max(hits, key=lambda rng: (rng.start, -rng.end))


def uncovered_lines(source: str, ranges: list[Range]) -> list[int]:
    """Lines whose innermost V8 range never ran."""
    starts = line_starts(source)
    uncovered: list[int] = []
    for index, line in enumerate(source.splitlines(), start=1):
        if not line.strip():
            continue
        offset = starts[index - 1] + (len(line) - len(line.lstrip()))
        inner = innermost(ranges, offset)
        if inner is not None and inner.count == 0:
            uncovered.append(index)
    return uncovered


def format_lines(lines: list[int]) -> str:
    groups: list[str] = []
    start = previous = lines[0]
    for line in lines[1:]:
        if line == previous + 1:
            previous = line
            continue
        groups.append(str(start) if start == previous else f"{start}-{previous}")
        start = previous = line
    groups.append(str(start) if start == previous else f"{start}-{previous}")
    return ", ".join(groups)


def describe(module: Module, coverage: FileCoverage | None) -> list[str]:
    name = module.include
    if coverage is None or not coverage.loaded:
        return [f"{name}: never loaded by any suite; every line and branch is uncovered"]
    source = read_source(module.path)
    uncovered = uncovered_lines(source, coverage.ranges)
    problems: list[str] = []
    if uncovered:
        problems.append(f"{name}: uncovered lines {format_lines(uncovered)}")
    starts = line_starts(source)
    cold = [fn for fn in coverage.functions if fn.count == 0]
    if cold:
        lines = sorted({line_at(starts, fn.start) for fn in cold})
        problems.append(f"{name}: never-called functions at lines {format_lines(lines)}")
    return problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="only print the inventory")
    parser.add_argument("--keep-v8", action="store_true", help="keep raw V8 coverage JSON")
    args = parser.parse_args(argv)

    modules = discover_modules()
    tests = discover_tests()
    for module in modules:
        print(module.include)
    print(f"inventory: {len(modules)} source modules, {len(tests)} test files")
    if not modules or not tests:
        print("FAIL empty inventory", file=sys.stderr)
        return 1
    if args.list:
        return 0

    command = coverage_command(modules, tests)
    print("running: " + subprocess.list2cmdline(command), flush=True)
    directory = Path(tempfile.mkdtemp(prefix="craft-workbench-v8-"))
    environment = {key: value for key, value in os.environ.items()
                   if not key.upper().startswith("NODE_V8_COVERAGE")}
    environment["NODE_V8_COVERAGE"] = str(directory)
    try:
        result = subprocess.run(command, cwd=ROOT, env=environment, check=False)
        coverage = collect_coverage(directory, modules)
    finally:
        if args.keep_v8:
            target = ROOT / ".v8-coverage"
            shutil.rmtree(target, ignore_errors=True)
            shutil.copytree(directory, target)
            print(f"raw V8 coverage kept in {relative(target)}", file=sys.stderr)
        shutil.rmtree(directory, ignore_errors=True)

    failures: list[str] = []
    for module in modules:
        failures.extend(describe(module, coverage.get(module.path.resolve())))
    if result.returncode != 0:
        failures.insert(0, f"node coverage gate exited with {result.returncode}")
    if failures:
        for failure in failures:
            print(f"FAIL {failure}", file=sys.stderr)
        return 1
    print(f"coverage gate passed: {len(modules)} modules at 100% "
          f"lines, branches and functions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
