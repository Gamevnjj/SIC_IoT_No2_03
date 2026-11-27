// Danh sách các cổng kết nối ưu tiên (Tự động thử lần lượt)
const ENDPOINTS = [
    "https://provider-refer-catering-incomplete.trycloudflare.com", // Ưu tiên 1: Cloudflare Tunnel toàn cầu
    "http://localhost:5000",                                      // Ưu tiên 2: Localhost PC
    "http://10.182.199.79:5000",                                  // Ưu tiên 3: IP WiFi nội bộ
    window.location.origin                                         // Ưu tiên 4: Cùng domain nếu host online
];

let activeBaseUrl = ENDPOINTS[0];
let audioEnabled = true;
let audioCtx = null;
let lastAlarmTime = 0;
let isConnected = false;

function toggleAudio() {
    audioEnabled = !audioEnabled;
    const icon = document.getElementById('icon-audio');
    const btn = document.getElementById('btn-audio');
    if (audioEnabled) {
        icon.className = "fa-solid fa-volume-high";
        btn.className = "w-9 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-yellow-400 transition";
    } else {
        icon.className = "fa-solid fa-volume-xmark";
        btn.className = "w-9 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-gray-500 transition";
    }
}

function playSiren() {
    if (!audioEnabled) return;
    const now = Date.now();
    if (now - lastAlarmTime < 1200) return;
    lastAlarmTime = now;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1400, audioCtx.currentTime + 0.3);
        osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.6);

        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.6);
    } catch (e) {}
}

function toggleSchematicModal() {
    const modal = document.getElementById('modal-schematic');
    modal.classList.toggle('hidden');
}

// Đóng modal khi nhấn ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('modal-schematic');
        if (modal && !modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
        }
    }
});

// ĐỒ THỊ CHART.JS
const ctx = document.getElementById('chart-distance').getContext('2d');
const distChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Khoảng cách (cm)',
            data: [],
            borderColor: '#22d3ee',
            backgroundColor: 'rgba(34, 211, 238, 0.1)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointRadius: 2,
            pointHoverRadius: 6
        }, {
            label: 'Ngưỡng Vàng (50cm)',
            data: [],
            borderColor: '#f59e0b',
            borderDash: [5, 5],
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0
        }, {
            label: 'Ngưỡng Đỏ (<20cm)',
            data: [],
            borderColor: '#ef4444',
            borderDash: [3, 3],
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: { grid: { color: '#1e293b' }, ticks: { color: '#64748b', font: { size: 10 } } },
            y: { min: 0, max: 200, grid: { color: '#1e293b' }, ticks: { color: '#64748b', font: { size: 10 } } }
        },
        plugins: {
            legend: { labels: { color: '#94a3b8', font: { size: 11 } } }
        }
    }
});

// BẮN LỆNH ĐIỀU KHIỂN XUỐNG ESP32
function sendControl(action) {
    fetch(activeBaseUrl + '/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action })
    })
    .then(r => r.json())
    .then(() => {
        updateData();
    })
    .catch(() => {});
}

function clearLogs() {
    document.getElementById('log-list').innerHTML = '<div class="p-3 rounded-2xl bg-slate-900 text-gray-500 text-center">Đã xóa nhật ký.</div>';
}

