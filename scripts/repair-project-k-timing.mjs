import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_LINE_WINDOW_MS = 500;
const SHORT_REST_THRESHOLD_MS = 50;
const SHORT_REST_PENALTY_MS = 300;

function parseTimestamp(minutes, seconds) {
  return Math.round((Number(minutes) * 60 + Number(seconds)) * 1000);
}

export function parseEnhancedLrc(source) {
  const lineMarker = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  const markers = [...source.matchAll(lineMarker)];

  return markers.map((marker, index) => {
    const contentStart = marker.index + marker[0].length;
    const contentEnd = markers[index + 1]?.index ?? source.length;
    const content = source.slice(contentStart, contentEnd).replace(/\r?\n/g, "");
    const segmentMarker = /<(\d+):(\d+(?:\.\d+)?)>/g;
    const segmentMarkers = [...content.matchAll(segmentMarker)];

    if (segmentMarkers.length === 0) {
      throw new Error(`Enhanced LRC line ${index + 1} has no segment timestamps.`);
    }

    const segments = segmentMarkers.map((segmentMarkerMatch, segmentIndex) => {
      const textStart = segmentMarkerMatch.index + segmentMarkerMatch[0].length;
      const textEnd = segmentMarkers[segmentIndex + 1]?.index ?? content.length;
      return {
        startTimeMs: parseTimestamp(segmentMarkerMatch[1], segmentMarkerMatch[2]),
        text: content.slice(textStart, textEnd),
      };
    });

    return {
      startTimeMs: parseTimestamp(marker[1], marker[2]),
      text: segments.map((segment) => segment.text).join(""),
      segments,
    };
  });
}

function readVariableLength(buffer, state) {
  let value = 0;
  let count = 0;
  while (true) {
    if (state.offset >= buffer.length || count === 4) {
      throw new Error("Invalid MIDI variable-length value.");
    }
    const byte = buffer[state.offset++];
    value = (value << 7) | (byte & 0x7f);
    count += 1;
    if ((byte & 0x80) === 0) return value;
  }
}

function parseMidiTrack(buffer, trackIndex) {
  const tempos = [];
  const lyrics = [];
  const notes = [];
  const activeNotes = new Map();
  const state = { offset: 0 };
  let tick = 0;
  let runningStatus = null;

  while (state.offset < buffer.length) {
    tick += readVariableLength(buffer, state);
    let status = buffer[state.offset];
    if (status >= 0x80) {
      state.offset += 1;
      if (status < 0xf0) runningStatus = status;
    } else {
      if (runningStatus === null) throw new Error("MIDI running status has no preceding status byte.");
      status = runningStatus;
    }

    if (status === 0xff) {
      runningStatus = null;
      const type = buffer[state.offset++];
      const length = readVariableLength(buffer, state);
      const end = state.offset + length;
      if (end > buffer.length) throw new Error("MIDI meta event exceeds its track.");
      const data = buffer.subarray(state.offset, end);
      state.offset = end;
      if (type === 0x51 && length === 3) {
        tempos.push({ tick, microsecondsPerQuarter: data.readUIntBE(0, 3) });
      } else if (type === 0x05) {
        lyrics.push({ trackIndex, tick, text: new TextDecoder().decode(data) });
      }
      if (type === 0x2f) break;
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      runningStatus = null;
      const length = readVariableLength(buffer, state);
      state.offset += length;
      if (state.offset > buffer.length) throw new Error("MIDI SysEx event exceeds its track.");
      continue;
    }

    const messageType = status & 0xf0;
    const channel = status & 0x0f;
    const dataLength = messageType === 0xc0 || messageType === 0xd0 ? 1 : 2;
    if (state.offset + dataLength > buffer.length) throw new Error("MIDI channel event exceeds its track.");
    const data1 = buffer[state.offset++];
    const data2 = dataLength === 2 ? buffer[state.offset++] : 0;

    if (messageType === 0x90 && data2 > 0) {
      const note = { trackIndex, channel, pitch: data1, tick, endTick: null };
      notes.push(note);
      const key = `${channel}:${data1}`;
      const pending = activeNotes.get(key) ?? [];
      pending.push(note);
      activeNotes.set(key, pending);
    } else if (messageType === 0x80 || (messageType === 0x90 && data2 === 0)) {
      const key = `${channel}:${data1}`;
      const pending = activeNotes.get(key);
      const note = pending?.shift();
      if (note) note.endTick = tick;
      if (pending?.length === 0) activeNotes.delete(key);
    }
  }

  return { tempos, lyrics, notes };
}

