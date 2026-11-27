// Tự lấy hostname hiện tại (hoạt động cả trên máy tính lẫn khi mở từ điện thoại qua IP LAN)
const API_HOST = window.location.hostname || "127.0.0.1";
const API_BASE_URL = `http://${API_HOST}:8000`;

function appendTelegramLog(type, message) {
  const logList = document.getElementById("log-list");
  if (!logList) return;

  // Xóa dòng chờ ban đầu nếu đang hiển thị placeholder
  if (logList.children.length === 1 && logList.textContent.includes("Đang kết nối cổng dữ liệu")) {
    logList.innerHTML = "";
  }

  let color = "text-cyan-400";
  if (type === "ERR" || type === "ALARM") color = "text-red-400";
  if (type === "OK" || type === "HELLO") color = "text-emerald-400";

  const time = new Date().toLocaleTimeString("vi-VN");
  const item = document.createElement("div");
  item.className =
    "p-2 rounded-xl bg-slate-900 border border-slate-800/80 flex items-center justify-between gap-3";
  item.innerHTML = `
    <span class="${color} font-bold shrink-0">[${type}]</span>
    <span class="text-gray-300 flex-1">${message}</span>
    <span class="text-gray-500 text-[11px] shrink-0">${time}</span>
  `;
  logList.prepend(item);
}

async function handleTestHello() {
  const btnTestHello = document.getElementById("btnTestHello");
  if (btnTestHello) btnTestHello.disabled = true;

  appendTelegramLog("HELLO", "Đang gọi alert_send / test_file.py để gửi 'hello' tới Telegram & Email...");

  try {
    const resp = await fetch(`${API_BASE_URL}/api/test-hello`, {
      method: "POST",
    });
    const data = await resp.json();

    const tg = data.results?.telegram;
    const em = data.results?.email;

    if (tg) {
      appendTelegramLog(tg.ok ? "OK" : "ERR", tg.detail);
    }
    if (em) {
      appendTelegramLog(em.ok ? "OK" : "ERR", em.detail);
    }
  } catch (err) {
    appendTelegramLog("ERR", `Không kết nối được tới API server (${API_BASE_URL}): ${err.message}`);
  } finally {
    if (btnTestHello) btnTestHello.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btnTestHello = document.getElementById("btnTestHello");
  if (btnTestHello) {
    btnTestHello.addEventListener("click", handleTestHello);
  }
  appendTelegramLog("HELLO", "Nút Test 'hello' (Telegram + Email) đã sẵn sàng trên giao diện.");
});