# 開発ログ

## 2026-03 セッション2（現セッション）

### overlay.html
- デフォルト表示を LAJ_018/LAJ_019 → **LAJ_017（左）/ LAJ_018（右）** に変更
- 「左図を赤色調」チェックボックスを追加（位置リセットの右）
  - 緑の地形境界線を赤色に変換し、右図との視覚的区別を容易にする
  - `.leaflet-tile-pane` に `filter: hue-rotate(240deg)` を適用（コンテナへの適用は stacking context 問題で不可）

### calibration-preview.html
- **北海道マスクポリゴン調整**
  - 下端 y=2860 → y=3400（十勝を含むよう延長）
  - 右端 x=11764 → x=8800（根室東沖で切断、北方領土除外）
- **琉球・奄美レイヤ追加**（`017-mapping-rk.tsv`、30 GCP）
  - `MASK_RYUKYU` ポリゴン（ユーザー提供 6 頂点）
  - GCP マーカー：緑色
- **先島諸島レイヤ追加**（`017-mapping-sk.tsv`、20 GCP）
  - `MASK_SAKISHIMA` ポリゴン（ユーザー提供 5 頂点）
  - GCP マーカー：橙色
- **凡例ポップアップ機能追加**
  - ポリゴン `123,45 / 141,3573 / 4442,3565 / 4428,39`
  - スペースキー押下中に右下へ fixed 表示（IIIF から 1400px 幅で取得、初回のみフェッチ）
  - 「Space キーで凡例表示」ヒントを画面下部に常時表示

### ファイル整理
- `_sandbox/` → `_local/` にリネーム（.gitignore も更新）
- `./data/` を廃止し内容を `_local/` へ統合
  - `data/017-mapping.tsv`（本州+HK結合版）→ `_local/017-mapping-combined.tsv`
  - `data/017-mapping-hk.tsv` → `_local/`
  - `data/LAJ_018_LAJ_001.json` → `_local/`（`overlay/data/` と同一）
  - 重複ファイル・ロックファイルは削除
- `_local/index.md` を作成（各ファイルの説明）

---

## 2026-01〜02 セッション1

### calibration-preview.html（新規作成）

**初期実装**
- Leaflet + OSM ベースマップ上に NIHU IIIF 画像をワープ表示
- GCP（地上基準点）TSV を読み込み、Delaunay 三角分割 + アフィンワープで描画
- GCP マーカー表示（実測点・推定点・残差ライン）

**バグ修正**
- Delaunator v5 が ESM 専用のためエラー → v4 に固定
- ズームアウト時にオーバーレイが右方向へ大きくズレる問題
  - 原因：canvas を `overlayPane`（CSS transform で移動するペイン）に配置していた
  - 修正：canvas をマップコンテナ直下に配置し `latLngToContainerPoint` で描画

**アルゴリズム改善**
- 「古地図」→「方言地図」に名称変更
- IIIF プログレッシブロード実装
  - 初期：全体を低解像度（1024px）で取得
  - `moveend`/`zoomend` 時：表示領域を逆ワープして IIIF region を計算し高解像度取得
- Piecewise Affine（Delaunay）→ **Thin Plate Spline（TPS）＋均一グリッド** にアップグレード
  - 25×25 連立方程式をガウス消去法で解く
  - 50×37 均一グリッド（1887点、3700三角形）で描画
  - GCP 点で完全一致、C² 連続の滑らかな変換

**地域別マスク機能**
- SVG ポリゴン（画像ピクセル座標）→ TPS で地理座標に変換 → Canvas `clip('evenodd')`
- 本州マスク（ユーザー提供 SVG ポリゴン、14 頂点）
- 北海道レイヤ追加（`017-mapping-hk.tsv`、15 GCP）
  - 初期マスク：矩形 `4300,0 11764,0 11764,2860 4300,2860`
  - HK TSV が `overlay/data/` に存在せず 0 GCP になる問題 → パスを修正

### overlay.html（既存ファイルへの機能追加）

git コミット履歴より：
- `98477dc` 初期コミット
- `b9e693f` 地図候補選択・キャリブレーション記録機能追加
- `e739be8` UI 改善・ズーム同期バグ修正
- `4750625` オーバーレイオフセットのズームスケーリング修正
