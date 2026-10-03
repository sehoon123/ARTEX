<div align="center">

# ARTEX

AI 자율 침투 테스트 시스템 (Go 백엔드 + Next.js 프론트엔드)

🌐 **온라인 데모**: [https://artex-demo.vercel.app/](https://artex-demo.vercel.app/)

🌍 **Language / 언어**: [English](README.md) | 한국어

</div>

---

## 스크린샷

> 전체 대화형 데모는 [온라인 데모](https://artex-demo.vercel.app/)를 참고하세요.

| 대시보드 (개요 / 토큰 사용량 / 활동) | 작업 목록 |
| :---: | :---: |
| ![대시보드](screenshots/dashboard.png) | ![작업](screenshots/tasks.png) |

| 작업 · 실행 과정 (세션 / 도구 호출) | 탐색 경로 |
| :---: | :---: |
| ![실행 과정](screenshots/sessions.png) | ![탐색 경로](screenshots/graph.png) |

| 발견 항목 | 자산 |
| :---: | :---: |
| ![발견 항목](screenshots/findings.png) | ![자산](screenshots/assets.png) |

| 자산 커버리지 맵 (Force-directed 레이아웃 · 테스트 하이라이트 · 접기/펼치기) |
| :---: |
| ![커버리지](screenshots/assets_test.png) |

| 트래픽 녹화 | 사람-인-더-루프 대화 |
| :---: | :---: |
| ![트래픽](screenshots/traffic.png) | ![대화](screenshots/chat.png) |

| 에이전트 관리 | LLM 설정 |
| :---: | :---: |
| ![에이전트](screenshots/agents.png) | ![LLM](screenshots/llm.png) |

| 인터셉트 승인 | 백엔드 로그 |
| :---: | :---: |
| ![인터셉트](screenshots/intercept.png) | ![로그](screenshots/logs.png) |

---

## 승인 기록 상세

글로벌 "승인 기록", 작업 내 "인터셉트 승인", 대화 중 승인 카드 모두 펼쳐서 상세 내용을 확인할 수 있습니다.

## 자산 동기화 (ScopeSentry)

[ScopeSentry](https://github.com/Autumn-27/ScopeSentry)에서 직접 자산 데이터를 동기화할 수 있습니다:

- **자산 동기화** 페이지에서 ScopeSentry 주소와 API 키를 설정;
- **프로젝트** 또는 **작업** 단위로 동기화 대상과 자산 유형(도메인 / 서브도메인 / IP / 포트 / 사이트 / 엔드포인트…)을 선택;
- 원클릭으로 가져오고 기업 자산 범위에 따라 병합하여 ARTEX 자산 그래프에서 에이전트가 바로 탐색할 수 있습니다.

---

## 설치

> **PostgreSQL** 데이터베이스가 필요합니다. 탐색에는 **LLM** 설정(`ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY`, UI에서도 설정 가능)이 필요합니다.

### 방법 1: 원클릭 설치 스크립트 (권장)

```bash
git clone https://github.com/sehoon123/ARTEX.git
cd ARTEX
./install.sh
```

스크립트가 수행하는 작업: Docker 감지/자동 설치 → **① 전체 Docker** 또는 **② 로컬 빌드** 선택:

- **① 전체 Docker**: Postgres 비밀번호 입력(Enter로 랜덤 생성) → `.env` 자동 작성 → `docker compose up -d`.
- **② 로컬 빌드**: 데이터베이스 선택(기존 연결 / Docker로 시작) → `config.json` 생성 → `go` 컴파일로 단일 바이너리 → 시작.

설치 후 **http://localhost:8787**에 접속하세요 (첫 방문 시 `/setup`에서 관리자 비밀번호 설정).

### 방법 2: Docker Compose (수동)

```bash
git clone https://github.com/sehoon123/ARTEX.git
cd ARTEX
cp .env.example .env          # POSTGRES_PASSWORD 입력, 선택적으로 ANTHROPIC_API_KEY
docker compose up -d          # autumn27/artex 이미지 + postgres pull
# → http://localhost:8787
```

이미지에 일반 도구(ripgrep/curl/vim/npm/nmap…) 포함; `./skills`와 `./data`는 바인드 마운트로 영구 보존됩니다.

---

## 국제화 (i18n)

ARTEX는 **영어**와 **한국어**를 지원합니다. 사이드바의 사용자 메뉴에서 언어를 변경할 수 있습니다. 첫 방문 시 브라우저 언어를 자동 감지합니다.

---

## 라이선스

[AGPL-3.0](LICENSE)
