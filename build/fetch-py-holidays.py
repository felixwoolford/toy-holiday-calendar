#!/usr/bin/env python3
"""Build-time helper: bank holidays for the 21 countries that nager.at
doesn't cover, from the Python `holidays` package (free, MIT, keyless).

The package is asked for English names (language='en_US'). Moon-dependent
dates carry an "(estimated)" marker, which becomes the `approx` flag (the
app shows a "±1 day" badge for those).

Prints JSON to stdout:
  { "AF": [ { "date": "2024-04-19", "name": "Liberation Day", "approx": false }, ... ], ... }
"""
import json
import re
import sys

import holidays

YEARS = [2024, 2025, 2026, 2027]

CLASSES = {
    "AF": "Afghanistan", "BT": "Bhutan", "IN": "India", "JO": "Jordan",
    "KW": "Kuwait", "KG": "Kyrgyzstan", "LA": "Laos", "LB": "Lebanon",
    "MM": "Myanmar", "NP": "Nepal", "KP": "NorthKorea", "OM": "Oman",
    "PS": "Palestine", "QA": "Qatar", "SA": "SaudiArabia", "LK": "SriLanka",
    "TJ": "Tajikistan", "TH": "Thailand", "TL": "TimorLeste",
    "TM": "Turkmenistan", "MY": "Malaysia",
}

TAIL = re.compile(r"\s*\(([^)]*)\)$")


def clean(name):
    """Split combined names ('A; B'), strip the estimated marker, flag approx."""
    parts = []
    for part in name.split(";"):
        part = part.strip()
        if not part:
            continue
        approx = False
        m = TAIL.search(part)
        if m and "estimated" in m.group(1):
            approx = True
            rest = m.group(1).replace("estimated", "").strip(" ,")
            part = part[: m.start()] + (f" ({rest})" if rest else "")
        parts.append((part, approx))
    return parts


out = {}
for code, cls in CLASSES.items():
    cal = getattr(holidays, cls)(years=YEARS, expand=False, language="en_US")
    entries = {}
    for d, name in cal.items():
        for part, approx in clean(str(name)):
            key = (str(d)[:10], part)
            if key not in entries or approx:
                entries[key] = {"date": str(d)[:10], "name": part, "approx": approx}
    rows = sorted(entries.values(), key=lambda e: (e["date"], e["name"]))
    if len(rows) < 20:
        print(f"ERROR: {code} ({cls}) has only {len(rows)} holidays — check the package",
              file=sys.stderr)
        sys.exit(1)
    out[code] = rows

json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
print()
