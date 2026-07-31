// ==========================================
// Speak AI Tutor - REST API & Web Speech API
// ==========================================

// --- DOM Elements ---
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
const captionText = document.getElementById('captionText');

// Modals
const backendSettingsModal = document.getElementById('backendSettingsModal');
const openBackendSettingsBtn = document.getElementById('openBackendSettingsBtn');
const closeBackendSettingsModalBtn = document.getElementById('closeBackendSettingsModalBtn');
const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
const geminiModelSelect = document.getElementById('geminiModelSelect');
const saveBackendWsBtn = document.getElementById('saveBackendWsBtn');
const voiceSelect = document.getElementById('voiceSelect');

// --- Global State ---
let currentScenario = 'freetalk';
let isListening = false;
let recognition = null;
let synthesis = window.speechSynthesis;
let currentUtterance = null;
let conversationHistory = [];

// --- Scenario Meta ---
const SCENARIO_META = {
    freetalk: { name: 'Alex (American Tutor)', emoji: '🗣️', desc: '自由對話練習，適合任何主題', prompt: "You are Alex, an American English tutor. You are engaging in a free talk session with the user. Keep your responses conversational and concise. If the user makes a grammar mistake, correct it using the format [[CORRECTION|original|corrected|reason]] at the end of your response." },
    starbucks: { name: 'Jessica (Barista)', emoji: '☕', desc: '星巴克點餐情境模擬', prompt: "You are Jessica, a barista at Starbucks. The user is ordering a drink. Be polite and ask standard Starbucks questions (size, hot/iced, name). Keep your responses concise. Correct their grammar if they make a mistake using the format [[CORRECTION|original|corrected|reason]]." },
    interview: { name: 'David (Interviewer)', emoji: '👔', desc: '外商面試全英文演練', prompt: "You are David, a job interviewer at a multinational tech company. You are interviewing the user for a software engineering position. Ask behavioral and technical questions. Correct their grammar if they make a mistake using the format [[CORRECTION|original|corrected|reason]]." },
    airport: { name: 'Officer Smith', emoji: '🛂', desc: '機場海關過關問答', prompt: "You are Officer Smith, an immigration officer at JFK airport. Ask standard immigration questions (purpose of visit, duration of stay, where they will stay). Correct their grammar if they make a mistake using the format [[CORRECTION|original|corrected|reason]]." },
    business: { name: 'Michael (Partner)', emoji: '💼', desc: '商業談判與會議情境', prompt: "You are Michael, a business partner negotiating a contract. Discuss pricing, timelines, and deliverables. Correct their grammar if they make a mistake using the format [[CORRECTION|original|corrected|reason]]." }
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Load Settings
    const savedKey = localStorage.getItem('speak_gemini_api_key');
    if (savedKey) geminiApiKeyInput.value = savedKey;
    
    const savedModel = localStorage.getItem('speak_gemini_model');
    if (savedModel) { geminiModelSelect.value = savedModel; if (!geminiModelSelect.value) geminiModelSelect.value = 'gemini-3.5-flash'; }

    // Initialize Web Speech API
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        
        recognition.onresult = handleRecognitionResult;
        recognition.onerror = (e) => {
            addLog("語音辨識錯誤: " + e.error, 'error');
            stopListening();
        };
        recognition.onend = () => {
            if (isListening) {
                try { recognition.start(); } catch(e){}
            }
        };
    } else {
        addLog("您的瀏覽器不支援語音辨識，請使用 Chrome", 'error');
    }
});

// --- UI Event Listeners ---
openBackendSettingsBtn.addEventListener('click', () => {
    backendSettingsModal.classList.remove('hidden');
});
closeBackendSettingsModalBtn.addEventListener('click', () => {
    backendSettingsModal.classList.add('hidden');
});
saveBackendWsBtn.addEventListener('click', () => {
    localStorage.setItem('speak_gemini_api_key', geminiApiKeyInput.value);
    localStorage.setItem('speak_gemini_model', geminiModelSelect.value);
    addLog("設定已儲存", 'success');
    backendSettingsModal.classList.add('hidden');
});

