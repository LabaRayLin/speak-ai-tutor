/**
 * Speak AI Tutor - Full Feature Speak App Replica Logic
 * 
 * 功能包含：
 * 1. 【直連 Gemini API Key】支援在網頁設定中輸入 Gemini API Key，在 GitHub Pages / 無伺服器環境下直接與 Google Gemini Live API 進行 WebSocket 雙向對話。
 * 2. 【🧪 一鍵測試 API Key 連線】新增「🧪 測試 Key」按鈕，發送實時 Request 驗證金鑰有效性並給予回饋。
 * 3. 【防範未設定 Key 斷線】點擊開始對話時若未設定 API Key，自動開啟 ⚙️ 設定視窗並聚焦 API Key 輸入框，避免 Mixed Content 斷線。
 * 4. 【跨平台 Emoji 相容修復】採用全平台字型無障礙相容圖示。
 * 5. 【情境角色扮演】自由對話、星巴克點餐、外商面試、機場過關、商業談判。
 * 6. 【語速調整】0.8x, 1.0x, 1.2x Web Audio Playback Rate。
 * 7. 【即時文法修復卡片】分析建議並標示原句 (劃線紅字) 與建議句 (綠字)。
 * 8. 【單字片語收藏庫】LocalStorage 持久化與管理。
 * 9. 【學習成績單】顯示說話時長、對話輪次與修正數。
 * 10.【商業級效能】8KB Chunked Base64 與連續 3 幀防抖打斷機制 (Debounced Barge-in)。
 */

// Register PWA Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then((reg) => console.log('[PWA] Service Worker registered successfully with scope:', reg.scope))
            .catch((err) => console.warn('[PWA] Service Worker registration failed:', err));
    });
}

// DOM Elements
const toggleBtn = document.getElementById('toggleBtn');
const btnText = document.getElementById('btnText');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const pulseRing = document.getElementById('pulseRing');
const tutorStatus = document.getElementById('tutorStatus');
const tutorName = document.getElementById('tutorName');
const avatarEmoji = document.getElementById('avatarEmoji');
const logContent = document.getElementById('logContent');
const clearLogBtn = document.getElementById('clearLogBtn');
const waveVisualizer = document.querySelector('.wave-visualizer');
const voiceSelect = document.getElementById('voiceSelect');
const captionText = document.getElementById('captionText');

// Speak App Specific DOM Elements
const scenarioChips = document.querySelectorAll('.chip');
const speedBtns = document.querySelectorAll('.speed-btn');
const correctionCard = document.getElementById('correctionCard');
const originalTextEl = document.getElementById('originalText');
const correctedTextEl = document.getElementById('correctedText');
const saveCorrectionBtn = document.getElementById('saveCorrectionBtn');

// Modals
const vocabModal = document.getElementById('vocabModal');
const openVocabBtn = document.getElementById('openVocabBtn');
const closeVocabModalBtn = document.getElementById('closeVocabModalBtn');
const vocabList = document.getElementById('vocabList');
const vocabCount = document.getElementById('vocabCount');

const summaryModal = document.getElementById('summaryModal');
const closeSummaryModalBtn = document.getElementById('closeSummaryModalBtn');
const statDuration = document.getElementById('statDuration');
const statTurns = document.getElementById('statTurns');
const statCorrections = document.getElementById('statCorrections');

// Backend & API Key Settings Modal
const backendSettingsModal = document.getElementById('backendSettingsModal');
const openBackendSettingsBtn = document.getElementById('openBackendSettingsBtn');
const closeBackendSettingsModalBtn = document.getElementById('closeBackendSettingsModalBtn');
const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
const customWsUrlInput = document.getElementById('customWsUrlInput');
const saveBackendWsBtn = document.getElementById('saveBackendWsBtn');
const resetBackendWsBtn = document.getElementById('resetBackendWsBtn');

