// "Ask the Dashboard" chat card — front end for AiChatServer.cs (Phase 2).
// Pure client of POST {API}/api/chat: sends the user's question plus the visible
// transcript, renders the reply and which tools the model consulted. All model
// and tool logic lives server-side; this file only moves strings around.
//
// URL resolution: AI_CHAT_API_URL from config.js. When that is empty (not yet
// deployed) the card hides itself on the public site — but a dashboard served
// from localhost falls back to the local dev server so F5 testing needs no
// config edit:  dotnet run -- chat-server   →   http://localhost:8080

const AI_CHAT_LOCAL_FALLBACK = 'http://localhost:8080';

// Cap on how many transcript turns are sent back with each question (the server
// trims to 12 as well; this just keeps requests small).
const AI_CHAT_MAX_HISTORY = 12;

const AI_CHAT_EXAMPLES = [
    'What is the Powerwall at right now?',
    'Will the pack survive tonight?',
    'How did yesterday compare to the rest of the week?',
    'What is the automation planning to do today?'
];

let aiChatHistory = [];   // [{role, content}] — the transcript we replay to the server
let aiChatBusy = false;

function aiChatApiUrl() {
    if (typeof AI_CHAT_API_URL === 'string' && AI_CHAT_API_URL) return AI_CHAT_API_URL;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return AI_CHAT_LOCAL_FALLBACK;
    return '';
}

function escapeAiChatHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function aiChatAppendBubble(kind, text, toolsUsed) {
    const messages = document.getElementById('aiChatMessages');
    if (!messages) return null;
    const bubble = document.createElement('div');
    bubble.className = `ai-chat-bubble ${kind}`;
    bubble.textContent = text;
    if (toolsUsed && toolsUsed.length) {
        const tools = document.createElement('div');
        tools.className = 'ai-chat-tools';
        tools.textContent = `checked: ${toolsUsed.map(t => t.replace(/^get_/, '').replace(/_/g, ' ')).join(', ')}`;
        bubble.appendChild(tools);
    }
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
}

function aiChatSetBusy(busy) {
    aiChatBusy = busy;
    const button = document.getElementById('aiChatSend');
    const input = document.getElementById('aiChatInput');
    if (button) button.disabled = busy;
    if (input) input.disabled = busy;
}

async function aiChatSend(textFromExample) {
    if (aiChatBusy) return;
    const input = document.getElementById('aiChatInput');
    const message = (textFromExample != null ? textFromExample : (input ? input.value : '')).trim();
    if (!message) return;
    if (input) input.value = '';

    // First message: clear the example-question hints.
    const hint = document.getElementById('aiChatHint');
    if (hint) hint.remove();

    aiChatAppendBubble('user', message);
    const pending = aiChatAppendBubble('assistant', 'Thinking…');
    aiChatSetBusy(true);

    try {
        const response = await fetch(`${aiChatApiUrl()}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                history: aiChatHistory.slice(-AI_CHAT_MAX_HISTORY)
            })
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || !data || typeof data.reply !== 'string') {
            const reason = (data && data.error) ? data.error : `HTTP ${response.status}`;
            pending.className = 'ai-chat-bubble error';
            pending.textContent = `Couldn't answer: ${reason}`;
            return;
        }

        pending.remove();
        aiChatAppendBubble('assistant', data.reply, data.toolsUsed);
        aiChatHistory.push({ role: 'user', content: message });
        aiChatHistory.push({ role: 'assistant', content: data.reply });
    } catch (error) {
        pending.className = 'ai-chat-bubble error';
        pending.textContent = `Couldn't reach the chat server (${error.message}). ` +
            'If you are running locally, start it with:  dotnet run -- chat-server';
    } finally {
        aiChatSetBusy(false);
        if (input) input.focus();
    }
}

// Shows the card (never hides it) with an explanation of why chat can't be
// used right now, and disables input so the user isn't invited to try.
function aiChatShowLoadFailure(reason) {
    const hint = document.getElementById('aiChatHint');
    if (hint) {
        hint.className = 'ai-chat-bubble error';
        hint.textContent = `Chat unavailable: ${reason}`;
    }
    const input = document.getElementById('aiChatInput');
    const button = document.getElementById('aiChatSend');
    if (input) input.disabled = true;
    if (button) button.disabled = true;
}

document.addEventListener('DOMContentLoaded', async function () {
    const card = document.getElementById('aiChatContainer');
    if (!card) return;

    const url = aiChatApiUrl();
    if (!url) {
        aiChatShowLoadFailure('AI_CHAT_API_URL is not configured for this deployment.');
        return;
    }

    // Confirm the server is actually reachable and has a provider before
    // handing the user a chat box that would just fail on first message.
    try {
        const response = await fetch(`${url}/healthz`);
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            aiChatShowLoadFailure(`server at ${url} returned HTTP ${response.status}.`);
            return;
        }
        if (!data || data.provider === 'none') {
            aiChatShowLoadFailure(`server at ${url} has no LLM provider configured.`);
            return;
        }
    } catch (error) {
        aiChatShowLoadFailure(`can't reach ${url} (${error.message}). ` +
            'If you are running locally, start it with:  dotnet run -- chat-server');
        return;
    }

    // Seed the example-question chips (clicking one asks it).
    const hint = document.getElementById('aiChatHint');
    if (hint) {
        hint.innerHTML = 'Ask about the live system, history, or the plan — for example:<br>' +
            AI_CHAT_EXAMPLES.map(q =>
                `<span class="ai-chat-example" data-q="${escapeAiChatHtml(q)}">${escapeAiChatHtml(q)}</span>`).join('');
        hint.addEventListener('click', function (event) {
            const q = event.target && event.target.dataset ? event.target.dataset.q : null;
            if (q) aiChatSend(q);
        });
    }

    const button = document.getElementById('aiChatSend');
    if (button) button.addEventListener('click', function () { aiChatSend(); });

    const input = document.getElementById('aiChatInput');
    if (input) {
        // Enter sends; Shift+Enter makes a newline.
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                aiChatSend();
            }
        });
    }
});
