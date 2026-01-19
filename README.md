# Gemini Dev Bridge

Gemini Web版（https://gemini.google.com/）での開発支援を、**ローカルのみ**で安全に行うための最小ツールです。Chrome拡張のボタン操作だけで、
- ローカルのソースコードを「フルパス付きテキスト」に変換してGeminiへ貼り付ける
- Geminiの返信に含まれる unified diff を `git apply` でローカルに適用する
を実現します。

## これは何か（目的）
- **外部アップロードなし**で、Gemini Web版にローカルのスナップショットを渡す
- **unified diffのみ**を安全に適用し、任意コード実行をしない
- Dockerで1コマンド起動が可能

## セキュリティ設計
- サーバは **ホスト側では127.0.0.1に限定**して公開（外部公開しない）
- Dockerコンテナ内は `0.0.0.0` で待ち受け、ホスト側からのみアクセス可能
- **トークン必須**（拡張機能からのみ操作できるようにする）
- **起動時カレントディレクトリ配下のみ**を対象に走査・diff適用
- `.env` や鍵ファイル等は除外（機密保護のため）
- `git apply --check` を通過したdiffのみ適用

## 必要要件
- Docker Desktop
- Git（ホストにあるだけでOK。コンテナ内には同梱済み）
- Google Chrome

## リポジトリ構成
```
/extension  : Chrome拡張機能
/server     : Python FastAPI ローカルサーバ
/scripts    : 起動補助（PowerShell / bat）
Dockerfile
docker-compose.yml
.env.example
README.md
LICENSE
```

## インストール手順（Docker前提）
1) リポジトリを clone
2) `.env` を用意（パスだけ指定）

```bash
cp .env.example .env
```

`.env` を開いて `TARGET_PROJECT` に対象プロジェクトの絶対パスを設定してください。  
Docker Desktop の「File Sharing」にそのパスが含まれていないと起動できません。

3) Dockerイメージをビルド

```bash
docker build -t gemini-dev-bridge .
```

4) サーバ起動（対象プロジェクトを自動でマウント）

```bash
docker compose up --build
```

起動ログに `Token:` が出るので控えておきます。URLは `http://127.0.0.1:17831` です。

5) Chrome拡張を読み込む
- Chrome → 拡張機能 → デベロッパーモード ON
- 「パッケージ化されていない拡張機能を読み込む」
- `extension` フォルダを指定

6) 拡張オプションで設定
- `ローカルサーバURL` と `トークン` を入力

## 使い方
### 1. Snapshot → Paste
- Gemini画面右下の **Snapshot → Paste** を押す
- スナップショットと **diff生成テンプレ** がGemini入力欄に貼り付けられます

### 2. Geminiへ diff 生成を依頼
下記テンプレをコピペして指示してください。

**diff生成ルール（テンプレ）**
- 変更は **起動時カレントディレクトリ配下のみ**
- unified diff 形式
- ファイルパスは相対（例: `app/main.py`）
- `diff --git a/<相対パス> b/<相対パス>` を必ず含める
- 各ファイルの先頭に必ず `diff --git ...` 行を付ける（無いdiffは不可）
- diffは必ずコードブロックで囲む（```diff 〜 ```）
- コードブロック内で ``` を書く必要がある場合は ```` を使う
- diff以外の説明は書いてよい（diffはコードブロック内に限定）
- hunk内の全行は必ず `+` / `-` / 半角スペース / `\` で始める（空行でも半角スペースを付ける）
- 空行は削除しない（空行もdiffの一部として保持する）
- 行末の空白は入れない（trailing whitespaceを禁止）
- diffコードブロック以外に `diff --git` を含む文字列を出力しない
- diffコードブロック以外に `---` / `+++` / `@@` を出力しない
- 改行は保持（LF/CRLF変更は最小限）
- 可能な限り小さな差分で

**コピペ用プロンプト**
```
以下のルールで unified diff を出力してください。
- 変更は起動時カレントディレクトリ配下のみ
- 形式は unified diff
- `diff --git a/<相対パス> b/<相対パス>` を必ず含める
- 各ファイルの先頭に必ず `diff --git ...` 行を付ける（無いdiffは不可）
- diffは必ずコードブロックで囲む（```diff 〜 ```）
- コードブロック内で ``` を書く必要がある場合は ```` を使う
- diff以外の説明は書いてよい（diffはコードブロック内に限定）
- hunk内の全行は必ず `+` / `-` / 半角スペース / `\` で始める（空行でも半角スペースを付ける）
- 空行は削除しない（空行もdiffの一部として保持する）
- 行末の空白は入れない（trailing whitespaceを禁止）
- diffコードブロック以外に `diff --git` を含む文字列を出力しない
- diffコードブロック以外に `---` / `+++` / `@@` を出力しない
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
docker compose up --build
```

```bash
export GEMINI_BRIDGE_PORT=17831
docker compose up --build
```

### Dockerの共有パスエラー
- `mounts denied` が出る場合、Docker Desktop の「File Sharing」で対象パスを許可してください
- `.env` の `TARGET_PROJECT` が実在するかも確認してください

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

## 便利な起動方法（docker run）
`docker compose` を使わずに起動したい場合は以下を使います。
この場合のみ `/workspace` のパスが登場しますが、**コンテナ内の作業ディレクトリ名**なのでホスト側に存在する必要はありません。

### macOS / Linux
```bash
docker run --rm \
  -e GEMINI_BRIDGE_HOST=0.0.0.0 \
  -e GEMINI_BRIDGE_PORT=17831 \
  -p 127.0.0.1:17831:17831 \
  -v /path/to/your-project:/workspace \
  -w /workspace \
  gemini-dev-bridge
```

### Windows (PowerShell)
```powershell
docker run --rm `
  -e GEMINI_BRIDGE_HOST=0.0.0.0 `
  -e GEMINI_BRIDGE_PORT=17831 `
  -p 127.0.0.1:17831:17831 `
  -v C:\path\to\your-project:/workspace `
  -w /workspace `
  gemini-dev-bridge
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