// API Test Elements
const testApiKeyBtn = document.getElementById('testApiKeyBtn');
const testApiResult = document.getElementById('testApiResult');

// State Variables
let isConnected = false;
let ws = null;
let inputAudioContext = null;
let outputAudioContext = null;
let mediaStream = null;
let scriptProcessor = null;
let silentGainNode = null;

// Target Audio Settings
const TARGET_INPUT_SAMPLE_RATE = 16000;
const DEFAULT_OUTPUT_SAMPLE_RATE = 24000;

// Dynamic Settings
let currentScenario = 'freetalk';
let currentSpeechSpeed = 1.0;
let noiseFloor = 0.01;
let consecutiveLoudFrames = 0;
let currentTextBuffer = "";

// Session Statistics
let sessionStartTime = 0;
let turnsCount = 0;
let correctionsCount = 0;

// Playback State
let nextStartTime = 0;
let activeSourceNodes = [];
let isAiSpeaking = false;
let isFirstChunkOfTurn = true;

// Scenario Metadata & Prompts
const SCENARIO_META = {
    freetalk: { name: 'Alex (American Tutor)', emoji: '🗣️', desc: '自由談論任何感興趣的話題...' },
    starbucks: { name: 'Jessica (Barista)', emoji: '☕', desc: '星巴克點餐：嘗試點一杯冰拿鐵！' },
    interview: { name: 'David (Interviewer)', emoji: '💼', desc: '外商面試：回答工作經驗與優缺點...' },
    airport: { name: 'Officer Smith', emoji: '✈️', desc: '入境檢查：回答訪美目的與停留天數...' },
    business: { name: 'Michael (Partner)', emoji: '🤝', desc: '商業會議：談判合作細節與報價...' }
};

const SCENARIO_PROMPTS = {
    freetalk: "你是一位專業、有耐心的美國籍英文家教 Alex。請與學生進行自然的日常自由對話。回覆必須簡短自然。如果學生的句子有文法或用詞錯誤，請先指出並簡單糾正，再接續對話。",
    starbucks: "你是一位在星巴克工作的美國咖啡師 (Barista)。學生是一位前來點餐的顧客。請用熱情友善的英文引導學生點餐。若學生的句子有文法錯誤，請先溫和糾正，再回覆顧客。",
    interview: "你是一位美國跨國科技公司的外商主考官 (Job Interviewer)。學生是一位前來面試的求職者。請用專業態度提問面試問題。若學生有文法錯誤，請糾正後再繼續。",
    airport: "你是一位在美國甘迺迪國際機場 (JFK Airport) 的海關人員。請用正式標準英文詢問學生的護照與訪美目的。若學生有錯誤，請予以溫和糾正。",
    business: "你是一位美國商業合作夥伴。學生正與你進行商業會議 (Business Negotiation)。請用專業職場英文進行討論。若用詞不合商業慣例，請給予修正建議。"
};

// ----------------- API Key 測試按鈕功能 -----------------

if (testApiKeyBtn) {
    testApiKeyBtn.addEventListener('click', async () => {
        const key = geminiApiKeyInput.value.trim();
        if (!key) {
            testApiResult.style.color = '#f87171';
            testApiResult.textContent = '❌ 請先輸入 API Key 再進行測試！';
            return;
        }

        testApiResult.style.color = '#f59e0b';
        testApiResult.textContent = '⏳ 正在測試與 Google Gemini 伺服器連線...';

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
            const data = await response.json();

            if (response.ok && data.models) {
                testApiResult.style.color = '#34d399';
                testApiResult.textContent = '✅ 連線成功！Gemini API Key 有效，可正常進行 AI 語音對話！';
                addLog('API Key 測試成功：金鑰有效', 'success');
            } else {
                testApiResult.style.color = '#f87171';
                const errMsg = data.error?.message || 'Key 無效或尚未啟用 API 權限';
                testApiResult.textContent = `❌ 測試失敗：${errMsg}`;
                addLog(`API Key 測試失敗: ${errMsg}`, 'error');
            }
        } catch (err) {
            testApiResult.style.color = '#f87171';
            testApiResult.textContent = `❌ 網路連線錯誤：${err.message}`;
            addLog(`API Key 測試網路錯誤: ${err.message}`, 'error');
        }
    });
}

