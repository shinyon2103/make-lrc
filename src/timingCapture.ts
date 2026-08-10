export type MediaClock = {
  currentTime: number;
  readyState: number;
  seeking: boolean;
};

export type CompletedTimingCapture = {
  startTime: number;
  endTime: number | undefined;
};

export function readStableMediaTime(audio: MediaClock | null) {
  if (!audio || audio.readyState < 1 || audio.seeking || !Number.isFinite(audio.currentTime)) {
    return undefined;
  }
  return audio.currentTime;
}

export function completeStableTimingCapture(
  startTime: number,
  startRevision: number,
  currentRevision: number,
  audio: MediaClock | null,
): CompletedTimingCapture | null {
  const endTime = readStableMediaTime(audio);
  if (startRevision !== currentRevision || !Number.isFinite(endTime)) return null;
  return {
    startTime,
    endTime: (endTime ?? startTime) > startTime ? endTime : undefined,
  };
}
