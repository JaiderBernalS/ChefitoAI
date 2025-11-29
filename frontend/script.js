// ========================================
// CONFIG
// ========================================
const API_BASE = window.location.origin;

// ----------------------------
// SELECTORES CHAT
// ----------------------------
const chatForm = document.querySelector("#chatForm");
const chatBox = document.querySelector("#chatBox");
const messageInput = document.querySelector("#userMessage");
const fileInput = document.querySelector("#file");
const fileLabel = document.querySelector(".file-label");
const sidebarHistory = document.querySelector(".history-section");
const newChatBtn = document.querySelector(".new-chat-btn");
const logoutBtn = document.querySelector("#logoutBtn");

// avatar / menú usuario
const userAvatar = document.getElementById("userAvatar");
const userMenu = document.getElementById("userMenu");
const userNameLabel = document.getElementById("userNameLabel");

// preview imagen
const imagePreview = document.getElementById("imagePreview");
let currentPreviewUrl = null;

let currentConversationId = localStorage.getItem("currentConversationId") || null;
let conversationJustStarted = false;

// ----------------------------
// UTILS
// ----------------------------
function generateUuid() {
    return "id-" + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Genera un título corto a partir del primer mensaje del usuario
function createTitleFromMessage(msg) {
    if (!msg) return "Nueva receta";

    let text = msg.trim();

    // Quitar emojis básicos
    text = text.replace(/\p{Extended_Pictographic}/gu, "");

    // Quitar palabras de relleno al inicio (ayúdame, hola, oye, necesito, etc.)
    text = text.replace(
        /^(hola|buenas|buenos días|buenas tardes|buenas noches|oye|ayuda(me)?|necesito|por favor|podrías|puedes)\s+/i,
        ""
    );

    // Cortar en el primer signo de puntuación fuerte o coma
    const punctIndex = text.search(/[?.!]/);
    const commaIndex = text.indexOf(",");
    let cutAt = -1;

    if (punctIndex !== -1 && commaIndex !== -1) {
        cutAt = Math.min(punctIndex, commaIndex);
    } else if (punctIndex !== -1) {
        cutAt = punctIndex;
    } else if (commaIndex !== -1) {
        cutAt = commaIndex;
    }

    if (cutAt !== -1) {
        text = text.slice(0, cutAt);
    }

    text = text.trim();
    if (!text) text = "Nueva receta";

    // Limitar longitud
    const MAX_LEN = 30;
    if (text.length > MAX_LEN) {
        text = text.slice(0, MAX_LEN).trim() + "…";
    }

    // Capitalizar primera letra
    text = text.charAt(0).toUpperCase() + text.slice(1);

    return text;
}

/**
 * Pide al backend un título creativo generado por la IA.
 * Si algo falla, usa createTitleFromMessage(msg) como fallback.
 */
async function getTitleFromAI(userMessage, assistantText) {
    const fallback = createTitleFromMessage(userMessage);

    try {
        const res = await fetch(`${API_BASE}/conversations/suggest_title/`, {
            method: "POST",
            headers: {
                ...getAuthHeaders({ "Content-Type": "application/json" })
            },
            body: JSON.stringify({
                user_message: userMessage,
                assistant_message: assistantText?.slice(0, 800) || ""
            })
        });

        if (!res.ok) {
            console.warn("Error al pedir título IA, uso fallback");
            return fallback;
        }

        const data = await res.json();
        const raw = (data.title || "").trim();
        if (!raw) return fallback;

        // Limpiar prefijos como "Título: ..."
        let clean = raw
            .replace(/^["“”]+/, "")
            .replace(/["“”]+$/, "")
            .replace(/^t[ií]tulo[:\-]\s*/i, "")
            .trim();

        if (!clean) clean = fallback;
        return clean;
    } catch (err) {
        console.error("Error llamando al endpoint de título IA:", err);
        return fallback;
    }
}

// 👉 mismas claves que auth.js
function getToken() {
    return localStorage.getItem("chef_token");
}

/**
 * Siempre devuelve un objeto con username.
 * Si no encuentra nada en localStorage, usa "Chef Invitado".
 */
function getCurrentUser() {
    const username = localStorage.getItem("kitchenAssistantUsername");
    if (!username) {
        return { username: "Chef Invitado" };
    }
    return { username };
}

function getAuthHeaders(extra = {}) {
    const token = getToken();
    if (!token) return extra;
    return { Authorization: `Bearer ${token}`, ...extra };
}

function forceLogout() {
    localStorage.removeItem("chef_token");
    localStorage.removeItem("kitchenAssistantUsername");
    localStorage.removeItem("currentConversationId");
    localStorage.removeItem("chatHistory");
    window.location.href = "login.html";
}

/**
 * Helper antiguo, ya no se usa para renombrar pero lo dejamos por si acaso.
 */
function buildTitleFromMessage(message) {
    if (!message) return "Nueva receta";

    let text = message
        .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
        .replace(/[^\p{L}\p{N}\s,\.]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const starters = [
        "ayudame a",
        "ayúdame a",
        "me puedes",
        "me podrías",
        "me podrias",
        "quiero que",
        "quiero una",
        "necesito que",
        "necesito una",
        "necesito",
        "por favor",
        "porfa",
        "hola",
        "buenos días",
        "buenas tardes",
        "buenas noches"
    ];

    for (const start of starters) {
        if (text.startsWith(start + " ")) {
            text = text.slice(start.length).trim();
            break;
        }
    }

    if (!text) return "Nueva receta";

    const words = text.split(" ");
    const maxWords = 7;
    let short = words.slice(0, maxWords).join(" ");

    short = short.charAt(0).toUpperCase() + short.slice(1);

    if (words.length > maxWords) short += "…";

    return short || "Nueva receta";
}

// ----------------------------
// CAMBIO DE ARCHIVO + MINIATURA
// ----------------------------
if (fileInput && fileLabel) {
    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            fileLabel.innerHTML = `<span class="icon">📸</span> ${file.name}`;

            // Miniatura
            if (imagePreview) {
                if (currentPreviewUrl) {
                    URL.revokeObjectURL(currentPreviewUrl);
                    currentPreviewUrl = null;
                }
                currentPreviewUrl = URL.createObjectURL(file);
                imagePreview.innerHTML = `
                    <div class="image-preview-inner">
                        <img src="${currentPreviewUrl}" alt="Ingrediente" />
                        <button type="button" class="image-preview-remove">✕</button>
                    </div>
                `;
                const removeBtn = imagePreview.querySelector(".image-preview-remove");
                removeBtn.addEventListener("click", () => {
                    fileInput.value = "";
                    fileLabel.innerHTML = `<span class="icon">📸</span> Añadir Ingrediente (Imagen)`;
                    imagePreview.innerHTML = "";
                    if (currentPreviewUrl) {
                        URL.revokeObjectURL(currentPreviewUrl);
                        currentPreviewUrl = null;
                    }
                });
            }
        } else {
            fileLabel.innerHTML = `<span class="icon">📸</span> Añadir Ingrediente (Imagen)`;
            if (imagePreview) imagePreview.innerHTML = "";
            if (currentPreviewUrl) {
                URL.revokeObjectURL(currentPreviewUrl);
                currentPreviewUrl = null;
            }
        }
    });
}

// ----------------------------
// ENVIAR CON ENTER
// ----------------------------
if (messageInput && chatForm) {
    messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            chatForm.dispatchEvent(new Event("submit"));
        }
    });
}

