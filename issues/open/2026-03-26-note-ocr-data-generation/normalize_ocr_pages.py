#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ocr_location_numbers import load_canonical_location_number_map, merge_location_numbers


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SURVEY_POINTS = REPO_ROOT / "overlay/data/survey-points.json"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="既存の OCR ページ JSON を正規化し、other_text から地点番号を補う"
    )
    parser.add_argument(
        "ocr_dir",
        help="page_*.json と pages.json があるディレクトリ",
    )
    parser.add_argument(
        "--survey-points",
        default=str(DEFAULT_SURVEY_POINTS),
        help="調査地点 JSON。地点番号の正規表記に合わせるために使う",
    )
    return parser


def normalize_record(record: dict, canonical_map: dict[str, str]) -> tuple[dict, bool]:
    before = record.get("location_numbers", [])
    after = merge_location_numbers(before, record.get("other_text", ""), canonical_map=canonical_map)
    changed = after != before
    record["location_numbers"] = after
    return record, changed


def main() -> int:
    args = build_parser().parse_args()
    ocr_dir = Path(args.ocr_dir)
    canonical_map = load_canonical_location_number_map(args.survey_points)
    page_files = sorted(ocr_dir.glob("page_*.json"))
    if not page_files:
        raise SystemExit(f"no page_*.json found under {ocr_dir}")

    changed_count = 0
    summary = []
    for page_file in page_files:
        record = json.loads(page_file.read_text(encoding="utf-8"))
        record, changed = normalize_record(record, canonical_map)
        if changed:
            changed_count += 1
            page_file.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        summary.append(record)

    (ocr_dir / "pages.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"normalized {len(page_files)} pages, changed {changed_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
