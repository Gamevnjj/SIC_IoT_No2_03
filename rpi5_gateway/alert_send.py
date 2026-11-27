import datetime
import json
import urllib.request
import urllib.error

import alert_gateway
import config

def send_red_alert(
    distance_cm: float = 12.0,
    pir: int = 1,
    reason: str = "Báo động màu đỏ (LED Đỏ / Khoảng cách < 20cm)",
    pi_endpoint: str | None = None,
) -> dict:
    """
    Gửi thông tin báo động màu đỏ tới kênh cảnh báo (Telegram/Email)
    và báo về máy chủ/API trên Raspberry Pi (nếu có cấu hình PI_ALERT_URL).
    """
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    payload = {
        "level": "RED",
        "led": "do",
        "alarm": True,
        "distance_cm": distance_cm,
        "pir": pir,
        "reason": reason,
        "timestamp": timestamp,
    }

    message = (
        f"[BÁO ĐỘNG ĐỎ - {timestamp}]\n"
        f"Trạng thái LED: ĐỎ (CẢNH BÁO)\n"
        f"Khoảng cách: {distance_cm:.1f} cm\n"
        f"PIR: {'Có chuyển động' if pir == 1 else 'Không có'}\n"
        f"Chi tiết: {reason}"
    )

    results = {
        "telegram": {"ok": False, "detail": ""},
        "email": {"ok": False, "detail": ""},
        "pi_sync": {"ok": False, "detail": ""},
    }

    # 1. Gửi cảnh báo đỏ qua Telegram
    try:
        alert_gateway.send_telegram(message)
        msg = "Đã gửi cảnh báo màu đỏ tới Telegram."
        print(f"[OK] {msg}")
        results["telegram"] = {"ok": True, "detail": msg}
    except Exception as exc:
        err = f"Gửi Telegram báo động đỏ thất bại: {exc}"
        print(f"[ERR] {err}")
        results["telegram"] = {"ok": False, "detail": err}

    # 2. Gửi cảnh báo đỏ qua Email
    try:
        recipients = getattr(config, "TO_EMAILS", getattr(config, "TO_EMAIL", []))
        alert_gateway.send_email("[BÁO ĐỘNG ĐỎ] Cảnh báo hệ thống IoT", message, recipients=recipients)
        msg = f"Đã gửi cảnh báo màu đỏ tới Email ({recipients})."
        print(f"[OK] {msg}")
        results["email"] = {"ok": True, "detail": msg}
    except Exception as exc:
        err = f"Gửi Email báo động đỏ thất bại: {exc}"
        print(f"[ERR] {err}")
        results["email"] = {"ok": False, "detail": err}

    # 3. Gửi thông tin báo động đỏ về API trên Raspberry Pi (nếu có)
    target_url = pi_endpoint or getattr(config, "PI_ALERT_URL", None)
    if target_url:
        try:
            req = urllib.request.Request(
                target_url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                msg = f"Đã gửi payload báo động đỏ về Pi ({target_url}), HTTP {resp.status}."
                print(f"[OK] {msg}")
                results["pi_sync"] = {"ok": True, "detail": msg}
        except (urllib.error.URLError, TimeoutError, Exception) as exc:
            err = f"Gửi thông tin về Pi ({target_url}) thất bại: {exc}"
            print(f"[ERR] {err}")
            results["pi_sync"] = {"ok": False, "detail": err}
    else:
        results["pi_sync"] = {
            "ok": True,
            "detail": "Chưa cấu hình PI_ALERT_URL; bỏ qua bước POST HTTP về Pi.",
        }

    return results


def test_hello_channels() -> dict:
    results = {
        "telegram": {"ok": False, "detail": ""},
        "email": {"ok": False, "detail": ""},
    }

    try:
        alert_gateway.send_telegram("hello")
        msg = f"Đã gửi 'hello' tới nhóm Telegram ({config.TELEGRAM_CHAT_ID}) thành công!"
        print(f"[OK] {msg}")
        results["telegram"] = {"ok": True, "detail": msg}
    except Exception as exc:
        err = f"Gửi Telegram thất bại: {exc}"
        print(f"[ERR] {err}")
        results["telegram"] = {"ok": False, "detail": err}

    try:
        recipients = getattr(config, "TO_EMAILS", getattr(config, "TO_EMAIL", []))
        alert_gateway.send_email("[Test IoT] Hello", "hello", recipients=recipients)
        msg = f"Đã gửi 'hello' tới danh sách Email ({recipients}) thành công!"
        print(f"[OK] {msg}")
        results["email"] = {"ok": True, "detail": msg}
    except Exception as exc:
        err = f"Gửi Email thất bại: {exc}"
        print(f"[ERR] {err}")
        results["email"] = {"ok": False, "detail": err}

    return results


if __name__ == "__main__":
    print("--- BẮT ĐẦU KIỂM TRA BÁO ĐỘNG MÀU ĐỎ ---")
    send_red_alert(distance_cm=11.5, pir=1, reason="Test kích hoạt trạng thái LED Đỏ")