// ----------------------------
// RENDER Y PERSISTENCIA
// ----------------------------
function appendMessage(text, sender) {
    if (!chatBox) return;
    const div = document.createElement("div");
    div.className = `message ${sender}`;

    if (sender === "assistant" && typeof marked !== "undefined") {
        div.innerHTML = marked.parse(text);
    } else {
        div.textContent = text;
    }

    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function saveChat() {
    if (!chatBox) return;
    localStorage.setItem("chatHistory", chatBox.innerHTML);
}

function renderHistoryToChatBox(history) {
    if (!chatBox) return;
    chatBox.innerHTML = "";

    const currentUser = getCurrentUser();
    const name = currentUser.username;
    appendMessage(
        `👋 ¡Hola ${name}! Conversación cargada. ¿Continuamos con esta receta?`,
        "assistant"
    );

    history.forEach((item) => {
        if (item.user) appendMessage(item.user, "user");
        if (item.bot) appendMessage(`🍳 ${item.bot}`, "assistant");
    });

    saveChat();
}

function startNewConversation() {
    currentConversationId = generateUuid();
    localStorage.setItem("currentConversationId", currentConversationId);
    conversationJustStarted = true;

    if (chatBox) chatBox.innerHTML = "";
    localStorage.removeItem("chatHistory");
    document.querySelectorAll(".history-item").forEach((item) =>
        item.classList.remove("active")
    );

    const currentUser = getCurrentUser();
    const name = currentUser.username;
    appendMessage(
        `👋 ¡Hola ${name}! Iniciando una nueva obra maestra.`,
        "assistant"
    );

    loadConversations(currentConversationId);
}

if (newChatBtn) {
    newChatBtn.addEventListener("click", startNewConversation);
}

// ----------------------------
// LOGOUT
// ----------------------------
if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        forceLogout();
    });
}

