#!/usr/bin/env python3
"""
json-to-mapping.py

overlay.html で記録したキャリブレーション JSON から
calibration-preview.html 用の GCP TSV を生成する。

【手法】
  JSON の対応点から「基準地図px → 対象地図px」のクロスマップ変換を推定し、
  基準地図の GCP TSV（017-mapping*.tsv）のピクセル座標をすべて変換する。
  地理座標は基準地図のものをそのまま継承する。

  対応点が 8 点以上なら Thin Plate Spline（scipy `RBFInterpolator`）を使い、
  8 点未満ならアフィン最小二乗にフォールバックする。

  LAJ_017 基準では本州系を 4 分割（h1〜h4）した TSV と、
  統合版 main、北海道・琉球・先島の各 TSV を一括生成する。

【使用法】
  python scripts/json-to-mapping.py                         # data/ 内の全 JSON を処理
  python scripts/json-to-mapping.py data/LAJ_017_LAJ_001.json  # 個別指定
  python scripts/json-to-mapping.py --base-id LAJ_018 data/LAJ_018_LAJ_*.json
"""

import sys
import re
import json
import argparse
from pathlib import Path

import numpy as np
from scipy.interpolate import RBFInterpolator
from numpy.linalg import LinAlgError

DATA_DIR = Path(__file__).parent.parent / "data"

# アフィンフォールバックの点数閾値
TPS_MIN_POINTS = 8

# 基準 GCP ファイル定義（サフィックス → ファイル名）
REF_TSVS = {
    "":   "017-mapping.tsv",
    "h1": "017-mapping-h1.tsv",
    "h2": "017-mapping-h2.tsv",
    "h3": "017-mapping-h3.tsv",
    "h4": "017-mapping-h4.tsv",
    "hk": "017-mapping-hk.tsv",
    "rk": "017-mapping-rk.tsv",
    "sk": "017-mapping-sk.tsv",
}


# ===== TSV パース: "px py lon lat" =====

def parse_tsv(path: Path) -> list:
    pts = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        px, py, lon, lat = map(float, line.split())
        pts.append((px, py, lon, lat))
    return pts


# ===== 変換器の構築 =====

def build_affine(src: np.ndarray, dst: np.ndarray):
    """アフィン最小二乗: src (n,2) → dst (n,2)"""
    n = src.shape[0]
    A = np.hstack([src, np.ones((n, 1))])
    coef, _, _, _ = np.linalg.lstsq(A, dst, rcond=None)
    def transform(pts: np.ndarray) -> np.ndarray:
        A_q = np.hstack([pts, np.ones((pts.shape[0], 1))])
        return A_q @ coef
    return transform


def build_tps(src: np.ndarray, dst: np.ndarray):
    """Thin Plate Spline: src (n,2) → dst (n,2)"""
    rbf = RBFInterpolator(src, dst, kernel="thin_plate_spline", degree=1)
    return lambda pts: rbf(pts)


def build_cross_map_transform(src: np.ndarray, dst: np.ndarray):
    """点数に応じて TPS / アフィンを選択"""
    n = src.shape[0]
    if n >= TPS_MIN_POINTS:
        try:
            return build_tps(src, dst), "TPS"
        except (ValueError, LinAlgError):
            return build_affine(src, dst), "affine(fallback)"
    else:
        return build_affine(src, dst), "affine"


def map_id_to_nnn(map_id: str) -> str | None:
    m = re.search(r"(\d+)$", map_id)
    return m.group(1).zfill(3) if m else None


# ===== JSON 1ファイルを処理 =====

def process_json(json_path: Path, ref_gcps: dict, base_id: str) -> bool:
    data = json.loads(json_path.read_text(encoding="utf-8"))

    if data.get("baseId") != base_id:
        print(f"  Skip: baseId={data.get('baseId')} (期待: {base_id})")
        return False

    overlay_id = data["overlayId"]
    points = data["points"]
    if not points:
        print(f"  Skip: points が空")
        return False

    nnn = map_id_to_nnn(overlay_id)
    if nnn is None:
        print(f"  Skip: overlayId 解析失敗: {overlay_id}")
        return False

    # クロスマップ変換: base px → overlay px
    src = np.array([[p["base"]["x"],    p["base"]["y"]]    for p in points])
    dst = np.array([[p["overlay"]["x"], p["overlay"]["y"]] for p in points])
    cross, method = build_cross_map_transform(src, dst)

    rmse = float(np.sqrt(((cross(src) - dst) ** 2).mean()))
    print(f"  {method} ({len(points)}点, RMSE={rmse:.2f}px)")

    # 各 TSV を変換して出力
    for suffix, gcps in ref_gcps.items():
        ref_px  = np.array([[g[0], g[1]] for g in gcps])  # (m, 2)
        out_px  = cross(ref_px)                            # (m, 2): 対象地図 px

        suffix_str = f"-{suffix}" if suffix else ""
        out_name   = f"{nnn}-mapping{suffix_str}.tsv"
        out_path   = json_path.parent / out_name

        lines = [
            f"{out_px[i, 0]:.1f}\t{out_px[i, 1]:.1f}"
            f"\t{gcps[i][2]:.8f}\t{gcps[i][3]:.8f}"
            for i in range(len(gcps))
        ]
        out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        label = suffix or "main"
        print(f"    [{label:4s}] → {out_name} ({len(lines)}点)")

    return True


# ===== メイン =====

def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("json_files", nargs="*", type=Path,
                        help="処理する JSON（省略時は data/ 内を自動検索）")
    parser.add_argument("--base-id", default="LAJ_017",
                        help="基準地図ID（デフォルト: LAJ_017）")
    parser.add_argument("--ref-dir", type=Path, default=DATA_DIR,
                        help=f"基準 TSV の置き場所（デフォルト: {DATA_DIR}）")
    args = parser.parse_args()

    base_id  = args.base_id
    ref_dir  = args.ref_dir

    # 基準 GCP 読み込み（存在するものだけ）
    ref_gcps = {}
    for suffix, fname in REF_TSVS.items():
        path = ref_dir / fname
        if path.exists():
            gcps = parse_tsv(path)
            ref_gcps[suffix] = gcps
            label = suffix or "main"
            print(f"基準GCP [{label:4s}]: {fname} ({len(gcps)}点)")
        else:
            print(f"基準GCP [{'skip':4s}]: {fname} 見つからず")

    if not ref_gcps:
        print("エラー: 基準GCPが1件も見つかりません", file=sys.stderr)
        sys.exit(1)

    # 処理対象 JSON
    if args.json_files:
        json_files = list(args.json_files)
    else:
        pattern = re.compile(rf"^{re.escape(base_id)}_LAJ_\d+\.json$")
        json_files = sorted(
            f for f in DATA_DIR.glob("*.json") if pattern.match(f.name)
        )

    if not json_files:
        print("処理対象の JSON が見つかりません")
        return

    ok = 0
    for jf in json_files:
        print(f"{jf.name}")
        if process_json(jf, ref_gcps, base_id):
            ok += 1

    print(f"\n完了: {ok}/{len(json_files)} ファイルを処理")


if __name__ == "__main__":
    main()