// ----------------- WebSocket URL & API Key Resolution -----------------

function getWebSocketUrl() {
    const apiKey = localStorage.getItem('speak_gemini_api_key');
    if (apiKey && apiKey.trim() !== '') {
        return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey.trim())}`;
    }

    const savedWs = localStorage.getItem('speak_custom_backend_ws');
    if (savedWs && savedWs.trim() !== '') {
        return savedWs.trim();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    
    if (host.endsWith('github.io')) {
        return `ws://localhost:8000/ws`;
    }

    const port = window.location.port ? window.location.port : '8000';
    return `${protocol}//${host}:${port}/ws`;
}

openBackendSettingsBtn.addEventListener('click', () => {
    geminiApiKeyInput.value = localStorage.getItem('speak_gemini_api_key') || '';
    customWsUrlInput.value = localStorage.getItem('speak_custom_backend_ws') || '';
    if (testApiResult) testApiResult.textContent = '';
    backendSettingsModal.classList.remove('hidden');
});

closeBackendSettingsModalBtn.addEventListener('click', () => backendSettingsModal.classList.add('hidden'));

saveBackendWsBtn.addEventListener('click', () => {
    const keyVal = geminiApiKeyInput.value.trim();
    const wsVal = customWsUrlInput.value.trim();

    if (keyVal) {
        localStorage.setItem('speak_gemini_api_key', keyVal);
        addLog('已成功儲存 Gemini API Key！可以直接連線進行對話了', 'success');
    } else {
        localStorage.removeItem('speak_gemini_api_key');
    }

    if (wsVal) {
        localStorage.setItem('speak_custom_backend_ws', wsVal);
        addLog(`後端 URL 已設定為: ${wsVal}`, 'success');
    } else {
        localStorage.removeItem('speak_custom_backend_ws');
    }

    backendSettingsModal.classList.add('hidden');
});

resetBackendWsBtn.addEventListener('click', () => {
    localStorage.removeItem('speak_gemini_api_key');
    localStorage.removeItem('speak_custom_backend_ws');
    geminiApiKeyInput.value = '';
    customWsUrlInput.value = '';
    if (testApiResult) testApiResult.textContent = '';
    addLog('已重置 API Key 與後端設定', 'info');
    backendSettingsModal.classList.add('hidden');
});

// ----------------- Vocabulary Bank (LocalStorage) -----------------

function getSavedVocab() {
    try {
        return JSON.parse(localStorage.getItem('speak_saved_vocab')) || [];
    } catch {
        return [];
    }
}

function updateVocabUI() {
    const list = getSavedVocab();
    vocabCount.textContent = list.length;

    if (list.length === 0) {
        vocabList.innerHTML = `<div class="empty-state">尚無收藏卡片。可以在對話中點擊「⭐ 收藏此卡片」將重點句加入收藏庫。</div>`;
        return;
    }

    vocabList.innerHTML = list.map((item, idx) => `
        <div class="correction-card">
            <div class="correction-header">
                <span>📌 #${idx + 1} (${item.date})</span>
                <button class="btn-text" onclick="deleteVocab(${idx})">🗑️ 刪除</button>
            </div>
            <div class="correction-body">
                <div class="correction-row original"><span class="label">原句：</span>${item.original}</div>
                <div class="correction-row corrected"><span class="label">建議：</span>${item.corrected}</div>
            </div>
        </div>
    `).join('');
}

window.deleteVocab = function(index) {
    const list = getSavedVocab();
    list.splice(index, 1);
    localStorage.setItem('speak_saved_vocab', JSON.stringify(list));
    updateVocabUI();
};

