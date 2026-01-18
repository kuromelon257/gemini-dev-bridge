$ErrorActionPreference = "Stop"

# このスクリプトの場所からリポジトリルートを推定
$RepoRoot = Split-Path -Parent $PSScriptRoot

$VenvPath = Join-Path $RepoRoot ".venv"
$PythonPath = Join-Path $VenvPath "Scripts\python.exe"

if (-not (Test-Path $VenvPath)) {
  Write-Host "[INFO] venv を作成します..."
  python -m venv .venv
}

Write-Host "[INFO] 依存をインストールします..."
& $PythonPath -m pip install --upgrade pip
& $PythonPath -m pip install -r (Join-Path $RepoRoot "server/requirements.txt")

Write-Host "[INFO] サーバを起動します..."
Write-Host "※ 停止する場合は Ctrl+C を押してください。"
& $PythonPath (Join-Path $RepoRoot "server/main.py")
