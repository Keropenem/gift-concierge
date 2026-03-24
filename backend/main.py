import asyncio
import json
import logging
import time
import uuid

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from .gemini_client import chat, set_debug_mode, subscribe_debug, unsubscribe_debug
from . import gemini_client as _gc
from .prompts import GREETING

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("gift-concierge")

app = FastAPI(title="Gift Concierge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# セッション管理（インメモリ）
# {session_id: {"history": [...], "last_access": timestamp}}
sessions: dict[str, dict] = {}
SESSION_TTL = 3600  # 1時間


def cleanup_sessions():
    """期限切れセッションを削除"""
    now = time.time()
    expired = [sid for sid, s in sessions.items() if now - s["last_access"] > SESSION_TTL]
    for sid in expired:
        del sessions[sid]


def get_or_create_session(session_id: str) -> dict:
    """セッションを取得または新規作成"""
    cleanup_sessions()
    if session_id not in sessions:
        sessions[session_id] = {
            "history": [
                {"role": "model", "parts": [GREETING]},
            ],
            "last_access": time.time(),
        }
    sessions[session_id]["last_access"] = time.time()
    return sessions[session_id]


class ChatRequest(BaseModel):
    message: str


@app.post("/api/chat")
async def api_chat(request: ChatRequest, raw_request: Request):
    session_id = raw_request.headers.get("x-session-id", str(uuid.uuid4()))
    session = get_or_create_session(session_id)

    logger.info(f"[{session_id[:8]}] User: {request.message[:100]}")

    try:
        result = await chat(session["history"], request.message, session_id=session_id)

        # 会話履歴に追加
        session["history"].append({"role": "user", "parts": [request.message]})
        session["history"].append({"role": "model", "parts": [result["raw_reply"]]})

        logger.info(f"[{session_id[:8]}] AI reply (first 100): {result['reply'][:100]}")
        if result["items"]:
            logger.info(f"[{session_id[:8]}] Items count: {len(result['items'])}")

        resp = {
            "reply": result["reply"],
            "items": result["items"],
            "session_id": session_id,
        }
        if "_debug" in result:
            resp["_debug"] = result["_debug"]
        return resp

    except Exception as e:
        logger.error(f"[{session_id[:8]}] Error: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Gemini APIエラー: {type(e).__name__}: {str(e)[:200]}",
        )


@app.post("/api/reset")
async def api_reset(raw_request: Request):
    session_id = raw_request.headers.get("x-session-id", "")
    if session_id in sessions:
        del sessions[session_id]
    return {"status": "ok"}


# ── デバッグモード ──

@app.get("/api/debug")
async def api_debug_status():
    """デバッグモードの現在の状態を返す"""
    return {"debug": _gc.DEBUG_MODE}


@app.post("/api/debug")
async def api_debug_toggle():
    """デバッグモードを切り替える"""
    set_debug_mode(not _gc.DEBUG_MODE)
    logger.info(f"Debug mode: {'ON' if _gc.DEBUG_MODE else 'OFF'}")
    return {"debug": _gc.DEBUG_MODE}


@app.get("/api/debug/stream")
async def api_debug_stream(raw_request: Request):
    """SSEでリアルタイムデバッグイベントをストリーミング"""
    session_id = raw_request.query_params.get("session_id", "")
    if not session_id:
        return {"error": "session_id required"}

    q = subscribe_debug(session_id)

    async def event_generator():
        try:
            while True:
                # クライアント切断チェック
                if await raw_request.is_disconnected():
                    break
                try:
                    entry = await asyncio.wait_for(q.get(), timeout=30)
                    yield {
                        "event": "debug",
                        "data": json.dumps(entry, ensure_ascii=False, default=str),
                    }
                except asyncio.TimeoutError:
                    # keepalive
                    yield {"event": "ping", "data": ""}
        finally:
            unsubscribe_debug(session_id)

    return EventSourceResponse(event_generator())


FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@app.get("/chat")
async def page_chat():
    return FileResponse(FRONTEND / "chat.html")


@app.get("/form")
async def page_form():
    return FileResponse(FRONTEND / "form.html")


# 静的ファイル配信（フロントエンド） ← 必ず最後に定義
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
