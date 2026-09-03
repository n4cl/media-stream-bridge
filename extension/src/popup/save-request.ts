import type { SaveCandidateMessage } from "../shared/messages.js";

export function createSaveRequest(
  tabId: number,
  hlsUrl: string,
  outputFileName: string | undefined,
  destination?: string,
): SaveCandidateMessage {
  return {
    type: "save:start",
    tabId,
    hlsUrl,
    ...(outputFileName === undefined || outputFileName === "" ? {} : { outputFileName }),
    ...(destination === undefined ? {} : { destination }),
  };
}