// ----------------------------
// CHAT: ENVÍO CON STREAMING
// ----------------------------
if (chatForm && messageInput) {
    chatForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const userMessage = messageInput.value.trim();
        const currentUser = getCurrentUser();

        if (!currentConversationId) {
            startNewConversation();
        }
        if (!userMessage) return;

        appendMessage(`${currentUser.username}: ${userMessage}`, "user");

        const formData = new FormData();
        formData.append("user_message", userMessage);
        formData.append("username", currentUser.username);
        formData.append("conversation_id", currentConversationId);

        if (fileInput && fileInput.files.length > 0) {
            formData.append("image", fileInput.files[0]);
        }

        appendMessage("🤖 Pensando en una receta...", "assistant");

        try {
            const res = await fetch(`${API_BASE}/stream_chat/`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: formData,
            });

            if (res.status === 401) {
                appendMessage(
                    "Tu sesión ha expirado. Vuelve a iniciar sesión.",
                    "error"
                );
                forceLogout();
                return;
            }

            if (!res.ok) {
                throw new Error(`Error HTTP! Estado: ${res.status}`);
            }

            const lastMsg = document.querySelector(".assistant:last-child");
            if (lastMsg && lastMsg.textContent.includes("Pensando")) lastMsg.remove();

            const botResponseDiv = document.createElement("div");
            botResponseDiv.className = "message assistant";
            botResponseDiv.innerHTML = "🍳 ";
            chatBox.appendChild(botResponseDiv);
            chatBox.scrollTop = chatBox.scrollHeight;

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let done = false;
            let fullText = "";
            const updateInterval = 50;
            let lastUpdateTime = Date.now();

            while (!done) {
                const { value, done: streamDone } = await reader.read();
                done = streamDone;
                if (!value) continue;

                const chunk = decoder.decode(value, { stream: true });
                fullText += chunk;

                if (Date.now() - lastUpdateTime > updateInterval) {
                    if (typeof marked !== "undefined") {
                        botResponseDiv.innerHTML =
                            "🍳 " + marked.parse(fullText);
                    } else {
                        botResponseDiv.textContent = "🍳 " + fullText;
                    }
                    chatBox.scrollTop = chatBox.scrollHeight;
                    lastUpdateTime = Date.now();
                }
            }

            if (typeof marked !== "undefined") {
                botResponseDiv.innerHTML = "🍳 " + marked.parse(fullText);
            } else {
                botResponseDiv.textContent = "🍳 " + fullText;
            }

            // ====== RENOMBRE AUTOMÁTICO DEL CHAT (con ayuda de la IA) ======
            if (conversationJustStarted) {
                conversationJustStarted = false;

                const title = await getTitleFromAI(userMessage, fullText);

                const fd = new FormData();
                fd.append("conversation_id", currentConversationId);
                fd.append("new_title", title);

                try {
                    await fetch(`${API_BASE}/conversations/rename/`, {
                        method: "POST",
                        headers: getAuthHeaders(),
                        body: fd,
                    });
                    loadConversations(currentConversationId);
                } catch (err) {
                    console.error("Error renombrando conversación:", err);
                }
            } else {
                loadConversations(currentConversationId);
            }

            saveChat();
        } catch (error) {
            console.error("Error al procesar el stream:", error);
            const lastMsg = document.querySelector(".assistant:last-child");
            if (lastMsg) lastMsg.remove();
            appendMessage(`❌ Error de conexión: ${error.message}.`, "error");
        }

        messageInput.value = "";
        if (fileInput) fileInput.value = "";
        if (fileLabel) {
            fileLabel.innerHTML =
                `<span class="icon">📸</span> Añadir Ingrediente (Imagen)`;
        }
        if (imagePreview) {
            imagePreview.innerHTML = "";
        }
        if (currentPreviewUrl) {
            URL.revokeObjectURL(currentPreviewUrl);
            currentPreviewUrl = null;
        }
    });
}

