#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import ssl
import urllib.parse
import urllib.request
from pathlib import Path


def build_parser() -> argparse.ArgumentParser:
    repo_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(
        description="地図番号に対応する注記 manifest から JPG ページをダウンロードする"
    )
    parser.add_argument(
        "--map-numbers",
        nargs="+",
        required=True,
        help="対象地図番号。例: 017 018 019",
    )
    parser.add_argument(
        "--note-index",
        default=str(repo_root / "overlay" / "data" / "laj_note_index.json"),
        help="地図番号→注記対応辞書 JSON",
    )
    parser.add_argument(
        "--out-root",
        default=str(repo_root / "iiif-image-cache" / "note-ocr" / "017-019"),
        help="出力先ルート。dl_pages/ と metadata.json を作る",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="既存 jpg を上書きする",
    )
    parser.add_argument(
        "--max-width",
        type=int,
        default=2400,
        help="IIIF Image API で取得する最大幅。縦横比は維持される",
    )
    return parser


def normalize_map_number(value: str) -> str:
    return str(value).strip().zfill(3)


def fetch_json(url: str, context: ssl.SSLContext) -> dict:
    with urllib.request.urlopen(url, context=context) as resp:
        return json.load(resp)


def label_text(value, fallback: str) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list) and value:
        return str(value[0])
    if isinstance(value, dict) and value:
        first = next(iter(value.values()))
        if isinstance(first, list) and first:
            return str(first[0])
        if isinstance(first, str):
            return first
    return fallback


def image_service_from_canvas(canvas: dict) -> tuple[str | None, int | None]:
    body = None
    if canvas.get("items"):
      body = (((canvas.get("items") or [{}])[0].get("items") or [{}])[0].get("body"))
    elif canvas.get("images"):
      body = ((canvas.get("images") or [{}])[0].get("resource"))
    if not isinstance(body, dict):
        return None, None
    service = body.get("service")
    if isinstance(service, list):
        service = service[0] if service else None
    service_id = None
    if isinstance(service, dict):
        service_id = service.get("id") or service.get("@id")
    width = canvas.get("width") or body.get("width")
    return service_id, width


def build_image_url(service_id: str, width: int | None, max_width: int) -> str:
    base = service_id.replace("/info.json", "").rstrip("/")
    target_width = max_width
    if width:
        target_width = min(int(width), max_width)
    return f"{base}/full/{target_width},/0/default.jpg"


def canvases_from_manifest(manifest: dict) -> list[dict]:
    if manifest.get("items"):
        return manifest.get("items") or []
    seqs = manifest.get("sequences") or []
    if seqs:
        return (seqs[0].get("canvases") or [])
    return []


def collect_note_entries(note_index: dict, map_numbers: list[str]) -> list[dict]:
    found = []
    seen = set()
    for map_number in map_numbers:
        for entry in note_index.get("maps", {}).get(map_number, []):
            key = entry["ljcId"]
            if key in seen:
                continue
            seen.add(key)
            found.append(entry)
    return found


def download_file(url: str, dst: Path, context: ssl.SSLContext) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "nihu-iiif-tools/1.0"})
    with urllib.request.urlopen(req, context=context) as resp, dst.open("wb") as f:
        f.write(resp.read())


def main() -> int:
    args = build_parser().parse_args()
    map_numbers = [normalize_map_number(v) for v in args.map_numbers]
    note_index_path = Path(args.note_index)
    out_root = Path(args.out_root)
    dl_pages = out_root / "dl_pages"
    dl_pages.mkdir(parents=True, exist_ok=True)
    context = ssl.create_default_context()

    note_index = json.loads(note_index_path.read_text(encoding="utf-8"))
    entries = collect_note_entries(note_index, map_numbers)
    if not entries:
        raise SystemExit(f"No note entries found for map numbers: {', '.join(map_numbers)}")

    ids_lines: list[str] = []
    pages_meta: list[dict] = []
    page_counter = 0

    for entry in entries:
        manifest = fetch_json(entry["manifestUrl"], context=context)
        canvases = canvases_from_manifest(manifest)
        for local_index, canvas in enumerate(canvases):
            service_id, width = image_service_from_canvas(canvas)
            if not service_id:
                continue
            image_url = build_image_url(service_id, width, args.max_width)
            filename = f"page_{page_counter:03d}.jpg"
            dst = dl_pages / filename
            if args.overwrite or not dst.exists():
                download_file(image_url, dst, context=context)
            ids_lines.append(service_id)
            pages_meta.append({
                "page_file": filename,
                "ljcId": entry["ljcId"],
                "title": entry["title"],
                "mapNumbers": entry["mapNumbers"],
                "manifestUrl": entry["manifestUrl"],
                "canvasLabel": label_text(canvas.get("label"), str(local_index + 1)),
                "canvasId": canvas.get("id") or canvas.get("@id"),
                "serviceId": service_id,
                "imageUrl": image_url,
                "downloadWidth": min(int(width), args.max_width) if width else args.max_width,
            })
            print(f"[OK] {filename} <- {urllib.parse.unquote(service_id)}")
            page_counter += 1

    (dl_pages / "ids.txt").write_text("\n".join(ids_lines) + "\n", encoding="utf-8")
    (out_root / "metadata.json").write_text(
        json.dumps(
            {
                "mapNumbers": map_numbers,
                "noteEntries": entries,
                "pages": pages_meta,
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    print(f"Saved {page_counter} pages under {dl_pages}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
