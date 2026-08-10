# MakeLRC 運用手順

## 開発

```powershell
npm ci
npm run dev
```

## ビルドと検証

```powershell
npm test
npm run build
npx wrangler deploy --dry-run
```

確認項目:

1. タイムライン連続性の単体テストが通る。
2. `make-lrc/index.html` と `make-lrc/assets/` が生成される。
3. `make-lrc/index.html` の JavaScript / CSS の URL が `/assets/` から始まる。
4. `wrangler deploy --dry-run` が `./make-lrc` を assets directory として読み込む。
5. `/` と `/settings/` の SPA ルートで HTML が返る。

ローカル Worker で打刻操作を確認する場合は、次のコマンドを使う。

```powershell
npx wrangler dev --port 8788
```

音源を読み込み、通常の押下・離しでは時刻が確定すること、押下中に一時停止またはシークした場合は打刻が取り消されること、シーク完了前の打刻が拒否されることを確認する。

## 既存 Project K JSON のタイミング復旧

区間ごとに異なる同期ずれが入った詳細 JSON は、補正元を上書きせずに次のスクリプトで復旧する。

```powershell
npm run repair:project-k-timing -- `
  --json "C:\path\to\lyrics\main.json" `
  --enhanced-lrc "C:\path\to\edits\lyrics.lrc" `
  --midi "C:\path\to\midi\vocal.mid" `
  --midi-offset -0.75 `
  --output "C:\path\to\lyrics\main.corrected.json" `
  --report "C:\path\to\lyrics\main.corrected.report.md"
```

スクリプトはJSONとEnhanced LRCの行・セグメント本文が完全一致する場合だけ実行する。MIDI行頭で1～最終MIDI対応行を固定し、行内文字境界にはEnhanced LRCの相対時刻を使う。LRC内に逆転がある行は補正元JSONの正常な相対時刻へ限定的にフォールバックする。対応MIDIノートがない末尾行はLRC開始値を使い、明示終了がない最終セグメントだけを`inferred`とする。入力SHA-256、補正根拠、例外行はレポートとJSONの`extensions.com.shinyo.makelrc.timingRepair`へ記録する。

## デプロイ

```powershell
npm run deploy
```

このコマンドはビルド後に Wrangler で `make-lrc` Worker をデプロイする。Custom Domain `make-lrc.shinyo-n.com` の DNS、認証、実環境の HTTP 応答はローカルの dry-run だけでは確認できないため、デプロイ後に別途確認する。

## 整理ルール

ソースは `src/`、配信ロジックは `worker/`、仕様は `Docs/` に置く。ビルド成果物や Wrangler の状態、ログをコミットしない。出力先を変更する場合は `vite.config.ts`、`wrangler.jsonc`、`public/.assetsignore` の3箇所を同時に確認する。
