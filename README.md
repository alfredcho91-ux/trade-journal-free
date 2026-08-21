# Multi-Exchange Trade Journal Free

여러 거래소의 읽기 전용 거래 기록을 동기화하고 실제 종료 거래를 분석하는 무료 오픈소스 트레이딩 저널입니다. 화면은 `매매일지`와 `매매분석` 두 개만 제공합니다.

## 지원 거래소

| 거래소 | 연동 방식 | Passphrase |
| --- | --- | --- |
| Deepcoin | 종료 포지션 API | 필요 |
| Binance | CCXT 체결 기록 재구성 | 불필요 |
| Bybit | CCXT 체결 기록 재구성 | 불필요 |
| OKX | CCXT 체결 기록 재구성 | 필요 |

모든 연동은 읽기 전용 API를 전제로 하며, 주문 실행이나 출금 기능은 포함하지 않습니다.

## 제공 기능

- Deepcoin, Binance, Bybit, OKX SWAP/SPOT 읽기 전용 동기화
- 거래소 선택과 동기화 종목 직접 지정
- 거래별 순수익률·순수익금·수수료·펀딩·보유시간 기록
- Lightweight Charts 기반 진입/청산 차트 복기
- RSI, MACD, Stoch RSI, Slow Stochastic 3종 진입·청산 시점 비교
- MFE/MAE, Weekly/Daily/4H Regime, 진입·청산 품질 분석
- 투자금 순수익률 30% 또는 방향 반영 가격 수익률 3% 이상 대성공 거래 분석
- 손절 사후 분석, Stop 최적화, 코인 가격 기준 N% 손절 기대값, SL/TP 조합 시뮬레이션
- 현재 시장과 과거 거래의 유사도 비교

이 프로그램은 주문 생성·수정·취소·출금 API를 호출하지 않습니다. 모든 거래소 키는 반드시 Read Only로 생성하세요.

## 가장 쉬운 실행: Docker

1. `.env.example`을 `.env`로 복사합니다.
2. 사용할 거래소의 읽기 전용 API key와 secret을 `.env`에 입력합니다. Deepcoin과 OKX는 passphrase도 필요합니다.
3. 아래 명령을 실행합니다.

```bash
docker compose up --build
```

브라우저에서 `http://localhost:8000`을 엽니다. Docker 포트는 기본적으로 `127.0.0.1`에만 열리며, 거래 DB는 `journal/`에 보존됩니다.

## 로컬 개발 실행

요구사항은 Python 3.9 이상과 Node.js 18 이상입니다.

```bash
chmod +x bootstrap.sh dev.sh start.sh
cp .env.example .env
./start.sh
```

- Frontend: `http://localhost:5181`
- Backend/OpenAPI: `http://localhost:8011/docs`

기본 포트는 전체 Quant-Lab 앱(`5173/8000`)과 동시에 실행해도 충돌하지 않도록 분리되어 있습니다. `.env`의 `JOURNAL_FRONTEND_PORT`, `JOURNAL_BACKEND_PORT`로 변경할 수 있습니다.

## 환경 변수

| 변수 | 용도 |
| --- | --- |
| `DEEPCOIN_API_KEY` | Deepcoin 읽기 전용 API key |
| `DEEPCOIN_SECRET_KEY` | Deepcoin secret |
| `DEEPCOIN_PASSPHRASE` | Deepcoin API passphrase |
| `DEEPCOIN_API_BASE_URL` | 기본값 `https://api.deepcoin.com` |
| `BINANCE_API_KEY`, `BINANCE_SECRET_KEY` | Binance 읽기 전용 API 자격 증명 |
| `BYBIT_API_KEY`, `BYBIT_SECRET_KEY` | Bybit 읽기 전용 API 자격 증명 |
| `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` | OKX 읽기 전용 API 자격 증명 |
| `{EXCHANGE}_SYMBOLS` | 기본 동기화 종목. 화면에서도 변경 가능 |
| `JOURNAL_DIR` | SQLite/CSV 저장 디렉터리 |
| `APP_ENV` | 로컬은 `development`, 외부 공개는 `production` |
| `DEMO_USERNAME`, `DEMO_PASSWORD` | production Basic Auth 계정 |

`.env`, `journal/*.db`, 캐시와 시장 데이터는 Git에서 제외됩니다. 키를 브라우저나 GitHub에 입력하지 마세요.

## 데이터 기준

- 거래 원본은 선택한 거래소의 읽기 전용 API를 사용합니다.
- Deepcoin은 종료 포지션 API를 사용하고, Binance·Bybit·OKX는 CCXT 체결을 시간순으로 매칭해 완료 포지션을 재구성합니다.
- CCXT 커넥터는 선택 기간 이전에 열린 포지션, 거래소가 제공하지 않는 과거 레버리지·펀딩을 완전히 복원하지 못할 수 있으며 UI 경고로 표시합니다.
- 캔들, 보조지표, VPVR, VWAP은 Binance Spot OHLCV를 사용합니다.
- 진입 분석에는 진입 전에 완료된 봉만 사용합니다.
- 종료 이후 봉은 추가 홀딩·청산 품질·손절 사후 분석에만 사용합니다.
- 분석용 Binance Spot 시세와 실제 체결 거래소의 가격·거래량은 다를 수 있습니다.

## 검증

```bash
backend/venv/bin/python -m pytest -q backend/tests
cd frontend && npm test
cd frontend && npm run lint
cd frontend && npm run build
```

구조와 API 범위는 [ARCHITECTURE.md](./ARCHITECTURE.md), 보안 배포 기준은 [SECURITY.md](./SECURITY.md)를 참고하세요.

## 라이선스

공개 배포 전에 원하는 허용 범위에 맞는 `LICENSE`를 선택해야 합니다. 상업적 재사용까지 허용하려면 MIT, 개인·비상업 무료 배포만 허용하려면 별도의 freeware 라이선스가 적합합니다.

이 프로그램과 분석 결과는 투자 자문이나 수익 보장이 아닙니다.
