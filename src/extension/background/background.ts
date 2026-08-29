import { CandidateStore, isHlsPlaylistUrl } from "../shared/candidates.js";
import { isListCandidatesMessage, type ListCandidatesResponse } from "../shared/messages.js";

const candidates = new CandidateStore();

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
