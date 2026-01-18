from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

# サーバ起動時のCWDをプロジェクトルートとして扱う（外部パスを許可しない）
ROOT_DIR = Path.cwd().resolve()

DEFAULT_PORT = 17831
PORT_SEARCH_RANGE = 50

MAX_FILE_BYTES = 200 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024

# 除外対象（安全上・ノイズ低減のため）
EXCLUDE_DIRS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "dist",
    "build",
    "__pycache__",
}

EXCLUDE_FILE_NAMES = {
    ".env",
    "id_rsa",
    "id_rsa.pub",
}

EXCLUDE_SUFFIXES = {
    ".pyc",
    ".log",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".pdf",
    ".zip",
    ".exe",
    ".dll",
    ".pdb",
    ".pem",
    ".pfx",
}

LANG_BY_SUFFIX = {
    ".py": "python",
    ".js": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".jsx": "jsx",
    ".json": "json",
    ".md": "markdown",
    ".html": "html",
    ".css": "css",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".sh": "bash",
    ".ps1": "powershell",
    ".bat": "bat",
    ".txt": "text",
    ".toml": "toml",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
}

TOKEN = secrets.token_urlsafe(32)

app = FastAPI()

# 127.0.0.1 専用 + トークン認証。拡張機能以外からの誤操作を防ぐ。
@app.middleware("http")
async def local_token_guard(request: Request, call_next):
    # ローカル以外の通信は明確に拒否する
    client_host = request.client.host if request.client else ""
    if client_host not in {"127.0.0.1", "::1"}:
        return JSONResponse(
            status_code=403,
            content={"ok": False, "message": "ローカルホスト以外からのアクセスは拒否されました。"},
        )

    # トークンが一致しない場合は処理しない（無差別なアクセスを防ぐ）
    token = request.headers.get("X-Local-Token", "")
    if token != TOKEN:
        return JSONResponse(
            status_code=401,
            content={"ok": False, "message": "トークンが正しくありません。"},
        )

    return await call_next(request)


# 拡張機能からのアクセスを想定（トークン必須のため、CORSは緩めに許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ApplyRequest(BaseModel):
    diff_text: str


@dataclass
class SnapshotResult:
    text: str
    meta: Dict[str, Any]


def _is_relative_safe_path(path_str: str) -> bool:
    # Windowsのドライブレターや絶対パスを拒否（スコープ外へのアクセス防止）
    if not path_str:
        return False
    if path_str.startswith("/"):
        return False
    parts = PurePosixPath(path_str).parts
    if any(part == ".." for part in parts):
        return False
    if parts and ":" in parts[0]:
        return False
    return True


def _is_excluded_file(path: Path) -> bool:
    if path.name in EXCLUDE_FILE_NAMES:
        return True
    if path.suffix.lower() in EXCLUDE_SUFFIXES:
        return True
    return False


def _detect_language(path: Path) -> str:
    return LANG_BY_SUFFIX.get(path.suffix.lower(), "")


def _snapshot_text(scope_path: Path) -> SnapshotResult:
    total_bytes = 0
    file_count = 0
    skipped_files: List[str] = []
    unreadable_files: List[str] = []
    truncated_files: List[str] = []
    truncated_total = False

    header_lines = [
        "### Gemini Snapshot",
        f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"Root: {ROOT_DIR}",
        f"Scope: {scope_path}",
        "Note: ローカル限定で利用し、機密ファイルは除外しています。",
        "----",
    ]

    chunks: List[str] = ["\n".join(header_lines)]

    for dirpath, dirnames, filenames in os.walk(scope_path):
        current_dir = Path(dirpath)
        # シンボリックリンクを辿ると想定外に広がるため除外
        if current_dir.is_symlink():
            dirnames[:] = []
            continue

        dirnames[:] = [
            d
            for d in dirnames
            if d not in EXCLUDE_DIRS and not (current_dir / d).is_symlink()
        ]

        for filename in filenames:
            file_path = current_dir / filename
            # ファイルのシンボリックリンクも除外（安全側に倒す）
            if file_path.is_symlink():
                skipped_files.append(str(file_path))
                continue
            if _is_excluded_file(file_path):
                skipped_files.append(str(file_path))
                continue

            try:
                size = file_path.stat().st_size
            except OSError:
                skipped_files.append(str(file_path))
                continue

            # 合計上限に達していたら早めに打ち切り（トークン節約）
            if total_bytes >= MAX_TOTAL_BYTES:
                truncated_total = True
                break

            try:
                with file_path.open("r", encoding="utf-8") as f:
                    content = f.read(MAX_FILE_BYTES + 1)
            except UnicodeDecodeError:
                # 文字化け・バイナリ判定はスキップして一覧に記録
                unreadable_files.append(str(file_path))
                continue
            except OSError:
                skipped_files.append(str(file_path))
                continue

            # 大きすぎるファイルは一部のみ切り出す（安全性と応答速度のため）
            if len(content.encode("utf-8")) > MAX_FILE_BYTES:
                content = content[:MAX_FILE_BYTES]
                truncated_files.append(str(file_path))

            content_bytes = len(content.encode("utf-8"))
            # 合計サイズ上限を超える場合はこれ以上追加しない
            if total_bytes + content_bytes > MAX_TOTAL_BYTES:
                truncated_total = True
                break

            total_bytes += content_bytes
            file_count += 1

            lang = _detect_language(file_path)
            chunks.append(
                "\n".join(
                    [
                        f"FILE: {file_path.resolve()}",
                        f"```{lang}" if lang else "```",
                        content,
                        "```",
                    ]
                )
            )

        if truncated_total:
            break

    if truncated_total:
        chunks.append("[INFO] 合計サイズ上限に達したため、以降のファイルは省略しました。")

    meta = {
        "root": str(ROOT_DIR),
        "scope": str(scope_path),
        "file_count": file_count,
        "total_bytes": total_bytes,
        "skipped_files": skipped_files,
        "unreadable_files": unreadable_files,
        "truncated_files": truncated_files,
        "truncated_total": truncated_total,
    }
    return SnapshotResult(text="\n\n".join(chunks), meta=meta)