function exportLogsCSV() {
    fetch(activeBaseUrl + '/api/state')
    .then(r => r.json())
    .then(d => {
        let csv = "Thoi_gian,Loai,Noi_dung\n";
        d.logs.forEach(l => {
            csv += `"${l.time}","${l.type}","${l.message}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `nhat_ky_aiot_${Date.now()}.csv`;
        link.click();
    });
}

function renderUI(c, history, logs) {
    // 1. Trạng thái Node
    const dot = document.getElementById('dot-node');
    const txtNode = document.getElementById('txt-node-status');
    if (c.node_status === 'online') {
        dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse";
        txtNode.innerText = "ONLINE";
        txtNode.className = "font-mono font-bold text-emerald-400";
    } else {
        dot.className = "w-2.5 h-2.5 rounded-full bg-red-500";
        txtNode.innerText = "OFFLINE";
        txtNode.className = "font-mono font-bold text-red-400";
    }

    document.getElementById('val-rssi').innerText = (c.rssi || -58) + " dBm";
    document.getElementById('val-uptime').innerText = (c.uptime || 0) + "s";

    // 2. Khoảng cách Siêu âm
    const d = c.distance_cm;
    const txtDist = document.getElementById('val-distance');
    const bar = document.getElementById('bar-distance');
    const txtDistHint = document.getElementById('txt-dist-hint');

    if (d >= 400 || d < 0) {
        txtDist.innerText = "--";
        bar.style.width = "100%";
        bar.className = "h-2.5 rounded-full transition-all duration-300 bg-cyan-600";
        txtDistHint.innerHTML = '<span>Phân vùng:</span><span class="text-cyan-300 font-bold">> 50cm (An toàn / Ngoài tầm)</span>';
    } else {
        txtDist.innerText = d.toFixed(1);
        const barPercent = Math.min(100, Math.max(0, (d / 150) * 100));
        bar.style.width = barPercent + "%";

        if (d < 20) {
            bar.className = "h-2.5 rounded-full transition-all duration-300 bg-red-500";
            txtDistHint.innerHTML = '<span>Phân vùng:</span><span class="text-red-400 font-extrabold animate-pulse">< 20cm (Áp sát rất gần)</span>';
            playSiren();
        } else if (d < 50) {
            bar.className = "h-2.5 rounded-full transition-all duration-300 bg-amber-400";
            txtDistHint.innerHTML = '<span>Phân vùng:</span><span class="text-yellow-400 font-bold">20 - 50cm (Vật thể ở gần)</span>';
        } else {
            bar.className = "h-2.5 rounded-full transition-all duration-300 bg-emerald-500";
            txtDistHint.innerHTML = '<span>Phân vùng:</span><span class="text-emerald-400 font-bold">> 50cm (An toàn)</span>';
        }
    }

    // 3. Cảm biến Thân nhiệt PIR
    const valPir = document.getElementById('val-pir');
    const badgePir = document.getElementById('badge-pir');
    if (c.pir === 1) {
        valPir.innerText = "CÓ CHUYỂN ĐỘNG";
        valPir.className = "text-2xl font-black text-purple-400 animate-pulse";
        badgePir.className = "inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40";
        badgePir.innerHTML = '<span class="w-2 h-2 rounded-full bg-purple-400 animate-ping"></span> Phát hiện thân nhiệt!';
    } else {
        valPir.innerText = "Yên tĩnh";
        valPir.className = "text-2xl font-black text-gray-400";
        badgePir.className = "inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-slate-800 text-gray-400 border border-slate-700";
        badgePir.innerHTML = '<span class="w-2 h-2 rounded-full bg-gray-500"></span> Không có thân nhiệt';
    }

    // 4. Mô phỏng 3 Đèn LED phần cứng
    const ledG = document.getElementById('sim-led-g');
    const ledY = document.getElementById('sim-led-y');
    const ledR = document.getElementById('sim-led-r');
    const txtActiveLed = document.getElementById('txt-active-led');
    const ledStatus = c.led || "tat";

    ledG.className = "w-9 h-9 rounded-full bg-emerald-950 border-2 border-emerald-500/30 flex items-center justify-center transition-all duration-200";
    ledY.className = "w-9 h-9 rounded-full bg-yellow-950 border-2 border-yellow-500/30 flex items-center justify-center transition-all duration-200";
    ledR.className = "w-9 h-9 rounded-full bg-red-950 border-2 border-red-500/30 flex items-center justify-center transition-all duration-200";

    if (ledStatus === "xanh") {
        ledG.className = "w-9 h-9 rounded-full bg-emerald-500 border-2 border-emerald-300 led-glow-green flex items-center justify-center transition-all duration-200";
        txtActiveLed.innerText = "LED XANH (GPIO 27) - AN TOÀN";
        txtActiveLed.className = "font-bold text-emerald-400";
    } else if (ledStatus === "vang") {
        ledY.className = "w-9 h-9 rounded-full bg-yellow-400 border-2 border-yellow-200 led-glow-yellow flex items-center justify-center transition-all duration-200";
        txtActiveLed.innerText = "LED VÀNG (GPIO 26) - Ở GẦN";
        txtActiveLed.className = "font-bold text-yellow-400";
    } else if (ledStatus === "do") {
        ledR.className = "w-9 h-9 rounded-full bg-red-500 border-2 border-red-200 led-glow-red flex items-center justify-center transition-all duration-200 animate-pulse";
        txtActiveLed.innerText = "LED ĐỎ (GPIO 25) - BÁO ĐỘNG!";
        txtActiveLed.className = "font-bold text-red-400";
    } else if (ledStatus === "cho_pir") {
        ledY.className = "w-9 h-9 rounded-full bg-yellow-500 border-2 border-yellow-300 flex items-center justify-center transition-all duration-200 animate-pulse";
        txtActiveLed.innerText = "LED VÀNG NHÁY (PIR ĐANG KHỞI ĐỘNG)";
        txtActiveLed.className = "font-bold text-yellow-300";
    } else {
        txtActiveLed.innerText = "TẤT CẢ ĐÈN ĐANG TẮT";
        txtActiveLed.className = "font-bold text-gray-500";
    }

    // 5. Banner Trạng thái
    const banner = document.getElementById('banner-state');
    const txtState = document.getElementById('txt-state');
    const txtStateDesc = document.getElementById('txt-state-desc');
    const iconBox = document.getElementById('icon-state-box');
    const icon = document.getElementById('icon-state');

    if (c.alarm || ledStatus === "do") {
        banner.className = "p-5 sm:p-6 rounded-3xl border-2 border-red-500 bg-gradient-to-r from-red-950/60 via-slate-900 to-slate-900 shadow-xl alarm-danger flex flex-wrap items-center justify-between gap-6";
        txtState.innerText = "BÁO ĐỘNG ÁP SÁT! (< 20cm)";
        txtState.className = "text-2xl sm:text-3xl font-black tracking-tight text-red-400 mt-0.5 animate-pulse";
        txtStateDesc.innerText = "Cảnh báo khẩn cấp: Phát hiện mục tiêu áp sát dưới 20cm! Đèn Đỏ bật sáng.";
        iconBox.className = "w-16 h-16 rounded-2xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-3xl text-red-500 shrink-0";
        icon.className = "fa-solid fa-triangle-exclamation animate-bounce";
    } else if (ledStatus === "vang") {
        banner.className = "p-5 sm:p-6 rounded-3xl border border-yellow-500/40 bg-gradient-to-r from-yellow-950/40 via-slate-900 to-slate-900 shadow-xl flex flex-wrap items-center justify-between gap-6";
        txtState.innerText = "CẢNH GIÁC Ở GẦN (20 - 50cm)";
        txtState.className = "text-2xl sm:text-3xl font-black tracking-tight text-yellow-400 mt-0.5";
        txtStateDesc.innerText = "Phát hiện mục tiêu trong cự ly trung gian 20-50cm. Đèn Vàng bật sáng.";
        iconBox.className = "w-16 h-16 rounded-2xl bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center text-3xl text-yellow-400 shrink-0";
        icon.className = "fa-solid fa-eye";
    } else if (c.mode === "TẮT") {
        banner.className = "p-5 sm:p-6 rounded-3xl border border-slate-700 bg-slate-900 shadow-xl flex flex-wrap items-center justify-between gap-6";
        txtState.innerText = "HỆ THỐNG ĐANG TẮT";
        txtState.className = "text-2xl sm:text-3xl font-black tracking-tight text-gray-400 mt-0.5";
        txtStateDesc.innerText = "Hệ thống tạm ngưng giám sát. Bấm nút [AUTO] hoặc [LUÔN BẬT] để kích hoạt lại.";
        iconBox.className = "w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-3xl text-gray-500 shrink-0";
        icon.className = "fa-solid fa-power-off";
    } else {
        banner.className = "p-5 sm:p-6 rounded-3xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 shadow-xl flex flex-wrap items-center justify-between gap-6";
        txtState.innerText = "AN TOÀN (SAFE)";
        txtState.className = "text-2xl sm:text-3xl font-black tracking-tight text-white mt-0.5";
        txtStateDesc.innerText = "Chế độ " + c.mode + " đang hoạt động ổn định. Đèn Xanh bật sáng.";
        iconBox.className = "w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-3xl text-emerald-400 shrink-0";
        icon.className = "fa-solid fa-shield-check";
    }

    // 6. Cập nhật Biểu đồ
    if (history && history.length > 0) {
        distChart.data.labels = history.map(h => h.time);
        distChart.data.datasets[0].data = history.map(h => h.distance > 0 ? h.distance : 400);
        distChart.data.datasets[1].data = history.map(() => 50);
        distChart.data.datasets[2].data = history.map(() => 20);
        distChart.update('none');
    }

    // 7. Cập nhật Logs
    if (logs && logs.length > 0) {
        const logList = document.getElementById('log-list');
        logList.innerHTML = logs.map(l => {
            let color = "text-cyan-400";
            if (l.type === "ALARM" || l.type === "WARNING") color = "text-red-400";
            if (l.type === "MODE" || l.type === "CONTROL") color = "text-yellow-400";
            return `<div class="p-2 rounded-xl bg-slate-900 border border-slate-800/80 flex items-center justify-between">
                <span class="${color} font-bold">[${l.type}]</span>
                <span class="text-gray-300">${l.message}</span>
                <span class="text-gray-500 text-[11px]">${l.time}</span>
            </div>`;
        }).join('');
    }
}

// TỰ ĐỘNG DÒ VÀ KẾT NỐI SERVER THÔNG MINH
async function fetchWithFallback() {
    for (let url of ENDPOINTS) {
        try {
            const res = await fetch(url + '/api/state', { mode: 'cors', cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                activeBaseUrl = url;
                isConnected = true;
                document.getElementById('txt-active-host').innerText = url.includes('trycloudflare') ? 'Cloudflare Tunnel Live' : url;
                renderUI(data.current, data.history, data.logs);
                return;
            }
        } catch (e) {}
    }
}

function updateData() {
    fetchWithFallback();
}

setInterval(updateData, 600);
updateData();