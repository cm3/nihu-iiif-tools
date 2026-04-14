#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ページ画像から地点番号配列とその他テキストを OpenAI API で抽出し、
ページ単位 JSON と pages.json を保存する共有用スクリプト。

前提:
  - OPENAI_API_KEY が環境変数に設定されていること
  - page_000.jpg, page_001.jpg, ... のような画像があること
  - ids.txt があれば、画像順と同じ順で 1 行 1 ID を並べること
  - metadata.json があれば、各ページの manifest / canvas / service 情報を引き継げること
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
from io import BytesIO
from pathlib import Path
from typing import Any

from openai import OpenAI
from PIL import Image

from ocr_location_numbers import load_canonical_location_number_map, merge_location_numbers


SYSTEM_PROMPT = """\
You are extracting text from scanned Japanese document pages.

Return JSON only.

Tasks:
1. Read the page image and the left-column crop.
2. Extract only the location numbers (地点番号) that appear in the location-number column.
3. Put those location numbers into an array in top-to-bottom reading order.
4. Put all other readable text from the page into a single plain text string.

Rules:
- location_numbers must contain only the location numbers, not page numbers or row counts.
- Keep each location number as a string exactly as seen when possible.
- If a number is uncertain, still include your best guess as a string.
- If none are readable, return an empty array.
- other_text should be rough transcription; it does not need to be perfect.
- Do not include explanations outside the JSON.
"""


MODEL_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "location_numbers": {
            "type": "array",
            "items": {"type": "string"},
        },
        "other_text": {
            "type": "string",
        },
    },
    "required": ["location_numbers", "other_text"],
}


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SURVEY_POINTS = REPO_ROOT / "overlay/data/survey-points.json"


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images-dir", default="./dl_pages", help="Directory with page_*.jpg files")
    ap.add_argument("--ids-file", default=None, help="Optional ids.txt aligned to image order")
    ap.add_argument(
        "--source-metadata",
        default=None,
        help="Optional metadata.json produced by download_note_pages.py",
    )
    ap.add_argument(
        "--survey-points",
        default=str(DEFAULT_SURVEY_POINTS),
        help="調査地点 JSON。地点番号の正規表記に合わせるために使う",
    )
    ap.add_argument("--out-dir", default="./out_openai_pages", help="Directory for JSON outputs")
    ap.add_argument("--limit", type=int, default=None, help="How many pages to process")
    ap.add_argument("--offset", type=int, default=0, help="How many pages to skip first")
    ap.add_argument("--model", default="gpt-5-mini", help="OpenAI model name")
    ap.add_argument("--image-glob", default="page_*.jpg", help="Glob for page images")
    ap.add_argument(
        "--left-ratio",
        type=float,
        default=0.24,
        help="Fraction of page width to crop from the left as a helper image",
    )
    ap.add_argument(
        "--top-ratio",
        type=float,
        default=0.0,
        help="Optional fraction to trim from the top before making the left crop",
    )
    ap.add_argument(
        "--bottom-ratio",
        type=float,
        default=0.0,
        help="Optional fraction to trim from the bottom before making the left crop",
    )
    ap.add_argument("--sleep-sec", type=float, default=0.5, help="Pause between requests")
    ap.add_argument("--overwrite", action="store_true", help="Overwrite existing JSON files")
    return ap.parse_args()


def image_to_data_url(img: Image.Image, fmt: str = "JPEG") -> str:
    buf = BytesIO()
    img.save(buf, format=fmt, quality=92)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    mime = "image/jpeg" if fmt.upper() == "JPEG" else "image/png"
    return f"data:{mime};base64,{b64}"


def load_image(image_path: Path) -> Image.Image:
    return Image.open(image_path).convert("RGB")


def build_left_crop(
    img: Image.Image,
    left_ratio: float,
    top_ratio: float,
    bottom_ratio: float,
) -> Image.Image:
    w, h = img.size
    crop_w = max(1, int(round(w * left_ratio)))
    top = max(0, min(h - 1, int(round(h * top_ratio))))
    bottom = h - max(0, int(round(h * bottom_ratio)))
    if bottom <= top:
        top = 0
        bottom = h
    return img.crop((0, top, crop_w, bottom))


def collect_images(images_dir: Path, image_glob: str, offset: int, limit: int | None) -> list[Path]:
    paths = sorted(images_dir.glob(image_glob))
    if offset:
        paths = paths[offset:]
    if limit is not None:
        paths = paths[:limit]
    return paths


def read_ids(ids_file: Path | None) -> list[str]:
    if ids_file is None or not ids_file.exists():
        return []
    return [line.strip() for line in ids_file.read_text(encoding="utf-8").splitlines() if line.strip()]


def read_source_metadata(source_metadata_file: Path | None) -> dict[str, dict[str, Any]]:
    if source_metadata_file is None or not source_metadata_file.exists():
        return {}
    payload = json.loads(source_metadata_file.read_text(encoding="utf-8"))
    pages = payload.get("pages", [])
    return {
        page["page_file"]: page
        for page in pages
        if isinstance(page, dict) and page.get("page_file")
    }


def infer_page_index(image_path: Path, fallback_index: int) -> int:
    m = re.search(r"(\d+)", image_path.stem)
    if m:
        return int(m.group(1))
    return fallback_index


def get_source_id(ids: list[str], image_order_index: int) -> str | None:
    if 0 <= image_order_index < len(ids):
        return ids[image_order_index]
    return None


