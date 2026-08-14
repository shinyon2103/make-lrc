import { describe, expect, it } from "vitest";
import { applyTimingRetake, type TimingState } from "./timingRetake";

const completedState = (): TimingState => ({
  timings: [10, 30],
  endTimings: [14, 34],
  segmentTimings: [[10, 11, 12, 13], [30, 31]],
  segmentEndTimings: [[10.5, 11.5, 12.5, 14], [30.5, 34]],
});

describe("applyTimingRetake", () => {
  it("invalidates the remainder of only the current line during a segment retake", () => {
    const original = completedState();
    const retaken = applyTimingRetake(original, {
      lineIndex: 0,
      segmentIndex: 1,
      timingMode: "segment",
      startTime: 20,
      endTime: 20.5,
      segmentCount: 4,
    });

    expect(retaken).toEqual({
      timings: [10, 30],
      endTimings: [undefined, 34],
      segmentTimings: [[10, 20], [30, 31]],
      segmentEndTimings: [[10.5, 20.5], [30.5, 34]],
    });
    expect(original).toEqual(completedState());
  });

  it("builds a complete new pass and permits undo/redo snapshots to restore either generation", () => {
    const original = completedState();
    let current = applyTimingRetake(original, {
      lineIndex: 0, segmentIndex: 1, timingMode: "segment", startTime: 20, endTime: 20.4, segmentCount: 4,
    });
    current = applyTimingRetake(current, {
      lineIndex: 0, segmentIndex: 2, timingMode: "segment", startTime: 21, endTime: 21.4, segmentCount: 4,
    });
    current = applyTimingRetake(current, {
      lineIndex: 0, segmentIndex: 3, timingMode: "segment", startTime: 22, endTime: 22.5, segmentCount: 4,
    });

    expect(current.segmentTimings[0]).toEqual([10, 20, 21, 22]);
    expect(current.segmentEndTimings[0]).toEqual([10.5, 20.4, 21.4, 22.5]);
    expect(current.endTimings[0]).toBe(22.5);

    // The app's history stores full immutable states; these assignments model undo and redo.
    const redoSnapshot = current;
    current = original;
    expect(current).toEqual(completedState());
    current = redoSnapshot;
    expect(current.segmentTimings[0]).toEqual([10, 20, 21, 22]);
  });

  it("replaces a line start/end as one generation and clears stale detail for that line", () => {
    const retaken = applyTimingRetake(completedState(), {
      lineIndex: 0,
      segmentIndex: 0,
      timingMode: "line",
      startTime: 40,
      endTime: 42,
      segmentCount: 1,
    });

    expect(retaken.timings).toEqual([40, 30]);
    expect(retaken.endTimings).toEqual([42, 34]);
    expect(retaken.segmentTimings).toEqual([[], [30, 31]]);
    expect(retaken.segmentEndTimings).toEqual([[], [30.5, 34]]);
  });

  it("does not retain an old line end when the new line stamp has no usable release time", () => {
    const retaken = applyTimingRetake(completedState(), {
      lineIndex: 0, segmentIndex: 0, timingMode: "line", startTime: 40, endTime: undefined, segmentCount: 1,
    });

    expect(retaken.timings[0]).toBe(40);
    expect(retaken.endTimings[0]).toBeUndefined();
  });
});