function buildTickConverter(ppq, tempos) {
  const ordered = [...tempos].sort((left, right) => left.tick - right.tick);
  const normalized = [];
  for (const tempo of ordered) {
    if (normalized.at(-1)?.tick === tempo.tick) normalized[normalized.length - 1] = tempo;
    else normalized.push(tempo);
  }
  if (normalized[0]?.tick !== 0) normalized.unshift({ tick: 0, microsecondsPerQuarter: 500_000 });

  const segments = [];
  let elapsedMs = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const tempo = normalized[index];
    if (index > 0) {
      const previous = normalized[index - 1];
      elapsedMs += ((tempo.tick - previous.tick) * previous.microsecondsPerQuarter) / ppq / 1000;
    }
    segments.push({ ...tempo, elapsedMs });
  }

  return (tick) => {
    let low = 0;
    let high = segments.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (segments[middle].tick <= tick) low = middle;
      else high = middle - 1;
    }
    const segment = segments[low];
    return segment.elapsedMs + ((tick - segment.tick) * segment.microsecondsPerQuarter) / ppq / 1000;
  };
}

export function parseMidi(buffer, midiOffsetSeconds = 0) {
  if (buffer.toString("ascii", 0, 4) !== "MThd") throw new Error("MIDI header MThd was not found.");
  const headerLength = buffer.readUInt32BE(4);
  const format = buffer.readUInt16BE(8);
  const trackCount = buffer.readUInt16BE(10);
  const division = buffer.readUInt16BE(12);
  if ((division & 0x8000) !== 0) throw new Error("SMPTE MIDI time division is not supported.");
  if (format > 1) throw new Error(`MIDI format ${format} is not supported.`);

  let offset = 8 + headerLength;
  const parsedTracks = [];
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (buffer.toString("ascii", offset, offset + 4) !== "MTrk") {
      throw new Error(`MIDI track ${trackIndex + 1} is missing MTrk.`);
    }
    const length = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) throw new Error(`MIDI track ${trackIndex + 1} exceeds the file.`);
    parsedTracks.push(parseMidiTrack(buffer.subarray(start, end), trackIndex));
    offset = end;
  }

  const tempos = parsedTracks.flatMap((track) => track.tempos);
  const ticksToMilliseconds = buildTickConverter(division, tempos);
  const offsetMs = midiOffsetSeconds * 1000;
  const notes = parsedTracks.flatMap((track) => track.notes);
  const notesByOnset = new Map();
  for (const note of notes) {
    const key = `${note.trackIndex}:${note.tick}`;
    const matches = notesByOnset.get(key) ?? [];
    matches.push(note);
    notesByOnset.set(key, matches);
  }

  const lyricEvents = parsedTracks
    .flatMap((track) => track.lyrics)
    .sort((left, right) => left.tick - right.tick || left.trackIndex - right.trackIndex)
    .map((lyric) => {
      const note = notesByOnset.get(`${lyric.trackIndex}:${lyric.tick}`)?.[0];
      return {
        ...lyric,
        startTimeMs: Math.round(ticksToMilliseconds(lyric.tick) + offsetMs),
        endTimeMs: note?.endTick === null || note?.endTick === undefined
          ? null
          : Math.round(ticksToMilliseconds(note.endTick) + offsetMs),
      };
    });

  for (let index = 0; index < lyricEvents.length; index += 1) {
    const previous = lyricEvents[index - 1];
    lyricEvents[index].restBeforeMs = previous
      ? lyricEvents[index].startTimeMs - (previous.endTimeMs ?? previous.startTimeMs)
      : Number.POSITIVE_INFINITY;
  }

  return { format, trackCount, ppq: division, tempoEventCount: tempos.length, lyricEvents };
}

