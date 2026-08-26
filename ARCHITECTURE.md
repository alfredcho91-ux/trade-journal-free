# Architecture

Trade Journal은 저널, 거래 분석, 위험 관리 분석에 필요한 경로만 남긴 React/FastAPI 애플리케이션입니다.

현재 배포 버전: `v1.0.15`

```text
Browser / Desktop WebView
  -> React: /journal, /trade-analysis, /risk-lab, /plan-lab, /hold-reentry, /trade-explorer
  -> same-origin /api
FastAPI
  -> journal: 저장·기간 성과·MFE/MAE·품질·손절·SL/TP 분석
  -> plan_lab: 회고/사전 계획·불변 Revision·거래 연결·Historical Counterfactual·70/30 Optimizer
  -> exchanges: 공통 거래소 목록·연결 검증·읽기 전용 동기화
     -> deepcoin: native 종료 포지션·TP 마커
     -> ccxt adapter: Binance 조회·정규화
     -> reconstruction: 체결 기반 종료 포지션 재구성
     -> sync service: 스냅샷·저장 오케스트레이션
  -> indicators: 선택 거래소 거래 복기 차트·VPVR·VWAP
  -> core: RSI·MACD·Stochastic·ADX·VPVR 계산
  -> credential policy
     -> deployment environment secret
     -> desktop Keychain / Credential Manager
     -> server AES-256-GCM encrypted SQLite record
  -> JOURNAL_DIR/trade_journal.db
     -> journal_entries: 종료 포지션과 분석 스냅샷
     -> exchange_executions: 분할 진입·청산 차트 마커
     -> exchange_credentials: 서버 배포용 AES-GCM 암호문
     -> trading_plans: 거래와 독립된 계획 본체
     -> trading_plan_revisions: 서버 수신 시각이 포함된 불변 수정 이력
     -> trading_plan_links: journal external identity를 함께 보존하는 거래 연결
```

## 프런트엔드

