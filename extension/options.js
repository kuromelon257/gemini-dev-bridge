const DEFAULTS = {
  serverUrl: "http://127.0.0.1:17831",
  token: "",
};

function loadOptions() {
  // 初期値を表示して入力ミスを減らす
  chrome.storage.sync.get(DEFAULTS, (items) => {
    document.getElementById("serverUrl").value = items.serverUrl || "";
    document.getElementById("token").value = items.token || "";
  });
}

function saveOptions() {
  // 変更内容を保存（拡張機能全体で共有）
  const serverUrl = document.getElementById("serverUrl").value.trim();
  const token = document.getElementById("token").value.trim();

  chrome.storage.sync.set({ serverUrl, token }, () => {
    const status = document.getElementById("status");
    status.textContent = "保存しました。";
    setTimeout(() => (status.textContent = ""), 2000);
  });
}

document.getElementById("save").addEventListener("click", saveOptions);

document.addEventListener("DOMContentLoaded", loadOptions);
