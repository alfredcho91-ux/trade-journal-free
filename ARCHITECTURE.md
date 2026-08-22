# Architecture

Trade Journal Free는 저널, 거래 분석, 위험 관리 분석에 필요한 경로만 남긴 React/FastAPI 애플리케이션입니다.

```text
Browser / Desktop WebView
  -> React: /journal, /trade-analysis, /risk-lab
  -> same-origin /api
FastAPI
  -> journal: 저장·기간 성과·MFE/MAE·품질·손절·SL/TP 분석
  -> exchanges: 공통 거래소 목록·연결 검증·읽기 전용 동기화
     -> deepcoin: native 종료 포지션·TP 마커
     -> ccxt adapter: Binance·Bybit·OKX 조회·정규화
     -> reconstruction: 체결 기반 종료 포지션 재구성
     -> sync service: 스냅샷·저장 오케스트레이션
  -> indicators: Binance 거래 복기 차트·VPVR·VWAP
  -> core: RSI·MACD·Stochastic·ADX·VPVR 계산
  -> credential policy
     -> deployment environment secret
     -> desktop Keychain / Credential Manager
     -> server AES-256-GCM encrypted SQLite record
  -> JOURNAL_DIR/trade_journal.db
     -> journal_entries: 종료 포지션과 분석 스냅샷
     -> exchange_executions: 분할 진입·청산 차트 마커
     -> exchange_credentials: 서버 배포용 AES-GCM 암호문
```

## 프런트엔드

- `frontend/src/App.tsx`: 데스크톱 왼쪽 메뉴의 세 화면, 코인 선택, 언어 전환 제공
- `frontend/src/pages/JournalPage.tsx`: 저널 쿼리·기간·모달 상태 조립
- `frontend/src/features/journal/ExchangeConnectionModal.tsx`: API 입력과 연결 검증 UI
- `frontend/src/features/journal/JournalSyncPanel.tsx`: 거래소·상품·종목 선택 UI
- `frontend/src/features/journal/useExchangeConnection.ts`: 거래소 연결 상태·저장·삭제 mutation
- `frontend/src/features/journal/exchangeQueryKeys.ts`: 거래소 상태 React Query key
- `frontend/src/pages/TradeAnalysisPage.tsx`: 승패·대성공·대실패·진입·청산 품질, 계획/실수/규칙 준수 행동 분석
- `frontend/src/pages/RiskLabPage.tsx`: 손절·Stop 최적화·N% Stop·SL/TP 분석
- `frontend/src/features/journal/`: 기간·행 표시 수익률·리포트 조립. 기간 집계 공식은 백엔드를 사용
- `frontend/src/features/tradeAnalysis/`: 브라우저 집계와 분석 UI
- `frontend/src/components/PositionReviewChart.tsx`: Lightweight Charts 가격 차트
- `frontend/src/components/MiniChart.tsx`: 거래 리포트 RSI·지표 미니 차트. RSI 값 선은 기준선보다 굵은 SVG stroke로 표시해 축소 화면 가독성을 유지

## 백엔드

- `backend/modules/exchanges/registry.py`: 지원 거래소와 기능 메타데이터
- `backend/modules/exchanges/ccxt_adapter.py`: CCXT 클라이언트·페이지 조회·체결 정규화
- `backend/modules/exchanges/reconstruction.py`: 분할 체결의 완료 포지션 재구성
- `backend/modules/exchanges/sync_service.py`: 스냅샷과 저장 오케스트레이션
- `backend/modules/exchanges/execution_repository.py`: 복기용 원시 체결 경량 저장소
- `backend/modules/exchanges/credentials.py`: environment·Keychain·암호화 DB 선택, legacy migration, 상태 해석
- `backend/modules/exchanges/encrypted_store.py`: AES-256-GCM 암호문 SQLite adapter
- `backend/modules/exchanges/keyring_store.py`: macOS Keychain/Windows Credential Manager adapter
- `backend/modules/exchanges/legacy_env.py`: 이전 `.env` credential의 원자적 제거
- `packaging/sign_windows_artifact.ps1`: Authenticode 서명·timestamp·검증
- `backend/modules/exchanges/service.py`: API가 호출하는 공개 서비스 경계
- `backend/modules/deepcoin/`: Deepcoin 고유 서명 API와 TP/SL 주문 상세
- `backend/modules/journal/`: SQLite 저장소와 분석 서비스
- `backend/modules/indicators/`: 거래 리포트와 시장 지표
- `backend/modules/journal/market_data.py`: Deepcoin SWAP 우선 OHLCV와 Binance Spot fallback 출처 표기
- `core/indicator_pipelines.py`: 공용 지표 계산
- `core/vpvr.py`: kline 기반 Volume Profile