document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        currentScenario = e.target.dataset.scenario;
        const meta = SCENARIO_META[currentScenario];
        tutorName.textContent = meta.name;
        tutorStatus.textContent = meta.desc;
        avatarEmoji.textContent = meta.emoji;
        addLog("切換情境至: " + meta.desc, 'info');
    });
});

clearLogBtn.addEventListener('click', () => {
    logContent.innerHTML = '';
});

toggleBtn.addEventListener('click', () => {
    if (isListening) {
        stopListening();
    } else {
        const apiKey = localStorage.getItem('speak_gemini_api_key');
        if (!apiKey || apiKey.trim() === '') {
            backendSettingsModal.classList.remove('hidden');
            geminiApiKeyInput.focus();
            addLog("請先設定 API Key", 'error');
            return;
        }
        startListening();
    }
});

// --- Core Logic ---
function updateUIState(state) {
    if (state === 'disconnected') {
        statusBadge.className = 'status-badge';
        statusText.textContent = '未連線';
        toggleBtn.className = 'btn btn-primary';
        btnText.textContent = '開始連線與對話';
        pulseRing.classList.remove('active');
        waveVisualizer.classList.remove('active');
    } else if (state === 'listening') {
        statusBadge.className = 'status-badge status-connected';
        statusText.textContent = '聆聽中';
        toggleBtn.className = 'btn btn-danger';
        btnText.textContent = '停止聆聽 (送出)';
        pulseRing.classList.add('active');
        waveVisualizer.classList.add('active');
    } else if (state === 'processing') {
        statusBadge.className = 'status-badge status-connected';
        statusText.textContent = 'AI 思考中';
        toggleBtn.className = 'btn btn-danger';
        toggleBtn.disabled = true;
        btnText.textContent = 'AI 思考中...';
        pulseRing.classList.remove('active');
        waveVisualizer.classList.remove('active');
    } else if (state === 'speaking') {
        statusBadge.className = 'status-badge status-connected';
        statusText.textContent = 'AI 說話中';
        toggleBtn.className = 'btn btn-danger';
        toggleBtn.disabled = false;
        btnText.textContent = 'AI 說話中... (點擊中斷)';
        pulseRing.classList.add('active');
        waveVisualizer.classList.add('active');
    }
}

function updateCaption(text) {
    captionText.textContent = text;
}

function addLog(message, type = 'info') {
    const div = document.createElement('div');
    div.className = 'log-item ' + type;
    div.textContent = message;
    logContent.appendChild(div);
    logContent.scrollTop = logContent.scrollHeight;
}

function startListening() {
    if (!recognition) return;
    if (synthesis.speaking) synthesis.cancel();
    
    isListening = true;
    updateUIState('listening');
    updateCaption("請開始說話...");
    
    try {
        recognition.start();
        addLog("開始聆聽...", 'info');
    } catch(e) {
        stopListening();
    }
}

function stopListening() {
    if (recognition) {
        try { recognition.stop(); } catch(e){}
    }
    isListening = false;
    updateUIState('disconnected');
}

function handleRecognitionResult(event) {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
        } else {
            interimTranscript += event.results[i][0].transcript;
        }
    }
    
    if (interimTranscript !== '') {
        updateCaption(interimTranscript);
    }
    
    if (finalTranscript !== '') {
        updateCaption(finalTranscript);
        addLog("使用者：" + finalTranscript, 'success');
        
        stopListening();
        sendToGeminiREST(finalTranscript);
    }
}