export function matchLineStarts(referenceLines, midiEvents, options = {}) {
  const lineCount = options.lineCount ?? referenceLines.length;
  const windowMs = options.windowMs ?? DEFAULT_LINE_WINDOW_MS;
  const starts = [];
  let previousIndex = -1;

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const target = referenceLines[lineIndex].startTimeMs;
    const candidates = [];
    for (let eventIndex = previousIndex + 1; eventIndex < midiEvents.length; eventIndex += 1) {
      const event = midiEvents[eventIndex];
      const distance = Math.abs(event.startTimeMs - target);
      if (distance <= windowMs) {
        const restPenalty = event.restBeforeMs < SHORT_REST_THRESHOLD_MS ? SHORT_REST_PENALTY_MS : 0;
        candidates.push({ eventIndex, score: distance + restPenalty, distance });
      }
      if (event.startTimeMs > target + windowMs) break;
    }
    candidates.sort((left, right) => left.score - right.score || left.distance - right.distance || left.eventIndex - right.eventIndex);
    const match = candidates[0];
    if (!match) throw new Error(`No MIDI line start was found near LRC line ${lineIndex + 1} (${target} ms).`);
    starts.push(match.eventIndex);
    previousIndex = match.eventIndex;
  }

  return starts;
}

function validateTextAndShape(document, referenceLines) {
  const tracks = document.tracks;
  if (!Array.isArray(tracks) || tracks.length !== 1 || !Array.isArray(tracks[0].lines)) {
    throw new Error("Expected exactly one Project K lyrics track.");
  }
  const lines = tracks[0].lines;
  if (lines.length !== referenceLines.length) {
    throw new Error(`JSON has ${lines.length} lines, but Enhanced LRC has ${referenceLines.length}.`);
  }

  let segmentCount = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const reference = referenceLines[lineIndex];
    if (line.text !== reference.text) throw new Error(`Line ${lineIndex + 1} text differs between JSON and Enhanced LRC.`);
    if (line.segments.length !== reference.segments.length) {
      throw new Error(`Line ${lineIndex + 1} has ${line.segments.length} JSON segments and ${reference.segments.length} LRC segments.`);
    }
    for (let segmentIndex = 0; segmentIndex < line.segments.length; segmentIndex += 1) {
      if (line.segments[segmentIndex].text !== reference.segments[segmentIndex].text) {
        throw new Error(`Line ${lineIndex + 1}, segment ${segmentIndex + 1} text differs between JSON and Enhanced LRC.`);
      }
      segmentCount += 1;
    }
  }
  return { lines, segmentCount };
}

