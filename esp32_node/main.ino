#include <WiFi.h>
#include <PubSubClient.h>
#include <string.h>

// ======================= CẤU HÌNH WI-FI & MQTT (ĐỒNG BỘ PI 5) =======================
const char*    WIFI_SSID = "Dat0101";             // Tên WiFi (2.4GHz)
const char*    WIFI_PASS = "88888888";            // Mật khẩu WiFi
const char*    MQTT_HOST = "10.182.199.252";      // IP Raspberry Pi 5 (MQTT Broker)
const uint16_t MQTT_PORT = 1883;                  // Cổng MQTT
const char*    MQTT_USER = "esp01";               // User MQTT (khớp cai_mqtt_pi5.sh)
const char*    MQTT_PASS = "MAT_KHAU_MQTT_ESP01"; // Mật khẩu MQTT (khớp Pi)
const char*    NODE_ID   = "esp01";               // Tiền tố / ID thiết bị

// ======================= CHÂN GPIO =======================
#define TRIG_PIN    5
#define ECHO_PIN    18
#define PIR_PIN     35
#define BUTTON_PIN  32
#define LED_XANH    27
#define LED_VANG    26
#define LED_DO      25

// ======================= THÔNG SỐ ĐO & THỜI GIAN =======================
const float         NGUONG_GAN      = 20.0;   // < 20 cm     -> DO
const float         NGUONG_XA       = 50.0;   // 20 - 50 cm  -> VANG, > 50 cm -> XANH
const unsigned long THOI_GIAN_GIU   = 10000;  // Giữ đèn 10s sau lần cuối PIR thấy người
const unsigned long PIR_KHOI_DONG   = 30000;  // PIR cần ~30s ổn định sau cấp điện
const unsigned long TIMEOUT_US      = 30000;  // Timeout siêu âm (~5m)
const unsigned long CHU_KY_GUI      = 1000;   // Gửi trạng thái lên Pi mỗi 1s
const unsigned long BUOC_THU_MQTT   = 5000;   // Thử kết nối lại MQTT mỗi 5s

// ======================= CHẾ ĐỘ =======================
enum CheDo { AUTO, LUON_BAT, TAT };
const char* tenCheDo[] = { "AUTO (chi do khi co nguoi)", "LUON BAT", "TAT" };
const char* maCheDo[]  = { "auto", "on", "off" };

volatile CheDo cheDo       = AUTO;
volatile bool  vuaDoiCheDo = false;

// ======================= TRẠNG THÁI =======================
unsigned long lanCuoiCoNguoi = 0;
bool          dangCoNguoi   = false;
float         khoangCach    = -1.0f;
const char*   denHienTai    = "tat";
bool          canGuiNgay    = false;

// ======================= MQTT =======================
WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);
char         TOPIC_STATUS[48];
char         TOPIC_STATE[48];
char         TOPIC_MODE[48];
char         TOPIC_CMD[48];
unsigned long lanThuMQTT = 0;

// ---------- NÚT BẤM (NGẮT + CHỐNG DỘI) ----------
void IRAM_ATTR xuLyNut() {
  static unsigned long lanNhanTruoc = 0;
  unsigned long now = millis();
  if (now - lanNhanTruoc > 250) {
    cheDo = (CheDo)((cheDo + 1) % 3);
    vuaDoiCheDo = true;
    lanNhanTruoc = now;
  }
}

// ---------- SIÊU ÂM ----------
float docKhoangCach() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long t = pulseIn(ECHO_PIN, HIGH, TIMEOUT_US);
  if (t == 0) return -1.0f;
  return (t * 0.0343f) / 2.0f;
}

float docKhoangCachLoc() {
  float a = docKhoangCach();
  delay(15);
  float b = docKhoangCach();
  delay(15);
  float c = docKhoangCach();

  if (a > b) { float t = a; a = b; b = t; }
  if (b > c) { float t = b; b = c; c = t; }
  if (a > b) { float t = a; a = b; b = t; }
  return b;
}

