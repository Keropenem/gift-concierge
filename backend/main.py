import logging
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .gemini_client import chat
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
        result = await chat(session["history"], request.message)

        # 会話履歴に追加
        session["history"].append({"role": "user", "parts": [request.message]})
        session["history"].append({"role": "model", "parts": [result["raw_reply"]]})

        logger.info(f"[{session_id[:8]}] AI reply (first 100): {result['reply'][:100]}")
        if result["items"]:
            logger.info(f"[{session_id[:8]}] Items count: {len(result['items'])}")

        return {
            "reply": result["reply"],
            "items": result["items"],
            "session_id": session_id,
        }

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


# 静的ファイル配信（フロントエンド） ← 必ず最後に定義
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
