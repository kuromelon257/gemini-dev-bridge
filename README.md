# Gemini Dev Bridge

Gemini Web版（https://gemini.google.com/）での開発支援を、**ローカルのみ**で安全に行うための最小ツールです。Chrome拡張のボタン操作だけで、
- ローカルのソースコードを「フルパス付きテキスト」に変換してGeminiへ貼り付ける
- Geminiの返信に含まれる unified diff を `git apply` でローカルに適用する
を実現します。

## これは何か（目的）
- **外部アップロードなし**で、Gemini Web版にローカルのスナップショットを渡す
- **unified diffのみ**を安全に適用し、任意コード実行をしない
- Windows上で、`PowerShell` 1コマンド起動が可能

## セキュリティ設計
- サーバは **127.0.0.1 にのみバインド**（外部公開しない）
- **トークン必須**（拡張機能からのみ操作できるようにする）
- **起動時カレントディレクトリ配下のみ**を対象に走査・diff適用
- `.env` や鍵ファイル等は除外（機密保護のため）
- `git apply --check` を通過したdiffのみ適用

## 必要要件
### Windows
- Git for Windows
- Python 3.11+ 推奨
- Google Chrome

### macOS
- Git
- Python 3.11+ 推奨（`python3` が使える状態）
- Google Chrome

## リポジトリ構成
```
/extension  : Chrome拡張機能
/server     : Python FastAPI ローカルサーバ
/scripts    : 起動補助（PowerShell / bat）
README.md
LICENSE
```

## インストール手順
1) リポジトリを clone
2) サーバ起動

### Windows

```powershell
# 対象プロジェクトのルートで実行します
cd C:\\path\\to\\your-project
\\path\\to\\gemini-dev-bridge\\scripts\\run_server.ps1
```

### macOS

```bash
# 対象プロジェクトのルートで実行します
cd /path/to/your-project
/path/to/gemini-dev-bridge/scripts/run_server.sh
```

3) Chrome拡張を読み込む
- Chrome → 拡張機能 → デベロッパーモード ON
- 「パッケージ化されていない拡張機能を読み込む」
- `extension` フォルダを指定

4) 拡張オプションで設定
- `ローカルサーバURL` と `トークン` を入力

## 使い方
### 1. Snapshot → Paste
- Gemini画面右下の **Snapshot → Paste** を押す
- スナップショットがGemini入力欄に貼り付けられます

### 2. Geminiへ diff 生成を依頼
下記テンプレをコピペして指示してください。

**diff生成ルール（テンプレ）**
- 変更は **起動時カレントディレクトリ配下のみ**
- unified diff 形式
- ファイルパスは相対（例: `app/main.py`）
- `diff --git a/<相対パス> b/<相対パス>` を必ず含める
- 改行は保持（LF/CRLF変更は最小限）
- 可能な限り小さな差分で

**コピペ用プロンプト**
```
以下のルールで unified diff を出力してください。
- 変更は起動時カレントディレクトリ配下のみ
- 形式は unified diff
- `diff --git a/<相対パス> b/<相対パス>` を必ず含める
- 余計な説明文は不要、diffだけを出力
```

### 3. Extract Diff → Apply
- Geminiの返信で **diffコードブロック** が出力されている状態で
- **Extract Diff → Apply** を押す
- 成功時は変更ファイル一覧がトースト表示されます

## トラブルシュート
### ポートが埋まっている
- 起動時に自動で空きポートを探します
- 固定したい場合は、環境変数 `GEMINI_BRIDGE_PORT` を指定してください

```powershell
$env:GEMINI_BRIDGE_PORT = 17831
cd C:\\path\\to\\your-project
\\path\\to\\gemini-dev-bridge\\scripts\\run_server.ps1
```

```bash
export GEMINI_BRIDGE_PORT=17831
cd /path/to/your-project
/path/to/gemini-dev-bridge/scripts/run_server.sh
```

### トークンエラー
- サーバ起動ログの `Token:` を拡張機能のオプションに入力してください
- トークンが空だと必ず拒否されます

### Geminiの入力欄が見つからない
- Gemini側のUI変更が原因です
- いったんページをリロードしてください
- それでもダメなら `content.js` のDOM探索ロジックを更新してください

### git apply が失敗する
- diffが **unified diff形式** か確認
- `diff --git a/<相対パス> b/<相対パス>` を含んでいるか確認
- 変更対象ファイルが古いとコンテキスト不一致になります
- 改行コードのズレ（CRLF/LF）に注意してください

## 便利な起動方法（パスを通す）
毎回フルパスで呼び出すのが面倒な場合は、`scripts` を PATH に追加してください。

### Windows（PowerShell）
1) 環境変数PATHに `C:\\path\\to\\gemini-dev-bridge\\scripts` を追加
2) 対象プロジェクトのルートで次を実行

```powershell
run_server.ps1
```

### macOS
1) `~/.zshrc` などに追加

```bash
export PATH=\"/path/to/gemini-dev-bridge/scripts:$PATH\"
```

2) 対象プロジェクトのルートで次を実行

```bash
run_server.sh
```

## 開発者向け
### 主要ファイル
- `server/main.py` : FastAPIサーバ（snapshot / apply）
- `extension/content.js` : フローティングボタンとDOM操作
- `extension/options.html` : 設定画面

### DOM探索の考え方
- Geminiの入力欄は **textarea / contenteditable** を探索
- 「最新の可視要素」を選ぶことでUI変更の影響を減らしています

## ライセンス
MIT License