// ---------- LED ----------
void batDen(bool xanh, bool vang, bool doo) {
  digitalWrite(LED_XANH, xanh ? HIGH : LOW);
  digitalWrite(LED_VANG, vang ? HIGH : LOW);
  digitalWrite(LED_DO,   doo  ? HIGH : LOW);
}

void datDen(const char* mau) {
  batDen(
    strcmp(mau, "xanh") == 0,
    strcmp(mau, "vang") == 0,
    strcmp(mau, "do")   == 0
  );
  if (strcmp(mau, denHienTai) != 0) {
    denHienTai = mau;
    canGuiNgay = true;
  }
}

void nhayDen(int soLan) {
  for (int i = 0; i < soLan; i++) {
    batDen(true, true, true);
    delay(150);
    batDen(false, false, false);
    delay(150);
  }
}

void doVaHienThi() {
  float d = docKhoangCachLoc();

  if (d < 0 || d > 400.0f) {
    khoangCach = -1.0f;
    datDen("xanh");
    Serial.println("  Khong co vat / ngoai tam -> XANH");
  } else {
    khoangCach = d;
    if (d < NGUONG_GAN) {
      datDen("do");
      Serial.printf("  %.1f cm -> DO (gan)\n", d);
    } else if (d < NGUONG_XA) {
      datDen("vang");
      Serial.printf("  %.1f cm -> VANG (trung binh)\n", d);
    } else {
      datDen("xanh");
      Serial.printf("  %.1f cm -> XANH (xa)\n", d);
    }
  }
}

// ---------- MQTT: NHẬN LỆNH TỪ PI ----------
void nhanLenh(char* topic, byte* payload, unsigned int len) {
  String s;
  s.reserve(len);
  for (unsigned int i = 0; i < len; i++) {
    s += (char)payload[i];
  }
  s.trim();
  s.toLowerCase();
  Serial.printf("MQTT nhan [%s]: %s\n", topic, s.c_str());

  CheDo moi;
  if      (s == "auto" || s == "0") moi = AUTO;
  else if (s == "on"   || s == "1") moi = LUON_BAT;
  else if (s == "off"  || s == "2") moi = TAT;
  else if (s == "next")             moi = (CheDo)((cheDo + 1) % 3);
  else {
    Serial.println("  -> Lenh khong hop le (dung: auto | on | off | next)");
    return;
  }

  cheDo = moi;
  vuaDoiCheDo = true;
}

// ---------- MQTT: DUY TRÌ KẾT NỐI ----------
void giuKetNoi() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (!mqtt.connected()) {
    unsigned long now = millis();
    if (now - lanThuMQTT < BUOC_THU_MQTT) return;
    lanThuMQTT = now;

    Serial.print("Ket noi MQTT toi Pi... ");
    if (mqtt.connect(NODE_ID, MQTT_USER, MQTT_PASS, TOPIC_STATUS, 1, true, "offline")) {
      Serial.println("OK");
      mqtt.publish(TOPIC_STATUS, "online", true);
      mqtt.publish(TOPIC_MODE, maCheDo[cheDo], true);
      mqtt.subscribe(TOPIC_CMD);
      canGuiNgay = true;
    } else {
      Serial.printf("THAT BAI (rc=%d), thu lai sau 5s\n", mqtt.state());
    }
  }
  mqtt.loop();
}