saveCorrectionBtn.addEventListener('click', () => {
    const orig = originalTextEl.textContent;
    const corr = correctedTextEl.textContent;
    if (orig === '--' || corr === '--') return;

    const list = getSavedVocab();
    list.unshift({
        original: orig,
        corrected: corr,
        date: new Date().toLocaleDateString('zh-TW')
    });
    localStorage.setItem('speak_saved_vocab', JSON.stringify(list));
    updateVocabUI();
    saveCorrectionBtn.textContent = '✅ 已加入收藏！';
    setTimeout(() => { saveCorrectionBtn.textContent = '⭐ 收藏此卡片'; }, 2000);
});

openVocabBtn.addEventListener('click', () => {
    updateVocabUI();
    vocabModal.classList.remove('hidden');
});
closeVocabModalBtn.addEventListener('click', () => vocabModal.classList.add('hidden'));
closeSummaryModalBtn.addEventListener('click', () => summaryModal.classList.add('hidden'));

// ----------------- Log & Subtitle Utility -----------------

function addLog(message, type = 'info') {
    const item = document.createElement('div');
    item.className = `log-item ${type}`;
    const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    item.textContent = `[${time}] ${message}`;
    logContent.appendChild(item);
    logContent.scrollTop = logContent.scrollHeight;
}

clearLogBtn.addEventListener('click', () => logContent.innerHTML = '');

function updateCaption(text, append = false) {
    if (append) {
        currentTextBuffer += text;
    } else {
        currentTextBuffer = text;
    }
    captionText.textContent = currentTextBuffer || "正在傾聽您的英文對話...";
    parseGrammarCorrection(currentTextBuffer);
}

function parseGrammarCorrection(text) {
    const correctionRegex = /(?:Correction|Instead of|You should say|Did you mean):?\s*["']?([^"'\n\.]+)["']?\s*->?\s*["']?([^"'\n\.]+)["']?/i;
    const match = text.match(correctionRegex);
    if (match) {
        originalTextEl.textContent = match[1];
        correctedTextEl.textContent = match[2];
        correctionCard.classList.remove('hidden');
        correctionsCount++;
    }
}

// UI Status Manager
function updateUIState(state) {
    statusBadge.className = 'status-badge ' + state;
    
    switch (state) {
        case 'speaking':
            statusText.textContent = 'AI 說話中...';
            tutorStatus.textContent = `${SCENARIO_META[currentScenario].name} 正在回答...`;
            pulseRing.classList.add('active');
            waveVisualizer.classList.add('active');
            break;
        case 'connected':
            statusText.textContent = '已連線 & 監聽中';
            btnText.textContent = '結束對話並查看成績單';
            toggleBtn.className = 'btn btn-danger';
            pulseRing.classList.remove('active');
            waveVisualizer.classList.remove('active');
            tutorStatus.textContent = SCENARIO_META[currentScenario].desc;
            break;
        case 'connecting':
            statusText.textContent = '連線中...';
            btnText.textContent = '連線中...';
            pulseRing.classList.remove('active');
            waveVisualizer.classList.remove('active');
            tutorStatus.textContent = '正在進入情境房間...';
            break;
        case 'disconnected':
        default:
            statusText.textContent = '未連線';
            btnText.textContent = '開始連線與對話';
            toggleBtn.className = 'btn btn-primary';
            pulseRing.classList.remove('active');
            waveVisualizer.classList.remove('active');
            tutorStatus.textContent = '點擊下方「開始對話」即可進行即時口語練習';
            updateCaption("點擊按鈕開啟麥克風與 AI 家教練習英文...");
            break;
    }
}

// ----------------- 音訊處理與 8KB Chunked Base64 -----------------

