# MakeLRC 運用手順

## 開発

```powershell
npm ci
npm run dev
```

## ビルドと検証

```powershell
npm run build
npx wrangler deploy --dry-run
```

確認項目:

1. `make-lrc/index.html` と `make-lrc/assets/` が生成される。
2. `make-lrc/index.html` の JavaScript / CSS の URL が `/assets/` から始まる。
3. `wrangler deploy --dry-run` が `./make-lrc` を assets directory として読み込む。
4. `/` と `/settings/` の SPA ルートで HTML が返る。

## デプロイ

```powershell
npm run deploy
```

このコマンドはビルド後に Wrangler で `make-lrc` Worker をデプロイする。Custom Domain `make-lrc.shinyo-n.com` の DNS、認証、実環境の HTTP 応答はローカルの dry-run だけでは確認できないため、デプロイ後に別途確認する。

## 整理ルール

ソースは `src/`、配信ロジックは `worker/`、仕様は `Docs/` に置く。ビルド成果物や Wrangler の状態、ログをコミットしない。出力先を変更する場合は `vite.config.ts`、`wrangler.jsonc`、`public/.assetsignore` の3箇所を同時に確認する。
