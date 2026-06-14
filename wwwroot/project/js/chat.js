// ===== DeepSeek Chat (通过后端 API 代理) =====
var CHAT_API_URL = "/api/chat";
var MAX_HISTORY = 10;

var chatHistory = [];
var isProcessing = false;
var chatMessages = document.getElementById("chatMessages");
var chatInput = document.getElementById("chatInput");

function toggleChat() {
  var panel = document.getElementById("chatPanel");
  var rightPanel = document.getElementById("rightPanel");
  var spatialPanel = document.getElementById("spatialPanel");
  var willOpen = !panel.classList.contains("open");

  panel.classList.toggle("open");

  if (rightPanel) {
    if (willOpen) {
      rightPanel.style.transition = "opacity 0.4s ease";
      rightPanel.style.opacity = "0.15";
      rightPanel.style.pointerEvents = "none";
    } else {
      rightPanel.style.opacity = "";
      rightPanel.style.pointerEvents = "";
    }
  }
  if (spatialPanel && spatialPanel.classList.contains("open")) {
    if (willOpen) {
      spatialPanel.style.transition = "opacity 0.4s ease";
      spatialPanel.style.opacity = "0.15";
      spatialPanel.style.pointerEvents = "none";
    } else {
      spatialPanel.style.opacity = "";
      spatialPanel.style.pointerEvents = "";
    }
  }

  if (willOpen) {
    setTimeout(function () {
      chatInput.focus();
    }, 300);
  }
}

// ===== Toast Notification =====
function showToast(message) {
  var container = document.getElementById("toastContainer");
  if (!container) return;
  var toast = document.createElement("div");
  toast.className = "toast-item";
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function () {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 2600);
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showLoading() {
  var div = document.createElement("div");
  div.className = "message-row ai";
  div.id = "loadingIndicator";
  div.innerHTML =
    '<div class="message-avatar ai-avatar">D</div><div class="message-bubble ai"><div class="typing-indicator"><span></span><span></span><span></span></div></div>';
  chatMessages.appendChild(div);
  scrollToBottom();
}

function removeLoading() {
  var el = document.getElementById("loadingIndicator");
  if (el) el.remove();
}

function appendMessage(role, text) {
  var row = document.createElement("div");
  row.className = "message-row " + (role === "user" ? "user" : "ai");
  if (role === "assistant") {
    var avatar = document.createElement("div");
    avatar.className = "message-avatar ai-avatar";
    avatar.textContent = "D";
    row.appendChild(avatar);
  }
  var bubble = document.createElement("div");
  bubble.className =
    "message-bubble " + (role === "user" ? "user" : "ai");
  bubble.textContent = text;
  row.appendChild(bubble);
  chatMessages.appendChild(row);
  scrollToBottom();
}

async function sendMessage() {
  var text = chatInput.value.trim();
  if (!text || isProcessing) return;

  chatInput.value = "";
  chatInput.style.height = "auto";

  var welcome = document.getElementById("chatWelcome");
  if (welcome) welcome.style.display = "none";

  appendMessage("user", text);
  chatHistory.push({ role: "user", content: text });

  showLoading();
  isProcessing = true;
  document.getElementById("sendBtn").disabled = true;

  try {
    var response = await fetch(CHAT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: chatHistory.slice(-MAX_HISTORY * 2)
      })
    });

    if (!response.ok) {
      throw new Error("服务器错误: " + response.status);
    }

    var data = await response.json();
    var reply = data.reply;

    removeLoading();
    appendMessage("assistant", reply);
    chatHistory.push({ role: "assistant", content: reply });
  } catch (err) {
    removeLoading();
    appendMessage("assistant", "抱歉，连接出错：" + err.message);
  } finally {
    isProcessing = false;
    document.getElementById("sendBtn").disabled = false;
    chatInput.focus();
  }
}

chatInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

chatInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 80) + "px";
});