`backend/main.py`는 저널, 거래소, Deepcoin 고유 기능, 지표 라우터만 등록합니다. AI, 백테스트, 스캐너, 전략 분석 라우터는 무료판에 포함하지 않습니다.

## 보안 경계

- 연결 창은 같은 origin의 백엔드에만 값을 보내며 읽기 전용 조회를 먼저 검증합니다. desktop은 Keychain/Credential Manager, Docker·production은 AES-256-GCM 암호화 DB를 사용합니다.
- 거래소 상태 조회는 credential을 한 번만 해석해 연결 여부·저장 위치·저장소 오류를 함께 반환합니다. API 응답에는 credential 값이 포함되지 않습니다.
- 암호화 AAD에 거래소 ID와 버전을 묶어 다른 레코드로 암호문을 이동할 수 없게 하며, 마스터 키는 환경 Secret에만 존재합니다.
- credential 저장·삭제 endpoint는 production에서 HTTPS를 강제합니다. proxy header는 명시적으로 신뢰할 때만 사용합니다.
- API 응답은 키·secret·passphrase를 반환하지 않습니다.
- 연결 삭제 시 OS vault와 암호화 DB 레코드를 제거합니다. 배포 환경 Secret은 서버 밖에서 별도로 삭제해야 합니다.
- 거래소 동기화는 체결·포지션·주문 이력의 읽기 전용 endpoint만 사용합니다.
- production은 HTTP Basic Auth 설정 없이는 시작하지 않습니다.
- Docker 기본 포트는 localhost에만 바인딩합니다.
- 패키지 앱은 OS 파일 잠금으로 한 인스턴스만 실행하며 두 번째 실행은 기존 로컬 URL을 다시 엽니다.

## 계산 경계

- 기간 승률, 순손익, 투자금 가중 순수익률, PF, 연승·연패, 방향·종목별 성과는 `journal/performance.py`가 계산합니다.
- 프런트엔드는 API 집계값을 표시하고, 개별 행의 표시용 수익률과 차트 좌표만 계산합니다.
- `TradeAnalysisPage`의 최소 절대 순수익률 필터는 투입 증거금 대비 순수익률 절대값이 기준 이하인 종료 거래를 백엔드 품질 분석 표본과 프런트 상세 표본에서 함께 제외하며, 기본값 0%는 전체 거래입니다.
- `behavior_analysis.py`는 기존 품질 분석의 진입 당시 확정봉 Regime과 사후 MFE/MAE를 재사용합니다. 계획 SL/TP·Setup·Mistake는 거래소 동기화 필드와 분리해 저장하며, 규칙 준수는 진입 전에 기록된 계획과 진입 당시 완료된 추세만 사용합니다.
- 품질 분석 응답은 요약·Regime·홀딩·가상 청산·거래 항목별 Pydantic 모델로 검증합니다.

## 분석 시점

진입 feature는 진입 전에 완료된 candle만 사용합니다. 거래 종료 이후 데이터는 MFE/MAE, 추가 홀딩, 가상 청산, 손절 사후 분석에만 사용해 look-ahead bias가 진입 분석에 섞이지 않도록 분리합니다.
