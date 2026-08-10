import { describe, expect, it } from "vitest";
import { completeStableTimingCapture, readStableMediaTime } from "./timingCapture";

describe("readStableMediaTime", () => {
  it("accepts a finite media time after metadata is ready", () => {
    expect(readStableMediaTime({ currentTime: 12.345, readyState: 1, seeking: false })).toBe(12.345);
  });

  it("rejects clocks that are unavailable or seeking", () => {
    expect(readStableMediaTime(null)).toBeUndefined();
    expect(readStableMediaTime({ currentTime: 0, readyState: 0, seeking: false })).toBeUndefined();
    expect(readStableMediaTime({ currentTime: 10, readyState: 4, seeking: true })).toBeUndefined();
    expect(readStableMediaTime({ currentTime: Number.NaN, readyState: 4, seeking: false })).toBeUndefined();
  });
});

describe("completeStableTimingCapture", () => {
  it("commits both boundaries when the media timeline stays continuous", () => {
    expect(completeStableTimingCapture(10, 3, 3, {
      currentTime: 10.75,
      readyState: 4,
      seeking: false,
    })).toEqual({ startTime: 10, endTime: 10.75 });
  });

  it("keeps a start-only stamp when no later end was captured", () => {
    expect(completeStableTimingCapture(10, 3, 3, {
      currentTime: 10,
      readyState: 4,
      seeking: false,
    })).toEqual({ startTime: 10, endTime: undefined });
  });

  it("cancels a capture after pause, seek, or another timeline revision", () => {
    expect(completeStableTimingCapture(10, 3, 4, {
      currentTime: 10.75,
      readyState: 4,
      seeking: false,
    })).toBeNull();
  });

  it("cancels a capture while a seek is still pending", () => {
    expect(completeStableTimingCapture(10, 3, 3, {
      currentTime: 12,
      readyState: 4,
      seeking: true,
    })).toBeNull();
  });
});