// ----------------------------
// SIDEBAR: CARGAR LISTA
// ----------------------------
async function loadConversations(activeId = null) {
    const token = getToken();
    if (!token) return;

    try {
        const res = await fetch(`${API_BASE}/conversations/`, {
            headers: getAuthHeaders(),
        });

        if (res.status === 401) {
            forceLogout();
            return;
        }

        const data = await res.json();
        if (!sidebarHistory) return;

        sidebarHistory.innerHTML = "";
        activeId = activeId || currentConversationId;
        let activeConvFound = false;

        data.conversations.forEach((conv) => {
            const div = document.createElement("div");
            const titleSpan = document.createElement("span");
            const deleteBtn = document.createElement("button");

            const isActive = conv.id === activeId;
            div.className = `history-item ${isActive ? "active" : ""}`;

            titleSpan.className = "history-item-title";
            titleSpan.textContent = conv.title;

            deleteBtn.className = "history-item-delete";
            deleteBtn.innerHTML = "🗑";

            if (isActive) activeConvFound = true;

            // Click en el título = abrir conversación
            titleSpan.addEventListener("click", () =>
                handleHistoryClick(conv.id, conv.username, div)
            );
            // Doble click = renombrar
            titleSpan.addEventListener("dblclick", () =>
                enableRename(div, conv.id, conv.title)
            );
            // Click en papelera = eliminar
            deleteBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                deleteConversation(conv.id);
            });

            div.appendChild(titleSpan);
            div.appendChild(deleteBtn);
            sidebarHistory.appendChild(div);
        });

        if (activeId && !activeConvFound) {
            const div = document.createElement("div");
            div.textContent = "(Nueva Receta)";
            div.className = "history-item active unsaved";

            div.addEventListener("click", () => {
                document
                    .querySelectorAll(".history-item")
                    .forEach((item) => item.classList.remove("active"));
                div.classList.add("active");
            });

            sidebarHistory.prepend(div);
        }

        if (data.conversations.length === 0 && !activeId) {
            sidebarHistory.innerHTML =
                '<p style="color:#6D94B6; padding: 10px; font-size: 0.9em;">Aún no hay conversaciones guardadas.</p>';
        }
    } catch (error) {
        console.error("Error al cargar conversaciones desde el servidor:", error);
    }
}

