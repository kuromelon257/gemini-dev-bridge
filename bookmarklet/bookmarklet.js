(function () {
  if (document.getElementById("gdb-bookmarklet")) {
    return;
  }

  const STORAGE_KEY = "gdb_settings";
  const DEFAULTS = {
    serverUrl: "http://127.0.0.1:17831",
    token: "",
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...DEFAULTS };
      }
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function configureSettings() {
    const current = loadSettings();
    const url = window.prompt("Gemini Dev Bridge: サーバURL", current.serverUrl);
    if (url === null) {
      return null;
    }
    const token = window.prompt("Gemini Dev Bridge: トークン", current.token);
    if (token === null) {
      return null;
    }
    const next = {
      serverUrl: url.trim() || DEFAULTS.serverUrl,
      token: token.trim(),
    };
    saveSettings(next);
    return next;
  }

  function ensureSettings() {
    const current = loadSettings();
    if (!current.token) {
      const next = configureSettings();
      if (!next) {
        throw new Error("トークンが未設定です。設定してください。");
      }
      return next;
    }
    return current;
  }

  function showToast(message) {
    let toast = document.getElementById("gdb-bookmarklet-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "gdb-bookmarklet-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    setTimeout(() => toast.remove(), 5000);
  }

  function injectStyles() {
    if (document.getElementById("gdb-bookmarklet-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "gdb-bookmarklet-style";
    style.textContent = `
      #gdb-bookmarklet {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-family: "Segoe UI", "Yu Gothic UI", sans-serif;
      }
      .gdb-bm-btn {
        background: #111827;
        color: #f9fafb;
        border: 1px solid #374151;
        border-radius: 999px;
        padding: 10px 16px;
        font-size: 12px;
        cursor: pointer;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
      }
      .gdb-bm-btn.primary {
        background: #f97316;
        border-color: #fdba74;
        color: #ffffff;
        font-weight: 700;
        box-shadow: 0 8px 18px rgba(249, 115, 22, 0.35);
      }
      .gdb-bm-inline {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: 8px 0;
        padding: 8px 12px;
        border-radius: 10px;
        border: 2px solid #f59e0b;
        background: #fff7ed;
        font-size: 12px;
        font-weight: 600;
        color: #7c2d12;
        box-shadow: 0 6px 16px rgba(245, 158, 11, 0.2);
      }
      .gdb-bm-inline button {
        border: none;
        border-radius: 999px;
        padding: 8px 14px;
        background: #f97316;
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
      }
      #gdb-bookmarklet-toast {
        position: fixed;
        right: 16px;
        bottom: 80px;
        background: rgba(17, 24, 39, 0.95);
        color: #f9fafb;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 12px;
        max-width: 320px;
        z-index: 10000;
        line-height: 1.4;
      }
    `;
    document.head.appendChild(style);
  }

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function findGeminiInput() {
    const quillEditors = Array.from(
      document.querySelectorAll(
        "rich-textarea .ql-editor[contenteditable='true'], .ql-editor[contenteditable='true']"
      )
    ).filter(isVisible);
    if (quillEditors.length > 0) {
      return quillEditors[quillEditors.length - 1];
    }
    const candidates = Array.from(
      document.querySelectorAll("textarea, div[contenteditable='true']")
    ).filter((el) => isVisible(el) && !el.classList.contains("ql-clipboard"));
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
      inputEl.focus();
      inputEl.selectionStart = inputEl.value.length;
      inputEl.selectionEnd = inputEl.value.length;
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    if (inputEl.isContentEditable) {
      inputEl.textContent = text;
      inputEl.focus();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      range.collapse(false);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }

  function looksLikeDiff(text) {
    return (
      text.includes("diff --git") ||
      (text.includes("--- ") && text.includes("+++ ")) ||
      text.startsWith("@@ ")
    );
  }

  function extractUnifiedDiff() {
    const codeBlocks = Array.from(document.querySelectorAll("pre code"));
    for (let i = codeBlocks.length - 1; i >= 0; i -= 1) {
      const text = (codeBlocks[i].textContent || "").trim();
      if (text && looksLikeDiff(text)) {
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
    const settings = ensureSettings();
    const url = new URL("/snapshot", settings.serverUrl);
    const res = await fetch(url.toString(), {
      headers: {
        "X-Local-Token": settings.token || "",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Snapshot取得に失敗しました。");
    }
    return res.json();
  }

  async function applyDiff(diffText) {
    const settings = ensureSettings();
    const url = new URL("/apply", settings.serverUrl);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Local-Token": settings.token || "",
      },
      body: JSON.stringify({ diff_text: diffText }),
    });
    const text = await res.text();
    const data = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return { message: text };
      }
    })();
    if (!res.ok) {
      throw new Error(data.message || data.detail || "diff適用に失敗しました。");
    }
    return data;
  }

  function attachApplyButtons() {
    const codeBlocks = Array.from(document.querySelectorAll("pre code"));
    codeBlocks.forEach((code) => {
      if (code.dataset.gdbApplyAttached === "1") {
        return;
      }
      const text = (code.textContent || "").trim();
      if (!text || !looksLikeDiff(text)) {
        return;
      }
      const pre = code.closest("pre");
      if (!pre) {
        return;
      }
      const container = document.createElement("div");
      container.className = "gdb-bm-inline";
      const label = document.createElement("span");
      label.textContent = "差分を検出しました";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "この差分を適用";
      button.addEventListener("click", async () => {
        showToast("diff適用中...");
        try {
          const result = await applyDiff(text);
          const files = (result.changed_files || []).join(", ");
          showToast(`適用しました。変更: ${files || "(なし)"}`);
        } catch (err) {
          showToast(err.message || "diff適用に失敗しました。");
        }
      });
      container.appendChild(label);
      container.appendChild(button);
      pre.parentElement.insertBefore(container, pre);
      code.dataset.gdbApplyAttached = "1";
    });
  }

  function observeDiffBlocks() {
    attachApplyButtons();
    const observer = new MutationObserver(() => attachApplyButtons());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function createPanel() {
    const container = document.createElement("div");
    container.id = "gdb-bookmarklet";

    const snapshotBtn = document.createElement("button");
    snapshotBtn.className = "gdb-bm-btn primary";
    snapshotBtn.textContent = "スナップショット貼り付け";
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
    applyBtn.className = "gdb-bm-btn";
    applyBtn.textContent = "差分を抽出して適用";
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

    const settingsBtn = document.createElement("button");
    settingsBtn.className = "gdb-bm-btn";
    settingsBtn.textContent = "設定";
    settingsBtn.addEventListener("click", () => {
      const next = configureSettings();
      if (next) {
        showToast("設定を保存しました。");
      }
    });

    container.appendChild(snapshotBtn);
    container.appendChild(applyBtn);
    container.appendChild(settingsBtn);
    document.body.appendChild(container);
  }

  injectStyles();
  createPanel();
  observeDiffBlocks();
})();
