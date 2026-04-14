#!/usr/bin/env python3
"""
完了済み OCR バッチを束ねて overlay/data/ocr-review-pages.json を生成する。

使い方:
    python ./issues/open/2026-03-26-note-ocr-data-generation/generate_ocr_review_data.py

新しいバッチが完了するたびに再実行すれば差分が取り込まれる。
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CACHE_ROOT = REPO_ROOT / "iiif-image-cache" / "note-ocr"
SURVEY_POINTS_PATH = REPO_ROOT / "overlay" / "data" / "survey-points.json"
OUT_PATH = REPO_ROOT / "overlay" / "data" / "ocr-review-pages.json"


def main() -> int:
    survey_raw = json.loads(SURVEY_POINTS_PATH.read_text(encoding="utf-8"))
    survey_index = {p["id"]: {"name": p.get("name", ""), "pref": p.get("pref", "")} for p in survey_raw}

    pages: list[dict] = []
    batches: list[str] = []

    for batch_dir in sorted(CACHE_ROOT.iterdir()):
        pages_json = batch_dir / "out_openai_pages" / "pages.json"
        if not pages_json.exists():
            continue
        batch_name = batch_dir.name
        batches.append(batch_name)
        for page in json.loads(pages_json.read_text(encoding="utf-8")):
            pages.append({
                "batch": batch_name,
                "source_image": page.get("source_image"),
                "page_index": page.get("page_index"),
                "source_service_id": page.get("source_service_id") or page.get("source_id"),
                "source_canvas_label": page.get("source_canvas_label"),
                "source_ljc_id": page.get("source_ljc_id"),
                "source_map_numbers": page.get("source_map_numbers", []),
                "source_title": page.get("source_title"),
                "location_numbers": page.get("location_numbers", []),
                "other_text": page.get("other_text", ""),
            })

    total_unmatched = sum(
        1 for p in pages for n in p["location_numbers"] if n not in survey_index
    )

    payload = {
        "generated": str(date.today()),
        "batches": batches,
        "totalPages": len(pages),
        "totalUnmatched": total_unmatched,
        "pages": pages,
        "surveyIndex": survey_index,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Batches : {len(batches)}")
    print(f"Pages   : {len(pages)}")
    print(f"Unmatched numbers: {total_unmatched}")
    print(f"Written : {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
