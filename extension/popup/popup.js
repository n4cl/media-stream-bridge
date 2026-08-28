const status = document.querySelector("#status");
const form = document.querySelector("#candidate-form");
const list = document.querySelector("#candidate-list");

function renderCandidates(candidates) {
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

async function loadCandidates() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id)) {
      status.textContent = "現在のタブを確認できませんでした。";
      return;
    }

    const response = await browser.runtime.sendMessage({
      type: "candidates:list",
      tabId: tab.id,
    });

    if (!response?.ok) {
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
