import {
  NATIVE_MESSAGE_VERSION,
  type SaveStreamRequestBase,
} from "../../../contracts/native-messages.js";

export function createNativeSaveStartRequest(
  hlsUrl: string,
  outputFileName?: string,
  destination?: string,
): SaveStreamRequestBase {
  return {
    version: NATIVE_MESSAGE_VERSION,
    type: "save:start",
    hlsUrl,
    ...(outputFileName === undefined ? {} : { outputFileName }),
    ...(destination === undefined ? {} : { destination }),
  };
}
