const API_BASE = "http://127.0.0.1:8000";

// Tabs
const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

// ===== Cambio de pestañas =====
tabLogin.addEventListener("click", () => {
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
});

tabRegister.addEventListener("click", () => {
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
    registerForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
});

// ===== Helper para guardar sesión =====
function saveSession(token, username) {
    localStorage.setItem("chef_token", token);
    localStorage.setItem("kitchenAssistantUsername", username);
}

// ===== LOGIN =====
loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if (!username || !password) return;

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.detail || "Error al iniciar sesión");
            return;
        }

        const data = await res.json();
        saveSession(data.access_token, data.user.username);
        window.location.href = "index.html";
    } catch (err) {
        console.error(err);
        alert("Error de conexión con el servidor");
    }
});

// ===== REGISTRO =====
registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("register-username").value.trim();
    const email = document.getElementById("register-email").value.trim() || null;
    const password = document.getElementById("register-password").value.trim();

    if (!username || !password) return;

    if (password.length < 6 || password.length > 64) {
        alert("La contraseña debe tener entre 6 y 64 caracteres.");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, email, password }),
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.detail || "Error al registrar usuario");
            return;
        }

        const data = await res.json();
        saveSession(data.access_token, data.user.username);
        window.location.href = "index.html";
    } catch (err) {
        console.error(err);
        alert("Error de conexión con el servidor");
    }
});