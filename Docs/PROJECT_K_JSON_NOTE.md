# MakeLRC 独自JSON作成メモ

更新日: 2026-07-30  
状態: 1トラックのJSON出力と開始・終了打刻を実装中。mainへのマージ・デプロイは未実施。

## 目的

MakeLRCを、音声を再生しながら歌詞のタイミングを手作業で作成する単体ツールとして使う。作成した編集データを、カラオケ用の独自JSON（`Project K Lyrics JSON v1`）を正規形式として保存し、そこからLRC系の形式も出力できるようにする。

Synthesizer Vのプロジェクト、SVPファイル、Synthesizer VのAPI、MIDIノートは入力要件にしない。MakeLRCで入力した歌詞と、音声の `HTMLAudioElement.currentTime` をデータの根拠にする。

## 作成フロー

```text
音声ファイルをローカルで読み込む
        ↓
歌詞を入力・貼り付ける
        ↓
行単位または詳細単位を選ぶ
        ↓
音声を再生し、currentTimeで打刻する
        ↓
MakeLRCの編集モデル
        ├─ Project K Lyrics JSON v1
        ├─ LRC
        ├─ Enhanced LRC
        ├─ WebVTT
        └─ SRT
```

音声はサーバーへ送らず、JSONにも埋め込まない。JSONへ保存するのは歌詞と時刻であり、音声ファイル名などの補助情報は絶対パスを除いて任意メタデータへ置く。

## JSONの最小出力

MakeLRCが単体で作成する初期JSONは、1つの編集トラックを持つ。`tracks`を採用しているのは、将来の複数パート・複数歌唱への拡張余地を残すためである。

```json
{
  "format": "project-k-lyrics",
  "formatVersion": 1,
  "timeUnit": "milliseconds",
  "timingQuality": "mixed",
  "metadata": {
    "title": "曲名",
    "artist": "アーティスト名",
    "language": "ja",
    "source": {
      "application": "MakeLRC",
      "kind": "manual-authoring",
      "audioName": "song.mp3"
    }
  },
  "tracks": [
    {
      "id": "main",
      "name": "Main",
      "partIds": [],
      "lines": [
        {
          "id": "line-0001",
          "startTimeMs": 1200,
          "endTimeMs": 3100,
          "text": "君の声",
          "timingQuality": "mixed",
          "displayMode": "fine",
          "segments": [
            {
              "id": "line-0001-segment-0001",
              "startTimeMs": 1200,
              "endTimeMs": 1750,
              "text": "君",
              "granularity": "fine",
              "fineUnit": "character",
              "timingQuality": "inferred"
            },
            {
              "id": "line-0001-segment-0002",
              "startTimeMs": 1750,
              "endTimeMs": 3100,
              "text": "の声",
              "granularity": "fine",
              "fineUnit": "character",
              "timingQuality": "inferred"
            }
          ]
        }
      ]
    }
  ],
  "extensions": {
    "com.shinyo.makelrc": {
      "authoringMode": "fine",
      "endTimePolicy": "next-start-or-default"
    }
  }
}
```

## MakeLRC内部モデルとの対応

現在のMakeLRCの編集状態は、おおむね次の値で表現できる。

| MakeLRCの状態 | JSONへの対応 |
| --- | --- |
| `lines: string[]` | `tracks[0].lines[].text` |
| `timings: number[]`（秒） | `lines[].startTimeMs = round(seconds * 1000)` |
| `segmentTimings: number[][]`（秒） | `segments[].startTimeMs` |
| 行番号 | `line-0001`のような安定したローカルID |
| 詳細トークンの順序 | `segments[]`の配列順 |
| 選択形式 | JSONではなく出力プロファイルとして扱う |

JSONからSynthesizer Vのノートを作ることはしない。JSONはMakeLRCの作成結果であり、再編集する場合もMakeLRC自身の編集データとして扱う。

## 打刻モード

### 行モード

- 1行を1セグメントとして扱う。
- ユーザーが打刻した `currentTime` を行・セグメントの開始時刻にする。
- `displayMode` と `granularity` は `line` とする。
- 行単位のLRC、WebVTT、SRTに最も自然に変換できる。

### 詳細モード

- 日本語を含む行は文字単位、その他の行は単語または文字単位に分割する現在の方針を引き継ぐ。
- ユーザーが打刻した時刻を各セグメントの開始時刻にする。
- 自動分割したトークンの文字列を勝手に正規化・翻訳しない。
- `displayMode: "fine"` とし、`fineUnit`は `character`、`word`、`mixed` のいずれかで記録する。

詳細モードのトークン分割は表示・打刻を助けるためのもので、発音や音節を解析した結果とはみなさない。

## 終了時刻と `timingQuality`

現在のMakeLRCは主に開始時刻を打刻するため、終了時刻を別途明示しない作成結果が発生する。JSON v1は終了時刻を必須とするため、保存時のポリシーを固定する。

