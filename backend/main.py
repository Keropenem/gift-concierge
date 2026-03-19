from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .gemini_client import suggest_gifts

app = FastAPI(title="Gift Concierge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)


class GiftRequest(BaseModel):
    relationship: str = ""
    age_range: str = ""
    gender: str = ""
    budget_min: int = 1000
    budget_max: int = 10000
    occasion: str = ""
    interests: list[str] = []
    free_text: str = ""


@app.post("/api/suggest")
async def api_suggest(request: GiftRequest):
    if not any([
        request.relationship,
        request.interests,
        request.free_text,
        request.occasion,
    ]):
        raise HTTPException(
            status_code=400,
            detail="少なくとも1つの情報を入力してください。",
        )

    result = await suggest_gifts(request.model_dump())
    return result


# 静的ファイル配信（フロントエンド）
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
