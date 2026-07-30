# MakeLRC 構成仕様

## ファイルの責務

| パス | 種別 | 責務 |
| --- | --- | --- |
| `src/App.tsx` | ソース | アプリ状態、音声再生、歌詞編集、出力処理 |
| `src/main.tsx` | ソース | React アプリのエントリポイント |
| `src/styles.css` | ソース | UI スタイル |
| `public/` | 静的ソース | ビルド時に配信する静的ファイル。`.assetsignore` もここに置く |
| `index.html` | ソース | Vite の HTML エントリポイント |
| `vite.config.ts` | 設定 | React/Vite 設定。出力先は `make-lrc/`、公開ベースは `/` |
| `worker/index.ts` | 配信ソース | Workers Static Assets へリクエストを渡すエントリポイント |
| `wrangler.jsonc` | 設定 | Worker 名、Custom Domain、Static Assets の設定 |
| `Docs/` | 仕様 | 本プロジェクトの仕様・運用ドキュメント |

## 生成物・ローカル専用データ

- `make-lrc/`: `npm run build` が作る、Workers 用ビルド成果物
- `dist/`: 旧出力先の残骸。現在は使用しない
- `.wrangler/`, `.wrangler-config/`: Wrangler のキャッシュ・状態・ログ
- `worker/worker-configuration.d.ts`: Wrangler が生成する型定義
- `*.log`, `tsconfig.tsbuildinfo`: ローカル検証で発生する一時ファイル

これらは `.gitignore` で管理対象外とし、ソースや仕様と混在させない。

## 配信経路

### Cloudflare Workers

`wrangler.jsonc` の `assets.directory` は `./make-lrc`。Custom Domain `make-lrc.shinyo-n.com` のルートで Worker が先に実行され、リクエストを Static Assets に渡す。SPA の存在しないパスは `index.html` にフォールバックする。
