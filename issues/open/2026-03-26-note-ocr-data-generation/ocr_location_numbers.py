from __future__ import annotations

import json
import re
from pathlib import Path


LOCATION_NUMBER_PATTERN = re.compile(
    r"(?<!\d)"
    r"(0*\d{3,4}[.,]\d{1,2}"   # 通常形式: 0990.77
    r"|0*\d{1,2}\s\d{2}[.,]\d{1,2}"  # スペース区切り: 09 90.77
    r"|\d{5,6})"  # 小数点なし5〜6桁: 099077 → 0990.77
    r"[.,]?(?!\d)"
)


def normalize_location_number(value: str) -> str | None:
    text = str(value or "").strip()
    text = text.strip("()[]{}<>")
    text = text.rstrip(".,;:!?")
    text = re.sub(r"\s+", "", text)  # スペースを除去 (09 90.77 → 0990.77)
    text = text.replace(",", ".")    # カンマ区切りをピリオドに統一
    # 小数点なし5〜6桁: 099077 → 0990.77, 09907 → 0990.7
    m6 = re.fullmatch(r"(\d{5,6})", text)
    if m6:
        digits = m6.group(1)
        text = digits[:4] + "." + digits[4:]
    m = re.fullmatch(r"0*(\d{3,4})\.(\d{1,2})", text)
    if not m:
        return None
    int_part = m.group(1).zfill(4)   # 先頭ゼロを保持して4桁に揃える
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