def build_source_fields(
    image_name: str,
    source_meta_by_file: dict[str, dict[str, Any]],
    fallback_source_id: str | None,
) -> dict[str, Any]:
    meta = source_meta_by_file.get(image_name, {})
    return {
        "source_id": meta.get("serviceId") or fallback_source_id,
        "source_manifest": meta.get("manifestUrl"),
        "source_canvas_id": meta.get("canvasId"),
        "source_canvas_label": meta.get("canvasLabel"),
        "source_service_id": meta.get("serviceId") or fallback_source_id,
        "source_ljc_id": meta.get("ljcId"),
        "source_map_numbers": meta.get("mapNumbers"),
        "source_title": meta.get("title"),
    }


def extract_page(
    client: OpenAI,
    image_path: Path,
    model: str,
    left_ratio: float,
    top_ratio: float,
    bottom_ratio: float,
) -> dict[str, Any]:
    page_img = load_image(image_path)
    left_crop = build_left_crop(page_img, left_ratio, top_ratio, bottom_ratio)

    full_data_url = image_to_data_url(page_img, fmt="JPEG")
    crop_data_url = image_to_data_url(left_crop, fmt="JPEG")

    user_prompt = (
        f"Source file: {image_path.name}\n"
        "Extract the location numbers and the remaining page text.\n"
        "The second image is a left-side crop to help read the location-number column."
    )

    response = client.responses.create(
        model=model,
        instructions=SYSTEM_PROMPT,
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": user_prompt},
                    {"type": "input_image", "image_url": full_data_url, "detail": "high"},
                    {"type": "input_image", "image_url": crop_data_url, "detail": "high"},
                ],
            }
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "page_transcription",
                "strict": True,
                "schema": MODEL_OUTPUT_SCHEMA,
            }
        },
    )

    return json.loads(response.output_text)


def main() -> int:
    args = parse_args()

    if not os.environ.get("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY is not set", file=sys.stderr)
        return 2

    images_dir = Path(args.images_dir)
    ids_file = Path(args.ids_file) if args.ids_file else None
    source_metadata_file = Path(args.source_metadata) if args.source_metadata else None
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    image_paths = collect_images(images_dir, args.image_glob, args.offset, args.limit)
    if not image_paths:
        print(f"ERROR: no images found under {images_dir} with glob {args.image_glob}", file=sys.stderr)
        return 3

    ids = read_ids(ids_file)
    source_meta_by_file = read_source_metadata(source_metadata_file)
    canonical_map = load_canonical_location_number_map(args.survey_points)
    if ids and len(ids) != len(sorted(images_dir.glob(args.image_glob))):
        print(
            f"[WARN] ids count ({len(ids)}) does not match full image count ({len(sorted(images_dir.glob(args.image_glob)))})",
            file=sys.stderr,
        )

    client = OpenAI()
    summary: list[dict[str, Any]] = []

    for image_order_index, image_path in enumerate(image_paths, start=args.offset):
        page_index = infer_page_index(image_path, image_order_index)
        source_id = get_source_id(ids, image_order_index)
        source_fields = build_source_fields(image_path.name, source_meta_by_file, source_id)
        out_path = out_dir / f"{image_path.stem}.json"

        if out_path.exists() and not args.overwrite:
            existing = json.loads(out_path.read_text(encoding="utf-8"))
            if "error" not in existing:
                print(f"[SKIP] {image_path.name} -> {out_path.name}", flush=True)
                summary.append(existing)
                continue
            print(f"[RETRY] {image_path.name} — previous error: {existing.get('error', '')[:80]}", flush=True)

        print(
            f"[{len(summary) + 1}/{len(image_paths)}] processing {image_path.name}",
            flush=True,
        )

        last_err: Exception | None = None
        for attempt in range(1, 4):
            try:
                parsed = extract_page(
                    client=client,
                    image_path=image_path,
                    model=args.model,
                    left_ratio=args.left_ratio,
                    top_ratio=args.top_ratio,
                    bottom_ratio=args.bottom_ratio,
                )
                record = {
                    "source_image": image_path.name,
                    "page_index": page_index,
                    "location_numbers": merge_location_numbers(
                        parsed.get("location_numbers", []),
                        parsed.get("other_text", ""),
                        canonical_map=canonical_map,
                    ),
                    "other_text": parsed.get("other_text", ""),
                    "model": args.model,
                    **source_fields,
                }
                out_path.write_text(
                    json.dumps(record, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                summary.append(record)
                print(
                    f"[OK] {image_path.name} numbers={len(record['location_numbers'])}",
                    flush=True,
                )
                break
            except Exception as exc:
                last_err = exc
                print(
                    f"[WARN] {image_path.name} attempt {attempt}/3 failed: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                if "insufficient_quota" in str(exc):
                    print("[FATAL] OpenAI quota exhausted — stopping.", file=sys.stderr, flush=True)
                    # pages.json は途中まで書いておく
                    summary_path = out_dir / "pages.json"
                    summary_path.write_text(
                        json.dumps(summary, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    return 4  # 呼び出し元 (run_all_batches.py) が検知して停止
                time.sleep(2.0 * attempt)
        else:
            failed = {
                "source_image": image_path.name,
                "page_index": page_index,
                "location_numbers": [],
                "other_text": "",
                "model": args.model,
                "error": str(last_err) if last_err else "unknown error",
                **source_fields,
            }
            out_path.write_text(
                json.dumps(failed, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            summary.append(failed)

        time.sleep(args.sleep_sec)

    summary_path = out_dir / "pages.json"
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Saved summary: {summary_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
