# MakeLRC

音源を再生しながらタイミングに合わせて打刻し、LRC などの同期歌詞ファイルを作成する Web アプリです。

仕様・構成・運用手順は [Docs/README.md](Docs/README.md) にまとめています。

## Development

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```

## Current Prototype

- ローカル音源を読み込み
- 歌詞を入力または貼り付け。空行は自動削除
- Space または大きな打刻エリアで、押下時に開始・離した時に終了を記録
- 打刻単位を `行`、`詳細` から選択。詳細では日本語を含む行は文字単位、その他は単語単位で打刻
- 打ち直しで現在行のタイムスタンプの少し前へ戻って再試行
- 間奏追加で `♪ 間奏` 行を挿入
- Project K Lyrics JSON v1（1トラック）、LRC、Enhanced LRC、WebVTT、SRT として出力
- 出力形式を変更しても打刻済みの行タイミングを維持し、選択中の形式へ変換
- 詳細モードでは終了時刻を「同じ行内のみ補完」または「補完しない」から選択
- JSONの終了時刻は押下・離しで記録でき、補完しない場合は未記録の終了時刻を推定しない
- 文字の開始時刻が直前の文字の終了時刻より前になった場合、行・文字位置と時刻を警告
- テンポを 0.5x〜2x に変更でき、再生速度変更時もピッチを維持
- 作業中の歌詞とタイミングを `localStorage` に一時保存

## Shortcuts

- Space: 押下で現在行の開始、離して終了
- Shift + Space: 再生 / 停止
- R: 現在行を打ち直し
- ArrowUp: 前の行
- ArrowDown: 次の行
- J: 3秒戻る
- K: 3秒進む
- Ctrl / Cmd + Z: 取消
- Ctrl / Cmd + Y: やり直し
- ?: ヘルプを表示 / 非表示
