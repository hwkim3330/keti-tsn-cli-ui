# KETI TSN CLI UI

TSN Switch (LAN9662) Configuration Web UI

## Overview

`keti-tsn-cli-ui`는 TSN 스위치 설정을 위한 웹 기반 사용자 인터페이스입니다.
기존 CLI 도구의 모든 기능을 웹 브라우저에서 사용할 수 있습니다.

## Features

| 기능 | 설명 |
|------|------|
| Checksum | 장비 YANG 카탈로그 체크섬 조회 |
| Download | YANG 카탈로그 다운로드 |
| List | 캐시된 YANG 카탈로그 목록 |
| Encode | YAML → CBOR 변환 (오프라인) |
| Decode | CBOR → YAML 변환 (오프라인) |
| Fetch | 특정 설정값 조회 (iFETCH) |
| Patch | 설정값 변경 (iPATCH) |
| Get | 전체 설정 조회 (Block-wise GET) |

## Architecture

```
┌─────────────┐      WiFi (UDP)      ┌─────────────┐      Serial      ┌─────────────┐
│  Host (PC)  │ ◀─────────────────▶  │   ESP32     │ ◀─────────────▶  │  LAN9662    │
│  Web UI     │     MUP1 frames      │   (Bridge)  │     MUP1         │  (Target)   │
└─────────────┘      Port 5683       └─────────────┘                  └─────────────┘
```

## Installation

```bash
# 1. Clone repository
git clone https://github.com/hwkim3330/keti-tsn-cli-ui.git
cd keti-tsn-cli-ui

# 2. Install all dependencies
npm run install:all

# 3. Start development server
npm run dev
```

## Usage

### Development Mode

```bash
# Start both server and client in development mode
npm run dev

# Or run separately:
npm run server    # Backend on http://localhost:3001
npm run client    # Frontend on http://localhost:3000
```

### Production Mode

```bash
# Build frontend
npm run build

# Start production server
npm start
```

Open http://localhost:3001 in your browser.

## Configuration

### Transport Settings

UI에서 Settings 페이지를 통해 전송 방식을 설정할 수 있습니다:

**WiFi Mode (ESP32 Proxy):**
- Host: ESP32 IP 주소 (예: 10.42.0.11)
- Port: UDP 포트 (기본값: 5683)

**Serial Mode (Direct USB):**
- Device: 시리얼 디바이스 경로 (예: /dev/ttyACM0)

### Preset Configurations

| Preset | IP Address | Port |
|--------|------------|------|
| ESP32 #1 | 10.42.0.11 | 5683 |
| ESP32 #2 | 10.42.0.12 | 5683 |
| ESP32 #3 | 10.42.0.13 | 5683 |
| ESP32 #4 | 10.42.0.14 | 5683 |
| Default AP | 192.168.4.1 | 5683 |

## Project Structure

```
keti-tsn-cli-ui/
├── server/                 # Express 백엔드
│   ├── index.js           # 서버 진입점
│   └── routes/            # API 라우트
│       ├── checksum.js
│       ├── download.js
│       ├── list.js
│       ├── encode.js
│       ├── decode.js
│       ├── fetch.js
│       ├── patch.js
│       ├── get.js
│       └── config.js
├── client/                 # React 프론트엔드
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/         # 페이지 컴포넌트
│   │   └── index.css      # 스타일
│   └── index.html
├── tsc2cbor/              # CBOR 변환 라이브러리
├── lib/                   # CLI 명령어 구현
└── package.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | 서버 상태 확인 |
| `/api/checksum` | POST | YANG 체크섬 조회 |
| `/api/download` | POST | YANG 카탈로그 다운로드 |
| `/api/list` | GET | 캐시된 카탈로그 목록 |
| `/api/encode` | POST | YAML → CBOR 변환 |
| `/api/decode` | POST | CBOR → YAML 변환 |
| `/api/fetch` | POST | 설정값 조회 (iFETCH) |
| `/api/patch` | POST | 설정값 변경 (iPATCH) |
| `/api/get` | POST | 전체 설정 조회 |
| `/api/config/ports` | GET | 시리얼 포트 목록 |

## License

TBD