// ---------- MQTT: GỬI TRẠNG THÁI ----------
void guiTrangThai() {
  static unsigned long lanGuiCuoi = 0;
  unsigned long now = millis();
  if (!mqtt.connected()) return;
  if (!canGuiNgay && (now - lanGuiCuoi < CHU_KY_GUI)) return;

  char kc[12];
  if (khoangCach < 0) {
    snprintf(kc, sizeof(kc), "null");
  } else {
    snprintf(kc, sizeof(kc), "%.1f", khoangCach);
  }

  char json[220];
  snprintf(
    json,
    sizeof(json),
    "{\"node\":\"%s\",\"mode\":\"%s\",\"pir\":%d,\"distance\":%s,\"led\":\"%s\",\"rssi\":%d,\"uptime\":%lu}",
    NODE_ID,
    maCheDo[cheDo],
    dangCoNguoi ? 1 : 0,
    kc,
    denHienTai,
    WiFi.RSSI(),
    now / 1000
  );

  mqtt.publish(TOPIC_STATE, json);
  lanGuiCuoi = now;
  canGuiNgay = false;
}

// ---------- SETUP ----------
void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN,   OUTPUT);
  pinMode(ECHO_PIN,   INPUT);
  pinMode(PIR_PIN,    INPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_XANH,   OUTPUT);
  pinMode(LED_VANG,   OUTPUT);
  pinMode(LED_DO,     OUTPUT);

  attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), xuLyNut, FALLING);

  batDen(true, false, false); delay(300);
  batDen(false, true, false); delay(300);
  batDen(false, false, true); delay(300);
  batDen(false, false, false);

  snprintf(TOPIC_STATUS, sizeof(TOPIC_STATUS), "%s/status",   NODE_ID);
  snprintf(TOPIC_STATE,  sizeof(TOPIC_STATE),  "%s/state",    NODE_ID);
  snprintf(TOPIC_MODE,   sizeof(TOPIC_MODE),   "%s/mode",     NODE_ID);
  snprintf(TOPIC_CMD,    sizeof(TOPIC_CMD),    "%s/cmd/mode", NODE_ID);

  Serial.printf("\nKet noi WiFi \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - t0 < 15000)) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWiFi OK - IP ESP32: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nChua ket noi duoc WiFi - he thong van chay, se tu thu lai.");
  }

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(nhanLenh);
  mqtt.setKeepAlive(15);

  Serial.println("===== KHOI DONG XONG =====");
  Serial.printf("Che do: %s\n", tenCheDo[cheDo]);
}

// ---------- LOOP ----------
void loop() {
  unsigned long now = millis();

  giuKetNoi();

  if (vuaDoiCheDo) {
    vuaDoiCheDo = false;
    dangCoNguoi = false;
    khoangCach  = -1.0f;
    batDen(false, false, false);
    nhayDen(cheDo + 1);
    denHienTai = "tat";
    Serial.printf("\n>>> CHE DO: %s\n", tenCheDo[cheDo]);
    if (mqtt.connected()) {
      mqtt.publish(TOPIC_MODE, maCheDo[cheDo], true);
    }
    canGuiNgay = true;
  }

  switch (cheDo) {
    case TAT:
      datDen("tat");
      khoangCach = -1.0f;
      break;

    case LUON_BAT:
      doVaHienThi();
      break;

    case AUTO:
      if (now < PIR_KHOI_DONG) {
        static unsigned long lanIn = 0;
        if (now - lanIn > 5000) {
          Serial.printf("PIR dang khoi dong... con %lu giay\n", (PIR_KHOI_DONG - now) / 1000);
          lanIn = now;
        }
        batDen(false, ((now / 500) % 2) == 1, false);
        denHienTai = "cho_pir";
      } else {
        if (digitalRead(PIR_PIN) == HIGH) {
          lanCuoiCoNguoi = now;
          if (!dangCoNguoi) {
            dangCoNguoi = true;
            canGuiNgay  = true;
            Serial.println("PIR: CO NGUOI -> bat dau do");
          }
        }

        if (dangCoNguoi && (now - lanCuoiCoNguoi > THOI_GIAN_GIU)) {
          dangCoNguoi = false;
          khoangCach  = -1.0f;
          datDen("tat");
          canGuiNgay  = true;
          Serial.println("PIR: KHONG CON NGUOI -> tat den");
        }

        if (dangCoNguoi) {
          doVaHienThi();
        }
      }
      break;
  }

  guiTrangThai();
  delay(30);
}