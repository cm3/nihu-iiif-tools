#!/usr/bin/env python
import argparse
import csv
import json
import re
from pathlib import Path


def build_parser():
    here = Path(__file__).resolve()
    overlay_dir = here.parent.parent
    repo_root = overlay_dir.parent
    parser = argparse.ArgumentParser(
        description="注記一覧 CSV から地図番号対応辞書 JSON を生成する"
    )
    parser.add_argument(
        "--input",
        default=str(repo_root / "_local" / "注記一覧metadata_1.csv"),
        help="入力 CSV パス",
    )
    parser.add_argument(
        "--cards-input",
        default=str(repo_root / "_local" / "注記一覧metadata_2.csv"),
        help="注記カード一覧 CSV パス",
    )
    parser.add_argument(
        "--output",
        default=str(overlay_dir / "data" / "laj_note_index.json"),
        help="出力 JSON パス",
    )
    return parser


def parse_map_numbers(value):
    return [num.zfill(3) for num in re.findall(r"\d+", value or "")]


def load_cards(path):
    src = Path(path)
    if not src.exists():
        return {}
    cards_by_ljc_id = {}
    with src.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            card_id = row["LJCカードID"]
            cards_by_ljc_id.setdefault(row["LJC_ID"], []).append(
                {
                    "cardId": card_id,
                    "jpegFileName": row["jpegファイル名"],
                    "cardNumber": row["カード番号"],
                    "mapNumbers": parse_map_numbers(row["地図番号"]),
                    "canvasId": f"https://iiif.nihu.jp/iiif/2/archives/{card_id}",
                    "serviceId": f"https://iiif.nihu.jp/iiif/2/laj_note%2F{card_id}.tif",
                }
            )
    return cards_by_ljc_id


def main():
    args = build_parser().parse_args()
    src = Path(args.input)
    dst = Path(args.output)
    cards_by_ljc_id = load_cards(args.cards_input)

    maps = {}
    total_rows = 0
    total_links = 0

    with src.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_rows += 1
            cards = cards_by_ljc_id.get(row["LJC_ID"], [])
            map_numbers = set(parse_map_numbers(row["地図番号"]))
            for card in cards:
                map_numbers.update(card["mapNumbers"])
            item = {
                "ljcId": row["LJC_ID"],
                "title": row["項目名"],
                "questionNumber": row["質問番号"],
                "mapNumbers": sorted(map_numbers),
                "cardCount": int(row["カード枚数"]) if row["カード枚数"] else None,
                "sourceTitle": row["収録書名"],
                "creator": row["作成者"],
                "year": row["作成年"],
                "manifestUrl": f"https://iiif.nihu.jp/iiif/archives/{row['LJC_ID']}/manifest.json",
                "cards": cards,
            }
            for map_number in item["mapNumbers"]:
                maps.setdefault(map_number, []).append(item)
                total_links += 1

    payload = {
        "generatedFrom": src.name,
        "mapCount": len(maps),
        "noteCount": total_rows,
        "linkCount": total_links,
        "maps": dict(sorted(maps.items())),
    }

    dst.parent.mkdir(parents=True, exist_ok=True)
    with dst.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Wrote {dst} ({len(maps)} maps / {total_rows} notes / {total_links} links)")


if __name__ == "__main__":
    main()
