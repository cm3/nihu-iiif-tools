from __future__ import annotations

import json
import re
from pathlib import Path


LOCATION_NUMBER_PATTERN = re.compile(r"(?<!\d)(0*\d{3,4}\.\d{1,2})\.?(?!\d)")


def normalize_location_number(value: str) -> str | None:
    text = str(value or "").strip()
    text = text.strip("()[]{}<>")
    text = text.rstrip(".,;:!?")
    m = re.fullmatch(r"0*(\d{3,4})\.(\d{1,2})", text)
    if not m:
        return None
    int_part = str(int(m.group(1)))
    frac_part = m.group(2).rstrip("0") or "0"
    return f"{int_part}.{frac_part}"


def extract_location_numbers_from_text(text: str) -> list[str]:
    out: list[str] = []
    for raw in LOCATION_NUMBER_PATTERN.findall(text or ""):
        normalized = normalize_location_number(raw)
        if normalized:
            out.append(normalized)
    return out


def canonicalize_location_number(
    value: str,
    canonical_map: dict[str, str] | None = None,
) -> str | None:
    normalized = normalize_location_number(value)
    if not normalized:
        return None
    if canonical_map:
        return canonical_map.get(normalized, normalized)
    return normalized


def load_canonical_location_number_map(survey_points_path: str | Path) -> dict[str, str]:
    points = json.loads(Path(survey_points_path).read_text(encoding="utf-8"))
    mapping: dict[str, str] = {}
    for point in points:
        canonical = str(point.get("id", "")).strip()
        normalized = normalize_location_number(canonical)
        if not canonical or not normalized:
            continue
        mapping[normalized] = canonical
    return mapping


def merge_location_numbers(
    location_numbers: list[str],
    other_text: str,
    canonical_map: dict[str, str] | None = None,
) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for raw in location_numbers or []:
        canonical = canonicalize_location_number(raw, canonical_map)
        if canonical and canonical not in seen:
            seen.add(canonical)
            merged.append(canonical)
    for raw in extract_location_numbers_from_text(other_text or ""):
        canonical = canonicalize_location_number(raw, canonical_map)
        if canonical and canonical not in seen:
            seen.add(canonical)
            merged.append(canonical)
    return merged
