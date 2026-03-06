# LAJ オーバーレイツール

[日本言語地図（LAJ）](https://mmsrv.ninjal.ac.jp/laj_map/) の IIIF 画像を操作するブラウザツール群です。
NIHU IIIF サーバー（`https://iiif.nihu.jp`）の画像を直接参照します。

---

## ファイル構成

```
overlay/
├── overlay.html              # 2枚の地図を重ねて比較するツール
├── calibration-preview.html  # GCP ベースのワープ＋OSM オーバーレイ
├── data/
│   ├── laj_maps.json         # 地図候補リスト（LAJ_001〜LAJ_300, S01〜S06）
│   ├── 017-mapping.tsv       # LAJ_017 本州用 GCP（23点）
│   ├── 017-mapping-hk.tsv    # LAJ_017 北海道インセット用 GCP（15点）
│   ├── 017-mapping-rk.tsv    # LAJ_017 琉球・奄美インセット用 GCP（30点）
│   ├── 017-mapping-sk.tsv    # LAJ_017 先島諸島インセット用 GCP（20点）
│   └── *.json                # キャリブレーション記録（overlay.html で出力）
└── scripts/
    └── csv-to-json.js        # laj_maps.json 生成スクリプト
```

---

## overlay.html

2枚の LAJ 地図を上下に重ねて表示し、**平行移動によるキャリブレーション**を行うツール。

### 使い方

1. ブラウザで `overlay.html` を開く（ローカルサーバー推奨）
2. 左のプルダウンでベース地図、右でオーバーレイ地図を選択（デフォルト：LAJ_017 / LAJ_018）
3. ブレンドスライダーで両地図の不透明度を調整
4. 矢印ボタンまたは「調整幅」でオーバーレイを平行移動
5. 「記録」ボタンで画面中央の対応点を記録 → 「ダウンロード」で JSON 出力

### 機能

| 機能 | 説明 |
|------|------|
| 地図選択 | `laj_maps.json` から LAJ_001〜LAJ_300 + 参考地図を選択 |
| ブレンド | スライダーで左右の不透明度を連続調整（合計 1.0） |
| 平行移動 | 矢印ボタンで最大ズーム基準 px 単位の位置調整 |
| 左図を赤色調 | チェックで左図の緑系色を赤に変換（地形境界の視覚的区別） |
| キャリブレーション記録 | 対応点を JSON 形式で保存 |
| クリック座標出力 | 地図クリックでフル解像度ピクセル座標をコンソール出力 |

### キーボードショートカット

| キー | 動作 |
|------|------|
| `←` `→` `↑` `↓` | オーバーレイを平行移動 |
| `A` / `S` | オーバーレイ地図を前/次の候補に切り替え |
| `Space` | キャリブレーション点を記録 |
| `Esc` | 記録をクリア |
| `Enter` | JSON ダウンロード |
| `Shift` | ブレンドを 7:3 ↔ 3:7 にアニメーション切り替え |

### 技術

- **Leaflet** + `L.CRS.Simple` で IIIF 画像を表示
- **leaflet-iiif** でタイル配信（IIIF Image API v2）
- IIIF マニフェスト（`iiif/archives/{ID}/manifest.json`）から info.json を自動取得
- CSS `filter: hue-rotate(240deg)` を `.leaflet-tile-pane` に適用して赤色調モードを実現

---

## calibration-preview.html

GCP（地上基準点）TSV を元に LAJ 地図を **Thin Plate Spline でワープ**し、OSM 地図と重ねて精度を確認するツール。

### 使い方

1. ブラウザで `calibration-preview.html` を開く（ローカルサーバー必須）
2. 地図が自動読み込みされ、OSM 上に方言地図がオーバーレイ表示される
3. スライダーで不透明度を調整
4. GCP・残差ラインの表示切替が可能
5. **スペースキー**押下中：右下に凡例を拡大表示

### 対応地域（LAJ_017）

| 地域 | TSV | GCP数 | マーカー色 |
|------|-----|-------|----------|
| 本州・四国・九州 | `017-mapping.tsv` | 23点 | 赤 |
| 北海道 | `017-mapping-hk.tsv` | 15点 | 青 |
| 琉球・奄美 | `017-mapping-rk.tsv` | 30点 | 緑 |
| 先島諸島 | `017-mapping-sk.tsv` | 20点 | 橙 |

### 技術

- **Thin Plate Spline（TPS）**：GCP 点で完全一致する C² 連続の非線形ワープ
  - 25×25 連立方程式をガウス消去法で求解
  - 50×37 の均一グリッド（3700 三角形）で描画
- **IIIF プログレッシブロード**：初期は低解像度全体像、ズーム後は表示領域の高解像度クロップを取得
- **地域別マスク**：SVG ポリゴン（画像ピクセル座標）→ TPS で地理座標に変換 → Canvas `clip()` で切り抜き
- **Leaflet** カスタムレイヤー（`L.Layer.extend`）でキャンバスをマップコンテナ直下に配置（CSS transform ドリフト回避）

### GCP TSV フォーマット

```
# px py lon lat（スペース区切り、ヘッダなし）
10438 4724 142.49646387 37.33646354
10790 3460 142.49638243 39.00293991
...
```

`px`/`py` は IIIF 画像のピクセル座標（LAJ_017 は 11764×8386px）。

---

## 依存ライブラリ（CDN）

| ライブラリ | 用途 |
|-----------|------|
| [Leaflet 1.9.4](https://leafletjs.com/) | 地図表示 |
| [leaflet-iiif 3.0.0](https://github.com/mejackreed/Leaflet-IIIF) | IIIF タイルレイヤー |

---

## 関連リソース

- NIHU IIIF サーバー：`https://iiif.nihu.jp/`
- LAJ 地図一覧（NINJAL）：`https://mmsrv.ninjal.ac.jp/laj_map/`
- LAJ データベース（NIHU）：`https://iiif.nihu.jp/database/laj_map`
