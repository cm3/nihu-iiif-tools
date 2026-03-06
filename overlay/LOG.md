# 開発ログ

## 2026-03 セッション3（現セッション）

### scripts/json-to-mapping.py（新規作成）
- overlay.html のキャリブレーション JSON から各 LAJ 地図用 GCP TSV を生成するスクリプト
- **手法**: JSON の対応点から「基準地図px → 対象地図px」のクロスマップ変換を推定し、
  基準地図（LAJ_017）の GCP TSV のピクセル座標を変換。地理座標は LAJ_017 から継承。
- 点数 ≥ 8 なら TPS（scipy `RBFInterpolator`）、< 8 ならアフィン最小二乗にフォールバック
- 本州・北海道・琉球・先島の 4 種 TSV を一括生成
  - `data/{NNN}-mapping.tsv`（22点）
  - `data/{NNN}-mapping-hk.tsv`（15点）
  - `data/{NNN}-mapping-rk.tsv`（30点）
  - `data/{NNN}-mapping-sk.tsv`（20点）
- `--base-id`・`--ref-dir` オプションで LAJ_018 基準など他の基準地図にも対応
- `data/LAJ_017_LAJ_001〜004.json` を処理済み（001〜003 はアフィン、004 は TPS）

### calibration-preview.html
- `<select id="selectMap">` を追加し `data/laj_maps.json` から候補を読み込む
- `MAP_CONFIGS`（例外設定）＋ `defaultMapConfig(id)`（命名規約ベース）に分離
  - LAJ_017：従来どおり 4 地域＋マスク＋凡例 bbox を明示
  - その他：`NNN-mapping*.tsv` が存在すれば 4 地域で自動表示
- `loadMap(id)` で地図切り替え時に既存レイヤ・マーカー・凡例をすべてリセット

---

## 2026-03 セッション2

### overlay.html（セッション3追加分）
- **矢印ボタンの押しっぱなし連続移動**：`mousedown`/`touchstart` で即時発火、300ms 後から 50ms 間隔で繰り返し
- **Leaflet キーボード操作を無効化**（`keyboard: false`）：地図にフォーカスがある状態で矢印キーが地図ビューを動かしてしまう問題を修正
- **パン範囲を拡張**：`setMaxBounds` を画像サイズ分の余白付き（`pad(1)`）に変更し、地図の端を画面中央まで持ち込めるように
  - 座標計算（`containerToFullPx`）は画像 `fullW`/`fullH` 基準のまま変更なし。JSON 出力への影響なし

---

## 2026-03 セッション2

### overlay.html
- デフォルト表示を LAJ_018/LAJ_019 → **LAJ_017（左）/ LAJ_018（右）** に変更
- 「左図を赤色調」チェックボックスを追加（位置リセットの右）
  - 緑の地形境界線を赤色に変換し、右図との視覚的区別を容易にする
  - `.leaflet-tile-pane` に `filter: hue-rotate(240deg)` を適用（コンテナへの適用は stacking context 問題で不可）
- **キーボードショートカット追加**
  - 矢印キー：オーバーレイの平行移動（ボタン操作と同等）
  - `A` / `S`：オーバーレイ地図を前/次の候補に切り替え（記録ありの場合は確認ダイアログ）
  - `Space`：キャリブレーション点を記録
  - `Esc`：記録をクリア（確認ダイアログあり）
  - `Enter`：JSON ダウンロード
  - `Shift`：ブレンドを 7:3（A）/ 3:7（B）に ease-in-out アニメーションで切り替え（現在値から遠い側へ）
- ショートカット一覧をキャリブレーション行の右端に常時表示

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