// ----------------------------
// ELIMINAR CONVERSACIÓN
// ----------------------------
async function deleteConversation(convId) {
    const ok = confirm("¿Eliminar esta conversación?");
    if (!ok) return;

    try {
        const res = await fetch(`${API_BASE}/conversations/${convId}`, {
            method: "DELETE",
            headers: getAuthHeaders(),
        });

        if (res.status === 401) {
            forceLogout();
            return;
        }

        if (!res.ok) {
            throw new Error(`Error HTTP ${res.status}`);
        }

        // Si la conversación eliminada era la actual, empezamos una nueva
        if (currentConversationId === convId) {
            currentConversationId = null;
            localStorage.removeItem("currentConversationId");
            localStorage.removeItem("chatHistory");
            if (chatBox) chatBox.innerHTML = "";
            startNewConversation();
        } else {
            loadConversations(currentConversationId);
        }
    } catch (err) {
        console.error("Error al eliminar conversación:", err);
        alert("No se pudo eliminar la conversación.");
    }
}

// ----------------------------
// SIDEBAR: RENOMBRAR MANUAL
// ----------------------------
async function enableRename(element, convId, currentTitle) {
    const originalText = element.textContent;
    if (originalText.includes("(Nueva Receta)")) return;

    element.innerHTML = `<input type="text" value="${currentTitle}" class="rename-input" />`;
    const input = element.querySelector(".rename-input");
    input.focus();

    const saveRename = async () => {
        const newTitle = input.value.trim();
        if (!newTitle || newTitle === currentTitle) {
            element.textContent = originalText;
            return;
        }

        const formData = new FormData();
        formData.append("conversation_id", convId);
        formData.append("new_title", newTitle);

        try {
            const res = await fetch(`${API_BASE}/conversations/rename/`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: formData,
            });

            if (res.status === 401) {
                forceLogout();
                return;
            }

            element.textContent = newTitle;
            loadConversations(currentConversationId);
        } catch (error) {
            console.error("Error al renombrar:", error);
            element.textContent = originalText;
        }
    };

    input.addEventListener("blur", saveRename);
    input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") input.blur();
    });
}

// ----------------------------
// SIDEBAR: CLICK HISTORIAL
// ----------------------------
async function handleHistoryClick(convId, username, element) {
    currentConversationId = convId;
    localStorage.setItem("currentConversationId", currentConversationId);

    document
        .querySelectorAll(".history-item")
        .forEach((item) => item.classList.remove("active"));
    element.classList.add("active");

    try {
        const res = await fetch(`${API_BASE}/history/${convId}`, {
            headers: getAuthHeaders(),
        });

        if (res.status === 401) {
            forceLogout();
            return;
        }

        const data = await res.json();
        renderHistoryToChatBox(data.history);
    } catch (error) {
        console.error(`Error al cargar historial de ${convId}:`, error);
    }
}

// ----------------------------
// INIT CHAT PAGE
// ----------------------------
window.addEventListener("load", () => {
    const token = getToken();

    // Solo exigimos token. El nombre puede faltar y se usa "Chef Invitado".
    if (!token) {
        window.location.href = "login.html";
        return;
    }

    const user = getCurrentUser();

    // Avatar y nombre
    if (userAvatar) {
        const initial = user.username.charAt(0).toUpperCase();
        userAvatar.textContent = initial;
    }
    if (userNameLabel) {
        userNameLabel.textContent = user.username;
    }
    if (userAvatar && userMenu) {
        userAvatar.addEventListener("click", (e) => {
            e.stopPropagation();
            userMenu.classList.toggle("open");
        });

        document.addEventListener("click", (e) => {
            if (
                !userMenu.contains(e.target) &&
                !userAvatar.contains(e.target)
            ) {
                userMenu.classList.remove("open");
            }
        });
    }

    const savedChat = localStorage.getItem("chatHistory");
    currentConversationId =
        localStorage.getItem("currentConversationId") || null;

    if (!currentConversationId || !savedChat) {
        startNewConversation();
    } else if (chatBox) {
        chatBox.innerHTML = savedChat;
    }

    loadConversations(currentConversationId);
});