// Ensure function is exposed for external test scripts if needed
window.sendToGeminiREST = async function(userText) {
    const apiKey = localStorage.getItem('speak_gemini_api_key');
    const selectedModel = localStorage.getItem('speak_gemini_model') || 'gemini-3.5-flash';
    let formattedModel = selectedModel.startsWith('models/') ? selectedModel : "models/" + selectedModel;
    
    updateCaption("AI 思考中...");
    updateUIState('processing');

    try {
        let contents = [];
        const sysInstruction = SCENARIO_META[currentScenario].prompt;
        
        contents.push({
            role: "user",
            parts: [{text: sysInstruction + "\n\nRespond to the user's latest input."}]
        });
        
        for (const msg of conversationHistory) {
            contents.push(msg);
        }
        
        contents.push({
            role: "user",
            parts: [{text: userText}]
        });

        const requestBody = {
            contents: contents,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 256,
            }
        };

        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/" + formattedModel + ":generateContent?key=" + apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error("HTTP " + response.status + ": " + errBody);
        }

        const data = await response.json();
        
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content.parts.length > 0) {
            let aiResponseText = data.candidates[0].content.parts[0].text;
            
            // Handle corrections formatting
            const correctionMatch = aiResponseText.match(/\[\[CORRECTION\|(.*?)\|(.*?)\|(.*?)\]\]/);
            if (correctionMatch) {
                const original = correctionMatch[1];
                const corrected = correctionMatch[2];
                const reason = correctionMatch[3];
                
                document.getElementById('correctionCard').classList.remove('hidden');
                document.getElementById('originalText').textContent = original;
                document.getElementById('correctedText').textContent = corrected;
                document.getElementById('explanationText').textContent = reason;
                
                // Remove the tag from spoken text
                aiResponseText = aiResponseText.replace(/\[\[CORRECTION.*\]\]/, '').trim();
            }

            addLog("AI：" + aiResponseText, 'info');
            updateCaption(aiResponseText);
            
            conversationHistory.push({ role: "user", parts: [{text: userText}] });
            conversationHistory.push({ role: "model", parts: [{text: aiResponseText}] });
            
            speakAIResponse(aiResponseText);
        } else {
            throw new Error("Invalid response from Gemini API");
        }

    } catch (error) {
        addLog("Gemini API 請求失敗: " + error.message, 'error');
        updateCaption("連線失敗，請重試");
        updateUIState('disconnected');
    }
}

function speakAIResponse(text) {
    if (!window.speechSynthesis) {
        addLog("您的瀏覽器不支援語音合成", 'error');
        updateUIState('disconnected');
        return;
    }
    
    synthesis.cancel();
    currentUtterance = new SpeechSynthesisUtterance(text);
    currentUtterance.lang = 'en-US'; 
    currentUtterance.rate = 1.0;
    
    // Attempt to match voice
    const voices = synthesis.getVoices();
    let chosenVoice = null;
    for(let v of voices) {
        if(v.name.includes('Google US English') || v.lang === 'en-US') {
            chosenVoice = v;
            break;
        }
    }
    if (chosenVoice) currentUtterance.voice = chosenVoice;

    currentUtterance.onstart = () => {
        updateUIState('speaking');
        isListening = false;
    };
    
    currentUtterance.onend = () => {
        updateUIState('disconnected');
    };
    
    currentUtterance.onerror = (e) => {
        updateUIState('disconnected');
    };

    synthesis.speak(currentUtterance);
}

testApiKeyBtn.addEventListener('click', async () => {
    const key = geminiApiKeyInput.value.trim();
    const model = geminiModelSelect.value;
    if (!model) { testApiResult.textContent = '❌ 請選擇有效的模型'; return; }
    if (!key) {
        testApiResult.textContent = '❌ 請先輸入 API Key';
        testApiResult.style.color = 'var(--danger)';
        return;
    }
    
    testApiResult.textContent = '⏳ 測試連線中...';
    testApiResult.style.color = 'var(--text-muted)';
    testApiKeyBtn.disabled = true;

    try {
        let formattedModel = model.startsWith('models/') ? model : "models/" + model;
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/" + formattedModel + ":generateContent?key=" + key, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: "Hello" }] }],
                generationConfig: { maxOutputTokens: 10 }
            })
        });

        if (response.ok) {
            testApiResult.textContent = '✅ API Key 測試成功！請點擊下方儲存。';
            testApiResult.style.color = 'var(--accent)';
        } else {
            const errBody = await response.text();
            testApiResult.textContent = '❌ 測試失敗: ' + response.status;
            testApiResult.style.color = 'var(--danger)';
        }
    } catch (err) {
        testApiResult.textContent = '❌ 網路錯誤或跨域阻擋';
        testApiResult.style.color = 'var(--danger)';
    } finally {
        testApiKeyBtn.disabled = false;
    }
});