function resampleTo16k(float32Array, originSampleRate) {
    if (originSampleRate === TARGET_INPUT_SAMPLE_RATE) return float32Array;
    const ratio = originSampleRate / TARGET_INPUT_SAMPLE_RATE;
    const newLength = Math.floor(float32Array.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        const originIdx = i * ratio;
        const idxFloor = Math.floor(originIdx);
        const idxCeil = Math.min(float32Array.length - 1, idxFloor + 1);
        const weight = originIdx - idxFloor;
        result[i] = float32Array[idxFloor] * (1 - weight) + float32Array[idxCeil] * weight;
    }
    return result;
}

function floatTo16BitPCM(float32Array) {
    const buffer = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return buffer;
}

function base64ToInt16Array(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const validLength = len - (len % 2);
    return new Int16Array(bytes.buffer, 0, validLength / 2);
}

function int16ToFloat32(int16Array) {
    const float32 = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
        float32[i] = int16Array[i] / 32768.0;
    }
    return float32;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return window.btoa(binary);
}

// ----------------- 音訊佇列與語速控制 -----------------

function initOutputAudioContext() {
    if (!outputAudioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        outputAudioContext = new AudioContextClass({ sampleRate: DEFAULT_OUTPUT_SAMPLE_RATE });
    }
    if (outputAudioContext.state === 'suspended') {
        outputAudioContext.resume();
    }
}

function stopAndClearAudioQueue() {
    activeSourceNodes.forEach(node => {
        try { node.stop(); node.disconnect(); } catch (e) {}
    });
    activeSourceNodes = [];
    nextStartTime = 0;
    isFirstChunkOfTurn = true;
    consecutiveLoudFrames = 0;

    if (isAiSpeaking) {
        isAiSpeaking = false;
        updateUIState('connected');
        addLog('語音播放已中斷 (Barge-in)', 'info');
    }
}

function queueAudioChunk(base64PcmData, sampleRate = DEFAULT_OUTPUT_SAMPLE_RATE) {
    initOutputAudioContext();

    const int16Data = base64ToInt16Array(base64PcmData);
    if (int16Data.length === 0) return;

    const float32Data = int16ToFloat32(int16Data);
    const audioBuffer = outputAudioContext.createBuffer(1, float32Data.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32Data);

    const source = outputAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = currentSpeechSpeed;

    source.connect(outputAudioContext.destination);

    const currentTime = outputAudioContext.currentTime;

    if (isFirstChunkOfTurn || nextStartTime < currentTime) {
        nextStartTime = currentTime + 0.05;
        isFirstChunkOfTurn = false;
    }

    source.start(nextStartTime);
    nextStartTime += (audioBuffer.duration / currentSpeechSpeed);

    activeSourceNodes.push(source);

    if (!isAiSpeaking) {
        isAiSpeaking = true;
        updateUIState('speaking');
    }

    source.onended = () => {
        const index = activeSourceNodes.indexOf(source);
        if (index !== -1) activeSourceNodes.splice(index, 1);

        if (activeSourceNodes.length === 0 && outputAudioContext.currentTime >= nextStartTime) {
            isAiSpeaking = false;
            isFirstChunkOfTurn = true;
            updateUIState('connected');
        }
    };
}

// ----------------- 音訊輸入與防抖打斷 -----------------

