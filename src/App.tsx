import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
} from "react";

const STORAGE_KEY = "makelrc.autosave.v3";
const LANGUAGE_STORAGE_KEY = "makelrc.language";
const THEME_STORAGE_KEY = "makelrc.theme";
const RETAKE_MARGIN_SECONDS = 2.5;
const SEEK_STEP_SECONDS = 3;
const DEFAULT_END_TIME_SECONDS = 4;
const MIN_TIMING_INTERVAL_SECONDS = 0.001;
const TEMPO_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const GAP_LINE_TEXT = "♪ 間奏";
const ATTACHED_KANA_PATTERN = /^[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮゕゖヶー]$/;
const OPENING_BRACKETS = new Set(Array.from("「『（([［｛{【〈《〔〝“‘"));
const CLOSING_BRACKETS = new Set(Array.from("」』）)]］｝}】〉》〕〟”’"));
const AUDIO_FILE_EXTENSIONS = new Set([
  "aac",
  "aif",
  "aiff",
  "caf",
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "oga",
  "ogg",
  "opus",
  "wav",
  "weba",
  "webm",
]);

type OutputFormat = "project-k-json" | "lrc" | "enhanced-lrc" | "webvtt" | "srt";
type TimingMode = "line" | "segment";
type DetailedEndPolicy = "same-line-only" | "none";
type Language = "ja" | "en";
type ThemeMode = "light" | "dark";

const TEXT = {
  ja: {
    appLabel: "MakeLRC エディタ",
    help: "ヘルプ",
    copy: "コピー",
    save: "保存",
    language: "English",
    darkTheme: "ダーク",
    lightTheme: "ライト",
    shortcuts: "ショートカット",
    stampCurrentLine: "現在行を打刻",
    playPause: "再生/停止",
    playPauseHelp: "再生 / 停止",
    previousNextHelp: "前の行 / 次の行",
    seekHelp: "3秒戻る / 3秒進む",
    undo: "1つ戻す",
    redo: "1つ進める",
    helpToggle: "ヘルプを表示 / 非表示",
    audio: "音源",
    chooseAudio: "音源を選択",
    lyricsInput: "歌詞入力",
    lyrics: "歌詞",
    paste: "貼り付け",
    lyricsPlaceholder: "ここに歌詞を入力または貼り付け。空行は自動で削除されます。",
    timingControls: "タイミング操作",
    enterLyrics: "歌詞を入力してください",
    tapToStamp: "押下で開始・離して終了",
    previousLine: "前の行",
    nextLine: "次の行",
    seekBack: "3秒戻る",
    seekForward: "3秒進む",
    timingUnit: "打刻単位",
    line: "行",
    detail: "詳細",
    detailedEndPolicy: "詳細終了時刻",
    sameLineOnly: "同じ行内のみ",
    noCompletion: "補完しない",
    tempo: "テンポ",
    tempoPitchNote: "ピッチ固定",
    timingWarningTitle: "タイミングの矛盾",
    format: "形式",
    addGap: "間奏を追加",
    clearAllTimings: "全時刻クリア",
    outputPreview: "出力プレビュー",
    output: "出力",
    outputEmpty: "出力はここに表示されます。",
    outputFormatLossNotice: "この形式では終了時刻または詳細なタイミングが失われます。正規データは Project K JSON で保存してください。",
    jsonTimingIncomplete: "JSONを出力するには、すべての行の開始時刻と必要な終了時刻を打刻してください。",
    jsonValidationError: "JSONを出力できません",
    lineCount: "行",
  },
  en: {
    appLabel: "MakeLRC editor",
    help: "Help",
    copy: "Copy",
    save: "Save",
    language: "日本語",
    darkTheme: "Dark",
    lightTheme: "Light",
    shortcuts: "Shortcuts",
    stampCurrentLine: "Stamp current line",
    playPause: "Play/Pause",
    playPauseHelp: "Play / pause",
    previousNextHelp: "Previous line / next line",
    seekHelp: "Back 3 seconds / forward 3 seconds",
    undo: "Step back",
    redo: "Step forward",
    helpToggle: "Show / hide help",
    audio: "Audio",
    chooseAudio: "Choose audio",
    lyricsInput: "Lyrics input",
    lyrics: "Lyrics",
    paste: "Paste",
    lyricsPlaceholder: "Type or paste lyrics here. Blank lines are removed automatically.",
    timingControls: "Timing controls",
    enterLyrics: "Enter lyrics to start",
    tapToStamp: "Press to start / release to end",
    previousLine: "Previous line",
    nextLine: "Next line",
    seekBack: "Back 3s",
    seekForward: "Forward 3s",
    timingUnit: "Timing unit",
    line: "Line",
    detail: "Detail",
    detailedEndPolicy: "Detail end times",
    sameLineOnly: "Same line only",
    noCompletion: "Do not complete",
    tempo: "Tempo",
    tempoPitchNote: "Pitch preserved",
    timingWarningTitle: "Timing contradiction",
    format: "Format",
    addGap: "Add gap",
    clearAllTimings: "Clear all timings",
    outputPreview: "Output preview",
    output: "Output",
    outputEmpty: "Output will appear here.",
    outputFormatLossNotice: "This format loses end times or detailed timing. Keep Project K JSON as the canonical data.",
    jsonTimingIncomplete: "Stamp the required start and end times to export JSON.",
    jsonValidationError: "Could not export JSON",
    lineCount: " lines",
  },
} satisfies Record<Language, Record<string, string>>;

function readStoredLanguage(): Language {
  return localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "ja";
}

