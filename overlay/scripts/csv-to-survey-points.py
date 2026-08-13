#!/usr/bin/env python3
"""
csv-to-survey-points.py

overlay/source-data/survey-points/output_gc_final_with_dist_fixed_ids.csv から
調査地点の緯度経度・ラベルを抽出し、overlay/data/survey-points.json を生成する。

座標選択方針:
  - ジオコーダ level <= 3（市区町村レベル）: メッシュ座標を優先
      → ジオコーダが市の重心しか返せず複数地点が同座標になる問題を回避
      → 海上に落ちるケースは56件抜き打ちチェックでゼロと確認済み（2026-04-14）
  - ジオコーダ level >= 4（町丁・大字以上）: 原則ジオコーダ座標を使用
      ただし同座標の重複が生じた場合はメッシュ座標にフォールバック

バックアップ:
  survey-points-geocoder-original.json  元のジオコーダ座標版
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

OVERLAY_ROOT = Path(__file__).resolve().parents[1]
SRC = OVERLAY_ROOT / "source-data" / "survey-points" / "output_gc_final_with_dist_fixed_ids.csv"
DEST = OVERLAY_ROOT / "data" / "survey-points.json"

MESH_PREFERRED_MAX_LEVEL = 3


def dms_to_decimal(dms_str: str) -> float:
    """DDMMSS.ssss または DDDMMSS.ssss 形式の文字列を十進度に変換する。"""
    s = str(dms_str).strip()
    int_part, _, frac = s.partition(".")
    ss = float(int_part[-2:] + ("." + frac if frac else ""))
    mm = int(int_part[-4:-2])
    dd = int(int_part[:-4])
    return dd + mm / 60 + ss / 3600


# ── パス1: 全行を読み、座標を仮決定 ──
candidates: list[dict] = []
with open(SRC, encoding="utf-8", newline="") as f:
    reader = csv.DictReader(f, delimiter="\t")
    for row in reader:
        try:
            gc_lon = float(row["estimated_long"])
            gc_lat = float(row["estimated_lat"])
        except (ValueError, KeyError):
            continue

        level = int(row.get("level", "0") or "0")
        use_mesh = level <= MESH_PREFERRED_MAX_LEVEL

        if use_mesh:
            try:
                lat = dms_to_decimal(row["mesh_lat_jgd"])
                lon = dms_to_decimal(row["mesh_long_jgd"])
            except (ValueError, KeyError):
                lat, lon = gc_lat, gc_lon
                use_mesh = False
        else:
            lat, lon = gc_lat, gc_lon

        candidates.append({
            "id":       row["調査地点番号"].strip(),
            "pref":     row["調査地点都道府県名（原表記）"].strip(),
            "name":     row["調査地点名（原表記）"].strip(),
            "lat":      round(lat, 6),
            "lon":      round(lon, 6),
            "gc_lat":   gc_lat,
            "gc_lon":   gc_lon,
            "mesh_lat_jgd": row.get("mesh_lat_jgd", ""),
            "mesh_long_jgd": row.get("mesh_long_jgd", ""),
            "note":     row.get("note", "").strip(),
            "use_mesh": use_mesh,
            "level":    level,
        })

# ── パス2: level>=4 で座標が重複している点をメッシュにフォールバック ──
coord_count: defaultdict[tuple, int] = defaultdict(int)
for c in candidates:
    coord_count[(c["lat"], c["lon"])] += 1

fallback_count = 0
for c in candidates:
    if c["use_mesh"]:
        continue  # すでにメッシュ使用
    if coord_count[(c["lat"], c["lon"])] <= 1:
        continue  # 重複なし → そのまま
    # 重複あり → メッシュにフォールバック
    try:
        m_lat = dms_to_decimal(c["mesh_lat_jgd"])
        m_lon = dms_to_decimal(c["mesh_long_jgd"])
        c["lat"] = round(m_lat, 6)
        c["lon"] = round(m_lon, 6)
        c["use_mesh"] = True
        fallback_count += 1
    except (ValueError, KeyError):
        pass  # メッシュ値がなければそのまま

# ── 出力 ──
points = [
    {
        "id":   c["id"],
        "pref": c["pref"],
        "name": c["name"],
        "lat":  c["lat"],
        "lon":  c["lon"],
        "note": c["note"],
    }
    for c in candidates
]

DEST.write_text(
    json.dumps(points, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8",
)

mesh_total = sum(1 for c in candidates if c["use_mesh"])
print(f"{len(points)} 点 → {DEST}")
print(f"  メッシュ座標使用 (level ≤ {MESH_PREFERRED_MAX_LEVEL}): {mesh_total - fallback_count} 件")
print(f"  メッシュにフォールバック (level ≥ 4 だが重複): {fallback_count} 件")
print(f"  ジオコーダ座標使用: {len(points) - mesh_total} 件")