- `frontend/src/App.tsx`: 데스크톱 왼쪽 메뉴, 코인 선택, 언어 전환 제공
- `frontend/src/pages/JournalPage.tsx`: 저널 쿼리·기간·모달 상태 조립. 거래소 동기화 성공 뒤 거래 목록·기간 성과·품질 분석을 즉시 다시 조회하며, 종료 포지션이 없으면 체결 동기화 성공과 분석 가능 여부를 구분해 안내
- `frontend/src/features/journal/ExchangeConnectionModal.tsx`: API 입력과 연결 검증 UI
- `frontend/src/features/journal/JournalSyncPanel.tsx`: 거래소·상품·종목 선택 UI
- `frontend/src/features/journal/useExchangeConnection.ts`: 거래소 연결 상태·저장·삭제 mutation. 아직 연결되지 않았던 거래소의 첫 저장 성공 시 최근 30일을 한 번 자동 동기화하도록 `JournalPage`에 알림
- `frontend/src/features/journal/exchangeQueryKeys.ts`: 거래소 상태 React Query key
- `frontend/src/pages/TradeAnalysisPage.tsx`: Trading Review Executive Summary와 승패·대성공·대실패·진입·청산 품질, 계획/실수/규칙 준수 행동 분석. Review는 Quality/Behavior의 기존 React Query 결과와 이미 캐시된 Plan Lab 결과만 표시한다.
- `frontend/src/features/tradeAnalysis/TradingReview.tsx`: 공식 행동 누수·시장 상황 강점·Plan 실행 요약을 재계산 없이 카드와 근거 거래 이동으로 변환하는 표시용 adapter/UI
- `frontend/src/pages/RiskLabPage.tsx`: 손절·Stop 최적화·N% Stop·SL/TP 분석
- `frontend/src/pages/PlanLabPage.tsx`: 과거 계획 순차 입력, 검증된 사전 계획, Actual/Plan KPI, 행동별 Delta, Setup·방향·시장상황, 70/30 Optimizer와 근거 거래 drill-down
- `frontend/src/features/planLab/PlanLabCharts.tsx`: 동일 표본 Actual/Plan 누적 R, 실행 차이·분포 시각화
- `frontend/src/features/journal/`: 기간·행 표시 수익률·리포트 조립. 기간 집계 공식은 백엔드를 사용
- `frontend/src/features/tradeAnalysis/`: 백엔드 분석 결과의 표시·필터·차트 UI. 성과·품질·행동·위험 분석의 기준 집계는 백엔드가 담당
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
- `backend/modules/exchanges/service.py`: API가 호출하는 공개 서비스 경계와 현재 SWAP 포지션 조회
- `backend/modules/deepcoin/`: Deepcoin 고유 서명 API와 TP/SL 주문 상세
- `backend/modules/journal/`: SQLite 저장소와 분석 서비스
- `backend/modules/plan_lab/repository.py`: 독립 Plan, 불변 Revision, stable trade link. `server_received_at < first_actual_entry_at`인 Revision이 있을 때만 `VERIFIED_PRETRADE`로 분류
- `backend/modules/plan_lab/analysis.py`: 기존 완료 5분봉 경로를 실제 Entry 가격 기준으로 재사용하는 Counterfactual, 상호배타 대표 행동, Actual/Plan 동일 표본 집계와 70/30 Optimizer
- `backend/modules/indicators/`: 거래 리포트와 시장 지표
- `backend/modules/journal/market_data.py`: 저널 분석 전용 Binance USDT-M Futures OHLCV 단일 소스
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
- `JournalPage`는 API 집계값을 표시하고, 개별 행의 표시용 수익률과 차트 좌표만 계산합니다.
- `TradeAnalysisPage`의 최소 절대 순수익률 필터는 투입 증거금 대비 순수익률 절대값이 기준 이하인 종료 거래를 백엔드 품질 분석 표본과 프런트 상세 표본에서 함께 제외하며, 기본값 0%는 전체 거래입니다.
- `behavior_analysis.py`는 기존 품질 분석의 진입 당시 확정봉 Regime과 사후 MFE/MAE를 재사용합니다. 계획 SL/TP·Setup·Mistake는 거래소 동기화 필드와 분리해 저장하며, 규칙 준수는 진입 전에 기록된 계획과 진입 당시 완료된 추세만 사용합니다.
- Plan Lab의 `VERIFIED_PRETRADE`는 클라이언트 시각이 아니라 서버 수신 시각과 최초 실제 Entry를 엄격 비교합니다. `planInitial`은 첫 Revision, `planEffectiveAtEntry`는 Entry보다 먼저 수신된 마지막 Revision입니다. Entry 이후 입력은 과거 시각 metadata를 보내도 `RETROSPECTIVE`입니다.
- 회고 Plan은 그 거래의 최신 Revision을 분석 대상으로 사용하되 source를 사전 기록으로 승격하지 않습니다. 기존 DB link도 조회 시 서버 수신 시각으로 재검증합니다.
- Plan Simulation은 기존 완료 5분봉 경로와 최초 barrier 판정을 재사용하고 계획 Entry가 아닌 **실제 Entry**에 SL/TP를 적용합니다. 기본 관찰 구간은 실제 종료 후 경과시간 40시간이며 사용자 최대 보유시간이 있으면 이를 적용합니다. Entry/Horizon/Actual Exit이 봉 내부에 있으면 경계 봉을 보존하되 그 봉의 고가·저가가 barrier 결과에 영향을 줄 수 있으면 `NOT_EVALUABLE`로 제외합니다. MFE·목표 보정은 관찰 불가능한 Entry/Horizon 부분 봉의 극값을 사용하지 않습니다. 완전 봉에서 TP와 SL이 함께 닿으면 `AMBIGUOUS`, 평가 구간 내 미도달은 `UNRESOLVED`입니다.
- Plan Expectancy·Actual Expectancy·Execution Delta는 계획 위험 USDT를 신뢰할 수 있는 거래만 집계합니다. 가격 기준 R fallback은 별도 coverage로만 표시합니다.
- Plan ↔ Trade link는 생성 후 불변입니다. 동일 거래 재요청은 idempotent하고 다른 거래로의 재연결은 거부합니다. 동기화 후 내부 journal ID 복구는 기존 external ID가 일치할 때만 수행합니다.
- Setup·방향·시장상황 집계의 공식 `n`과 chart/drill-down `journal_ids`는 같은 USDT R 표본을 사용합니다. 전체 그룹 ID는 별도 `all_journal_ids`로만 보존합니다.
- 대표 실행 행동은 거래당 하나만 배정해 Delta 합계의 중복을 막고, 부가 관찰 태그는 별도 집계합니다. Optimizer는 시간순 Discovery 70%와 Validation 30% 각각의 `n`·표본 신뢰도를 독립 계산합니다.
- Setup은 현재 Revision의 문자열 스냅샷이며 stable setup ID, rename, delete API가 없습니다. 따라서 과거 문자열은 보존되지만 이름 변경 전후 자동 병합은 지원하지 않습니다.
- 품질 분석 응답은 요약·Regime·홀딩·가상 청산·거래 항목별 Pydantic 모델로 검증합니다.
- `frontend/src/features/tradeAnalysis/`는 백엔드가 계산한 Regime, MFE/MAE, Stop, SL/TP 결과를 기준값으로 사용합니다. 선택된 화면 표본의 승패 지표 비교·유사도·표시용 요약과 필터는 브라우저에서 계산하므로, 이 영역은 백엔드의 전체 기간 집계와 목적이 다릅니다.
- Trading Review는 별도 `/trading-review` API나 새 Quant 계산을 만들지 않습니다. Behavior 카드는 Behavior Analysis가 누적 실현손실 USDT로 정렬한 `biggest_leaks` 순서·값·evidence IDs를 그대로 사용합니다. 강점 카드는 동일 방향 Quality Regime 중 공식 R 표본 신뢰도가 `보통` 이상인 항목만 평균 R로 비교하고, 근거 거래도 `r_multiple`이 있는 같은 표본으로 제한합니다. Plan 카드는 동일 기간·방향의 Plan Lab cache가 있을 때만 공식 Plan/Actual Expectancy와 Execution Delta를 보여 주며, 대표 실행 차이는 Plan Lab의 `largest_execution_gap`/`BEHAVIOR_GAP` 진단 source를 사용합니다. 로딩, 오류, 캐시 미적재, 최소 순수익률 필터 미지원, 공식 표본 부족은 서로 다른 상태로 표시합니다.
- 근거 거래 이동은 기간·방향·최소 절대 순수익률·evidence IDs를 함께 전달합니다. Trade Explorer에서 evidence-only 필터를 해제해도 원래 최소 수익률 범위로 Quality Analysis와 거래 목록을 복원합니다.

