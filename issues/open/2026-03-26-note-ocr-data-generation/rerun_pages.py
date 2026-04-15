#!/usr/bin/env python3
"""
指定したページだけ OCR を再実行する。

使い方:
    python ./issues/open/2026-03-26-note-ocr-data-generation/rerun_pages.py \
        _local/zero-location-pages.tsv [--model gpt-5]

入力 TSV の形式:
    バッチ名<TAB>ページファイル名  (例: 003-015\tpage_008.jpg)

処理:
    1. TSV を読んでバッチごとにまとめる
    2. 各バッチで対象ページの JSON を一時退避 → OCR 再実行 → normalize
    3. 成功したら退避ファイルを削除、失敗したら元に戻す
    4. 完了後、zero-location-pages.tsv と ocr-review-pages.json を更新

オプション:
    --dry-run     実際には実行せず対象一覧を表示
    --batch       指定バッチのみ処理 (カンマ区切り)
    --model       使用モデル (デフォルト: gpt-5)
    --no-refresh  完了後の TSV / ocr-review-pages.json 再生成をスキップ
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_DIR = Path(__file__).parent
CACHE_ROOT = REPO_ROOT / "iiif-image-cache" / "note-ocr"
OCR_SCRIPT_OPENAI = SCRIPT_DIR / "extract_location_numbers_openai.py"
OCR_SCRIPT_CLAUDE = SCRIPT_DIR / "extract_location_numbers_claude.py"
NORMALIZE_SCRIPT = SCRIPT_DIR / "normalize_ocr_pages.py"
GENERATE_SCRIPT = SCRIPT_DIR / "generate_ocr_review_data.py"
ZERO_LOC_TSV = REPO_ROOT / "_local" / "zero-location-pages.tsv"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="指定ページのみ OCR を再実行する")
    p.add_argument("tsv", help="バッチ名<TAB>ページファイル名 の TSV")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--batch", default=None, metavar="BATCHES",
                   help="処理対象バッチをカンマ区切りで絞り込む")
    p.add_argument("--model", default=None,
                   help="OCR に使うモデル (デフォルト: openai=gpt-5, claude=claude-sonnet-4-6)")
    p.add_argument("--script", default="openai", choices=["openai", "claude"],
                   help="使用する OCR スクリプト (デフォルト: openai)")
    p.add_argument("--no-refresh", action="store_true",
                   help="完了後の TSV / ocr-review-pages.json 再生成をスキップ")
    return p


def load_tsv(path: Path) -> dict[str, list[str]]:
    by_batch: dict[str, list[str]] = defaultdict(list)
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        by_batch[parts[0]].append(parts[1])
    return dict(by_batch)


def run(cmd: list[str], label: str) -> int:
    print(f"  [{label}] " + " ".join(str(c) for c in cmd), flush=True)
    return subprocess.run([str(c) for c in cmd], cwd=REPO_ROOT).returncode


def process_batch(batch_name: str, page_files: list[str], model: str, dry_run: bool, ocr_script: Path) -> str:
    batch_dir = CACHE_ROOT / batch_name
    dl_pages = batch_dir / "dl_pages"
    out_dir = batch_dir / "out_openai_pages"

    if not out_dir.exists():
        return "skip:no_out_dir"

    # 対象ページの JSON を退避
    stashed: list[tuple[Path, Path]] = []
    missing: list[str] = []
    for pf in page_files:
        json_path = out_dir / (Path(pf).stem + ".json")
        if not json_path.exists():
            missing.append(pf)
            continue
        stash = json_path.with_suffix(".json.stash")
        if not dry_run:
            shutil.move(str(json_path), str(stash))
        stashed.append((json_path, stash))

    if missing:
        print(f"  [WARN] JSON が見つからないページ: {missing}")

    if not stashed and not missing:
        return "skip:nothing_to_do"

    if dry_run:
        for pf in page_files:
            print(f"    would rerun: {batch_name}/{pf}  (model={model})")
        return "dry-run"

    # OCR 再実行
    rc = run(
        [sys.executable, ocr_script,
         "--images-dir", dl_pages,
         "--ids-file", dl_pages / "ids.txt",
         "--source-metadata", batch_dir / "metadata.json",
         "--out-dir", out_dir,
         "--model", model],
        "ocr",
    )

    if rc == 4:
        for json_path, stash in stashed:
            if stash.exists():
                shutil.move(str(stash), str(json_path))
        return "quota_exhausted"

    if rc != 0:
        for json_path, stash in stashed:
            if stash.exists():
                shutil.move(str(stash), str(json_path))
        return f"fail:ocr(rc={rc})"

    # 成功 → 退避ファイルを削除
    for _, stash in stashed:
        if stash.exists():
            stash.unlink()

    # normalize
    run([sys.executable, NORMALIZE_SCRIPT, out_dir], "normalize")
    return "done"


def refresh_zero_tsv() -> int:
    """zero-location-pages.tsv を再生成して残件数を返す。"""
    rows = []
    for batch in sorted(CACHE_ROOT.iterdir()):
        pages_json = batch / "out_openai_pages" / "pages.json"
        if not pages_json.exists():
            continue
        for p in json.loads(pages_json.read_text(encoding="utf-8")):
            if "error" in p or p.get("location_numbers"):
                continue
            if len((p.get("other_text") or "").strip()) < 20:
                continue
            rows.append(f"{batch.name}\t{p['source_image']}")
    ZERO_LOC_TSV.write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(f"zero-location-pages.tsv 更新: {len(rows)} 件 → {ZERO_LOC_TSV}")
    return len(rows)


def main() -> int:
    args = build_parser().parse_args()

    # スクリプトとモデルの解決
    if args.script == "claude":
        ocr_script = OCR_SCRIPT_CLAUDE
        model = args.model or "claude-sonnet-4-6"
        env_key = "ANTHROPIC_API_KEY"
    else:
        ocr_script = OCR_SCRIPT_OPENAI
        model = args.model or "gpt-5"
        env_key = "OPENAI_API_KEY"

    if not args.dry_run and not __import__("os").environ.get(env_key):
        print(f"ERROR: {env_key} is not set", file=sys.stderr)
        return 2

    tsv_path = Path(args.tsv)
    if not tsv_path.exists():
        print(f"ERROR: {tsv_path} が見つかりません", file=sys.stderr)
        return 1

    by_batch = load_tsv(tsv_path)

    if args.batch:
        only = {b.strip() for b in args.batch.split(",")}
        by_batch = {k: v for k, v in by_batch.items() if k in only}

    total_pages = sum(len(v) for v in by_batch.values())
    print(f"対象バッチ: {len(by_batch)} / 対象ページ: {total_pages}  script={args.script}  model={model}")
    if args.dry_run:
        print("(dry-run モード)\n")

    results: dict[str, int] = {"done": 0, "skip": 0, "fail": 0}
    for i, (batch_name, pages) in enumerate(sorted(by_batch.items()), 1):
        print(f"\n[{i}/{len(by_batch)}] {batch_name}  ({len(pages)} ページ)", flush=True)
        outcome = process_batch(batch_name, pages, model, args.dry_run, ocr_script)
        print(f"  => {outcome}", flush=True)
        if outcome == "quota_exhausted":
            print("[FATAL] quota 枯渇 — 停止", file=sys.stderr)
            return 1
        elif outcome.startswith("done"):
            results["done"] += 1
        elif outcome.startswith("skip") or outcome == "dry-run":
            results["skip"] += 1
        else:
            results["fail"] += 1

    print(f"\n完了: done={results['done']} skip={results['skip']} fail={results['fail']}")

    if not args.dry_run and not args.no_refresh:
        print("\n── 後処理 ──")
        remaining = refresh_zero_tsv()
        rc = run([sys.executable, GENERATE_SCRIPT], "generate ocr-review-pages.json")
        print(f"残り zero-location ページ: {remaining} 件")
        return rc

    return 0 if results["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
