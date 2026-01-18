const DEFAULTS = {
  serverUrl: "http://127.0.0.1:17831",
  token: "",
};

function getSettings() {
  // オプション画面の設定を取得（未設定でも動くようにデフォルトを使う）
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (items) => resolve(items));
  });
}

function showToast(message) {
  const existing = document.getElementById("gemini-dev-bridge-toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = "gemini-dev-bridge-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 5000);
}

function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function findGeminiInput() {
  // GeminiのUI変更に耐えるため、textarea/contenteditableを広めに探索
  const candidates = Array.from(
    document.querySelectorAll("textarea, div[contenteditable='true']")
  ).filter(isVisible);
  if (candidates.length === 0) {
    return null;
  }
  return candidates[candidates.length - 1];
}

function setInputText(inputEl, text) {
  if (!inputEl) {
    return false;
  }
  if (inputEl.tagName.toLowerCase() === "textarea") {
    inputEl.value = text;
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  if (inputEl.isContentEditable) {
    inputEl.textContent = text;
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  return false;
}

function extractUnifiedDiff() {
  // 最新のコードブロックからdiffらしいものを探索
  const codeBlocks = Array.from(document.querySelectorAll("pre code"));
  for (let i = codeBlocks.length - 1; i >= 0; i -= 1) {
    const text = (codeBlocks[i].textContent || "").trim();
    if (!text) {
      continue;
    }
    const looksDiff =
      text.includes("diff --git") ||
      (text.includes("--- ") && text.includes("+++ ")) ||
      text.startsWith("@@ ");
    if (looksDiff) {
      return text;
    }
  }

  const preBlocks = Array.from(document.querySelectorAll("pre"));
  for (let i = preBlocks.length - 1; i >= 0; i -= 1) {
    const text = (preBlocks[i].textContent || "").trim();
    if (text.includes("diff --git")) {
      return text;
    }
  }

  return null;
}

async function fetchSnapshot() {
  // トークンを付与してローカルサーバからスナップショットを取得
  const settings = await getSettings();
  const url = new URL("/snapshot", settings.serverUrl);

  const res = await fetch(url.toString(), {
    headers: {
      "X-Local-Token": settings.token || "",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Snapshot失敗: ${text}`);
  }
  return res.json();
}

async function applyDiff(diffText) {
  // diff適用はサーバ側でgit apply --checkを行うため、ここでは送信のみ
  const settings = await getSettings();
  const url = new URL("/apply", settings.serverUrl);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Local-Token": settings.token || "",
    },
    body: JSON.stringify({ diff_text: diffText }),
  });

  const data = await res.json().catch(() => ({ message: "応答の解析に失敗しました。" }));
  if (!res.ok) {
    throw new Error(data.message || "diff適用に失敗しました。");
  }
  return data;
}

function createFloatingButtons() {
  if (document.getElementById("gemini-dev-bridge")) {
    return;
  }

  const container = document.createElement("div");
  container.id = "gemini-dev-bridge";

  const snapshotBtn = document.createElement("button");
  snapshotBtn.className = "gdb-btn";
  snapshotBtn.textContent = "Snapshot → Paste";
  snapshotBtn.addEventListener("click", async () => {
    showToast("スナップショット取得中...");
    try {
      const data = await fetchSnapshot();
      const inputEl = findGeminiInput();
      if (!setInputText(inputEl, data.text)) {
        showToast("入力欄が見つかりません。GeminiのUI変更に注意してください。");
        return;
      }
      showToast("貼り付け完了しました。");
    } catch (err) {
      showToast(err.message || "Snapshot取得に失敗しました。");
    }
  });

  const applyBtn = document.createElement("button");
  applyBtn.className = "gdb-btn";
  applyBtn.textContent = "Extract Diff → Apply";
  applyBtn.addEventListener("click", async () => {
    showToast("diff抽出中...");
    const diffText = extractUnifiedDiff();
    if (!diffText) {
      showToast("diffブロックが見つかりません。Geminiの返信を確認してください。");
      return;
    }
    try {
      const result = await applyDiff(diffText);
      const files = (result.changed_files || []).join(", ");
      showToast(`適用しました。変更: ${files || "(なし)"}`);
    } catch (err) {
      showToast(err.message || "diff適用に失敗しました。");
    }
  });

  container.appendChild(snapshotBtn);
  container.appendChild(applyBtn);
  document.body.appendChild(container);
}

createFloatingButtons();