## 분석 시점

진입 feature는 진입 전에 완료된 candle만 사용합니다. 거래 종료 이후 데이터는 MFE/MAE, 추가 홀딩, 가상 청산, 손절 사후 분석에만 사용해 look-ahead bias가 진입 분석에 섞이지 않도록 분리합니다.

## VWAP 분석 경계

`core/indicator_primitives.py`의 `compute_vwap_standard_deviation`이 일간·주간·월간 Anchored VWAP별 HLC3, Length 14 표준편차, 실제 사용 완료봉 수(`sample_count`), 현재 σ 위치와 1σ·2σ·3σ 밴드를 공통 계산합니다. 거래 리포트 응답의 `vwap_deviations`에 세 앵커의 VWAP·표준편차·표본 수·σ·구간·밴드를 담고, 화면은 이를 한 묶음으로 표시합니다. 종료 포지션의 진입 분석 스냅샷은 종료 시각이 아니라 알려진 최초 진입 시각(`cTime`)까지의 완료봉만 사용합니다. VPVR는 별도 거래량 프로파일 계약으로 유지합니다.

## 시장 데이터와 진행중 포지션

- OHLCV는 모든 저널 분석에서 Binance USDT-M Futures 공개 시장 데이터를 사용합니다. 거래소별 API는 체결·포지션 동기화에만 사용하며, 리포트·분석 응답에 `Binance USDT-M Futures` 출처를 표시합니다.
- MFE/MAE, Stop, SL/TP, VPVR, VWAP, 거래 리포트는 같은 시장 데이터 선택 경로를 공유합니다.
- 진행중 포지션은 raw fill에 `exit_price` 또는 `realized_pnl`이 비어 있는지로 판단하지 않습니다. `/api/exchanges/open-positions`가 Deepcoin native API와 Binance의 CCXT 현재 포지션 API를 조회한 non-zero SWAP 포지션만 반환하며, UI는 그 결과만 표시합니다.
