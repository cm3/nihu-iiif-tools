# OCR レビュー API サーバを立てる

更新日: 2026-04-23

## 背景と目的

OCR 結果（全 242 バッチ）を `overlay/data/ocr-review-pages.json` に収めると
推定 200MB・340 万行になりブラウザで扱えない。
SQLite + FastAPI をさくらのサーバ 1 台に置き、
`ocr-review.html` からフェッチで読み書きする構成に切り替える。

副次効果として、レビュー画面での修正を直接 DB に保存できる
（現行の「JSON をダウンロードして手動コミット」フローを廃止）。

## 完了条件

- さくらのサーバ上で FastAPI + SQLite が動いている
- `ocr-review.html` がフェッチで OCR データを取得・保存できる
- 作業者が magic link を踏むだけで認証できる
- 管理者が CLI でトークン発行 URL を生成できる

## アーキテクチャ

```
さくらサーバ（1 台）
├── FastAPI  (uvicorn, systemd で常駐)
│   ├── GET  /pages?batch=&offset=&limit=&error_only=
│   ├── GET  /pages/{page_id}
│   ├── PUT  /pages/{page_id}          # レビュー保存
│   ├── GET  /auth/activate?otp=...    # magic link → localStorage にトークン保存
│   └── POST /admin/issue-token        # OTP 発行（IP 制限）
└── SQLite   review.db
    ├── pages        (OCR 結果 + レビュー修正)
    └── auth_tokens  (トークン・OTP 管理)
```

静的ファイル（`ocr-review.html` 等）は同じサーバの nginx から配信し、
`/api/` を FastAPI にリバースプロキシする。

## 認証方式

**localStorage トークン + magic link 方式**

1. 管理者が `python issue-token.py` を実行 → 一回限りの OTP URL を取得
2. 作業者が URL を踏む → サーバが OTP を失効させ、長期トークンを発行
3. ブラウザが `localStorage.setItem('ocr_token', token)` で保存
4. 以降の API リクエストは `Authorization: Bearer <token>` ヘッダを付与

### セキュリティ上の決定事項

- **HTTPS 必須**（Let's Encrypt）
- OTP は初回アクセスで即失効（ブラウザ履歴から再利用不可）
- トークンの有効期限: 180 日（サーバ側で検証）
- トークンは作業者ごとに発行・個別失効可能
- `/admin/issue-token` は IP アドレス制限で保護（パスワード不要）
- XSS リスク: ツールは研究者限定かつ外部入力を HTML に直接挿入しないため許容範囲

## DB スキーマ（案）

```sql
CREATE TABLE pages (
    id          TEXT PRIMARY KEY,   -- "{ljcId}_{page_index}"
    ljc_id      TEXT NOT NULL,
    batch_name  TEXT NOT NULL,
    page_index  INTEGER NOT NULL,
    source_id   TEXT,
    source_image TEXT,
    location_numbers TEXT,          -- JSON array
    other_text  TEXT,
    model       TEXT,
    has_error   INTEGER DEFAULT 0,
    review_note TEXT,               -- レビュー修正メモ
    reviewed_at TEXT,               -- ISO 8601
    reviewed_by TEXT,               -- トークンの作業者名
    created_at  TEXT NOT NULL
);

CREATE TABLE auth_tokens (
    token       TEXT PRIMARY KEY,
    label       TEXT,               -- 作業者名など
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    last_used   TEXT
);

CREATE TABLE otps (
    otp         TEXT PRIMARY KEY,
    token       TEXT NOT NULL,      -- 発行済みトークン
    used        INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL
);
```

## 実装ファイル構成（予定）

```
issues/open/2026-04-23-ocr-review-api/
├── README.md          (このファイル)
├── app/
│   ├── main.py        FastAPI アプリ本体
│   ├── db.py          SQLite 接続・マイグレーション
│   ├── auth.py        トークン検証・OTP 処理
│   └── import_ocr.py  iiif-image-cache/note-ocr/*/out_openai_pages を DB に取り込む
├── issue-token.py     管理者用 CLI（OTP URL を標準出力）
└── requirements.txt
```

## デプロイ手順（予定）

```bash
# さくらサーバ上で
git clone ...
cd issues/open/2026-04-23-ocr-review-api
pip install -r requirements.txt

# OCR データをインポート
python app/import_ocr.py --cache-root /path/to/iiif-image-cache/note-ocr

# systemd サービスとして起動
uvicorn app.main:app --host 127.0.0.1 --port 8000

# nginx リバースプロキシ設定（/api/ → localhost:8000）
```

## 残課題

- `ocr-review.html` のフェッチ対応（現行の静的 JSON ロードを置き換え）
- インポートスクリプトの差分更新（OCR が追加されるたびに再インポート）
- レビュー保存の競合制御（同一ページを複数作業者が同時編集した場合）
