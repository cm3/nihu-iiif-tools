# 地図移動中に方言地図がどんどん薄くなる

更新日: 2026-03-25

## クローズ

- 2026-03-26 放置でクローズ
- `stale` は観測されたが、現状の実害は小さく、リロードで回避可能
- 必要になったら `WarpedImageLayer` の dispose 処理や fetch abort を再検討する

## 現象

- `overlay.html` で地図を切り替え続けていると、方言地図オーバーレイの不透明度が徐々に下がっていくように見える

## メモ

- 詳細は後で追記
- `calibration-preview.html` / `WarpedImageLayer` 周辺を確認候補