function readStoredTheme(): ThemeMode {
  return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

function normalizeTempoRate(value: unknown) {
  return typeof value === "number" && TEMPO_RATES.includes(value as typeof TEMPO_RATES[number])
    ? value
    : 1;
}

function normalizeDetailedEndPolicy(value: unknown): DetailedEndPolicy {
  return value === "none" ? "none" : "same-line-only";
}

function translateStatus(status: string, language: Language) {
  if (language === "ja") return status;
  const statusMap: Record<string, string> = {
    "一時保存を復元": "Draft restored",
    "未保存": "Not saved",
    "再生できません": "Could not play",
    "コピーしました": "Copied",
    "音源ファイルを選択してください": "Choose an audio file",
    "一時保存済み": "Draft saved",
    "一時保存できません": "Could not save draft",
  };
  return statusMap[status] ?? status;
}

type Snapshot = {
  timings: Array<number | undefined>;
  endTimings: Array<number | undefined>;
  segmentTimings: Array<Array<number | undefined>>;
  segmentEndTimings: Array<Array<number | undefined>>;
  activeIndex: number;
  activeSegmentIndex: number;
};

type Draft = {
  lyrics: string;
  timings: Array<number | undefined>;
  endTimings?: Array<number | undefined>;
  segmentTimings?: Array<Array<number | undefined>>;
  segmentEndTimings?: Array<Array<number | undefined>>;
  activeIndex: number;
  activeSegmentIndex?: number;
  format: OutputFormat;
  timingMode?: TimingMode;
  detailedEndPolicy?: DetailedEndPolicy;
  tempoRate?: number;
};

type OutputRow = {
  index: number;
  text: string;
  time: number | undefined;
  endTime: number | undefined;
  segmentTimings: Array<number | undefined>;
  segmentEndTimings: Array<number | undefined>;
};

type OutputPreviewBlock = {
  key: string;
  lines: string[];
  sourceIndex?: number;
};

type TimingCapture = {
  lineIndex: number;
  segmentIndex: number;
  startTime: number;
};

function normalizeLyrics(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseLines(text: string) {
  const normalized = normalizeLyrics(text);
  return normalized ? normalized.split("\n") : [];
}

function formatLrcTime(seconds: number | undefined) {
  if (!Number.isFinite(seconds)) return "--:--.--";
  const totalCentiseconds = Math.max(0, Math.round((seconds ?? 0) * 100));
  const minutes = Math.floor(totalCentiseconds / 6000);
  const secs = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function formatSrtTime(seconds: number | undefined) {
  const millis = Math.max(0, Math.round((seconds ?? 0) * 1000));
  const hours = Math.floor(millis / 3600000);
  const minutes = Math.floor((millis % 3600000) / 60000);
  const secs = Math.floor((millis % 60000) / 1000);
  const ms = millis % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function formatWebVttTime(seconds: number | undefined) {
  return formatSrtTime(seconds).replace(",", ".");
}

function getRows(
  lines: string[],
  timings: Array<number | undefined>,
  endTimings: Array<number | undefined> = [],
): OutputRow[] {
  return lines.map((text, index) => ({
    index,
    text,
    time: timings[index],
    endTime: endTimings[index],
    segmentTimings: [],
    segmentEndTimings: [],
  }));
}

function getRowsWithSegments(
  lines: string[],
  timings: Array<number | undefined>,
  endTimings: Array<number | undefined>,
  segmentTimings: Array<Array<number | undefined>>,
  segmentEndTimings: Array<Array<number | undefined>>,
): OutputRow[] {
  return lines.map((text, index) => {
    const firstSegmentTime = segmentTimings[index]?.find((time) => Number.isFinite(time));
    return {
      index,
      text,
      time: Number.isFinite(timings[index]) ? timings[index] : firstSegmentTime,
      endTime: endTimings[index],
      segmentTimings: segmentTimings[index] ?? [],
      segmentEndTimings: segmentEndTimings[index] ?? [],
    };
  });
}

function getCueRange(rows: OutputRow[], index: number) {
  const row = rows[index];
  const start = Number.isFinite(row.time) ? row.time ?? 0 : 0;
  const nextTime = rows.slice(index + 1).find((candidate) => Number.isFinite(candidate.time))?.time;
  const inferredEnd = Number.isFinite(nextTime) ? nextTime ?? 0 : start + DEFAULT_END_TIME_SECONDS;
  const end = Number.isFinite(row.endTime) && (row.endTime ?? 0) > start
    ? row.endTime ?? inferredEnd
    : Math.max(start + 0.2, inferredEnd);
  return { start, end };
}

function tokenizeEnhancedText(text: string) {
  if (/\s/.test(text)) {
    return text.match(/\S+\s*/g) ?? [text];
  }

  return Array.from(text);
}

function containsJapaneseText(text: string) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function canFormatUseDetailedTiming(format: OutputFormat) {
  return format === "enhanced-lrc" || format === "project-k-json";
}

function tokenizeCharactersSkippingStandaloneSpaces(text: string) {
  const tokens: string[] = [];
  let pendingSpaces = "";

  for (const character of Array.from(text)) {
    if (/\s/.test(character)) {
      if (tokens.length) {
        tokens[tokens.length - 1] += character;
      } else {
        pendingSpaces += character;
      }
      continue;
    }

    if (OPENING_BRACKETS.has(character)) {
      pendingSpaces += character;
      continue;
    }

    if ((ATTACHED_KANA_PATTERN.test(character) || CLOSING_BRACKETS.has(character)) && tokens.length) {
      tokens[tokens.length - 1] += `${pendingSpaces}${character}`;
      pendingSpaces = "";
      continue;
    }

    tokens.push(`${pendingSpaces}${character}`);
    pendingSpaces = "";
  }

  if (pendingSpaces && tokens.length) {
    tokens[tokens.length - 1] += pendingSpaces;
  }

  return tokens;
}

function tokenizeForMode(text: string, mode: TimingMode) {
  if (mode === "line") return [text];
  if (containsJapaneseText(text)) return tokenizeCharactersSkippingStandaloneSpaces(text);
  if (!/\s/.test(text)) return Array.from(text);
  return tokenizeEnhancedText(text);
}

function getEnhancedTokensForRow(row: OutputRow) {
  const characterTokens = tokenizeCharactersSkippingStandaloneSpaces(row.text);
  if (row.segmentTimings.length === characterTokens.length) return characterTokens;

  if (containsJapaneseText(row.text)) return characterTokens;

  return tokenizeEnhancedText(row.text);
}

function buildEnhancedLrcLine(row: OutputRow, rows: OutputRow[], index: number) {
  const { start, end } = getCueRange(rows, index);
  const tokens = getEnhancedTokensForRow(row);
  const duration = Math.max(0.2, end - start);
  const step = tokens.length > 0 ? duration / tokens.length : 0;
  const taggedText = tokens
    .map((token, tokenIndex) => {
      const segmentTime = row.segmentTimings[tokenIndex];
      const time = Number.isFinite(segmentTime) ? segmentTime : start + step * tokenIndex;
      return `<${formatLrcTime(time)}>${token}`;
    })
    .join("");

  return `[${formatLrcTime(row.time)}]${taggedText}`;
}

type ProjectKJsonBuildResult = {
  output: string;
  errors: string[];
};

type OutputBuildOptions = {
  compactEnhanced?: boolean;
  timingMode?: TimingMode;
  audioName?: string;
  detailedEndPolicy?: DetailedEndPolicy;
};

type TimingWarning = {
  scope: "segment" | "line";
  lineIndex: number;
  segmentIndex: number;
  previousSegmentIndex: number;
  currentStart: number;
  previousEnd: number;
  currentText: string;
  previousText: string;
};

function getTimingWarnings(
  lines: string[],
  timings: Array<number | undefined>,
  endTimings: Array<number | undefined>,
  segmentTimings: Array<Array<number | undefined>>,
  segmentEndTimings: Array<Array<number | undefined>>,
  timingMode: TimingMode,
): TimingWarning[] {
  const warnings: TimingWarning[] = [];
  if (timingMode === "segment") {
    lines.forEach((line, lineIndex) => {
      const tokens = tokenizeForMode(line, timingMode);
      const starts = segmentTimings[lineIndex] ?? [];
      const ends = segmentEndTimings[lineIndex] ?? [];
      for (let segmentIndex = 1; segmentIndex < tokens.length; segmentIndex += 1) {
        const currentStart = starts[segmentIndex];
        const previousEnd = ends[segmentIndex - 1];
        if (Number.isFinite(currentStart) && Number.isFinite(previousEnd)
          && (currentStart ?? 0) < (previousEnd ?? 0)) {
          warnings.push({
            scope: "segment",
            lineIndex,
            segmentIndex,
            previousSegmentIndex: segmentIndex - 1,
            currentStart: currentStart ?? 0,
            previousEnd: previousEnd ?? 0,
            currentText: tokens[segmentIndex] ?? "",
            previousText: tokens[segmentIndex - 1] ?? "",
          });
        }
      }
    });
  }

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const currentStart = timings[lineIndex];
    const previousEnd = endTimings[lineIndex - 1];
    if (Number.isFinite(currentStart) && Number.isFinite(previousEnd)
      && (currentStart ?? 0) < (previousEnd ?? 0)) {
      warnings.push({
        scope: "line",
        lineIndex,
        segmentIndex: 0,
        previousSegmentIndex: 0,
        currentStart: currentStart ?? 0,
        previousEnd: previousEnd ?? 0,
        currentText: lines[lineIndex] ?? "",
        previousText: lines[lineIndex - 1] ?? "",
      });
    }
  }

  return warnings;
}

function formatTimingWarning(warning: TimingWarning, language: Language) {
  if (warning.scope === "segment") {
    if (language === "en") {
      return `Line ${warning.lineIndex + 1}: character ${warning.segmentIndex + 1} (${warning.currentText}) starts at ${formatLrcTime(warning.currentStart)}, before character ${warning.previousSegmentIndex + 1} (${warning.previousText}) ends at ${formatLrcTime(warning.previousEnd)}.`;
    }
    return `行 ${warning.lineIndex + 1}「${warning.currentText}」の文字 ${warning.segmentIndex + 1} の開始 ${formatLrcTime(warning.currentStart)} が、直前の文字 ${warning.previousSegmentIndex + 1}「${warning.previousText}」の終了 ${formatLrcTime(warning.previousEnd)} より前です。`;
  }

  if (language === "en") {
    return `Line ${warning.lineIndex + 1} (${warning.currentText}) starts at ${formatLrcTime(warning.currentStart)}, before the previous line (${warning.previousText}) ends at ${formatLrcTime(warning.previousEnd)}.`;
  }
  return `行 ${warning.lineIndex + 1}「${warning.currentText}」の開始 ${formatLrcTime(warning.currentStart)} が、前の行「${warning.previousText}」の終了 ${formatLrcTime(warning.previousEnd)} より前です。`;
}

function toProjectKMilliseconds(seconds: number) {
  return Math.max(0, Math.round(seconds * 1000));
}

function getFineUnit(text: string): "character" | "word" {
  return containsJapaneseText(text) || !/\s/.test(text) ? "character" : "word";
}

function buildProjectKJsonOutput(
  lines: string[],
  timings: Array<number | undefined>,
  endTimings: Array<number | undefined>,
  segmentTimings: Array<Array<number | undefined>>,
  segmentEndTimings: Array<Array<number | undefined>>,
  options: Pick<OutputBuildOptions, "timingMode" | "audioName" | "detailedEndPolicy"> = {},
): ProjectKJsonBuildResult {
  const errors: string[] = [];
  const timingMode = options.timingMode ?? "line";
  const detailedEndPolicy = options.detailedEndPolicy ?? "same-line-only";
  const rows = getRowsWithSegments(lines, timings, endTimings, segmentTimings, segmentEndTimings);

  const timingWarnings = getTimingWarnings(
    lines,
    timings,
    endTimings,
    segmentTimings,
    segmentEndTimings,
    timingMode,
  );
  errors.push(...timingWarnings.map((warning) => formatTimingWarning(warning, "ja")));

  if (!lines.length) {
    return { output: "", errors: ["歌詞が入力されていません。"] };
  }

  rows.forEach((row, index) => {
    if (!Number.isFinite(row.time) || (row.time ?? -1) < 0) {
      errors.push(`行 ${index + 1}: 開始時刻を打刻してください。`);
    }
    if (index > 0 && Number.isFinite(row.time) && Number.isFinite(rows[index - 1].time)
      && (row.time ?? 0) < (rows[index - 1].time ?? 0)) {
      errors.push(`行 ${index + 1}: 開始時刻は前の行以降にしてください。`);
    }
  });

  const documentLines = rows.map((row, index) => {
    const start = Number.isFinite(row.time) ? row.time ?? 0 : 0;
    const nextLineStart = rows[index + 1]?.time;
    const explicitLineEnd = row.endTime;

    const tokens = tokenizeForMode(row.text, timingMode);
    const explicitLineEndIsValid = Number.isFinite(explicitLineEnd) && (explicitLineEnd ?? 0) > start;
    const finalSegmentStart = row.segmentTimings[tokens.length - 1];
    const finalSegmentEnd = row.segmentEndTimings[tokens.length - 1];
    const finalSegmentEndIsValid = Number.isFinite(finalSegmentStart)
      && Number.isFinite(finalSegmentEnd)
      && (finalSegmentEnd ?? 0) > (finalSegmentStart ?? start);
    if (Number.isFinite(explicitLineEnd) && !explicitLineEndIsValid) {
      errors.push(`行 ${index + 1}: 終了時刻は開始時刻より後にしてください。`);
    }

    const hasNextLineStart = Number.isFinite(nextLineStart) && (nextLineStart ?? 0) > start;
    const inferredLineEnd = hasNextLineStart
      ? nextLineStart ?? start + DEFAULT_END_TIME_SECONDS
      : start + DEFAULT_END_TIME_SECONDS;
    const lineEnd = timingMode === "segment"
      ? explicitLineEndIsValid
        ? explicitLineEnd
        : finalSegmentEndIsValid
          ? finalSegmentEnd
          : undefined
      : explicitLineEndIsValid
        ? explicitLineEnd
        : Math.max(start + MIN_TIMING_INTERVAL_SECONDS, inferredLineEnd);
    const missingEndMessage = detailedEndPolicy === "none"
      ? "終了時刻を記録してください。"
      : "同じ行内で終了時刻を記録してください。";
    if (!Number.isFinite(lineEnd)) {
      errors.push(`行 ${index + 1}: ${missingEndMessage}`);
    }
    const safeLineEnd = Number.isFinite(lineEnd)
      ? lineEnd ?? start + MIN_TIMING_INTERVAL_SECONDS
      : start + MIN_TIMING_INTERVAL_SECONDS;
    const lineEndIsExact = timingMode === "segment"
      ? explicitLineEndIsValid || finalSegmentEndIsValid
      : explicitLineEndIsValid;
    const lineSegments = timingMode === "line"
      ? [{
        id: `line-${String(index + 1).padStart(4, "0")}-segment-0001`,
        startTimeMs: toProjectKMilliseconds(start),
        endTimeMs: toProjectKMilliseconds(safeLineEnd),
        text: row.text,
        granularity: "line" as const,
        timingQuality: lineEndIsExact ? "exact" as const : "inferred" as const,
      }]
      : tokens.map((token, segmentIndex) => {
        const segmentStart = row.segmentTimings[segmentIndex];
        if (!Number.isFinite(segmentStart) || (segmentStart ?? -1) < 0) {
          errors.push(`行 ${index + 1} セグメント ${segmentIndex + 1}: 開始時刻を打刻してください。`);
        }
        if (segmentIndex > 0 && Number.isFinite(segmentStart)
          && Number.isFinite(row.segmentTimings[segmentIndex - 1])
          && (segmentStart ?? 0) < (row.segmentTimings[segmentIndex - 1] ?? 0)) {
          errors.push(`行 ${index + 1} セグメント ${segmentIndex + 1}: 開始時刻は前のセグメント以降にしてください。`);
        }
        const safeSegmentStart = Number.isFinite(segmentStart) ? segmentStart ?? start : start;
        const hasKnownLineEnd = Number.isFinite(lineEnd);
        if (safeSegmentStart < start || (hasKnownLineEnd && safeSegmentStart >= safeLineEnd)) {
          errors.push(`行 ${index + 1} セグメント ${segmentIndex + 1}: 行の時間範囲内にしてください。`);
        }
        const nextSegmentStart = row.segmentTimings[segmentIndex + 1];
        const explicitSegmentEnd = row.segmentEndTimings[segmentIndex];
        const explicitSegmentEndIsValid = Number.isFinite(explicitSegmentEnd) && (explicitSegmentEnd ?? 0) > safeSegmentStart;
        if (Number.isFinite(explicitSegmentEnd) && !explicitSegmentEndIsValid) {
          errors.push(`行 ${index + 1} セグメント ${segmentIndex + 1}: 終了時刻は開始時刻より後にしてください。`);
        }
        const nextSegmentStartIsValid = Number.isFinite(nextSegmentStart) && (nextSegmentStart ?? 0) > safeSegmentStart;
        const inferredSegmentEnd = nextSegmentStartIsValid
          ? nextSegmentStart ?? safeLineEnd
          : safeLineEnd;
        let segmentEnd = inferredSegmentEnd;
        let segmentEndIsExact = false;
        if (detailedEndPolicy === "same-line-only") {
          if (nextSegmentStartIsValid) {
            segmentEnd = nextSegmentStart ?? safeLineEnd;
            segmentEndIsExact = true;
          } else if (explicitSegmentEndIsValid) {
            segmentEnd = explicitSegmentEnd ?? safeLineEnd;
            segmentEndIsExact = true;
          } else if (Number.isFinite(lineEnd)) {
            segmentEnd = safeLineEnd;
            segmentEndIsExact = lineEndIsExact;
          } else {
            errors.push(`行 ${index + 1} セグメント ${segmentIndex + 1}: ${missingEndMessage}`);
            segmentEnd = safeSegmentStart + MIN_TIMING_INTERVAL_SECONDS;
          }
        } else if (explicitSegmentEndIsValid) {
          segmentEnd = explicitSegmentEnd ?? safeLineEnd;
          segmentEndIsExact = true;
        } else if (segmentIndex === tokens.length - 1 && explicitLineEndIsValid) {
          segmentEnd = safeLineEnd;
          segmentEndIsExact = true;
        } else {
          errors.push(`行 ${index + 1} セグメント ${segmentIndex + 1}: ${missingEndMessage}`);
          segmentEnd = safeSegmentStart + MIN_TIMING_INTERVAL_SECONDS;
        }
        if (hasKnownLineEnd && segmentEnd > safeLineEnd + MIN_TIMING_INTERVAL_SECONDS) {
          errors.push(`行 ${index + 1} セグメント ${segmentIndex + 1}: 行の終了時刻の範囲内にしてください。`);
        }
        return {
          id: `line-${String(index + 1).padStart(4, "0")}-segment-${String(segmentIndex + 1).padStart(4, "0")}`,
          startTimeMs: toProjectKMilliseconds(safeSegmentStart),
          endTimeMs: toProjectKMilliseconds(segmentEnd),
          text: token,
          granularity: "fine" as const,
          fineUnit: getFineUnit(row.text),
          timingQuality: segmentEndIsExact ? "exact" as const : "inferred" as const,
        };
      });

    const segmentText = lineSegments.map((segment) => segment.text).join("");
    if (segmentText !== row.text) {
      errors.push(`行 ${index + 1}: セグメント本文と行本文が一致しません。`);
    }
    if (lineSegments.some((segment) => segment.endTimeMs <= segment.startTimeMs)) {
      errors.push(`行 ${index + 1}: 終了時刻は開始時刻より後である必要があります。`);
    }
    const allSegmentsExact = lineSegments.every((segment) => segment.timingQuality === "exact");
    return {
      id: `line-${String(index + 1).padStart(4, "0")}`,
      startTimeMs: toProjectKMilliseconds(start),
      endTimeMs: toProjectKMilliseconds(safeLineEnd),
      text: row.text,
      timingQuality: lineEndIsExact && allSegmentsExact ? "exact" as const : "inferred" as const,
      displayMode: timingMode === "line" ? "line" as const : "fine" as const,
      segments: lineSegments,
    };
  });

  if (errors.length) return { output: "", errors };

  const hasExactEnd = documentLines.every((line) => line.timingQuality === "exact");
  const endTimePolicy = timingMode === "segment"
    ? detailedEndPolicy
    : "next-start-or-default";
  const document = {
    format: "project-k-lyrics" as const,
    formatVersion: 1 as const,
    timeUnit: "milliseconds" as const,
    timingQuality: hasExactEnd ? "exact" as const : "mixed" as const,
    metadata: {
      source: {
        application: "MakeLRC",
        kind: "manual-authoring",
        ...(options.audioName ? { audioName: options.audioName } : {}),
      },
    },
    tracks: [{
      id: "main",
      name: "Main",
      partIds: [] as string[],
      lines: documentLines,
    }],
    extensions: {
      "com.shinyo.makelrc": {
        authoringMode: timingMode === "line" ? "line" : "fine",
        endTimePolicy,
        defaultTailSeconds: DEFAULT_END_TIME_SECONDS,
      },
    },
  };
  return { output: JSON.stringify(document, null, 2), errors: [] };
}

function buildOutputPreviewBlocks(
  lines: string[],
  timings: Array<number | undefined>,
  endTimings: Array<number | undefined>,
  segmentTimings: Array<Array<number | undefined>>,
  segmentEndTimings: Array<Array<number | undefined>>,
  format: OutputFormat,
  options: OutputBuildOptions = {},
): OutputPreviewBlock[] {
  const rows = getRowsWithSegments(lines, timings, endTimings, segmentTimings, segmentEndTimings);

  if (format === "project-k-json") {
    const result = buildProjectKJsonOutput(lines, timings, endTimings, segmentTimings, segmentEndTimings, options);
    return [{
      key: "project-k-json",
      lines: result.output ? result.output.split("\n") : result.errors.map((error) => `${TEXT.ja.jsonValidationError}: ${error}`),
    }];
  }

  if (format === "webvtt") {
    return [
      { key: "webvtt-header", lines: ["WEBVTT"] },
      ...rows.map((row, index) => {
        const { start, end } = getCueRange(rows, index);
        return {
          key: `webvtt-${row.index}`,
          sourceIndex: row.index,
          lines: [`${formatWebVttTime(start)} --> ${formatWebVttTime(end)}`, row.text],
        };
      }),
    ];
  }

  if (format === "srt") {
    return rows.map((row, index) => {
      const { start, end } = getCueRange(rows, index);
      return {
        key: `srt-${row.index}`,
        sourceIndex: row.index,
        lines: [String(index + 1), `${formatSrtTime(start)} --> ${formatSrtTime(end)}`, row.text],
      };
    });
  }

  if (format === "enhanced-lrc") {
    return rows.map((row, index) => ({
      key: `enhanced-lrc-${row.index}`,
      sourceIndex: row.index,
      lines: options.compactEnhanced
        ? [`[${formatLrcTime(row.time)}]${row.text}`]
        : [buildEnhancedLrcLine(row, rows, index)],
    }));
  }

  return rows.map((row) => ({
    key: `lrc-${row.index}`,
    sourceIndex: row.index,
    lines: [`[${formatLrcTime(row.time)}]${row.text}`],
  }));
}

function clampLineIndex(index: number, lineCount: number) {
  return Math.min(Math.max(index, 0), Math.max(0, lineCount - 1));
}

function buildOutput(lines: string[], timings: Array<number | undefined>, format: OutputFormat) {
  const blocks = buildOutputPreviewBlocks(lines, timings, [], [], [], format);
  const separator = format === "srt" || format === "webvtt" ? "\n\n" : "\n";
  return blocks.map((block) => block.lines.join("\n")).join(separator);
}

function buildConvertedOutput(
  lines: string[],
  timings: Array<number | undefined>,
  endTimings: Array<number | undefined>,
  segmentTimings: Array<Array<number | undefined>>,
  segmentEndTimings: Array<Array<number | undefined>>,
  format: OutputFormat,
  options: Pick<OutputBuildOptions, "timingMode" | "audioName" | "detailedEndPolicy"> = {},
) {
  const blocks = buildOutputPreviewBlocks(lines, timings, endTimings, segmentTimings, segmentEndTimings, format, options);
  const separator = format === "srt" || format === "webvtt" ? "\n\n" : "\n";
  return blocks.map((block) => block.lines.join("\n")).join(separator);
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<Draft>;
    const savedTimingMode = draft.timingMode as string | undefined;
    return {
      lyrics: normalizeLyrics(draft.lyrics ?? ""),
      timings: Array.isArray(draft.timings) ? draft.timings : [],
      endTimings: Array.isArray(draft.endTimings) ? draft.endTimings : [],
      segmentTimings: Array.isArray(draft.segmentTimings) ? draft.segmentTimings : [],
      segmentEndTimings: Array.isArray(draft.segmentEndTimings) ? draft.segmentEndTimings : [],
      activeIndex: Number.isInteger(draft.activeIndex) ? draft.activeIndex ?? 0 : 0,
      activeSegmentIndex: Number.isInteger(draft.activeSegmentIndex) ? draft.activeSegmentIndex ?? 0 : 0,
      format: draft.format ?? "lrc",
      timingMode: savedTimingMode === "word" || savedTimingMode === "char"
        ? "segment"
        : draft.timingMode ?? "line",
      detailedEndPolicy: normalizeDetailedEndPolicy(draft.detailedEndPolicy),
      tempoRate: normalizeTempoRate(draft.tempoRate),
    };
  } catch {
    return null;
  }
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isLikelyAudioFile(file: File) {
  if (file.type.startsWith("audio/")) return true;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension ? AUDIO_FILE_EXTENSIONS.has(extension) : false;
}

export function App() {
  const initialDraft = useMemo(readDraft, []);
  const initialFormat = initialDraft?.format ?? "lrc";
  const initialTimingMode = canFormatUseDetailedTiming(initialFormat)
    ? initialDraft?.timingMode ?? "line"
    : "line";
  const initialDetailedEndPolicy = initialDraft?.detailedEndPolicy ?? "same-line-only";
  const initialActiveSegmentIndex = initialTimingMode === "line" ? 0 : initialDraft?.activeSegmentIndex ?? 0;
  const [lyrics, setLyrics] = useState(initialDraft?.lyrics ?? "");
  const [lines, setLines] = useState(() => parseLines(initialDraft?.lyrics ?? ""));
  const [timings, setTimings] = useState<Array<number | undefined>>(initialDraft?.timings ?? []);
  const [endTimings, setEndTimings] = useState<Array<number | undefined>>(initialDraft?.endTimings ?? []);
  const [segmentTimings, setSegmentTimings] = useState<Array<Array<number | undefined>>>(
    initialDraft?.segmentTimings ?? [],
  );
  const [segmentEndTimings, setSegmentEndTimings] = useState<Array<Array<number | undefined>>>(
    initialDraft?.segmentEndTimings ?? [],
  );
  const [activeIndex, setActiveIndex] = useState(initialDraft?.activeIndex ?? 0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(initialActiveSegmentIndex);
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const [format, setFormat] = useState<OutputFormat>(initialFormat);
  const [timingMode, setTimingMode] = useState<TimingMode>(initialTimingMode);
  const [detailedEndPolicy, setDetailedEndPolicy] = useState<DetailedEndPolicy>(initialDetailedEndPolicy);
  const [tempoRate, setTempoRate] = useState(() => normalizeTempoRate(initialDraft?.tempoRate));
  const [saveStatus, setSaveStatus] = useState(initialDraft ? "一時保存を復元" : "未保存");
  const [language, setLanguage] = useState<Language>(readStoredLanguage);
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioName, setAudioName] = useState("");
  const [isAudioDragging, setIsAudioDragging] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const outputPreviewRef = useRef<HTMLDivElement | null>(null);
  const activeOutputRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const displayedCentisecondRef = useRef(-1);
  const activeIndexRef = useRef(initialDraft?.activeIndex ?? 0);
  const activeSegmentIndexRef = useRef(initialActiveSegmentIndex);
  const timingCaptureRef = useRef<TimingCapture | null>(null);
  const lastImmediateStampRef = useRef(0);
  const canUseDetailedTiming = canFormatUseDetailedTiming(format);
  const effectiveTimingMode: TimingMode = canUseDetailedTiming ? timingMode : "line";
  const text = TEXT[language];
  const displayedSaveStatus = translateStatus(saveStatus, language);
  const themeLabel = theme === "light" ? text.darkTheme : text.lightTheme;

  const outputPreviewBlocks = useMemo(
    () => buildOutputPreviewBlocks(lines, timings, endTimings, segmentTimings, segmentEndTimings, format, {
      compactEnhanced: true,
      timingMode: effectiveTimingMode,
      audioName,
      detailedEndPolicy,
    }),
    [audioName, detailedEndPolicy, effectiveTimingMode, endTimings, format, lines, segmentEndTimings, segmentTimings, timings],
  );
  const activeLine = lines[activeIndex] ?? text.enterLyrics;
  const activeTokens = useMemo(
    () => tokenizeForMode(lines[activeIndex] ?? "", effectiveTimingMode),
    [activeIndex, effectiveTimingMode, lines],
  );
  const timingWarnings = useMemo(
    () => getTimingWarnings(lines, timings, endTimings, segmentTimings, segmentEndTimings, effectiveTimingMode),
    [effectiveTimingMode, endTimings, lines, segmentEndTimings, segmentTimings, timings],
  );

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    activeSegmentIndexRef.current = activeSegmentIndex;
  }, [activeSegmentIndex]);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (canUseDetailedTiming) return;
    if (timingMode !== "line") setTimingMode("line");
    if (activeSegmentIndexRef.current === 0) return;
    activeSegmentIndexRef.current = 0;
    setActiveSegmentIndex(0);
  }, [canUseDetailedTiming, timingMode]);

  const pushUndo = useCallback(() => {
    setUndoStack((stack) => {
      const next = [
        ...stack,
        {
          timings: [...timings],
          endTimings: [...endTimings],
          segmentTimings: segmentTimings.map((items) => [...items]),
          segmentEndTimings: segmentEndTimings.map((items) => [...items]),
          activeIndex,
          activeSegmentIndex,
        },
      ];
      return next.length > 100 ? next.slice(1) : next;
    });
    setRedoStack([]);
  }, [activeIndex, activeSegmentIndex, endTimings, segmentEndTimings, segmentTimings, timings]);

  const releaseButtonFocus = useCallback(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLButtonElement) {
      activeElement.blur();
    }
  }, []);

  const preventButtonMouseFocus = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  const syncCurrentTime = useCallback((force = false) => {
    const nextTime = audioRef.current?.currentTime ?? 0;
    const nextCentisecond = Math.round(nextTime * 100);
    if (force || nextCentisecond !== displayedCentisecondRef.current) {
      displayedCentisecondRef.current = nextCentisecond;
      setCurrentTime(nextTime);
    }
  }, []);

  const applyAudioTempo = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const audioWithPitch = audio as HTMLAudioElement & {
      mozPreservesPitch?: boolean;
      preservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    audioWithPitch.preservesPitch = true;
    audioWithPitch.mozPreservesPitch = true;
    audioWithPitch.webkitPreservesPitch = true;
    audio.defaultPlaybackRate = tempoRate;
    audio.playbackRate = tempoRate;
  }, [tempoRate]);

  useEffect(() => {
    applyAudioTempo();
  }, [applyAudioTempo, audioUrl]);

  const stopTimeLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const startTimeLoop = useCallback(() => {
    stopTimeLoop();

    const tick = () => {
      syncCurrentTime();
      if (!audioRef.current?.paused) {
        animationFrameRef.current = window.requestAnimationFrame(tick);
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
  }, [stopTimeLoop, syncCurrentTime]);

  const updateLyrics = useCallback((value: string) => {
    const normalized = normalizeLyrics(value);
    const nextLines = parseLines(normalized);
    setLyrics(normalized);
    setLines(nextLines);
    setTimings((current) => current.slice(0, nextLines.length));
    setEndTimings((current) => current.slice(0, nextLines.length));
    setSegmentTimings((current) => current.slice(0, nextLines.length));
    setSegmentEndTimings((current) => current.slice(0, nextLines.length));
    setActiveIndex((index) => clampLineIndex(index, nextLines.length));
    setActiveSegmentIndex(0);
  }, []);

  const startTimingCapture = useCallback(() => {
    if (!lines.length || timingCaptureRef.current) return;
    const currentLineIndex = clampLineIndex(activeIndexRef.current, lines.length);
    const currentSegmentIndex = effectiveTimingMode === "line" ? 0 : activeSegmentIndexRef.current;
    const startTime = audioRef.current?.currentTime ?? 0;
    const tokens = tokenizeForMode(lines[currentLineIndex] ?? "", effectiveTimingMode);

    pushUndo();
    timingCaptureRef.current = {
      lineIndex: currentLineIndex,
      segmentIndex: currentSegmentIndex,
      startTime,
    };

    if (effectiveTimingMode !== "line") {
      setSegmentTimings((current) => {
        const next = [...current];
        const lineTimings = [...(next[currentLineIndex] ?? [])];
        lineTimings[currentSegmentIndex] = startTime;
        lineTimings.length = tokens.length;
        next[currentLineIndex] = lineTimings;
        return next;
      });
      setSegmentEndTimings((current) => {
        const next = [...current];
        const lineEndTimings = [...(next[currentLineIndex] ?? [])];
        lineEndTimings[currentSegmentIndex] = undefined;
        lineEndTimings.length = tokens.length;
        next[currentLineIndex] = lineEndTimings;
        return next;
      });
      if (currentSegmentIndex === 0) {
        setTimings((current) => {
          const next = [...current];
          next[currentLineIndex] = startTime;
          return next;
        });
        setEndTimings((current) => {
          const next = [...current];
          next[currentLineIndex] = undefined;
          return next;
        });
      }
      return;
    }

    setTimings((current) => {
      const next = [...current];
      next[currentLineIndex] = startTime;
      return next;
    });
    setEndTimings((current) => {
      const next = [...current];
      next[currentLineIndex] = undefined;
      return next;
    });
  }, [effectiveTimingMode, lines, pushUndo]);

  const finishTimingCapture = useCallback(() => {
    const capture = timingCaptureRef.current;
    if (!capture) return;
    timingCaptureRef.current = null;
    const endTime = audioRef.current?.currentTime ?? 0;
    const hasUsableEnd = Number.isFinite(endTime) && endTime > capture.startTime;

    if (hasUsableEnd) {
      if (effectiveTimingMode === "line") {
        setEndTimings((current) => {
          const next = [...current];
          next[capture.lineIndex] = endTime;
          return next;
        });
      } else {
        const tokens = tokenizeForMode(lines[capture.lineIndex] ?? "", effectiveTimingMode);
        setSegmentEndTimings((current) => {
          const next = [...current];
          const lineEndTimings = [...(next[capture.lineIndex] ?? [])];
          lineEndTimings[capture.segmentIndex] = endTime;
          lineEndTimings.length = tokens.length;
          next[capture.lineIndex] = lineEndTimings;
          return next;
        });
        if (capture.segmentIndex === tokens.length - 1) {
          setEndTimings((current) => {
            const next = [...current];
            next[capture.lineIndex] = endTime;
            return next;
          });
        }
      }
    }

    const tokens = tokenizeForMode(lines[capture.lineIndex] ?? "", effectiveTimingMode);
    if (effectiveTimingMode !== "line" && capture.segmentIndex + 1 < tokens.length) {
      const nextSegmentIndex = capture.segmentIndex + 1;
      activeSegmentIndexRef.current = nextSegmentIndex;
      setActiveSegmentIndex(nextSegmentIndex);
      return;
    }

    const nextLineIndex = clampLineIndex(capture.lineIndex + 1, lines.length);
    activeIndexRef.current = nextLineIndex;
    activeSegmentIndexRef.current = 0;
    setActiveIndex(nextLineIndex);
    setActiveSegmentIndex(0);
  }, [effectiveTimingMode, lines]);

  const stampCurrentLine = useCallback(() => {
    startTimingCapture();
    finishTimingCapture();
  }, [finishTimingCapture, startTimingCapture]);

  const handleStampPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    lastImmediateStampRef.current = performance.now();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    startTimingCapture();
  }, [startTimingCapture]);

  const handleStampPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    lastImmediateStampRef.current = performance.now();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishTimingCapture();
  }, [finishTimingCapture]);

  const handleStampPointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    timingCaptureRef.current = null;
  }, []);

  const handleStampTouchStart = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
    if ("PointerEvent" in window) return;
    event.preventDefault();
    lastImmediateStampRef.current = performance.now();
    startTimingCapture();
  }, [startTimingCapture]);

  const handleStampTouchEnd = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
    if ("PointerEvent" in window) return;
    event.preventDefault();
    lastImmediateStampRef.current = performance.now();
    finishTimingCapture();
  }, [finishTimingCapture]);

  const handleStampClick = useCallback(() => {
    if (performance.now() - lastImmediateStampRef.current < 700) return;
    stampCurrentLine();
  }, [stampCurrentLine]);

  const moveActive = useCallback((delta: number) => {
    releaseButtonFocus();
    const nextLineIndex = clampLineIndex(activeIndexRef.current + delta, lines.length);
    activeIndexRef.current = nextLineIndex;
    activeSegmentIndexRef.current = 0;
    setActiveIndex(nextLineIndex);
    setActiveSegmentIndex(0);
  }, [lines.length, releaseButtonFocus]);

  const seekBy = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    releaseButtonFocus();
    audio.currentTime = Math.max(0, audio.currentTime + delta);
    syncCurrentTime(true);
  }, [releaseButtonFocus, syncCurrentTime]);

  const undo = useCallback(() => {
    releaseButtonFocus();
    setUndoStack((stack) => {
      const snapshot = stack.at(-1);
      if (!snapshot) return stack;
      const undoTargetTime = effectiveTimingMode === "line"
        ? timings[snapshot.activeIndex]
        : segmentTimings[snapshot.activeIndex]?.[snapshot.activeSegmentIndex] ?? timings[snapshot.activeIndex];
      setRedoStack((redo) => [
        ...redo,
        {
          timings: [...timings],
          endTimings: [...endTimings],
          segmentTimings: segmentTimings.map((items) => [...items]),
          segmentEndTimings: segmentEndTimings.map((items) => [...items]),
          activeIndex,
          activeSegmentIndex,
        },
      ]);
      setTimings([...snapshot.timings]);
      setEndTimings([...snapshot.endTimings]);
      setSegmentTimings(snapshot.segmentTimings.map((items) => [...items]));
      setSegmentEndTimings(snapshot.segmentEndTimings.map((items) => [...items]));
      const nextLineIndex = clampLineIndex(snapshot.activeIndex, lines.length);
      activeIndexRef.current = nextLineIndex;
      activeSegmentIndexRef.current = snapshot.activeSegmentIndex;
      setActiveIndex(nextLineIndex);
      setActiveSegmentIndex(snapshot.activeSegmentIndex);
      if (Number.isFinite(undoTargetTime) && audioRef.current) {
        audioRef.current.currentTime = Math.max(0, (undoTargetTime ?? 0) - RETAKE_MARGIN_SECONDS);
        syncCurrentTime(true);
        void audioRef.current.play().then(startTimeLoop).catch(() => undefined);
      }
      return stack.slice(0, -1);
    });
  }, [
    activeIndex,
    activeSegmentIndex,
    endTimings,
    effectiveTimingMode,
    lines.length,
    releaseButtonFocus,
    segmentEndTimings,
    segmentTimings,
    startTimeLoop,
    syncCurrentTime,
    timings,
  ]);

  const redo = useCallback(() => {
    releaseButtonFocus();
    setRedoStack((stack) => {
      const snapshot = stack.at(-1);
      if (!snapshot) return stack;
      setUndoStack((undoItems) => [
        ...undoItems,
        {
          timings: [...timings],
          endTimings: [...endTimings],
          segmentTimings: segmentTimings.map((items) => [...items]),
          segmentEndTimings: segmentEndTimings.map((items) => [...items]),
          activeIndex,
          activeSegmentIndex,
        },
      ]);
      setTimings([...snapshot.timings]);
      setEndTimings([...snapshot.endTimings]);
      setSegmentTimings(snapshot.segmentTimings.map((items) => [...items]));
      setSegmentEndTimings(snapshot.segmentEndTimings.map((items) => [...items]));
      const nextLineIndex = clampLineIndex(snapshot.activeIndex, lines.length);
      activeIndexRef.current = nextLineIndex;
      activeSegmentIndexRef.current = snapshot.activeSegmentIndex;
      setActiveIndex(nextLineIndex);
      setActiveSegmentIndex(snapshot.activeSegmentIndex);
      return stack.slice(0, -1);
    });
  }, [activeIndex, activeSegmentIndex, endTimings, lines.length, releaseButtonFocus, segmentEndTimings, segmentTimings, timings]);

  const clearTimings = useCallback(() => {
    releaseButtonFocus();
    timingCaptureRef.current = null;
    setTimings([]);
    setEndTimings([]);
    setSegmentTimings([]);
    setSegmentEndTimings([]);
    setUndoStack([]);
    setRedoStack([]);
    activeIndexRef.current = 0;
    activeSegmentIndexRef.current = 0;
    setActiveIndex(0);
    setActiveSegmentIndex(0);
  }, [releaseButtonFocus]);

  const insertGapAfterCurrentLine = useCallback(() => {
    releaseButtonFocus();
    pushUndo();
    const insertAt = lines.length ? activeIndex + 1 : 0;
    const nextLines = [...lines.slice(0, insertAt), GAP_LINE_TEXT, ...lines.slice(insertAt)];
    setLines(nextLines);
    setLyrics(nextLines.join("\n"));
    setTimings((current) => [
      ...current.slice(0, insertAt),
      undefined,
      ...current.slice(insertAt),
    ]);
    setEndTimings((current) => [
      ...current.slice(0, insertAt),
      undefined,
      ...current.slice(insertAt),
    ]);
    setSegmentTimings((current) => [
      ...current.slice(0, insertAt),
      [],
      ...current.slice(insertAt),
    ]);
    setSegmentEndTimings((current) => [
      ...current.slice(0, insertAt),
      [],
      ...current.slice(insertAt),
    ]);
    activeIndexRef.current = insertAt;
    activeSegmentIndexRef.current = 0;
    setActiveIndex(insertAt);
    setActiveSegmentIndex(0);
  }, [activeIndex, lines, pushUndo, releaseButtonFocus]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    releaseButtonFocus();
    if (audio.paused) {
      void audio.play().then(startTimeLoop).catch(() => setSaveStatus("再生できません"));
    } else {
      audio.pause();
      syncCurrentTime(true);
    }
  }, [releaseButtonFocus, startTimeLoop, syncCurrentTime]);

  const pasteLyrics = useCallback(async () => {
    if (!navigator.clipboard?.readText) return;
    const text = await navigator.clipboard.readText();
    if (text) updateLyrics(text);
  }, [updateLyrics]);

  const copyOutput = useCallback(async () => {
    const output = buildConvertedOutput(lines, timings, endTimings, segmentTimings, segmentEndTimings, format, {
      timingMode: effectiveTimingMode,
      audioName,
      detailedEndPolicy,
    });
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setSaveStatus("コピーしました");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.className = "output-copy-source";
      textarea.value = output;
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      setSaveStatus("コピーしました");
    }
  }, [audioName, detailedEndPolicy, effectiveTimingMode, endTimings, format, lines, segmentEndTimings, segmentTimings, timings]);

  const downloadOutput = useCallback(() => {
    const output = buildConvertedOutput(lines, timings, endTimings, segmentTimings, segmentEndTimings, format, {
      timingMode: effectiveTimingMode,
      audioName,
      detailedEndPolicy,
    });
    if (!output) return;
    const extension = format === "project-k-json" ? "lyrics.json" : format === "webvtt" ? "vtt" : format === "srt" ? "srt" : "lrc";
    const mimeType = format === "project-k-json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8";
    const blob = new Blob([output], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `lyrics.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [audioName, detailedEndPolicy, effectiveTimingMode, endTimings, format, lines, segmentEndTimings, segmentTimings, timings]);

  const loadAudioFile = useCallback((file: File) => {
    if (!isLikelyAudioFile(file)) {
      setSaveStatus("音源ファイルを選択してください");
      return;
    }

    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const nextUrl = URL.createObjectURL(file);
    setAudioUrl(nextUrl);
    setAudioName(file.name);
    setCurrentTime(0);
    displayedCentisecondRef.current = -1;
    setSaveStatus(file.name);
  }, [audioUrl]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const draft: Draft = {
          lyrics,
          timings,
          endTimings,
          segmentTimings,
          segmentEndTimings,
          activeIndex,
          activeSegmentIndex,
          format,
          timingMode,
          detailedEndPolicy,
          tempoRate,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
        setSaveStatus("一時保存済み");
      } catch {
        setSaveStatus("一時保存できません");
      }
    }, 1500);
    return () => window.clearTimeout(timeout);
  }, [activeIndex, activeSegmentIndex, detailedEndPolicy, endTimings, format, lyrics, segmentEndTimings, segmentTimings, tempoRate, timingMode, timings]);

  useEffect(() => {
    const container = outputPreviewRef.current;
    const activeLineElement = activeOutputRef.current;
    if (!container || !activeLineElement) return;

    const itemTop = activeLineElement.offsetTop;
    const itemBottom = itemTop + activeLineElement.offsetHeight;
    const visibleTop = container.scrollTop;
    const visibleBottom = visibleTop + container.clientHeight;

    if (itemTop < visibleTop) {
      container.scrollTop = itemTop;
    } else if (itemBottom > visibleBottom) {
      container.scrollTop = itemBottom - container.clientHeight;
    }
  }, [activeIndex]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onPlay = () => startTimeLoop();
    const onPause = () => {
      stopTimeLoop();
      syncCurrentTime(true);
    };
    const onSeeked = () => syncCurrentTime(true);
    const onLoadedMetadata = () => {
      applyAudioTempo();
      syncCurrentTime(true);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      stopTimeLoop();
    };
  }, [applyAudioTempo, startTimeLoop, stopTimeLoop, syncCurrentTime]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (key === "?" && !isEditableTarget(event.target)) {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }

      if (isEditableTarget(event.target)) return;

      if (event.code === "Space" && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        togglePlayback();
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) startTimingCapture();
        return;
      }

      if (event.code === "ArrowUp") {
        event.preventDefault();
        moveActive(-1);
        return;
      }

      if (event.code === "ArrowDown") {
        event.preventDefault();
        moveActive(1);
        return;
      }

      if (key === "j") {
        event.preventDefault();
        seekBy(-SEEK_STEP_SECONDS);
        return;
      }

      if (key === "k") {
        event.preventDefault();
        seekBy(SEEK_STEP_SECONDS);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        redo();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        finishTimingCapture();
      }
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("keyup", onKeyUp, { capture: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  }, [finishTimingCapture, moveActive, redo, seekBy, startTimingCapture, togglePlayback, undo]);

  useEffect(() => {
    let lastTouchEnd = 0;
    const onTouchEnd = (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 320) event.preventDefault();
      lastTouchEnd = now;
    };

    document.addEventListener("touchend", onTouchEnd, { passive: false });
    return () => document.removeEventListener("touchend", onTouchEnd);
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  return (
    <main className="app-shell">
      <section className="workspace" aria-label={text.appLabel}>
        <header className="topbar">
          <div className="brand-block">
            <h1>MakeLRC</h1>
            <p>{displayedSaveStatus}</p>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="square-action-button language-action"
              aria-label={text.language}
              title={text.language}
              onMouseDown={preventButtonMouseFocus}
              onClick={() => setLanguage((current) => current === "ja" ? "en" : "ja")}
            />
            <button
              type="button"
              className="square-action-button theme-action"
              aria-label={themeLabel}
              title={themeLabel}
              onMouseDown={preventButtonMouseFocus}
              onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
            />
            <button type="button" className="topbar-action-button hint-action" aria-expanded={helpOpen} onMouseDown={preventButtonMouseFocus} onClick={() => setHelpOpen((open) => !open)}>
              {text.help}
            </button>
            <button type="button" className="topbar-action-button copy-action" onMouseDown={preventButtonMouseFocus} onClick={copyOutput}>{text.copy}</button>
            <button type="button" className="topbar-action-button save-action" onMouseDown={preventButtonMouseFocus} onClick={downloadOutput}>{text.save}</button>
          </div>
        </header>

        {helpOpen && (
          <section className="help-panel">
            <h2>{text.shortcuts}</h2>
            <div className="shortcut-grid">
              <span><kbd>Space</kbd></span><span>{text.stampCurrentLine}</span>
              <span><kbd>Shift</kbd> + <kbd>Space</kbd></span><span>{text.playPauseHelp}</span>
              <span><kbd>ArrowUp</kbd> / <kbd>ArrowDown</kbd></span><span>{text.previousNextHelp}</span>
              <span><kbd>J</kbd> / <kbd>K</kbd></span><span>{text.seekHelp}</span>
              <span><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Z</kbd></span><span>{text.undo}</span>
              <span><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Y</kbd></span><span>{text.redo}</span>
              <span><kbd>?</kbd></span><span>{text.helpToggle}</span>
            </div>
          </section>
        )}

        <section
          className={`audio-panel${isAudioDragging ? " is-dragging" : ""}`}
          aria-label={text.audio}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsAudioDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsAudioDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsAudioDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) loadAudioFile(file);
          }}
        >
          <label className="file-picker">
            <span>{text.chooseAudio}</span>
            <input
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                loadAudioFile(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <audio
            ref={audioRef}
            controls
            playsInline
            preload="metadata"
            src={audioUrl}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onLoadedMetadata={() => {
              applyAudioTempo();
              syncCurrentTime(true);
            }}
          />
          <label className="tempo-control">
            {text.tempo}
            <select
              aria-label={text.tempo}
              value={String(tempoRate)}
              onChange={(event) => setTempoRate(normalizeTempoRate(Number(event.target.value)))}
            >
              {TEMPO_RATES.map((rate) => (
                <option key={rate} value={rate}>{rate}x</option>
              ))}
            </select>
            <span>{text.tempoPitchNote}</span>
          </label>
        </section>

        <section className="editor-grid">
          <section className="lyrics-panel" aria-label={text.lyricsInput}>
            <div className="panel-heading">
              <h2>{text.lyrics}</h2>
              <button type="button" onMouseDown={preventButtonMouseFocus} onClick={pasteLyrics}>{text.paste}</button>
            </div>
            <textarea
              value={lyrics}
              spellCheck={false}
              placeholder={text.lyricsPlaceholder}
              onChange={(event) => updateLyrics(event.target.value)}
            />
          </section>

          <section className="timing-panel" aria-label={text.timingControls}>
            <div className="timing-display">
              <span id="currentTime">{formatLrcTime(currentTime)}</span>
              <strong id="activeLine">
                {effectiveTimingMode === "line" || !activeTokens.length ? activeLine : (
                  <>
                    {activeTokens.map((token, index) => (
                      <span
                        key={`${index}-${token}`}
                        className={`active-token${index === activeSegmentIndex ? " is-current" : ""}`}
                      >
                        {token}
                      </span>
                    ))}
                  </>
                )}
              </strong>
            </div>
            <button
              className="tap-zone"
              type="button"
              onMouseDown={preventButtonMouseFocus}
              onPointerDown={handleStampPointerDown}
              onPointerUp={handleStampPointerUp}
              onPointerCancel={handleStampPointerCancel}
              onTouchStart={handleStampTouchStart}
              onTouchEnd={handleStampTouchEnd}
              onClick={handleStampClick}
            >
              <span>{text.tapToStamp}</span>
            </button>
            <div className="control-grid">
              <button type="button" className="control-button play-action" onMouseDown={preventButtonMouseFocus} onClick={togglePlayback}>{text.playPause}</button>
              <button type="button" className="control-button previous-action" onMouseDown={preventButtonMouseFocus} onClick={() => moveActive(-1)}>{text.previousLine}</button>
              <button type="button" className="control-button next-action" onMouseDown={preventButtonMouseFocus} onClick={() => moveActive(1)}>{text.nextLine}</button>
              <button type="button" className="control-button rewind-action" onMouseDown={preventButtonMouseFocus} onClick={() => seekBy(-SEEK_STEP_SECONDS)}>{text.seekBack}</button>
              <button type="button" className="control-button forward-action" onMouseDown={preventButtonMouseFocus} onClick={() => seekBy(SEEK_STEP_SECONDS)}>{text.seekForward}</button>
              <button type="button" className="control-button undo-action" disabled={!undoStack.length} onMouseDown={preventButtonMouseFocus} onClick={undo}>{text.undo}</button>
              <button type="button" className="control-button redo-action" disabled={!redoStack.length} onMouseDown={preventButtonMouseFocus} onClick={redo}>{text.redo}</button>
            </div>
            <div className="options-row">
              <label>
                {text.timingUnit}
                <select
                  value={timingMode}
                  disabled={!canUseDetailedTiming}
                  onChange={(event) => {
                    setTimingMode(event.target.value as TimingMode);
                    activeSegmentIndexRef.current = 0;
                    setActiveSegmentIndex(0);
                  }}
                >
                  <option value="line">{text.line}</option>
                  <option value="segment">{text.detail}</option>
                </select>
              </label>
              {effectiveTimingMode === "segment" && (
                <label>
                  {text.detailedEndPolicy}
                  <select
                    value={detailedEndPolicy}
                    onChange={(event) => setDetailedEndPolicy(normalizeDetailedEndPolicy(event.target.value))}
                  >
                    <option value="same-line-only">{text.sameLineOnly}</option>
                    <option value="none">{text.noCompletion}</option>
                  </select>
                </label>
              )}
              <label>
                {text.format}
                <select
                  value={format}
                  onChange={(event) => {
                    const nextFormat = event.target.value as OutputFormat;
                    setFormat(nextFormat);
                    if (!canFormatUseDetailedTiming(nextFormat)) {
                      setTimingMode("line");
                      activeSegmentIndexRef.current = 0;
                      setActiveSegmentIndex(0);
                    }
                  }}
                >
                  <option value="project-k-json">Project K JSON</option>
                  <option value="lrc">LRC</option>
                  <option value="enhanced-lrc">Enhanced LRC</option>
                  <option value="webvtt">WebVTT</option>
                  <option value="srt">SRT</option>
                </select>
              </label>
              <button type="button" onMouseDown={preventButtonMouseFocus} onClick={insertGapAfterCurrentLine}>{text.addGap}</button>
              <button type="button" className="danger-action" onMouseDown={preventButtonMouseFocus} onClick={clearTimings}>{text.clearAllTimings}</button>
            </div>
            {timingWarnings.length > 0 && (
              <div className="timing-warning" role="alert">
                <strong>{text.timingWarningTitle}</strong>
                <ul>
                  {timingWarnings.map((warning, index) => (
                    <li key={`${warning.scope}-${warning.lineIndex}-${warning.segmentIndex}-${index}`}>
                      {formatTimingWarning(warning, language)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </section>

        <section className="preview-panel" aria-label={text.outputPreview}>
          <div className="panel-heading">
            <h2>{text.output}</h2>
            <span>{lines.length}{text.lineCount} / {format}</span>
          </div>
          <div
            ref={outputPreviewRef}
            className="output-preview"
            role="textbox"
            aria-label={text.outputPreview}
            aria-readonly="true"
            tabIndex={0}
          >
            {!lines.length && <div className="output-empty">{text.outputEmpty}</div>}
            {outputPreviewBlocks.map((block) => (
              <div
                key={block.key}
                ref={block.sourceIndex === activeIndex ? activeOutputRef : undefined}
                className={`output-line${block.sourceIndex === activeIndex ? " is-active" : ""}`}
              >
                {block.lines.map((line, lineIndex) => (
                  <span key={`${block.key}-${lineIndex}`}>{line}</span>
                ))}
              </div>
            ))}
          </div>
          {format !== "project-k-json" && (
            <p className="output-notice">{text.outputFormatLossNotice}</p>
          )}
        </section>
      </section>
      <footer className="site-footer">
        <span>© {new Date().getFullYear()} しにょーん</span>
        <a href="https://shinyo-n.com" target="_blank" rel="noreferrer">
          {language === "ja" ? "しにょーんのプロフィール" : "Creator profile"}
        </a>
      </footer>
    </main>
  );
}
