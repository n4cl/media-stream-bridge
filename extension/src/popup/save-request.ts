import type { SaveCandidateMessage } from "../shared/messages.js";

export function createSaveRequest(
  tabId: number,
  hlsUrl: string,
  options?: { outputFileName: string; destination: string },
): SaveCandidateMessage {
  if (options === undefined) {
    return { type: "save:start", tabId, hlsUrl };
  }
  const { outputFileName } = options;
  return {
    type: "save:start",
    tabId,
    hlsUrl,
    ...(outputFileName === "" ? {} : { outputFileName }),
    destination: options.destination,
  };
}
