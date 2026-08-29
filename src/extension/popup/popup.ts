import { isListCandidatesResponse, type ListCandidatesMessage } from "../shared/messages.js";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }
  return element;
}

const status = requireElement<HTMLParagraphElement>("#status");
const form = requireElement<HTMLFormElement>("#candidate-form");
const list = requireElement<HTMLDivElement>("#candidate-list");

function renderCandidates(candidates: Array<{ url: string }>): void {
  status.hidden = true;
  form.hidden = false;

  for (const [index, candidate] of candidates.entries()) {
    const label = document.createElement("label");
    label.className = "candidate";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "candidate";
    input.value = candidate.url;
    input.checked = candidates.length === 1;

    const url = document.createElement("span");
    url.textContent = candidate.url;

    label.append(input, url);
    list.append(label);

    if (index < candidates.length - 1) {
      list.append(document.createElement("hr"));
    }
  }
}

async function loadCandidates(): Promise<void> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id;
    if (typeof tabId !== "number" || !Number.isInteger(tabId)) {
      status.textContent = "現在のタブを確認できませんでした。";
      return;
    }

    const message: ListCandidatesMessage = {
      type: "candidates:list",
      tabId,
    };
    const response: unknown = await browser.runtime.sendMessage(message);

    if (!isListCandidatesResponse(response) || !response.ok) {
      status.textContent = "候補を取得できませんでした。";
      return;
    }

    if (response.candidates.length === 0) {
      status.textContent = "このタブではHLSストリームを検出していません。";
      return;
    }

    renderCandidates(response.candidates);
  } catch {
    status.textContent = "候補の取得中にエラーが発生しました。";
  }
}

void loadCandidates();
