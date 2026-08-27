# Trade Journal

여러 거래소의 읽기 전용 거래 기록을 동기화하고 실제 종료 거래를 분석하는 Trade Journal입니다. 화면은 `매매일지`, `매매분석`, `Risk Lab`, `계획 분석`, `홀딩 / 재진입`, `거래 탐색`으로 나뉘며, 주문·출금·자산이동 기능은 포함하지 않습니다.

현재 배포 버전: `v1.0.19`

## 무료 배포판 범위

- Deepcoin SWAP, Binance의 읽기 전용 API 연동
- 처음 읽기 전용 API 연결을 저장하면 기본 최근 30일 거래를 한 번 자동 동기화
- 동기화가 끝나면 선택 기간의 거래 목록·성과·품질 분석을 자동 갱신하고, 종료 거래가 없으면 분석 불가 원인을 구분해 표시
- 종료 거래 저널, 거래 차트 복기, 분할 진입·익절 마커
- 승패·진입·청산 품질과 대성공·대실패 거래 분석, 별도 Risk Lab의 손절·SL/TP 기대값 분석
- 매매분석 상단 Trading Review: 기존 행동 분석의 수익 누수, 품질 분석의 반복 강점, 이미 계산된 Plan Lab 실행 요약을 한 번에 보고 근거 거래로 이동
- 거래별 계획 SL/TP·Setup·Mistake 기록과 규칙 준수, 수익 누수, 조건 비교 분석
- Plan Lab은 과거 종료 거래를 선택해 사용자가 당시 계획을 직접 입력하고 실제 실행과 비교합니다. 회고 입력에 계획 Entry가 없으면 실제 Entry를 계획값으로 저장하지 않으며, 거래 전 서버에 저장된 계획만 사전 기록으로 검증합니다. `TP2`가 없으면 기존처럼 `TP1`에서 100% 청산하고, `TP2`가 있으면 `TP1 50% + TP2 잔여 50%` 고정 규칙으로 공식 Plan R·Plan PnL·Delta·Attribution·Optimizer를 계산합니다. 거래 목록은 가볍게 먼저 열리고 경로 재생·Optimizer는 사용자가 공식 분석을 요청할 때 실행됩니다.
- macOS 앱과 Windows x64 압축 배포판
- 사용자 API Key는 브라우저 저장소나 프론트엔드 코드에 저장하지 않음

## 바로 실행 배포판

사용자가 Node.js나 Python을 따로 설치하지 않아도 되는 macOS 앱은 아래처럼 빌드합니다. Apple Silicon용 배포판은 Apple Silicon Mac에서, Intel용 배포판은 Intel Mac에서 각각 빌드해야 합니다.

```bash
backend/venv/bin/python -m pip install -r packaging/requirements-build.txt
./packaging/build_macos_app.sh
```

완성된 파일은 바탕화면의 `Trade Journal/macOS/Trade-Journal-macOS.zip`입니다. 이 압축 파일에는 API Key, 매매일지 DB, 시장 데이터, 마스터 키가 포함되지 않습니다. 사용자가 앱을 열면 로컬 주소(`127.0.0.1`)에서만 실행되고, 거래 DB는 `~/Library/Application Support/Trade Journal Free`에 저장됩니다. API Key는 macOS Keychain에 저장됩니다. 앱을 다시 실행하면 새 서버를 중복으로 띄우지 않고 기존 화면을 엽니다.

Windows x64용은 GitHub Actions의 `Build Windows Distribution` 워크플로를 수동 실행해 생성합니다. 결과물은 Actions 실행 화면의 `Trade-Journal-Windows-x64` artifact에서 내려받을 수 있습니다. Windows에서는 거래 DB가 `%APPDATA%\Trade Journal Free`에, API Key는 Windows Credential Manager에 저장됩니다. Windows 패키지는 Windows runner에서 빌드해야 하며 macOS에서 교차 빌드하지 않습니다.

### Windows 코드 서명

공개 배포본은 Authenticode PFX 인증서로 `Trade Journal.exe`를 서명한 뒤 timestamp 검증까지 수행합니다. GitHub 저장소의 `Settings → Secrets and variables → Actions`에 아래 값을 등록합니다.