def _extract_diff_paths(diff_text: str) -> Set[str]:
    paths: Set[str] = set()
    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            parts = line.split()
            # a/ b/ 形式を想定して抽出
            if len(parts) >= 4:
                a_path = parts[2].removeprefix("a/")
                b_path = parts[3].removeprefix("b/")
                paths.add(a_path)
                paths.add(b_path)
        elif line.startswith("--- ") or line.startswith("+++ "):
            raw = line.split(maxsplit=1)[1] if " " in line else ""
            raw = raw.removeprefix("a/").removeprefix("b/")
            paths.add(raw)
    return {p for p in paths if p}


def _validate_diff_paths(paths: Iterable[str]) -> None:
    for path_str in paths:
        if path_str == "/dev/null":
            continue
        if not _is_relative_safe_path(path_str):
            raise HTTPException(status_code=400, detail="diff内のパスが不正です。")
        posix = PurePosixPath(path_str)
        # diffの対象がプロジェクトルート外に出ないことを保証
        resolved = (ROOT_DIR / Path(*posix.parts)).resolve()
        if not resolved.is_relative_to(ROOT_DIR):
            raise HTTPException(
                status_code=400,
                detail="diffの対象がプロジェクトルート外に含まれています。",
            )


def _run_git(args: List[str], input_text: Optional[str] = None) -> Tuple[int, str, str]:
    try:
        proc = subprocess.run(
            ["git"] + args,
            input=input_text,
            text=True,
            capture_output=True,
            cwd=ROOT_DIR,
        )
    except FileNotFoundError:
        return 1, "", "gitが見つかりません。Git for Windowsをインストールしてください。"
    return proc.returncode, proc.stdout, proc.stderr


@app.get("/snapshot")
def snapshot():
    # 起動時のCWD配下のみを対象にする
    result = _snapshot_text(ROOT_DIR)
    return JSONResponse(content={"text": result.text, "meta": result.meta})


@app.post("/apply")
def apply_diff(request: ApplyRequest):
    if not request.diff_text.strip():
        raise HTTPException(status_code=400, detail="diff_textが空です。")

    diff_paths = _extract_diff_paths(request.diff_text)
    if not diff_paths:
        raise HTTPException(status_code=400, detail="diff内のパスが検出できませんでした。")

    _validate_diff_paths(diff_paths)

    before_code, diff_before, diff_before_err = _run_git(["diff"])
    if before_code != 0:
        raise HTTPException(
            status_code=500,
            detail=f"git diffの取得に失敗しました: {diff_before_err.strip()}",
        )

    check_code, check_out, check_err = _run_git(["apply", "--check", "-"], request.diff_text)
    if check_code != 0:
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "message": f"git apply --check に失敗しました: {check_err.strip() or check_out.strip()}",
                "changed_files": [],
                "diff_before": diff_before,
                "diff_after": diff_before,
            },
        )

    apply_code, apply_out, apply_err = _run_git(["apply", "-"], request.diff_text)
    if apply_code != 0:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "message": f"git apply に失敗しました: {apply_err.strip() or apply_out.strip()}",
                "changed_files": [],
                "diff_before": diff_before,
                "diff_after": diff_before,
            },
        )

    after_code, diff_after, diff_after_err = _run_git(["diff"])
    if after_code != 0:
        raise HTTPException(
            status_code=500,
            detail=f"git diffの取得に失敗しました: {diff_after_err.strip()}",
        )

    name_code, name_out, name_err = _run_git(["diff", "--name-only"])
    if name_code != 0:
        raise HTTPException(
            status_code=500,
            detail=f"git diff --name-only の取得に失敗しました: {name_err.strip()}",
        )

    changed_files = [line for line in name_out.splitlines() if line.strip()]

    return JSONResponse(
        content={
            "ok": True,
            "message": "diffを適用しました。",
            "changed_files": changed_files,
            "diff_before": diff_before,
            "diff_after": diff_after,
        }
    )


def _find_free_port(start_port: int, max_tries: int) -> int:
    for i in range(max_tries + 1):
        port = start_port + i
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("利用可能なポートが見つかりませんでした。")


def _load_fixed_port() -> Optional[int]:
    raw = os.getenv("GEMINI_BRIDGE_PORT")
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def main() -> None:
    fixed_port = _load_fixed_port()
    if fixed_port is not None:
        port = fixed_port
    else:
        port = _find_free_port(DEFAULT_PORT, PORT_SEARCH_RANGE)

    print("=" * 60)
    print("Gemini Dev Bridge (local server)")
    print(f"Root: {ROOT_DIR}")
    print(f"Port: {port}")
    print(f"Token: {TOKEN}")
    print("URL: http://127.0.0.1:" + str(port))
    print("※ トークンは拡張機能のオプション画面に貼り付けてください。")
    print("=" * 60)
    sys.stdout.flush()

    # 直接appオブジェクトを渡すことで、import経由の失敗を避ける
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
