# KETI TSN CLI UI

TSN Switch (LAN9692) Configuration Web UI

## Overview

LAN9692 TSN 스위치 설정을 위한 웹 기반 UI입니다. ESP32 WiFi 프록시를 통해 무선으로 스위치를 제어합니다.

## Quick Start

```bash
# 1. 저장소 클론
git clone https://github.com/hwkim3330/keti-tsn-cli-ui.git
cd keti-tsn-cli-ui

# 2. 의존성 설치
npm run install:all

# 3. 개발 서버 실행
npm run dev
```

브라우저에서 http://localhost:3000 접속

## Features

### TSN Configuration
| 기능 | 설명 |
|------|------|
| **gPTP (802.1AS)** | PTP 인스턴스, 포트 역할, Servo, 1PPS 설정 |
| **TAS (802.1Qbv)** | Time-Aware Shaper 게이트 스케줄 설정 |
| **CBS (802.1Qav)** | Credit-Based Shaper 대역폭 설정 |

### Monitoring
| 기능 | 설명 |
|------|------|
| **Dashboard** | 스위치 상태 개요, 포트 통계 |
| **Port Status** | 12포트 상세 상태 및 통계 |
| **Packet Capture** | 실시간 패킷 캡처 (CoAP, PTP, TCP/UDP) |

### Device Commands
| 기능 | 설명 |
|------|------|
| **Fetch (iFETCH)** | 특정 설정값 조회 |
| **Patch (iPATCH)** | 설정값 변경 |
| **Get Config** | 전체 설정 조회 |

### YANG Catalog
| 기능 | 설명 |
|------|------|
| **Checksum** | 장비 YANG 카탈로그 체크섬 조회 |
| **Download** | YANG 카탈로그 다운로드 |
| **Catalog List** | 캐시된 카탈로그 목록 |

### Tools
| 기능 | 설명 |
|------|------|
| **Encode** | YAML → CBOR 변환 |
| **Decode** | CBOR → YAML 변환 |
| **Settings** | 장치 관리, 연결 설정 |

## Architecture

```
┌─────────────┐      WiFi (UDP)      ┌─────────────┐      Serial      ┌─────────────┐
│   Web UI    │ ◀───────────────────▶│   ESP32     │ ◀───────────────▶│  LAN9692    │
│  (Browser)  │     CoAP/MUP1        │   Proxy     │     MUP1         │  TSN Switch │
└─────────────┘     Port 5683        └─────────────┘                  └─────────────┘
      │
      │ HTTP/WebSocket
      ▼
┌─────────────┐
│   Server    │
│  (Node.js)  │
└─────────────┘
```

## Usage

### Development Mode
```bash
npm run dev          # 서버(3001) + 클라이언트(3000) 동시 실행
```

### Production Mode
```bash
npm run build        # 프론트엔드 빌드
npm start            # 서버 실행 (http://localhost:3001)
```

## Device Connection

### WiFi Mode (ESP32 Proxy)
1. ESP32가 LAN9692에 시리얼로 연결
2. PC가 ESP32에 WiFi로 연결 (핫스팟 또는 같은 네트워크)
3. Settings에서 ESP32 IP 설정 (예: 10.42.0.11)

### Serial Mode (Direct USB)
1. LAN9692를 PC에 USB로 직접 연결
2. Settings에서 Serial 모드 선택
3. 디바이스 경로 설정 (예: /dev/ttyACM0)

### Default Devices
| Name | IP | Port |
|------|-----|------|
| ESP32 #1 | 10.42.0.11 | 5683 |
| ESP32 #2 | 10.42.0.12 | 5683 |
| ESP32 #3 | 10.42.0.13 | 5683 |
| ESP32 #4 | 10.42.0.14 | 5683 |

## Project Structure

```
keti-tsn-cli-ui/
├── client/                    # React Frontend
│   ├── src/
│   │   ├── App.jsx           # 메인 앱, 라우팅
│   │   ├── contexts/         # React Context
│   │   │   └── CaptureContext.jsx
│   │   ├── pages/            # 페이지 컴포넌트
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Ports.jsx
│   │   │   ├── Capture.jsx
│   │   │   ├── PTP.jsx
│   │   │   ├── TAS.jsx
│   │   │   ├── CBS.jsx
│   │   │   ├── Fetch.jsx
│   │   │   ├── Patch.jsx
│   │   │   └── Settings.jsx
│   │   └── index.css
│   └── vite.config.js
├── server/                    # Express Backend
│   ├── index.js              # 서버 진입점, WebSocket
│   └── routes/
│       ├── capture.js        # 패킷 캡처
│       ├── fetch.js          # iFETCH
│       ├── patch.js          # iPATCH
│       ├── config.js         # 설정
│       └── ...
├── tsc2cbor/                  # CBOR 변환 라이브러리
│   ├── tsc2cbor.js
│   ├── cbor2tsc.js
│   └── lib/
│       ├── transport/        # WiFi/Serial 전송
│       ├── encoder/          # YAML→CBOR
│       └── decoder/          # CBOR→YAML
└── package.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | 서버 상태 |
| `/api/fetch` | POST | iFETCH 요청 |
| `/api/patch` | POST | iPATCH 요청 |
| `/api/get` | POST | 전체 설정 조회 |
| `/api/capture/start` | POST | 패킷 캡처 시작 |
| `/api/capture/stop` | POST | 패킷 캡처 중지 |
| `/api/capture/interfaces` | GET | 네트워크 인터페이스 목록 |
| `/ws/capture` | WebSocket | 실시간 패킷 스트림 |

## Requirements

- Node.js 18+
- npm 9+
- libpcap (패킷 캡처용)

### Linux (Ubuntu/Debian)
```bash
sudo apt install libpcap-dev
```

### macOS
```bash
brew install libpcap
```

## License

MIT

## Author

KETI (Korea Electronics Technology Institute)