export function repairProjectKDocument(document, referenceLines, midiEvents, options = {}) {
  const repaired = structuredClone(document);
  const { lines, segmentCount } = validateTextAndShape(repaired, referenceLines);
  const midiLineCount = options.midiLineCount ?? lines.length - 1;
  if (midiLineCount <= 0 || midiLineCount >= lines.length) {
    throw new Error("The repair requires MIDI-backed lines followed by at least one LRC fallback line.");
  }
  const lineStartEventIndices = matchLineStarts(referenceLines, midiEvents, { lineCount: midiLineCount });
  const details = [];

  for (let lineIndex = 0; lineIndex < midiLineCount; lineIndex += 1) {
    const line = lines[lineIndex];
    const reference = referenceLines[lineIndex];
    const firstEventIndex = lineStartEventIndices[lineIndex];
    const nextEventIndex = lineStartEventIndices[lineIndex + 1] ?? midiEvents.length;
    const lineEvents = midiEvents.slice(firstEventIndex, nextEventIndex);
    const lineAnchorTimeMs = lineEvents[0].startTimeMs;
    const lineAnchorAdjustmentMs = lineAnchorTimeMs - reference.startTimeMs;
    const lrcSegmentStarts = reference.segments.map((segment) => segment.startTimeMs);
    const lrcSegmentsAreIncreasing = lrcSegmentStarts.every(
      (startTimeMs, segmentIndex) => segmentIndex === 0 || startTimeMs > lrcSegmentStarts[segmentIndex - 1],
    );
    const sourceJsonStartTimeMs = line.startTimeMs;
    const correctedSegmentStarts = lrcSegmentsAreIncreasing
      ? lrcSegmentStarts.map((startTimeMs) => startTimeMs + lineAnchorAdjustmentMs)
      : line.segments.map((segment) => lineAnchorTimeMs + segment.startTimeMs - sourceJsonStartTimeMs);
    const candidateEnds = lineEvents.map((event) => event.endTimeMs).filter(Number.isFinite);
    const lineEndTimeMs = Math.max(...candidateEnds);
    if (!Number.isFinite(lineEndTimeMs) || lineEndTimeMs <= correctedSegmentStarts.at(-1)) {
      throw new Error(`MIDI line ${lineIndex + 1} has no usable final note end.`);
    }

    const oldStartTimeMs = line.startTimeMs;
    line.startTimeMs = correctedSegmentStarts[0];
    line.endTimeMs = lineEndTimeMs;
    line.timingQuality = "exact";
    for (let segmentIndex = 0; segmentIndex < line.segments.length; segmentIndex += 1) {
      const segment = line.segments[segmentIndex];
      segment.startTimeMs = correctedSegmentStarts[segmentIndex];
      segment.endTimeMs = correctedSegmentStarts[segmentIndex + 1] ?? lineEndTimeMs;
      segment.timingQuality = "exact";
    }

    details.push({
      lineNumber: lineIndex + 1,
      source: "midi",
      oldStartTimeMs,
      newStartTimeMs: line.startTimeMs,
      shiftMs: line.startTimeMs - oldStartTimeMs,
      referenceStartTimeMs: reference.startTimeMs,
      lineAnchorAdjustmentMs,
      segmentTimingSource: lrcSegmentsAreIncreasing ? "enhanced-lrc-relative" : "source-json-relative-fallback",
      midiEventStartIndex: firstEventIndex,
      midiEventCount: lineEvents.length,
    });
  }

  for (let lineIndex = midiLineCount; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const reference = referenceLines[lineIndex];
    const oldStartTimeMs = line.startTimeMs;
    const originalLastSegment = line.segments.at(-1);
    const preservedTailDurationMs = originalLastSegment.endTimeMs - originalLastSegment.startTimeMs;
    line.startTimeMs = reference.segments[0].startTimeMs;
    for (let segmentIndex = 0; segmentIndex < line.segments.length; segmentIndex += 1) {
      const segment = line.segments[segmentIndex];
      segment.startTimeMs = reference.segments[segmentIndex].startTimeMs;
      segment.endTimeMs = reference.segments[segmentIndex + 1]?.startTimeMs
        ?? segment.startTimeMs + preservedTailDurationMs;
      segment.timingQuality = segmentIndex === line.segments.length - 1 ? "inferred" : "exact";
    }
    line.endTimeMs = line.segments.at(-1).endTimeMs;
    line.timingQuality = "inferred";
    details.push({
      lineNumber: lineIndex + 1,
      source: "enhanced-lrc-fallback",
      oldStartTimeMs,
      newStartTimeMs: line.startTimeMs,
      shiftMs: line.startTimeMs - oldStartTimeMs,
      referenceStartTimeMs: reference.startTimeMs,
      preservedTailDurationMs,
    });
  }

  repaired.timingQuality = "mixed";
  return { repaired, details, lineStartEventIndices, segmentCount };
}

