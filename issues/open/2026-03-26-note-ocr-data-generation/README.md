# 注記 OCR データを作成する

更新日: 2026-03-26

## 目的

日本言語地図注記一覧のページ画像から、地点番号列とその他本文をページ単位 JSON に抽出し、後続の検索・照合・構造化に使える OCR データを作る。

## 完了条件

- ページ画像群を入力として `page_000.json` などのページ単位 JSON を生成できる
- 全ページを束ねた `pages.json` を出力できる
- 各 JSON に少なくとも以下が入る
  - `source_image`
  - `page_index`
  - `source_id`
  - `location_numbers`
  - `other_text`
  - `model`
- スキーマとサンプルが残っていて、他者へ引き継げる

## この issue に同梱しているもの

- `extract_location_numbers_openai.py`
  - ページ画像を OpenAI Responses API に送り、地点番号配列とその他テキストを JSON 保存するスクリプト
- `requirements.txt`
  - 最低限の依存
- `page_record.schema.json`
  - 保存される 1 ページ分 JSON の想定形
- `sample_pages.json`
  - 実際に生成された `pages.json` のサンプル

## 想定する入力構成

```text
iiif-image-cache/
  note-ocr/
    017-019/
      dl_pages/
        page_000.jpg
        page_001.jpg
        ...
      out_openai_pages/
```

`ids.txt` 相当がある場合は、画像順と同じ順序で 1 行 1 ID を置く。

```text
iiif-image-cache/
  note-ocr/
    017-019/
      dl_pages/
        ids.txt
        page_000.jpg
        page_001.jpg
        ...
      out_openai_pages/
```

`iiif-image-cache/` はローカル作業用の一時置き場として使い、Git には載せない前提とする。

## 出力

- `page_000.json` などのページ単位 JSON
- `pages.json` のまとめ配列

`source_id` は基本的に各ページの IIIF Image API `serviceId`。
さらに `metadata.json` を OCR 時に読ませると、各ページ JSON に以下も入る。

- `source_manifest`
- `source_canvas_id`
- `source_canvas_label`
- `source_service_id`
- `source_ljc_id`
- `source_map_numbers`
- `source_title`

これで OCR 結果だけを見ても、元の IIIF manifest / canvas / service へ辿れる。

## 事前準備: 注記ページ JPG の取得

`download_note_pages.py` で、対象地図番号に対応する注記 manifest を引き、`dl_pages/` に `page_000.jpg` 形式で保存できる。

```bash
python ./issues/open/2026-03-26-note-ocr-data-generation/download_note_pages.py \
  --map-numbers 017 018 019 \
  --out-root ./iiif-image-cache/note-ocr/017-019 \
  --max-width 2400
```

このコマンドは以下を作る。

- `iiif-image-cache/note-ocr/017-019/dl_pages/page_000.jpg ...`
- `iiif-image-cache/note-ocr/017-019/dl_pages/ids.txt`
- `iiif-image-cache/note-ocr/017-019/metadata.json`

`--max-width` は既定で `2400`。縦横比は維持される。

## 地点番号の正規化

- 新規 OCR では、`location_numbers` をそのまま信用せず、`other_text` からも地点番号を拾い直して統合する
- 先頭ゼロや末尾ゼロ、末尾ピリオドの揺れを吸収したうえで、`overlay/data/survey-points.json` に存在する正規表記へ寄せる
  - 例: `747.7` / `0747.70` → `0747.70`
  - 例: `1762.1` / `1762.10` → `1762.10`
  - 例: `1770.18.` → `1770.18`

既存データを補正する場合:

```bash
python ./issues/open/2026-03-26-note-ocr-data-generation/normalize_ocr_pages.py \
  ./iiif-image-cache/note-ocr/017-019/out_openai_pages
```

## 実行前提

- `OPENAI_API_KEY` を環境変数で設定済み
- Python で `openai` と `pillow` が使える

必要なら:

```bash
pip-local install -r ./issues/open/2026-03-26-note-ocr-data-generation/requirements.txt
```

## 実行例

### 10枚だけ試す

```bash
python ./issues/open/2026-03-26-note-ocr-data-generation/extract_location_numbers_openai.py \
  --images-dir ./iiif-image-cache/note-ocr/017-019/dl_pages \
  --ids-file ./iiif-image-cache/note-ocr/017-019/dl_pages/ids.txt \
  --source-metadata ./iiif-image-cache/note-ocr/017-019/metadata.json \
  --out-dir ./iiif-image-cache/note-ocr/017-019/out_openai_pages \
  --limit 10
```

### 全件処理

```bash
python ./issues/open/2026-03-26-note-ocr-data-generation/extract_location_numbers_openai.py \
  --images-dir ./iiif-image-cache/note-ocr/017-019/dl_pages \
  --ids-file ./iiif-image-cache/note-ocr/017-019/dl_pages/ids.txt \
  --source-metadata ./iiif-image-cache/note-ocr/017-019/metadata.json \
  --out-dir ./iiif-image-cache/note-ocr/017-019/out_openai_pages
```

### `ids.txt` なしで処理

```bash
python ./issues/open/2026-03-26-note-ocr-data-generation/extract_location_numbers_openai.py \
  --images-dir ./iiif-image-cache/note-ocr/017-019/dl_pages \
  --source-metadata ./iiif-image-cache/note-ocr/017-019/metadata.json \
  --out-dir ./iiif-image-cache/note-ocr/017-019/out_openai_pages
```

## 実装メモ

- モデル既定値は `gpt-5-mini`
- 1 ページにつき
  - ページ全体画像
  - 左帯 crop
  の 2 枚を送る
- JSON Schema を強制し、
  - `location_numbers`: 地点番号配列
  - `other_text`: その他テキスト
  を返させる

## 注意点

- 位置情報 `x,y,w,h` は保存していない
- 地点番号は OCR ではなくモデル推定なので、微妙な数字は誤ることがある
- 左帯の比率は資料ごとに異なるため、必要なら `--left-ratio` を調整する
- 既存 JSON を上書きしたい場合は `--overwrite` を付ける

## 出力例

```json
{
  "source_image": "page_000.jpg",
  "page_index": 0,
  "source_id": "https://example.org/iiif/image/abc",
  "location_numbers": ["101", "102", "103.5"],
  "other_text": "井戸 ...",
  "model": "gpt-5-mini"
}
```
