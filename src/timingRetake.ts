export type TimingState = {
  timings: Array<number | undefined>;
  endTimings: Array<number | undefined>;
  segmentTimings: Array<Array<number | undefined>>;
  segmentEndTimings: Array<Array<number | undefined>>;
};

type Retake = {
  lineIndex: number;
  segmentIndex: number;
  timingMode: "line" | "segment";
  startTime: number;
  endTime: number | undefined;
  segmentCount: number;
};

function replaceAt<T>(items: T[], index: number, value: T) {
  const next = [...items];
  next[index] = value;
  return next;
}

/**
 * Applies one successfully completed stamp. Retaking never touches another line,
 * but invalidates every detailed boundary at or after the retake point so that a
 * previous pass cannot be combined with the new pass.
 */
export function applyTimingRetake(state: TimingState, retake: Retake): TimingState {
  const { lineIndex, segmentIndex, startTime, endTime } = retake;

  if (retake.timingMode === "line") {
    return {
      timings: replaceAt(state.timings, lineIndex, startTime),
      endTimings: replaceAt(state.endTimings, lineIndex, endTime),
      segmentTimings: replaceAt(state.segmentTimings, lineIndex, []),
      segmentEndTimings: replaceAt(state.segmentEndTimings, lineIndex, []),
    };
  }

  const oldStarts = state.segmentTimings[lineIndex] ?? [];
  const oldEnds = state.segmentEndTimings[lineIndex] ?? [];
  const newStarts = [...oldStarts.slice(0, segmentIndex), startTime];
  const newEnds = [...oldEnds.slice(0, segmentIndex), endTime];
  const isFinalSegment = segmentIndex === retake.segmentCount - 1;

  return {
    timings: segmentIndex === 0
      ? replaceAt(state.timings, lineIndex, startTime)
      : [...state.timings],
    endTimings: replaceAt(state.endTimings, lineIndex, isFinalSegment ? endTime : undefined),
    segmentTimings: replaceAt(state.segmentTimings, lineIndex, newStarts),
    segmentEndTimings: replaceAt(state.segmentEndTimings, lineIndex, newEnds),
  };
}
