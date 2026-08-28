import { CandidateStore, isHlsPlaylistUrl } from "../shared/candidates.mjs";

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

browser.runtime.onMessage.addListener((message) => {
  if (message?.type !== "candidates:list") {
    return undefined;
  }

  if (!Number.isInteger(message.tabId) || message.tabId < 0) {
    return Promise.resolve({ ok: false, error: "invalid-tab-id" });
  }

  return Promise.resolve({
    ok: true,
    candidates: candidates.list(message.tabId),
  });
});