function validateRepairedDocument(document) {
  const lines = document.tracks[0].lines;
  let previousLineStart = -1;
  let segmentCount = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.startTimeMs <= previousLineStart) throw new Error(`Line ${lineIndex + 1} does not start after the preceding line.`);
    if (line.endTimeMs <= line.startTimeMs) throw new Error(`Line ${lineIndex + 1} has a non-positive duration.`);
    previousLineStart = line.startTimeMs;
    let previousSegmentStart = -1;
    for (let segmentIndex = 0; segmentIndex < line.segments.length; segmentIndex += 1) {
      const segment = line.segments[segmentIndex];
      if (segment.startTimeMs <= previousSegmentStart) {
        throw new Error(`Line ${lineIndex + 1}, segment ${segmentIndex + 1} is not strictly increasing.`);
      }
      if (segment.endTimeMs <= segment.startTimeMs) {
        throw new Error(`Line ${lineIndex + 1}, segment ${segmentIndex + 1} has a non-positive duration.`);
      }
      if (segmentIndex + 1 < line.segments.length && segment.endTimeMs !== line.segments[segmentIndex + 1].startTimeMs) {
        throw new Error(`Line ${lineIndex + 1}, segment ${segmentIndex + 1} does not end at the next same-line start.`);
      }
      previousSegmentStart = segment.startTimeMs;
      segmentCount += 1;
    }
    if (line.startTimeMs !== line.segments[0].startTimeMs || line.endTimeMs !== line.segments.at(-1).endTimeMs) {
      throw new Error(`Line ${lineIndex + 1} boundaries do not match its segments.`);
    }
  }
  return { lineCount: lines.length, segmentCount };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith("--")) throw new Error(`Unexpected argument: ${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
    options[name.slice(2)] = value;
    index += 1;
  }
  for (const required of ["json", "enhanced-lrc", "midi", "output", "report"]) {
    if (!options[required]) throw new Error(`Required argument --${required} is missing.`);
  }
  options["midi-offset"] ??= "0";
  return options;
}

function buildReport(result, inputs, hashes, midiInfo, outputPath) {
  const lines = result.details.map((detail) => {
    const delta = detail.shiftMs >= 0 ? `+${detail.shiftMs}` : String(detail.shiftMs);
    const anchorAdjustment = detail.lineAnchorAdjustmentMs === undefined ? "-" : detail.lineAnchorAdjustmentMs;
    const segmentTimingSource = detail.segmentTimingSource ?? "enhanced-lrc";
    return `| ${detail.lineNumber} | ${detail.source} | ${segmentTimingSource} | ${detail.oldStartTimeMs} | ${detail.newStartTimeMs} | ${delta} | ${anchorAdjustment} |`;
  });
  const fallback = result.details.filter((detail) => detail.source !== "midi");

  return `# Project K JSON タイミング補正レポート

- 補正元 JSON: \`${inputs.json}\`
- 参照 Enhanced LRC: \`${inputs.enhancedLrc}\`
- 参照 MIDI: \`${inputs.midi}\`
- 出力 JSON: \`${outputPath}\`
- MIDI オフセット: ${inputs.midiOffsetSeconds} 秒
- JSON SHA-256: \`${hashes.json}\`
- LRC SHA-256: \`${hashes.lrc}\`
- MIDI SHA-256: \`${hashes.midi}\`

## 検証結果

- 行数: ${result.repaired.tracks[0].lines.length}
- セグメント数: ${result.segmentCount}
- MIDI lyric event 数: ${midiInfo.lyricEvents.length}
- MIDI で補正した行: ${result.details.length - fallback.length}
- Enhanced LRC フォールバック行: ${fallback.map((detail) => detail.lineNumber).join(", ")}
- LRC 内の逆転により補正元 JSON の行内間隔を使った行: ${result.details.filter((detail) => detail.segmentTimingSource === "source-json-relative-fallback").map((detail) => detail.lineNumber).join(", ") || "なし"}
- 行開始、セグメント開始、同一行内終了境界はすべて単調増加
- 行テキストとセグメント結合は JSON / Enhanced LRC 間で一致
- 文書 timingQuality: mixed

## 補正方法

1. Enhanced LRC の各行開始付近 500 ms 以内から、直前ノートとの休止を優先して MIDI lyric event の行頭を選択した。
2. MIDI は1つの発音イベントに複数文字が対応する行を含むため、文字をイベントへ強制対応させず、各行頭を MIDI に合わせた差分だけ Enhanced LRC の全セグメントを平行移動した。LRC 内で時刻が逆転する行だけは、補正元 JSON の正常な行内間隔を MIDI 行頭へ移動した。
3. 1～50行目の行末は、同じ MIDI 行に属する最終ノート終了へ補正した。
4. 51行目は対応 MIDI ノートがないため、開始値を Enhanced LRC へ戻した。最後のセグメント終了だけは補正元 JSON の最終セグメント長を維持した推定値であり、行と最終セグメントを inferred とした。

## 行別開始時刻

| 行 | 根拠 | 行内境界の根拠 | 補正前 ms | 補正後 ms | 変更量 ms | LRCからMIDI行頭への調整 ms |
|---:|---|---|---:|---:|---:|---:|
${lines.join("\n")}
`;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const jsonPath = path.resolve(args.json);
  const lrcPath = path.resolve(args["enhanced-lrc"]);
  const midiPath = path.resolve(args.midi);
  const outputPath = path.resolve(args.output);
  const reportPath = path.resolve(args.report);
  const midiOffsetSeconds = Number(args["midi-offset"]);
  if (!Number.isFinite(midiOffsetSeconds)) throw new Error("--midi-offset must be a number.");

  const [jsonBuffer, lrcBuffer, midiBuffer] = await Promise.all([
    readFile(jsonPath),
    readFile(lrcPath),
    readFile(midiPath),
  ]);
  const document = JSON.parse(jsonBuffer.toString("utf8"));
  const referenceLines = parseEnhancedLrc(lrcBuffer.toString("utf8"));
  const midiInfo = parseMidi(midiBuffer, midiOffsetSeconds);
  const result = repairProjectKDocument(document, referenceLines, midiInfo.lyricEvents);
  const validation = validateRepairedDocument(result.repaired);
  if (validation.segmentCount !== result.segmentCount) throw new Error("Segment count changed during repair.");

  const hashes = { json: sha256(jsonBuffer), lrc: sha256(lrcBuffer), midi: sha256(midiBuffer) };
  const extension = result.repaired.extensions?.["com.shinyo.makelrc"] ?? {};
  result.repaired.extensions ??= {};
  result.repaired.extensions["com.shinyo.makelrc"] = {
    ...extension,
    timingRepair: {
      algorithm: "midi-line-anchor-enhanced-lrc-v1",
      midiOffsetSeconds,
      sourceJsonSha256: hashes.json,
      enhancedLrcSha256: hashes.lrc,
      midiSha256: hashes.midi,
      midiCorrectedLineCount: result.details.filter((detail) => detail.source === "midi").length,
      lrcFallbackLineIds: result.details
        .filter((detail) => detail.source !== "midi")
        .map((detail) => result.repaired.tracks[0].lines[detail.lineNumber - 1].id),
      sourceJsonRelativeFallbackLineIds: result.details
        .filter((detail) => detail.segmentTimingSource === "source-json-relative-fallback")
        .map((detail) => result.repaired.tracks[0].lines[detail.lineNumber - 1].id),
      fallbackFinalEndPolicy: "preserve-source-last-segment-duration",
    },
  };

  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(result.repaired, null, 2)}\n`, "utf8"),
    writeFile(reportPath, buildReport(result, {
      json: jsonPath,
      enhancedLrc: lrcPath,
      midi: midiPath,
      midiOffsetSeconds,
    }, hashes, midiInfo, outputPath), "utf8"),
  ]);

  console.log(JSON.stringify({
    outputPath,
    reportPath,
    lineCount: validation.lineCount,
    segmentCount: validation.segmentCount,
    midiLyricEventCount: midiInfo.lyricEvents.length,
    lineStartEventIndices: result.lineStartEventIndices,
    fallbackLines: result.details.filter((detail) => detail.source !== "midi").map((detail) => detail.lineNumber),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
