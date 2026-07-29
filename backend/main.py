import os
import json
import asyncio
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import websockets
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-live")

GEMINI_WS_URL = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={GEMINI_API_KEY}"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("speak-ai-tutor")

app = FastAPI(title="Speak AI Tutor - Full Feature App Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 情境角色扮演 System Prompts 定義 (Speak App 核心情境)
SCENARIO_PROMPTS = {
    "freetalk": (
        "你是一位專業、有耐心的美國籍英文家教 Alex。請與學生進行自然的日常自由對話。"
        "回覆必須簡短自然。如果學生的句子有文法或用詞錯誤，請先指出並簡單糾正，再接續對話。"
    ),
    "starbucks": (
        "你是一位在星巴克工作的美國咖啡師 (Barista)。學生是一位前來點餐的顧客。"
        "請用熱情友善的英文引導學生點餐（詢問杯型、甜度冰塊、奶類選擇及姓名）。"
        "若學生的句子有文法錯誤，請先溫和糾正，再回覆顧客。"
    ),
    "interview": (
        "你是一位美國跨國科技公司的外商主考官 (Job Interviewer)。學生是一位前來面試的求職者。"
        "請用專業專業的態度提問面試問題（自我介紹、過去專案經驗、優缺點與離職原因）。"
        "若學生有文法錯誤或不地道表達，請糾正後再繼續下一個面試問題。"
    ),
    "airport": (
        "你是一位在美國甘迺迪國際機場 (JFK Airport) 的海關與登機櫃檯人員。"
        "請用正式標準的英文詢問學生的護照、登機證、來美目的與住宿地點。"
        "若學生表達有錯誤，請予以溫和糾正並繼續核對流程。"
    ),
    "business": (
        "你是一位美國商業合作夥伴。學生正與你進行一場商業合作會議 (Business Negotiation)。"
        "請用專業職場英文進行討論與談判。若學生用詞不符合商業職場慣例，請給予修正建議。"
    )
}

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Speak App 商業級 WebSocket 介面：
    支援 Scenario 情境選擇、Voice 聲線切換、即時文法糾正與心跳保活。
    """
    await websocket.accept()
    logger.info("前端 Client 連接 WebSocket")

    voice_name = websocket.query_params.get("voice", "Puck")
    scenario_key = websocket.query_params.get("scenario", "freetalk")
    
    # 選擇對應的情境 Prompt
    system_instruction_text = SCENARIO_PROMPTS.get(scenario_key, SCENARIO_PROMPTS["freetalk"])

    if not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here":
        logger.error("未設定 GEMINI_API_KEY")
        await websocket.send_json({
            "error": "GEMINI_API_KEY 尚未設定！請先在 backend/.env 檔案中填入 GEMINI_API_KEY。"
        })
        await websocket.close()
        return

    formatted_model = MODEL_NAME if MODEL_NAME.startswith("models/") else f"models/{MODEL_NAME}"

    setup_message = {
        "setup": {
            "model": formatted_model,
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {
                            "voiceName": voice_name
                        }
                    }
                }
            },
            "systemInstruction": {
                "parts": [
                    {
                        "text": system_instruction_text
                    }
                ]
            }
        }
    }

    try:
        async with websockets.connect(
            GEMINI_WS_URL,
            ping_interval=20,
            ping_timeout=10,
            close_timeout=5
        ) as gemini_ws:
            logger.info(f"連線 Gemini Live API (Model: {formatted_model}, Voice: {voice_name}, Scenario: {scenario_key})")
            
            await gemini_ws.send(json.dumps(setup_message))

            async def client_to_gemini():
                try:
                    while True:
                        data = await websocket.receive_text()
                        await gemini_ws.send(data)
                except WebSocketDisconnect:
                    logger.info("前端 Client 正常斷開連線")
                except Exception as e:
                    logger.warning(f"Client to Gemini 例外: {e}")

            async def gemini_to_client():
                try:
                    async for message in gemini_ws:
                        try:
                            msg_json = json.loads(message)
                            if "error" in msg_json:
                                logger.error(f"Gemini API 錯誤: {msg_json['error']}")
                        except Exception:
                            pass

                        await websocket.send_text(message)
                except Exception as e:
                    logger.warning(f"Gemini to Client 例外: {e}")

            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(client_to_gemini()),
                    asyncio.create_task(gemini_to_client()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in pending:
                task.cancel()

    except Exception as e:
        logger.error(f"Gemini Live WebSocket 連線失敗: {e}")
        await websocket.send_json({"error": f"連線失敗: {str(e)}"})
        await websocket.close()

if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
