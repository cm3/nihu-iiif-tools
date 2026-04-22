#!/usr/bin/env python3
"""
全注記バッチを順番に自動処理する。

1 バッチ = 1 注記 (ljcId) = download → OCR → normalize の 3 ステップ。

使い方:
    python ./issues/open/2026-03-26-note-ocr-data-generation/run_all_batches.py

オプション:
    --dry-run      実際には実行せず、処理対象バッチ一覧だけ表示する
    --skip-done    pages.json が揃っているバッチをスキップ（デフォルト有効）
    --start-from   指定バッチ名（例: 020）以降から処理を開始する
    --only         指定バッチ名のみ処理する（カンマ区切りで複数可）
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
NOTE_INDEX = REPO_ROOT / "overlay" / "data" / "laj_note_index.json"
CACHE_ROOT = REPO_ROOT / "iiif-image-cache" / "note-ocr"
SCRIPT_DIR = Path(__file__).parent

DOWNLOAD_SCRIPT = SCRIPT_DIR / "download_note_pages.py"
OCR_SCRIPT = SCRIPT_DIR / "extract_location_numbers_openai.py"
NORMALIZE_SCRIPT = SCRIPT_DIR / "normalize_ocr_pages.py"

# 処理済み ljcId はここに追加していく
DONE_LJCIDS: set[str] = {
    "LJC-M017Q158",  # 017-019, 62 pages
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="全注記バッチを自動処理する")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="処理対象バッチ一覧を表示するだけで、実行はしない",
    )
    parser.add_argument(
        "--start-from",
        default=None,
        metavar="BATCH_NAME",
        help="このバッチ名以降から処理を開始する（例: 020）",
    )
    parser.add_argument(
        "--only",
        default=None,
        metavar="BATCH_NAMES",
        help="このバッチ名だけ処理する（カンマ区切り、例: 001,002,003-015）",
    )
    return parser


def batch_name_from_map_numbers(map_numbers: list[str]) -> str:
    return "-".join(sorted(map_numbers))


def collect_batches(note_index: dict) -> list[dict]:
    """note_index から一意な注記バッチを取り出し、地図番号順にソートして返す。"""
    maps = note_index.get("maps", {})
    seen: set[str] = set()
    batches: list[dict] = []
    for map_num in sorted(maps.keys()):
        for entry in maps[map_num]:
            lid = entry["ljcId"]
            if lid in seen:
                continue
            seen.add(lid)
            map_numbers = sorted(entry.get("mapNumbers", [map_num]))
            batches.append(
                {
                    "ljcId": lid,
                    "mapNumbers": map_numbers,
                    "batchName": batch_name_from_map_numbers(map_numbers),
                    "cardCount": entry.get("cardCount", 0),
                    "title": entry.get("title", ""),
                }
            )
    return batches


def count_downloaded_images(dl_pages: Path) -> int:
    return len(list(dl_pages.glob("page_*.jpg")))


def count_ocr_pages(out_dir: Path) -> tuple[int, int]:
    """(total, error_count) を返す。pages.json がなければ (0, 0)。"""
    pages_json = out_dir / "pages.json"
    if not pages_json.exists():
        return 0, 0
    try:
        data = json.loads(pages_json.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return 0, 0
        errors = sum(1 for p in data if "error" in p)
        return len(data), errors
    except Exception:
        return 0, 0


DOWNLOAD_FAILED_MARKER = "_download_failed.txt"


def is_done(batch_dir: Path) -> bool:
    """dl_pages の画像数 == pages.json エントリ数 かつエラーなし なら完了とみなす。
    ダウンロード失敗マーカーがあれば永続スキップ扱い。"""
    if (batch_dir / DOWNLOAD_FAILED_MARKER).exists():
        return True
    dl_pages = batch_dir / "dl_pages"
    out_dir = batch_dir / "out_openai_pages"
    n_images = count_downloaded_images(dl_pages)
    n_ocr, n_errors = count_ocr_pages(out_dir)
    return n_images > 0 and n_ocr >= n_images and n_errors == 0


def run_step(cmd: list[str], label: str) -> int:
    print(f"\n  [{label}] " + " ".join(str(c) for c in cmd), flush=True)
    result = subprocess.run([str(c) for c in cmd], cwd=REPO_ROOT)
    return result.returncode


def process_batch(batch: dict) -> str:
    """
    1 バッチを処理して結果ラベルを返す。
    "done" / "skip" / "fail:download" / "fail:ocr" / "warn:normalize"
    """
    batch_dir = CACHE_ROOT / batch["batchName"]
    dl_pages = batch_dir / "dl_pages"
    out_dir = batch_dir / "out_openai_pages"

    # すでに完了していれば skip
    if is_done(batch_dir):
        return "skip"

    # Step 1: ダウンロード（dl_pages に画像がなければ実行）
    if count_downloaded_images(dl_pages) == 0:
        rc = run_step(
            [sys.executable, DOWNLOAD_SCRIPT, "--map-numbers"]
            + batch["mapNumbers"]
            + ["--out-root", batch_dir],
            "download",
        )
        if rc != 0:
            batch_dir.mkdir(parents=True, exist_ok=True)
            (batch_dir / DOWNLOAD_FAILED_MARKER).write_text(
                f"download failed (rc={rc})\n", encoding="utf-8"
            )
            return "fail:download"
    else:
        print(f"  [download] skip — {count_downloaded_images(dl_pages)} images already in {dl_pages}")

    # Step 2: OCR（既存 JSON はスキップされる）
    rc = run_step(
        [
            sys.executable,
            OCR_SCRIPT,
            "--images-dir", dl_pages,
            "--ids-file", dl_pages / "ids.txt",
            "--source-metadata", batch_dir / "metadata.json",
            "--out-dir", out_dir,
        ],
        "ocr",
    )
    if rc == 4:
        return "quota_exhausted"
    if rc != 0:
        return "fail:ocr"

    # Step 3: 正規化
    rc = run_step(
        [sys.executable, NORMALIZE_SCRIPT, out_dir],
        "normalize",
    )
    if rc != 0:
        return "warn:normalize"

    return "done"


def main() -> int:
    args = build_parser().parse_args()

    if not args.dry_run and not os.environ.get("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY is not set", file=sys.stderr)
        return 2

    note_index = json.loads(NOTE_INDEX.read_text(encoding="utf-8"))
    all_batches = collect_batches(note_index)

    # DONE_LJCIDS に含まれるものは除外
    batches = [b for b in all_batches if b["ljcId"] not in DONE_LJCIDS]

    # --only フィルタ
    if args.only:
        only_set = {n.strip() for n in args.only.split(",")}
        batches = [b for b in batches if b["batchName"] in only_set]

    # --start-from フィルタ
    if args.start_from:
        names = [b["batchName"] for b in batches]
        if args.start_from not in names:
            print(f"ERROR: --start-from '{args.start_from}' not found in batch list", file=sys.stderr)
            return 1
        idx = names.index(args.start_from)
        batches = batches[idx:]

    total_pages = sum(b["cardCount"] for b in batches)
    print(f"Batches to process : {len(batches)}")
    print(f"Estimated pages    : {total_pages}")
    print()

    if args.dry_run:
        print(f"{'#':<4}  {'BatchName':<15}  {'Pages':>5}  {'Maps':<15}  LjcId")
        print("-" * 75)
        for i, b in enumerate(batches, 1):
            batch_dir = CACHE_ROOT / b["batchName"]
            status = "DONE" if is_done(batch_dir) else "    "
            maps_str = " ".join(b["mapNumbers"])
            print(f"{i:<4}  {b['batchName']:<15}  {b['cardCount']:>5}  {maps_str:<15}  {b['ljcId']}  {status}")
        return 0

    results: dict[str, int] = {"done": 0, "skip": 0, "fail": 0, "warn": 0}

    for i, batch in enumerate(batches, 1):
        print(f"\n{'=' * 65}", flush=True)
        print(
            f"[{i}/{len(batches)}] {batch['batchName']}"
            f"  ({batch['ljcId']})  {batch['cardCount']} pages",
            flush=True,
        )
        outcome = process_batch(batch)
        print(f"  => {outcome}", flush=True)

        if outcome == "quota_exhausted":
            print("  [FATAL] quota exhausted — stopping all batches.", file=sys.stderr)
            break
        elif outcome == "done":
            results["done"] += 1
        elif outcome == "skip":
            results["skip"] += 1
        elif outcome.startswith("fail"):
            results["fail"] += 1
            print(f"  [ERROR] {outcome} — continuing to next batch", file=sys.stderr)
        elif outcome.startswith("warn"):
            results["done"] += 1
            results["warn"] += 1

    print(f"\n{'=' * 65}")
    print(
        f"Finished: done={results['done']}  skip={results['skip']}"
        f"  fail={results['fail']}  warn(normalize)={results['warn']}"
    )
    return 0 if results["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
