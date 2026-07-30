# MakeLRC ドキュメント

このフォルダは、MakeLRC の仕様とファイル配置を記録する一次資料です。

## ドキュメント一覧

- [PROJECT_SPEC.md](PROJECT_SPEC.md): アプリの目的、機能、入出力、状態管理の仕様
- [ARCHITECTURE.md](ARCHITECTURE.md): ソースコードと配信構成、ファイルの責務
- [OPERATIONS.md](OPERATIONS.md): 開発・ビルド・検証・デプロイ手順
- [PROJECT_K_JSON_NOTE.md](PROJECT_K_JSON_NOTE.md): Project K Lyrics JSON v1対応の軽量設計メモ

実装を変更した場合は、動作に関係する仕様をこのフォルダの文書にも反映します。`make-lrc/`、`dist/`、`.wrangler*/`、ログファイルは生成物またはローカル作業データであり、仕様の一次資料ではありません。