- 打刻した開始時刻は、音声の `currentTime` から取得する。
- セグメントの終了時刻は、同じ行の次のセグメント開始時刻を第一候補にする。
- 最後のセグメントは行の終了時刻、行の終了時刻は次の行の開始時刻を第一候補にする。
- 最終行・最終セグメントなど次の開始時刻がない場合は、既定の末尾長を使う。
- このように自動生成した終了時刻は `inferred` とする。
- 将来、終了位置をユーザーが直接調整できるUIを追加した場合だけ、その区間を `exact` とできる。
- 開始時刻が確定でも終了時刻が推定の場合、行または文書全体は `mixed` とする。
- 推定値を `exact` として出力しない。

詳細モードでは、終了時刻ポリシーを次の2種類から選択できる。

- `same-line-only`（同じ行内のみ）: セグメントの終了時刻は同じ行の次のセグメント開始時刻を使う。行をまたいだ補完や既定末尾長による補完は行わず、最後のセグメントには行またはセグメントの明示的な終了時刻が必要となる。
- `none`（補完しない）: 終了時刻を自動生成しない。各セグメントまたは最後のセグメントに対応する行の終了時刻が記録されていない場合は、対象箇所を検証エラーとして表示する。

既定の末尾長は仕様で定数化し、行モードの JSON の `extensions.com.shinyo.makelrc.endTimePolicy` に記録する。詳細モードでは選択した `same-line-only` または `none` を記録する。後から別の既定値で再計算して、利用者の保存データを黙って変更しない。終了時刻が不足する場合は、位置を示す検証エラーとして JSON 出力を止める。

## 再生テンポとタイミング警告

- 音声の再生速度は `0.5x`、`0.75x`、`1x`、`1.25x`、`1.5x`、`2x` から選択する。
- HTML Audio のピッチ維持設定を有効にする。タイムスタンプは引き続き音声の `currentTime` を基準にする。
- 詳細モードで、ある文字の開始時刻が直前の文字の終了時刻より前の場合、行番号・文字番号・文字内容・両方の時刻を画面に表示する。
- 行境界でも同じ矛盾を検出し、JSON出力時は位置を含む検証エラーとして扱う。

## 行・セグメントの検証

JSON出力前に次を検証する。

- `format`が`project-k-lyrics`であること
- `formatVersion`が`1`、`timeUnit`が`milliseconds`であること
- トラック、行、セグメントのIDが重複していないこと
- 時刻が0以上の安全な整数であること
- すべての区間で `endTimeMs > startTimeMs` であること
- セグメントが行の時間範囲内にあること
- 行の`text`とセグメント本文の連結が一致すること
- 空行・空セグメントを出力しないこと
- `timingQuality`を実際の値より良く見せていないこと

検証エラーがある場合は、不完全なJSONをダウンロードさせず、行番号・セグメント番号を示して修正を促す。

## 出力プロファイル

JSONを正規の作成結果とし、既存形式は同じ編集状態から生成する。

| プロファイル | 拡張子 | 出力方針 |
| --- | --- | --- |
| Project K Lyrics JSON v1 | `.lyrics.json` | 全トラック、行、セグメント、品質を保持 |
| LRC | `.lrc` | 行開始時刻を出力。詳細時刻・終了時刻は失われる |
| Enhanced LRC | `.lrc` | 行とセグメントの開始時刻を出力。終了時刻は表現しない |
| WebVTT | `.vtt` | 行単位の字幕。終了時刻は推定範囲 |
| SRT | `.srt` | 行単位の字幕。終了時刻は推定範囲 |

別形式へ出力しても、編集中のJSON相当データを置き換えない。形式変換による情報欠落は画面上で通知する。

## JSONの再編集

将来的には、MakeLRC自身が作成した `.lyrics.json` を再度開いて編集できるようにする。ただし初期の設計対象は「MakeLRCで新規作成してJSONへ保存する流れ」であり、Synthesizer Vや他アプリが作成したJSONを完全に取り込むことは必須要件にしない。

再編集時は、未変更の`id`、終了時刻、`timingQuality`、`extensions`を保持する。変更した行・セグメントだけを推定へ降格できるように、編集操作の単位を記録する。

## 実装しない事項

- Synthesizer Vとの連携
- SVP、MIDI、Synthesizer V APIの読み込み
- 音声のサーバーアップロード
- JSONへの音声バイナリ埋め込み
- このメモ段階でのUI・パーサー・出力処理の実装

## 参照仕様

- `karaoke-saiten-web/Docs/16_LYRICS_TIMING_FORMAT_SPECIFICATION.md`
- `karaoke-saiten-web/Docs/04_KSONG_SPECIFICATION.md`
- `MakeLRC/Docs/PROJECT_SPEC.md`
