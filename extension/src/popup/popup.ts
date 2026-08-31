import {
  isListCandidatesResponse,
  isSaveCandidateResponse,
  isSaveStatusResponse,
  type ListCandidatesMessage,
  type SaveCandidateMessage,
  type SaveJobStatus,
  type SaveStatusMessage,
} from "../shared/messages.js";
import {
  isActiveSaveJob,
  SaveStatusPoller,
  saveJobStatusText,
  type TimerScheduler,
} from "./save-status.js";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }
  return element;
}

const candidateStatus = requireElement<HTMLParagraphElement>("#candidate-status");
const status = requireElement<HTMLParagraphElement>("#status");
const form = requireElement<HTMLFormElement>("#candidate-form");
const list = requireElement<HTMLDivElement>("#candidate-list");
const saveButton = requireElement<HTMLButtonElement>("#save-button");
const scheduler: TimerScheduler = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (timerId) => window.clearTimeout(timerId),
};

let currentTabId: number | undefined;

function renderSaveStatus(job: SaveJobStatus | null): void {
  const text = saveJobStatusText(job);
  status.hidden = text === null;
  if (text !== null) {
    status.textContent = text;
  }
  saveButton.disabled = isActiveSaveJob(job);
}

async function requestSaveStatus(): Promise<SaveJobStatus | null> {
  if (currentTabId === undefined) {
    throw new Error("Current tab is unavailable");
  }
  const message: SaveStatusMessage = { type: "save:status", tabId: currentTabId };
  const response: unknown = await browser.runtime.sendMessage(message);
  if (!isSaveStatusResponse(response) || !response.ok) {
    throw new Error("Save status is unavailable");
  }
  return response.job;
}

const statusPoller = new SaveStatusPoller(
  requestSaveStatus,
  renderSaveStatus,
  () => {
    status.hidden = false;
    status.textContent = "保存状態を確認できませんでした。";
  },
  scheduler,
);

function renderCandidates(candidates: Array<{ url: string }>): void {
  list.replaceChildren();
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

async function resolveCurrentTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return typeof tab?.id === "number" && Number.isInteger(tab.id) ? tab.id : undefined;
}

async function loadCandidates(tabId: number): Promise<void> {
  try {
    const message: ListCandidatesMessage = { type: "candidates:list", tabId };
    const response: unknown = await browser.runtime.sendMessage(message);

    if (!isListCandidatesResponse(response) || !response.ok) {
      candidateStatus.textContent = "候補を取得できませんでした。";
      return;
    }

    if (response.candidates.length === 0) {
      candidateStatus.textContent = "このタブではHLSストリームを検出していません。";
      return;
    }

    candidateStatus.hidden = true;
    renderCandidates(response.candidates);
  } catch {
    candidateStatus.textContent = "候補の取得中にエラーが発生しました。";
  }
}

async function initialize(): Promise<void> {
  try {
    currentTabId = await resolveCurrentTabId();
  } catch {
    currentTabId = undefined;
  }
  if (currentTabId === undefined) {
    candidateStatus.textContent = "現在のタブを確認できませんでした。";
    return;
  }
  statusPoller.start();
  await loadCandidates(currentTabId);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = new FormData(form).get("candidate");
  if (typeof selected !== "string") {
    status.hidden = false;
    status.textContent = "保存する候補を選択してください。";
    return;
  }

  if (currentTabId === undefined) {
    status.hidden = false;
    status.textContent = "現在のタブを確認できませんでした。";
    return;
  }

  saveButton.disabled = true;
  status.hidden = false;
  status.textContent = "保存を開始しています…";
  let keepSaveDisabled = false;
  try {
    const message: SaveCandidateMessage = {
      type: "save:start",
      tabId: currentTabId,
      hlsUrl: selected,
    };
    const response: unknown = await browser.runtime.sendMessage(message);
    if (!isSaveCandidateResponse(response)) {
      status.textContent = "保存結果を確認できませんでした。";
    } else if (!response.ok && response.error === "save-already-running") {
      status.textContent = "既に保存中です。";
      keepSaveDisabled = true;
      statusPoller.start();
    } else if (!response.ok) {
      status.textContent = "保存を開始できませんでした。Native Host の設定を確認してください。";
    } else if (response.response.type === "save:started") {
      renderSaveStatus({ state: "running", saveId: response.response.saveId });
      keepSaveDisabled = true;
      statusPoller.start();
    } else if (response.response.type === "save:completed") {
      renderSaveStatus({
        state: "completed",
        saveId: response.response.saveId,
        outputFile: response.response.outputFile,
      });
    } else if (response.response.type === "save:failed") {
      renderSaveStatus({ state: "failed", error: response.response.code });
    } else {
      status.textContent = "保存結果を確認できませんでした。";
    }
  } catch {
    status.textContent = "保存中にエラーが発生しました。";
  } finally {
    if (!keepSaveDisabled) {
      saveButton.disabled = false;
    }
  }
});

window.addEventListener("pagehide", () => {
  statusPoller.stop();
});

void initialize();