async function startAudioCapture() {
    try {
        addLog('請求麥克風存取權限...', 'info');
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        inputAudioContext = new AudioContextClass();
        if (inputAudioContext.state === 'suspended') {
            await inputAudioContext.resume();
        }

        const source = inputAudioContext.createMediaStreamSource(mediaStream);
        const bufferSize = 2048;
        scriptProcessor = inputAudioContext.createScriptProcessor(bufferSize, 1, 1);

        silentGainNode = inputAudioContext.createGain();
        silentGainNode.gain.value = 0;

        scriptProcessor.onaudioprocess = (event) => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            const inputData = event.inputBuffer.getChannelData(0);

            let sumSquares = 0;
            for (let i = 0; i < inputData.length; i++) {
                sumSquares += inputData[i] * inputData[i];
            }
            const rms = Math.sqrt(sumSquares / inputData.length);

            if (!isAiSpeaking && rms > 0) {
                noiseFloor = noiseFloor * 0.95 + rms * 0.05;
            }

            const adaptiveThreshold = Math.max(0.035, noiseFloor * 3.0);
            if (rms > adaptiveThreshold && isAiSpeaking) {
                consecutiveLoudFrames++;
                if (consecutiveLoudFrames > 3) {
                    stopAndClearAudioQueue();
                    updateCaption("（您已打斷 AI，請繼續說話...）");
                    consecutiveLoudFrames = 0;
                }
            } else {
                consecutiveLoudFrames = 0;
            }

            const resampledData = resampleTo16k(inputData, inputAudioContext.sampleRate);
            const pcm16Data = floatTo16BitPCM(resampledData);
            const base64Audio = arrayBufferToBase64(pcm16Data.buffer);

            const messagePayload = {
                realtimeInput: {
                    mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64Audio }]
                }
            };

            ws.send(JSON.stringify(messagePayload));
        };

        source.connect(scriptProcessor);
        scriptProcessor.connect(silentGainNode);
        silentGainNode.connect(inputAudioContext.destination);

        addLog(`麥克風已連線 (防抖打斷門檻: ${noiseFloor.toFixed(3)})`, 'success');

    } catch (err) {
        addLog(`麥克風啟動失敗: ${err.message}`, 'error');
        alert("請允許麥克風存取權限。");
        stopAudioCapture();
        disconnectWebSocket();
    }
}

function stopAudioCapture() {
    if (scriptProcessor) {
        scriptProcessor.onaudioprocess = null;
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }
    if (silentGainNode) {
        silentGainNode.disconnect();
        silentGainNode = null;
    }
    if (inputAudioContext) {
        inputAudioContext.close();
        inputAudioContext = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    consecutiveLoudFrames = 0;
}

// ----------------- WebSocket & Session Management -----------------

function connectWebSocket() {
    initOutputAudioContext();
    updateCaption(`進入 [${SCENARIO_META[currentScenario].name}] 情境中...`);

    sessionStartTime = Date.now();
    turnsCount = 0;
    correctionsCount = 0;

    updateUIState('connecting');

    const baseUrl = getWebSocketUrl();
    const selectedVoice = voiceSelect.value || "Puck";
    const connector = baseUrl.includes('?') ? '&' : '?';
    const wsUrl = `${baseUrl}${connector}voice=${encodeURIComponent(selectedVoice)}&scenario=${encodeURIComponent(currentScenario)}`;

    const isDirectGemini = wsUrl.includes('generativelanguage.googleapis.com');

    addLog(isDirectGemini ? "連線中：直連 Google Gemini Live API (無伺服器模式)" : `連線至後端 WebSocket: ${wsUrl}`, 'info');

    ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
        isConnected = true;
        addLog(`連線成功 (情境: ${currentScenario}, 聲線: ${selectedVoice})`, 'success');
        updateUIState('connected');

        if (isDirectGemini) {
            const setupMsg = {
                setup: {
                    model: "models/gemini-3.1-flash-live",
                    generationConfig: {
                        responseModalities: ["AUDIO"],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: selectedVoice
                                }
                            }
                        }
                    },
                    systemInstruction: {
                        parts: [
                            {
                                text: SCENARIO_PROMPTS[currentScenario] || SCENARIO_PROMPTS["freetalk"]
                            }
                        ]
                    }
                }
            };
            ws.send(JSON.stringify(setupMsg));
            addLog("已發送 Gemini Live Setup 初始化訊息", "info");
        }

        await startAudioCapture();
    };

    ws.onmessage = (event) => {
        try {
            const response = JSON.parse(event.data);

            if (response.error) {
                addLog(`錯誤: ${JSON.stringify(response.error)}`, 'error');
                updateCaption(`⚠️ API 錯誤: ${response.error.message || response.error}`);
                return;
            }

            if (response.serverContent?.interrupted) {
                addLog('Gemini 偵測到打斷', 'info');
                stopAndClearAudioQueue();
                return;
            }

            if (response.serverContent?.turnComplete) {
                isFirstChunkOfTurn = true;
                turnsCount++;
            }

            const parts = response.serverContent?.modelTurn?.parts;
            if (parts && parts.length > 0) {
                for (const part of parts) {
                    if (part.text) {
                        updateCaption(part.text, true);
                    }

                    if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/pcm')) {
                        const base64Audio = part.inlineData.data;
                        let sampleRate = DEFAULT_OUTPUT_SAMPLE_RATE;
                        const match = part.inlineData.mimeType.match(/rate=(\d+)/);
                        if (match) sampleRate = parseInt(match[1], 10);

                        queueAudioChunk(base64Audio, sampleRate);
                    }
                }
            }
        } catch (err) {
            console.error('WebSocket 解析失敗:', err);
        }
    };

    ws.onerror = (error) => {
        const apiKey = localStorage.getItem('speak_gemini_api_key');
        if (!apiKey || apiKey.trim() === '') {
            addLog('連線失敗：尚未輸入 Gemini API Key！請在設定彈窗中貼上您的 API Key', 'error');
        } else {
            addLog('WebSocket 連線失敗！請檢查 API Key 是否有效或網路連線。', 'error');
        }
    };

    ws.onclose = () => {
        isConnected = false;
        addLog('WebSocket 已斷開', 'info');
        stopAudioCapture();
        stopAndClearAudioQueue();
        updateUIState('disconnected');
    };
}