| 종류 | 이름 | 값 |
| --- | --- | --- |
| Secret | `WINDOWS_CERTIFICATE_BASE64` | 코드 서명용 `.pfx` 파일 전체를 Base64로 인코딩한 값 |
| Secret | `WINDOWS_CERTIFICATE_PASSWORD` | PFX 비밀번호 |
| Variable | `WINDOWS_SIGNING_REQUIRED` | 공개 릴리스에서는 `true` |

`WINDOWS_SIGNING_REQUIRED=true`인데 인증서가 없거나 검증에 실패하면 Windows 배포 빌드는 실패합니다. 개인 테스트 빌드는 이 변수를 비워 둘 수 있지만, unsigned 파일에는 SmartScreen 경고가 표시될 수 있습니다. 인증서와 비밀번호는 `.env`, 코드, GitHub Actions 로그에 직접 넣지 않습니다.

### Windows 테스트 버전 실행 안내

현재 제공되는 Windows 테스트 버전은 코드 서명이 없을 수 있습니다. 따라서 처음 실행할 때 Microsoft Defender SmartScreen에 **“Windows의 PC 보호” 또는 “인식할 수 없는 앱의 시작을 차단했습니다”**라는 메시지가 표시될 수 있습니다. 이는 테스트 파일의 게시자를 Windows가 아직 확인하지 못했다는 뜻입니다. 반드시 공식 [trade-journal-free 저장소](https://github.com/alfredcho91-ux/trade-journal-free)의 다운로드 파일인지 확인하세요.

1. 내려받은 `Trade-Journal-Windows.zip`을 우클릭하고 `속성`을 엽니다. `차단 해제` 항목이 보이면 체크한 뒤 `적용`을 누릅니다.
2. ZIP 압축을 풀고 압축을 푼 폴더에서 `Trade Journal.exe`를 실행합니다.
3. SmartScreen 화면이 나타나면 `추가 정보`를 누른 뒤 `실행`을 선택합니다.
4. 앱이 실행되면 브라우저에 열리는 로컬 화면에서 거래소 연결과 동기화를 진행합니다.

SmartScreen을 끄거나 Windows 실시간 보호를 해제할 필요는 없습니다. 파일 출처가 공식 저장소와 다르거나 파일이 변조된 것으로 보이면 실행하지 마세요.

## 지원 거래소

| 거래소 | 연동 방식 | Passphrase |
| --- | --- | --- |
| Deepcoin | 종료 포지션 API | 필요 |
| Binance | CCXT 체결 기록 재구성 | 불필요 |

모든 연동은 읽기 전용 API를 전제로 하며, 주문 실행이나 출금 기능은 포함하지 않습니다. 거래소에서 API 권한을 만들 때 거래·출금·자산 이동 권한은 반드시 끄세요.

## 제공 기능

- Deepcoin SWAP, Binance SWAP 읽기 전용 동기화
- 거래소 선택과 동기화 종목 직접 지정
- 거래별 순수익률·순수익금·수수료·펀딩·보유시간 기록
- Lightweight Charts 기반 진입/청산 차트 복기
- RSI, MACD, Stoch RSI, Slow Stochastic 3종 진입·청산 시점 비교
- MFE/MAE, Weekly/Daily/4H Regime, 진입·청산 품질 분석
- 투자금 순수익률 30% 또는 방향 반영 가격 수익률 3% 이상인 대성공 거래와, 큰 투자금 손실 또는 큰 가격 역행이 발생한 대실패 거래 분석
- Risk Lab: 손절 사후 분석, Stop 최적화, 코인 가격 기준 N% 손절 기대값, SL/TP 조합 시뮬레이션
- 계획 분석: 실제 Entry 기준 SL/TP 경로 재생, TP2 선택 시 고정 50/50 분할 청산, Actual/Plan Expectancy, Execution Delta, 행동별 손익 누수, Setup·방향·시장상황 비교, 70/30 시계열 검증
- Trading Review는 새 분석 엔진이 아니라 기존 Quality Analysis·Behavior Analysis·Plan Lab의 공식 결과를 표시용으로만 조립하는 Executive Summary입니다. 강점은 공식 R 표본이 있는 시장상황끼리 평균 R로 비교하며, Plan Lab의 무거운 경로 재생·Optimizer는 매매분석 진입 시 자동 실행하지 않고 이미 같은 기간·방향으로 불러온 결과만 재사용합니다. 최소 순수익률 필터는 Plan Lab 미지원 범위로 명확히 표시합니다.
- 현재 시장과 과거 거래의 유사도 비교
- 매매분석 상단의 최소 순수익률 필터: 투입 증거금 대비 순수익률 절대값이 입력값 이하인 종료 거래를 통계에서 제외
- 거래 리포트: 실제 보유 구간의 최대 유리 움직임, 진입가 재도달, 이후 최대 불리 움직임과 실제 청산을 5분/15분봉으로 복기
- 거래 리포트의 RSI 선은 축소 화면에서도 확인할 수 있도록 다른 기준선보다 굵게 표시
- 매매일지·매매분석·Risk Lab의 상세 분석 영역은 처음부터 펼쳐진 상태로 표시

이 프로그램은 주문 생성·수정·취소·출금 API를 호출하지 않습니다. 모든 거래소 키는 반드시 Read Only로 생성하세요.

## 가장 쉬운 실행: Docker

1. `.env.example`을 `.env`로 복사하고 `CREDENTIAL_MASTER_KEY`에 아래 생성 명령의 결과를 넣습니다. 이 파일은 Git에서 제외됩니다.

```bash
python3 -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
```

2. 아래 명령을 실행합니다.

```bash
docker compose up --build
```

브라우저에서 `http://localhost:8000`을 열고 매매일지의 `API 연결`에서 거래소를 선택합니다. Docker/서버 모드에서는 읽기 전용 권한을 확인한 키가 `journal/trade_journal.db`에 AES-256-GCM 암호문으로만 저장됩니다. Docker 포트는 기본적으로 `127.0.0.1`에만 열리며, 거래 DB는 `journal/`에 보존됩니다.

## 로컬 개발 실행

요구사항은 Python 3.9 이상과 Node.js 18 이상입니다.

```bash
chmod +x bootstrap.sh dev.sh start.sh
./start.sh
```

- Frontend: `http://localhost:5181`
- Backend/OpenAPI: `http://localhost:8011/docs`

배포 앱을 종료할 때는 화면 오른쪽 위의 전원 아이콘을 누르세요. 브라우저만 닫는 것과 달리 로컬 서버까지 정상 종료합니다. 종료해도 운영체제 보안 저장소의 API Key는 삭제되지 않으며, 연결을 완전히 지우려면 매매일지의 `API 연결` 창에서 별도로 삭제해야 합니다.

기본 포트는 전체 Quant-Lab 앱(`5173/8000`)과 동시에 실행해도 충돌하지 않도록 분리되어 있습니다. `.env`의 `JOURNAL_FRONTEND_PORT`, `JOURNAL_BACKEND_PORT`로 변경할 수 있습니다.

## 환경 변수

| 변수 | 용도 |
| --- | --- |
| `DEEPCOIN_API_KEY` | Deepcoin 읽기 전용 API key. 배포 시 Secret으로만 주입 |
| `DEEPCOIN_SECRET_KEY` | Deepcoin secret |
| `DEEPCOIN_PASSPHRASE` | Deepcoin API passphrase |
| `DEEPCOIN_API_BASE_URL` | 기본값 `https://api.deepcoin.com` |
| `BINANCE_API_KEY`, `BINANCE_SECRET_KEY` | Binance 읽기 전용 API 자격 증명 |
| `{EXCHANGE}_SYMBOLS` | 기본 동기화 종목. 화면에서도 변경 가능 |
| `JOURNAL_DIR` | SQLite/CSV 저장 디렉터리 |
| `APP_ENV` | 로컬은 `development`, 외부 공개는 `production` |
| `DEMO_USERNAME`, `DEMO_PASSWORD` | production Basic Auth 계정 |
| `CREDENTIAL_STORAGE` | `auto`, `keyring`, `encrypted_db`. production의 `auto`는 암호화 DB 사용 |
| `CREDENTIAL_MASTER_KEY` | AES-256-GCM용 32바이트 URL-safe base64 키. 서버 Secret으로만 주입 |
| `TRUST_PROXY_HEADERS` | 신뢰하는 reverse proxy/Cloudflare 뒤에서만 `true` |

`.env`, `journal/*.db`, 인증서·키 파일, 캐시와 시장 데이터는 Git에서 제외됩니다. API 연결 창은 키를 브라우저 저장소에 기록하지 않고 같은 origin의 `/api` 백엔드에만 전송합니다. 데스크톱은 Keychain/Credential Manager, Docker·production 서버는 SQLite의 AES-256-GCM 암호문을 사용합니다. 마스터 키는 DB나 코드에 저장되지 않습니다. 명시적인 환경변수는 보안 저장소보다 우선하며 기존 로컬 `.env`의 거래소 키는 보호 저장소로 이전한 뒤 파일에서 제거합니다.

마스터 키는 로컬에서 다음처럼 생성하고 결과를 배포 Secret에만 등록합니다.

```bash
python3 -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
```

## Cloudflare 배포 준비

Pages는 빌드된 프론트엔드를 제공하고 `/api`를 Workers 또는 별도 FastAPI origin으로 라우팅합니다. 현재 Python FastAPI 자체는 Workers 런타임에서 직접 실행되지 않지만, 저장 암호문은 Workers Web Crypto가 지원하는 AES-256-GCM 형식이라 D1 기반 adapter로 옮길 수 있습니다.

```bash
wrangler secret put CREDENTIAL_MASTER_KEY
wrangler secret put DEMO_PASSWORD
```

`APP_ENV=production`, `CREDENTIAL_STORAGE=encrypted_db`를 설정하고 HTTPS를 종료하는 신뢰 가능한 Cloudflare proxy 뒤에서만 `TRUST_PROXY_HEADERS=true`로 둡니다. Pages와 API는 같은 HTTPS origin을 권장합니다.

## 데이터 기준

- 거래 원본은 선택한 거래소의 읽기 전용 API를 사용합니다.
- Deepcoin은 종료 포지션 API를 사용하고, Binance는 CCXT 체결을 시간순으로 매칭해 완료 포지션을 재구성합니다. 동기화는 timestamp 경계를 겹쳐 재조회하고 거래 ID로 중복 제거합니다. 조회 기간보다 이전에 열린 포지션은 충분한 기존 체결 원장이 없으면 복원이 불완전할 수 있으므로 경고를 확인해야 합니다.
- 종료 포지션은 저널 테이블에, 차트 복기용 개별 체결은 경량 `exchange_executions` 테이블에 분리 저장합니다. 지표 스냅샷은 최초 진입과 종료 시점에만 계산합니다.
- CCXT 커넥터는 선택 기간 이전에 열린 포지션, 거래소가 제공하지 않는 과거 레버리지·펀딩을 완전히 복원하지 못할 수 있으며 UI 경고로 표시합니다.
- 모든 저널 분석 OHLCV는 Binance USDT-M Futures 공개 캔들을 공통으로 사용합니다. 거래소 API는 체결·포지션 동기화에만 사용하며, 리포트와 분석 화면에는 `Binance USDT-M Futures` 출처를 표시합니다.
- 진행중 포지션은 저장된 raw fill의 종료값 유무가 아니라 연결된 각 거래소의 현재 SWAP 포지션 API 결과로만 판정합니다. 과거 종료 체결은 진행중 목록에 포함하지 않습니다.
- 진입 분석에는 진입 전에 완료된 봉만 사용합니다.
- 종료 이후 봉은 추가 홀딩·청산 품질·손절 사후 분석에만 사용합니다.
- `VERIFIED_PRETRADE`는 Revision의 서버 수신 시각이 최초 실제 Entry보다 **엄격히 빠른 경우**에만 부여합니다. 클라이언트가 보낸 과거 시각은 판정에 사용하지 않으며, Entry 이후 입력은 `RETROSPECTIVE`로 남습니다. 사전 Revision이 여러 개면 Entry 직전 마지막 서버 수신 Revision을 사용합니다.
- Plan과 거래의 연결은 한 번 생성되면 다른 거래로 옮길 수 없습니다. 동일 거래에 대한 재요청만 idempotent하게 허용하며, 동기화 시 내부 ID가 바뀌는 경우에는 저장된 거래소 external ID로만 복구합니다.
- 회고 입력 Plan은 당시 기억을 구조화하는 사후 분석 자료입니다. 계획 Entry를 입력받지 않으며 DB에는 `null`로 보존합니다. Execution-only 분석에서만 연결 거래의 실제 Entry에 계획 SL/TP를 적용하고 실제 종료 뒤 최대 40시간까지 경로를 재생합니다. Plan·Revision·거래 Link는 한 트랜잭션으로 저장되어 실패 시 함께 롤백됩니다.
- Entry 또는 분석 Horizon이 5분봉 내부에 있으면 해당 경계 봉을 버리지 않습니다. 경계 봉의 고가·저가가 SL/TP 판정에 영향을 줄 수 있지만 더 낮은 시간 데이터로 순서를 확인할 수 없는 경우 공식 결과는 `NOT_EVALUABLE`로 제외합니다.
- Trading Style Optimizer는 거래를 시간순 70/30으로 나누고 Discovery와 Validation의 `n`과 표본 신뢰도를 각각 계산합니다. Validation 표본이 부족하면 같은 방향이 관찰돼도 검증 완료로 표현하지 않습니다.
- Setup은 현재 안정 ID가 아닌 Revision별 문자열 스냅샷입니다. 이름을 바꾼 새 Revision은 과거 Revision 문자열을 훼손하지 않지만, 이름 변경 전후를 자동으로 같은 Setup으로 합치지는 않습니다.
- 공식 R 집계는 실제 순손익을 계획 위험금(투입 증거금 × 레버리지 × Entry→SL 가격비율)으로 나눈 거래만 사용합니다. 수량·위험금을 신뢰할 수 없는 거래의 가격 기준 R은 참고값으로 분리하며 공식 평균에 섞지 않습니다.
- Setup·방향·시장상황별 공식 차트의 `n`, 근거 거래 ID, drawer 거래 수는 모두 같은 공식 R 표본을 사용합니다.
- 대체 데이터 사용 시 실제 체결 거래소의 가격·거래량과 다를 수 있습니다.

## 검증

```bash
backend/venv/bin/python -m pytest -q backend/tests
cd frontend && npm test
cd frontend && npm run lint
cd frontend && npm run build
```

개발·테스트 의존성은 `backend/requirements-dev.txt`, 실행 의존성은 `backend/requirements.txt`로 분리되어 있습니다.

구조와 API 범위는 [ARCHITECTURE.md](./ARCHITECTURE.md), 보안 배포 기준은 [SECURITY.md](./SECURITY.md)를 참고하세요.

## 라이선스

공개 배포 전에 원하는 허용 범위에 맞는 `LICENSE`를 선택해야 합니다. 상업적 재사용까지 허용하려면 MIT, 개인·비상업 무료 배포만 허용하려면 별도의 freeware 라이선스가 적합합니다.

이 프로그램과 분석 결과는 투자 자문이나 수익 보장이 아닙니다.

## VWAP 편차 분석

거래 리포트는 일간·주간·월간 Anchored VWAP을 HLC3 기준으로 각각 계산하고, 각 앵커의 최근 완료봉 최대 14개 표준편차로 1σ·2σ·3σ 밴드와 현재가의 VWAP 대비 편차를 표시합니다. 200봉 롤링·분기·연간 VWAP은 사용하지 않습니다. 표본 수는 리포트에 함께 표시되며, 결과는 중심권, 상단/하단 확장, 극단적 이격으로 쉽게 구분됩니다. VPVR와는 별도 계산으로 동작합니다. 동기화는 선택 기간 안의 기존 거래도 실제 최초 진입 시각 기준 스냅샷으로 갱신하므로, 과거 기록을 새 기준으로 바꾸려면 그 기록을 포함한 기간으로 다시 동기화해야 합니다.
