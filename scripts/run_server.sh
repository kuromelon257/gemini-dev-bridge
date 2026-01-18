#!/usr/bin/env bash
set -euo pipefail

# このスクリプトの場所からリポジトリルートを推定
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

VENV_PATH="$REPO_ROOT/.venv"
PYTHON_PATH="$VENV_PATH/bin/python"

if [ ! -d "$VENV_PATH" ]; then
  echo "[INFO] venv を作成します..."
  python3 -m venv .venv
fi

echo "[INFO] 依存をインストールします..."
"$PYTHON_PATH" -m pip install --upgrade pip
"$PYTHON_PATH" -m pip install -r "server/requirements.txt"

echo "[INFO] サーバを起動します..."
echo "※ 停止する場合は Ctrl+C を押してください。"
"$PYTHON_PATH" "server/main.py"