function showSummaryReport() {
    const elapsedSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    
    statDuration.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    statTurns.textContent = turnsCount;
    statCorrections.textContent = correctionsCount;

    summaryModal.classList.remove('hidden');
}

function disconnectWebSocket() {
    if (isConnected) {
        showSummaryReport();
    }

    if (ws) {
        ws.close();
        ws = null;
    }
    stopAudioCapture();
    stopAndClearAudioQueue();
    updateUIState('disconnected');
}

// ----------------- Event Handlers -----------------

toggleBtn.addEventListener('click', () => {
    if (isConnected) {
        disconnectWebSocket();
    } else {
        const apiKey = localStorage.getItem('speak_gemini_api_key');
        const customWs = localStorage.getItem('speak_custom_backend_ws');

        if ((!apiKey || apiKey.trim() === '') && (!customWs || customWs.trim() === '')) {
            geminiApiKeyInput.value = '';
            backendSettingsModal.classList.remove('hidden');
            geminiApiKeyInput.focus();
            addLog('請先在設定視窗貼上您的 Gemini API Key！', 'error');
            updateCaption("⚠️ 請在上方設定視窗貼上 Gemini API Key");
            return;
        }

        updateCaption("");
        connectWebSocket();
    }
});

scenarioChips.forEach(chip => {
    chip.addEventListener('click', () => {
        scenarioChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentScenario = chip.dataset.scenario;

        tutorName.textContent = SCENARIO_META[currentScenario].name;
        avatarEmoji.textContent = SCENARIO_META[currentScenario].emoji;

        if (isConnected) {
            addLog(`切換情境至 ${SCENARIO_META[currentScenario].name}...`, 'info');
            disconnectWebSocket();
            setTimeout(() => connectWebSocket(), 400);
        }
    });
});

speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        speedBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSpeechSpeed = parseFloat(btn.dataset.speed);
        addLog(`語速調整為 ${currentSpeechSpeed}x`, 'info');
    });
});

voiceSelect.addEventListener('change', () => {
    if (isConnected) {
        addLog(`聲線切換為 ${voiceSelect.value}...`, 'info');
        disconnectWebSocket();
        setTimeout(() => connectWebSocket(), 400);
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden && isConnected) {
        stopAndClearAudioQueue();
    }
});

updateVocabUI();
