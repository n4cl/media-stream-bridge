import {
  isNativeHostResponse,
  NATIVE_MESSAGE_VERSION,
} from "../../../contracts/native-messages.js";
import { CandidateStore, isHlsPlaylistUrl } from "../shared/candidates.js";
import {
  isListCandidatesMessage,
  isSaveCandidateMessage,
  type ListCandidatesResponse,
  type SaveCandidateResponse,
} from "../shared/messages.js";

const candidates = new CandidateStore();
const NATIVE_HOST_NAME = "com.media_stream_bridge";

function saveWithNativeHost(hlsUrl: string): Promise<SaveCandidateResponse> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (response: SaveCandidateResponse): void => {
      if (!settled) {
        settled = true;
        resolve(response);
      }
    };
    let port: browser.runtime.Port;
    try {
      port = browser.runtime.connectNative(NATIVE_HOST_NAME);
    } catch {
      settle({ ok: false, error: "native-host-unavailable" });
      return;
    }

    port.onMessage.addListener((message: unknown) => {
      if (!isNativeHostResponse(message)) {
        settle({ ok: false, error: "native-host-invalid-response" });
        port.disconnect();
        return;
      }
      if (message.type === "save:started") {
        return;
      }
      settle({ ok: true, response: message });
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      settle({ ok: false, error: "native-host-unavailable" });
    });
    port.postMessage({ version: NATIVE_MESSAGE_VERSION, type: "save:start", hlsUrl });
  });
}

browser.webRequest.onBeforeRequest.addListener(
  (request) => {
    if (request.tabId < 0 || !isHlsPlaylistUrl(request.url)) {
      return;
    }

    candidates.add(request.tabId, request.url);
  },
  { urls: ["<all_urls>"] },
);

browser.tabs.onRemoved.addListener((tabId) => {
  candidates.deleteTab(tabId);
});

browser.runtime.onMessage.addListener((message: unknown) => {
  if (isSaveCandidateMessage(message)) {
    if (typeof message.hlsUrl !== "string" || !isHlsPlaylistUrl(message.hlsUrl)) {
      const response: SaveCandidateResponse = { ok: false, error: "invalid-hls-url" };
      return Promise.resolve(response);
    }
    return saveWithNativeHost(message.hlsUrl);
  }

  if (!isListCandidatesMessage(message)) {
    return undefined;
  }

  if (typeof message.tabId !== "number" || !Number.isInteger(message.tabId) || message.tabId < 0) {
    const response: ListCandidatesResponse = { ok: false, error: "invalid-tab-id" };
    return Promise.resolve(response);
  }

  const response: ListCandidatesResponse = {
    ok: true,
    candidates: candidates.list(message.tabId),
  };
  return Promise.resolve(response);
});
