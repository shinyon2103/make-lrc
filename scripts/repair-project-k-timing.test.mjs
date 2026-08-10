import { describe, expect, it } from "vitest";
import {
  matchLineStarts,
  parseEnhancedLrc,
  repairProjectKDocument,
} from "./repair-project-k-timing.mjs";

describe("parseEnhancedLrc", () => {
  it("parses adjacent line markers and preserves segment text", () => {
    const lines = parseEnhancedLrc("[00:01.00]<00:01.00>A<00:01.50> B[00:03.00]<00:03.00>C<00:03.25>D\r\n");
    expect(lines).toEqual([
      {
        startTimeMs: 1000,
        text: "A B",
        segments: [
          { startTimeMs: 1000, text: "A" },
          { startTimeMs: 1500, text: " B" },
        ],
      },
      {
        startTimeMs: 3000,
        text: "CD",
        segments: [
          { startTimeMs: 3000, text: "C" },
          { startTimeMs: 3250, text: "D" },
        ],
      },
    ]);
  });
});

describe("matchLineStarts", () => {
  it("prefers an event after a real rest over a slightly closer continuation", () => {
    const events = [
      { startTimeMs: 950, restBeforeMs: 500 },
      { startTimeMs: 1980, restBeforeMs: 0 },
      { startTimeMs: 2100, restBeforeMs: 200 },
    ];
    expect(matchLineStarts([{ startTimeMs: 1000 }, { startTimeMs: 2000 }], events)).toEqual([0, 2]);
  });
});

describe("repairProjectKDocument", () => {
  it("uses MIDI for backed lines and marks the LRC-only final end inferred", () => {
    const document = {
      timingQuality: "exact",
      tracks: [{
        lines: [
          {
            id: "line-0001",
            startTimeMs: 800,
            endTimeMs: 1800,
            text: "AB",
            timingQuality: "exact",
            segments: [
              { text: "A", startTimeMs: 800, endTimeMs: 1200, timingQuality: "exact" },
              { text: "B", startTimeMs: 1200, endTimeMs: 1800, timingQuality: "exact" },
            ],
          },
          {
            id: "line-0002",
            startTimeMs: 2900,
            endTimeMs: 4100,
            text: "CD",
            timingQuality: "exact",
            segments: [
              { text: "C", startTimeMs: 2900, endTimeMs: 3400, timingQuality: "exact" },
              { text: "D", startTimeMs: 3400, endTimeMs: 4100, timingQuality: "exact" },
            ],
          },
        ],
      }],
    };
    const reference = [
      { startTimeMs: 1000, text: "AB", segments: [{ text: "A", startTimeMs: 1000 }, { text: "B", startTimeMs: 1500 }] },
      { startTimeMs: 3000, text: "CD", segments: [{ text: "C", startTimeMs: 3000 }, { text: "D", startTimeMs: 3500 }] },
    ];
    const events = [
      { startTimeMs: 1000, endTimeMs: 1400, restBeforeMs: 500 },
      { startTimeMs: 1500, endTimeMs: 2000, restBeforeMs: 100 },
    ];

    const result = repairProjectKDocument(document, reference, events, { midiLineCount: 1 });
    const [midiLine, fallbackLine] = result.repaired.tracks[0].lines;
    expect(midiLine).toMatchObject({ startTimeMs: 1000, endTimeMs: 2000, timingQuality: "exact" });
    expect(fallbackLine).toMatchObject({ startTimeMs: 3000, endTimeMs: 4200, timingQuality: "inferred" });
    expect(fallbackLine.segments.at(-1)).toMatchObject({ startTimeMs: 3500, endTimeMs: 4200, timingQuality: "inferred" });
    expect(result.repaired.timingQuality).toBe("mixed");

    const reversedReference = structuredClone(reference);
    reversedReference[0].segments[1].startTimeMs = 900;
    const reversedResult = repairProjectKDocument(document, reversedReference, events, { midiLineCount: 1 });
    expect(reversedResult.repaired.tracks[0].lines[0].segments.map((segment) => segment.startTimeMs)).toEqual([1000, 1400]);
    expect(reversedResult.details[0].segmentTimingSource).toBe("source-json-relative-fallback");
  });
});
