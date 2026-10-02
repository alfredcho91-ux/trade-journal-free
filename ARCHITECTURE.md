# Architecture

Trade Journal은 저널, 거래 분석, 위험 관리 분석에 필요한 경로만 남긴 React/FastAPI 애플리케이션입니다.

현재 배포 버전: `v1.0.26`

```text
Browser (desktop launcher opens the default browser)
  -> React: /journal, /trade-analysis, /risk-lab, /plan-lab, /hold-reentry, /trade-explorer, /playbook
  -> same-origin /api
FastAPI
  -> journal: 저장·기간 성과·MFE/MAE·품질·손절·SL/TP 분석
     -> Daily Journal: 날짜별 준비·회고
     -> PlanningContext: Journal 메모·Plan 이력·실제 실행의 읽기 전용 조합
  -> plan_lab: 회고/사전 계획·불변 Revision·거래 연결·Historical Counterfactual·70/30 Optimizer
  -> strategies / strategy_assignments: 재사용 전략·버전과 거래별 정확한 버전 할당
  -> rule_engine: 기록된 근거에 대한 결정론적 규칙 평가
  -> analytics -> review: 검증된 질의·동일 snapshot 집계·패턴/전략/실행 진단
  -> experiments: 사용자 정의·상태 관리, Analytics를 통한 기간별 측정
  -> workspace: 첫 실행 상태와 별도 offline sample child 관리
  -> exchanges: 공통 거래소 목록·연결 검증·읽기 전용 동기화
     -> deepcoin: native 종료 포지션·TP 마커
     -> ccxt adapter: Binance 조회·정규화
     -> reconstruction: 체결 기반 종료 포지션 재구성
     -> sync service: 스냅샷·저장 오케스트레이션
  -> indicators: Binance USDT-M Futures 시장 데이터 기반 거래 복기 차트·VPVR·VWAP
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
     -> daily_journal_entries: 날짜별 준비·회고
     -> strategies / strategy_versions / journal_strategy_assignments: 전략·버전·거래 할당
     -> journal_behavior_rules: 기존 Journal 행동 규칙
     -> experiments: 사용자 실험 정의와 lifecycle (측정 결과는 저장하지 않음)
```

## 프런트엔드

`App.tsx`가 위 7개 경로를 등록합니다. `/`와 알 수 없는 경로는 `/journal`로 이동합니다. Daily Journal은 Journal 내부 보기이고, Guided/Advanced Analytics·Review·Experiments는 `/trade-analysis` 내부 영역으로 독립 페이지 경로가 아닙니다. Rule Engine 결과는 거래의 전략 평가와 Analytics/Review에서 사용합니다.

- `frontend/src/App.tsx`: 데스크톱 왼쪽 메뉴, 코인 선택, 언어 전환 제공
- `frontend/src/pages/JournalPage.tsx`: 저널 쿼리·기간·모달 상태 조립. 거래소 동기화 성공 뒤 거래 목록·기간 성과·품질 분석을 즉시 다시 조회하며, 종료 포지션이 없으면 체결 동기화 성공과 분석 가능 여부를 구분해 안내
- `frontend/src/features/journal/ExchangeConnectionModal.tsx`: API 입력과 연결 검증 UI
- `frontend/src/features/journal/JournalSyncPanel.tsx`: 거래소·상품·종목 선택 UI
- `frontend/src/features/journal/useExchangeConnection.ts`: 거래소 연결 상태·저장·삭제 mutation. 아직 연결되지 않았던 거래소의 첫 저장 성공 시 최근 30일을 한 번 자동 동기화하도록 `JournalPage`에 알림
- `frontend/src/features/journal/exchangeQueryKeys.ts`: 거래소 상태 React Query key
- `frontend/src/pages/TradeAnalysisPage.tsx`: Trading Review Executive Summary와 승패·대성공·대실패·진입·청산 품질, 계획/실수/규칙 준수 행동 분석. Review는 Quality/Behavior의 기존 React Query 결과와 이미 캐시된 Plan Lab 결과만 표시한다.
- `frontend/src/pages/PlanLabPage.tsx`: 종료 거래 목록에서 Plan 입력 여부를 확인하고, 선택한 거래의 회고 Plan을 Drawer에서 직접 입력·stable link한 뒤 기존 Actual vs Plan 결과로 연결한다. Cold mount는 `getJournal`과 `getPlans`만 사용하며, `/api/plan-lab`의 경로 재생·Quality·Optimizer는 저장 후 또는 사용자의 명시적 분석 요청 때만 실행한다.
- `frontend/src/features/tradeAnalysis/TradingReview.tsx`: 공식 행동 누수·시장 상황 강점·Plan 실행 요약을 재계산 없이 카드와 근거 거래 이동으로 변환하는 표시용 adapter/UI
- `frontend/src/pages/RiskLabPage.tsx`: 손절·Stop 최적화·N% Stop·SL/TP 분석
- `frontend/src/pages/PlanLabPage.tsx`: 과거 계획 순차 입력, 검증된 사전 계획, Actual/Plan KPI, 행동별 Delta, Setup·방향·시장상황, 70/30 Optimizer와 근거 거래 drill-down
- `frontend/src/pages/PlaybookPage.tsx`: Strategy와 버전별 규칙·활성/과거 버전 관리
- `frontend/src/features/analytics/`: 안내형 질문과 고급 질의 구성이 같은 Analytics API 사용
- `frontend/src/features/review/`: 요약 우선 Review, 전체 근거, 사용자 Experiment 초안과 측정
- `frontend/src/features/planLab/PlanningContextPanel.tsx`: Journal과 Plan Lab에서 원본을 구분하는 공통 계획 보기
- `frontend/src/features/onboarding/`: 첫 실행 선택, 샘플 전환·배너·reset/exit
- `frontend/src/features/planLab/PlanLabCharts.tsx`: 동일 표본 Actual/Plan 누적 R, 실행 차이·분포 시각화
- `frontend/src/features/journal/`: 기간·행 표시 수익률·리포트 조립. 기간 집계 공식은 백엔드를 사용
- `frontend/src/features/tradeAnalysis/`: 백엔드 분석 결과의 표시·필터·차트 UI. 성과·품질·행동·위험 분석의 기준 집계는 백엔드가 담당
- `frontend/src/components/PositionReviewChart.tsx`: Lightweight Charts 가격 차트
- `frontend/src/components/MiniChart.tsx`: 거래 리포트 RSI·지표 미니 차트. RSI 값 선은 기준선보다 굵은 SVG stroke로 표시해 축소 화면 가독성을 유지

## 백엔드

- `backend/modules/exchanges/registry.py`: 지원 거래소와 기능 메타데이터
- `backend/modules/exchanges/ccxt_adapter.py`: CCXT 클라이언트·페이지 조회·체결 정규화
- `backend/modules/exchanges/reconstruction.py`: 동일 signed-fill stream으로 진행중·완료 포지션 lifecycle을 재구성. Binance lifecycle은 계정 범위·symbol·position side·최초 진입 fill에서 결정하며 추가 진입/부분 청산에도 유지
- `backend/modules/exchanges/sync_service.py`: 스냅샷과 저장 오케스트레이션
- `backend/modules/exchanges/execution_repository.py`: 복기와 Binance lifecycle 재현용 account-scoped 원시 체결 경량 저장소
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

`backend/main.py`는 journal, workspace, plan_lab, strategies, strategy_assignments, rule_engine, analytics, review, experiments, exchanges, deepcoin, indicators 라우터를 등록합니다. AI·일반 백테스트·스캐너 라우터는 등록하지 않습니다. 정확한 HTTP 목록은 [API_SPEC.md](API_SPEC.md)를 참고하세요.

## 도메인 소유권과 분석

| 원본 / 경계 | 책임 |
| --- | --- |
| 거래소 실행 / Journal 실행 필드 | 실제 체결·종료 포지션 사실. 사용자 계획과 별도 |
| Journal annotation | 분류·심리·행동·회고 및 legacy `planned_*` 메모. 메모의 `plan_recorded_at`만으로 PlanRevision의 사전 기록을 입증하지 않음 |
| Daily Journal | 날짜별 준비·한도·회고; 거래별 Plan을 대체하지 않음 |
| Plan / PlanRevision | 구조화된 의도와 추가만 가능한 수정 이력, stable trade link |
| PlanningContext | `journal/planning_context.py`의 `mode=ro`, `query_only`, 단일 읽기 transaction. 실제 실행, 검증되지 않은 Journal 메모, entry-time/analysis/latest Revision을 구분. schema 생성·이전·link reconciliation·자동 복사 없음. 후보는 자동 연결하지 않음 |
| Strategy / StrategyVersion | 재사용 전략과 버전별 규칙 정의. 거래는 명시적 StrategyVersion ID에 할당되며 활성 버전 변경이 과거 할당을 대체하지 않음. Setup 문자열과 `setup_tags`는 Strategy identity가 아님 |
| Rule Engine | 등록된 evaluator와 관측값으로 `FOLLOWED` / `VIOLATED` / `NOT_EVALUABLE` 판정. 텍스트만 있는 규칙·없는 근거는 평가 불가. 준수율 = FOLLOWED / (FOLLOWED + VIOLATED), coverage = 평가 가능 / 전체 규칙; 분모가 0이면 해당 값은 null |
| Analytics | `analytics/registry.py`의 지표·차원·필터 계약과 제한을 검증하고 `repository.py`의 단일 읽기 snapshot에서 집계. 기록 누락·평가 불가와 0을 구분 |
| Review / Diagnosis | `review/context.py`에서 공식 Analytics와 Rule Engine 근거를 한 snapshot으로 조합하는 결정론적 review 계층. LLM·새 독립 Quant 엔진·인과 추론·예측 조언이 아님 |
| Experiment / Measure | 사용자 정의 가설·질의·비교 기간·그룹·판정 기준·최소 표본 및 DRAFT/ACTIVE/COMPLETED/CANCELLED 상태. 측정은 동일 그룹·필터의 기간 간 Analytics 비교이며 결과를 저장하지 않음 |

Review 화면은 최대 3개 주요 발견을 먼저 표시하고 전체 결과·사유 코드·표본/coverage 제한을 보존합니다. Review의 패턴은 하위 그룹과 그 그룹을 포함한 전체 표본의 비교입니다. Experiment handoff는 질의·기준 기간·그룹과 일시적인 설명 맥락을 채우며 사용자 행동을 처방하거나 실험을 자동 저장/활성화하지 않습니다. Experiment 측정은 같은 그룹의 기준 기간과 이후 기간을 비교합니다. 나중에 원본 기록이 수정되면 완료된 실험의 측정도 달라질 수 있고 `MET`은 사용자 기준 충족만 뜻합니다.

현재 Analytics/Review/Experiment 응답의 evidence semantics는 `OBSERVED_ASSOCIATION`입니다. UI가 설명할 수 있는 `ESTIMATED_OPPORTUNITY_COST`(추정 기회비용), `COUNTERFACTUAL_SIMULATION`(가정 시뮬레이션)을 이 API의 현재 관측 결과로 바꾸어 붙이지 않습니다. Plan Lab의 역사적 경로 시뮬레이션도 실제 실행 또는 인과 효과와 구분합니다.

## 프로필·샘플·영속화

- `settings.py`는 정상 frozen 실행에서 사용자 app-data를, 정상 소스 실행에서 checkout을 프로젝트 루트로 사용합니다. credential identity는 해석된 app-data·project·Journal·DB 경로로 결정됩니다. canonical packaged normal 프로필만 기존 OS vault namespace를 쓰고 소스/커스텀 경로는 별도 namespace를 씁니다. `.env` 로딩 전 소유권을 확인하며 파일에서 경로가 바뀌어도 이전 프로필에서 로딩한 credential/master key/auth 값을 새 프로필로 가져가지 않습니다.
- `sample/workspace.py`가 allowlist 환경으로 별도 child를 만들고 `sample_policy.py`가 `.env` 평가 전에 ownership token·전용 경로·disabled credentials를 검증합니다. 별도 SQLite·메모리 cache에 결정론적 합성 fixture를 생성합니다. 실제 credential, 거래소 sync, outgoing socket은 차단되고 정상 DB에는 샘플을 삽입하지 않습니다. reset은 parent가 child를 종료·정리하고 새로 생성합니다. 화면 exit는 정상 origin으로 돌아가며 child 정리는 reset 또는 parent 종료 시 이뤄집니다. 상세는 [샘플 문서](docs/isolated-sample-onboarding.md)에 있습니다.
- 스키마 생성·보정은 각 repository에 있고 별도 migrations 디렉터리는 없습니다. `ClosingConnection.__exit__`는 기존 sqlite3 commit/rollback 뒤 finally에서 connection을 닫습니다. 읽기 snapshot은 `contextlib.closing`으로 닫습니다. 연결 종료는 garbage collection에 의존하지 않습니다.
- HTTP GET 자체가 무변경을 보장하지는 않습니다. 일반 repository 조회는 schema 보정을 수행할 수 있고 Plan 목록은 link reconciliation을 수행합니다. PlanningContext·Analytics·Review snapshot의 읽기 경계와 구분합니다.

## CI와 데스크톱 배포

`.github/workflows/test.yml`의 Ubuntu Tests는 backend, frontend install/test/lint/TypeScript/build, Core/Route/Plan Lab/Release Version guard와 별도 TA-Lib regression job을 실행합니다. main push Tests가 성공하면 `windows-package.yml`의 `workflow_run`이 같은 repository·main·push 여부를 확인하고 그 `head_sha`를 `PACKAGE_SHA`로 checkout·검증·패키징합니다. main의 수동 실행도 선택 SHA의 성공한 Tests push 실행을 조회해야 진행합니다. Windows runner에서 ZIP artifact를 올리고 버전 태그가 이미 있으면 Release 게시를 건너뜁니다. 인증서가 설정되면 서명·timestamp를 검증하고 `WINDOWS_SIGNING_REQUIRED=true`이면 미서명 빌드를 거부합니다.

## 보안 경계

- 연결 창은 같은 origin의 백엔드에만 값을 보내며 읽기 조회 성공을 먼저 검증합니다. 쓰기 권한 부재까지 검사하는 것은 아니므로 사용자가 Read Only 키를 발급해야 합니다. 기본 desktop은 OS vault, 마스터 키가 있는 `auto` 또는 production의 `auto`는 AES-256-GCM 암호화 DB를 사용합니다.
- `/api/exchanges` 상태 조회는 거래소별 credential을 한 번만 해석해 연결 여부·저장 위치·저장소 오류를 함께 반환합니다. credential 값은 포함하지 않습니다.
- 암호화 AAD에 거래소 ID와 버전을 묶어 다른 거래소 레코드로 옮긴 암호문의 복호화를 거부합니다. 마스터 키는 환경 설정에서 읽으며 DB에 저장하지 않습니다.
- credential 저장·삭제 endpoint는 production에서 HTTPS를 강제합니다. proxy header는 명시적으로 신뢰할 때만 사용합니다.
- credential endpoint는 키·secret·passphrase를 응답에 반환하지 않습니다.
- 자동 resolution은 배포 환경·기존 보호 저장소를 우선하고, 암호화 DB 이전은 insert-if-absent 및 재조회 검증 후에도 원본 `.env`/vault를 보존합니다. keyring 모드의 legacy `.env`는 명시적 저장 전까지 읽기만 합니다. 상태 GET도 암호화 DB 복사를 유발할 수 있으므로 순수 읽기로 간주하지 않습니다.
- 명시적 save는 보호 저장 뒤 소유한 legacy `.env`를 정리합니다. delete는 legacy 정리 성공 뒤 주 저장소를 삭제하고 다른 저장소는 best-effort로 정리합니다. 정리 실패는 cleanup-pending이며 delete는 주 저장소 삭제 전에 중단합니다. 모두 현재 프로필 범위이고 배포 환경 Secret은 운영 환경에서 별도로 삭제해야 합니다. 자세한 우선순위와 오류 경계는 [SECURITY.md](SECURITY.md)를 참고하세요.
- 거래소 동기화는 체결·포지션·주문 이력의 읽기 전용 endpoint만 사용합니다.
- production은 HTTP Basic Auth 설정 없이는 시작하지 않습니다.
- Docker 기본 포트는 localhost에만 바인딩합니다.
- 패키지 앱은 OS 파일 잠금으로 한 인스턴스만 실행하며 두 번째 실행은 기존 로컬 URL을 다시 엽니다.

## 계산 경계

- 기간 승률, 순손익, 투자금 가중 순수익률, PF, 연승·연패, 방향·종목별 성과는 `journal/performance.py`가 계산합니다.
- `JournalPage`는 API 집계값을 표시하고, 개별 행의 표시용 수익률과 차트 좌표만 계산합니다.
- `TradeAnalysisPage`의 최소 절대 순수익률 필터는 투입 증거금 대비 순수익률 절대값이 기준 이하인 종료 거래를 백엔드 품질 분석 표본과 프런트 상세 표본에서 함께 제외하며, 기본값 0%는 전체 거래입니다.
- `behavior_analysis.py`는 기존 품질 분석의 진입 당시 확정봉 Regime과 사후 MFE/MAE를 재사용합니다. 계획 SL/TP·Setup·Mistake는 거래소 동기화 필드와 분리해 저장하며, 규칙 준수는 진입 전에 기록된 계획과 진입 당시 완료된 추세만 사용합니다.
- Plan Lab의 `VERIFIED_PRETRADE`는 클라이언트 시각이 아니라 서버 수신 시각과 최초 실제 Entry를 엄격 비교합니다. `planInitial`은 첫 Revision, `planEffectiveAtEntry`는 Entry보다 먼저 수신된 마지막 Revision입니다. Entry 이후 입력은 과거 시각 metadata를 보내도 `RETROSPECTIVE`입니다. 별도 `IN_TRADE` 경로는 거래소 open-position API가 서버에서 다시 확인한 포지션에만 허용하며, 실제 Entry를 `revision.entry_price`에 복사하지 않습니다. 활성 `IN_TRADE` Plan은 종료 거래 분석에서 제외됩니다. Deepcoin은 stable posId, Binance는 검증된 flat 경계 뒤 최초 fill에서 만든 deterministic lifecycle ID가 종료 거래와 정확히 같을 때만 자동 연결합니다. 첫 경계가 불확실하면 저장을 제한하고 근사 매칭하지 않습니다.
- 회고 Plan은 그 거래의 최신 Revision을 분석 대상으로 사용하되 source를 사전 기록으로 승격하지 않습니다. 사용자가 계획 Entry를 제공하지 않는 현재 Past Trade UX에서는 Revision의 Entry 필드를 `null`로 저장하고, 실제 Entry는 Execution-only 계산의 기준으로만 사용합니다. 따라서 original planned R:R과 Entry adherence는 평가하지 않습니다. 기존 DB link도 조회 시 서버 수신 시각으로 재검증합니다.
- `trading_plan_revisions.take_profit`은 TP1, 선택 입력 `take_profit_2`는 TP2로 revision마다 보존합니다. TP2가 없으면 기존 단일 TP barrier와 TP1 100% 청산 결과를 그대로 유지합니다. TP2가 있으면 공식 simulation이 `TP1 50% + TP2 잔여 50%` 고정 leg를 생성하고, TP1 이후에도 원래 SL을 유지합니다. TP1 후 TP2/SL 미도달은 공식 Horizon 종가로 잔여 leg를 평가합니다.
- 회고 입력의 Plan·첫 Revision·stable trade link는 하나의 SQLite transaction으로 생성합니다. 중복 link 또는 저장 중 실패가 발생하면 세 레코드를 모두 롤백하며, 의도적으로 미연결 Plan을 만드는 기존 사전 계획 경로는 그대로 유지합니다.
- Plan Simulation은 기존 완료 5분봉 경로를 재사용하고 계획 Entry가 아닌 **실제 Entry**에 SL/TP를 적용합니다. 기본 관찰 구간은 실제 종료 후 경과시간 40시간이며 사용자 최대 보유시간이 있으면 이를 적용합니다. Split Plan에서 TP1/SL 또는 TP1 확정 후 TP2/SL이 같은 봉에 닿거나 경계 부분 봉이 barrier 순서에 영향을 주면 유리한 순서를 추정하지 않고 `NOT_EVALUABLE`로 제외합니다. TP1·TP2가 같은 완료봉에 닿고 SL 충돌이 없으면 순서대로 50%씩 체결합니다. Split Plan의 청산 후 별도 분석은 TP1 이전 상태를 복원할 수 없어 단일 TP로 대체하지 않고 명시적으로 평가 제외합니다.
- 공식 Plan R은 각 leg의 가격 R에 50% 비중과 기존 fee proxy를 적용한 합계이며 denominator는 기존 Planned Risk USDT를 유지합니다. Plan PnL은 이 공식 Plan R과 Planned Risk의 곱으로 노출합니다. Execution Delta, Attribution, Optimizer와 70/30 Discovery/Validation은 별도 TP 계산 없이 같은 `planned_result_r`를 소비합니다. 응답의 `plan_legs`는 exit 가격·시각·비중·가격 R·가중 기여 R/손익을 제공하고 상세 UI는 이 backend 값을 표시만 합니다.
- Plan Expectancy·Actual Expectancy·Execution Delta는 계획 위험 USDT를 신뢰할 수 있는 거래만 집계합니다. 가격 기준 R fallback은 별도 coverage로만 표시합니다.
- Plan ↔ Trade link는 생성 후 불변입니다. 동일 거래 재요청은 idempotent하고 다른 거래로의 재연결은 거부합니다. Deepcoin은 exchange position external ID, Binance는 journal의 별도 `lifecycle_id`가 정확히 일치할 때만 미연결 `IN_TRADE` Plan을 복구합니다. lifecycle 중복 후보는 연결하지 않습니다.
- Setup·방향·시장상황 집계의 공식 `n`과 chart/drill-down `journal_ids`는 같은 USDT R 표본을 사용합니다. 전체 그룹 ID는 별도 `all_journal_ids`로만 보존합니다.
- 대표 실행 행동은 거래당 하나만 배정해 Delta 합계의 중복을 막고, 부가 관찰 태그는 별도 집계합니다. Optimizer는 시간순 Discovery 70%와 Validation 30% 각각의 `n`·표본 신뢰도를 독립 계산합니다.
- Setup은 현재 Revision의 문자열 스냅샷이며 stable setup ID, rename, delete API가 없습니다. 따라서 과거 문자열은 보존되지만 이름 변경 전후 자동 병합은 지원하지 않습니다.
- 품질 분석 응답은 요약·Regime·홀딩·가상 청산·거래 항목별 Pydantic 모델로 검증합니다.
- `frontend/src/features/tradeAnalysis/`는 백엔드가 계산한 Regime, MFE/MAE, Stop, SL/TP 결과를 기준값으로 사용합니다. 선택된 화면 표본의 승패 지표 비교·유사도·표시용 요약과 필터는 브라우저에서 계산하므로, 이 영역은 백엔드의 전체 기간 집계와 목적이 다릅니다.
- Overview 안의 기존 `TradingReview.tsx` 카드는 `/api/review/*`를 사용하는 Review 영역과 별도입니다. 이 카드는 새 Quant 계산을 만들지 않습니다. Behavior 카드는 Behavior Analysis가 누적 실현손실 USDT로 정렬한 `biggest_leaks` 순서·값·evidence IDs를 그대로 사용합니다. 강점 카드는 동일 방향 Quality Regime 중 공식 R 표본 신뢰도가 `보통` 이상인 항목만 평균 R로 비교하고, 근거 거래도 `r_multiple`이 있는 같은 표본으로 제한합니다. Plan 카드는 동일 기간·방향의 Plan Lab cache가 있을 때만 공식 Plan/Actual Expectancy와 Execution Delta를 보여 주며, 대표 실행 차이는 Plan Lab의 `largest_execution_gap`/`BEHAVIOR_GAP` 진단 source를 사용합니다. 로딩, 오류, 캐시 미적재, 최소 순수익률 필터 미지원, 공식 표본 부족은 서로 다른 상태로 표시합니다.
- 근거 거래 이동은 기간·방향·최소 절대 순수익률·evidence IDs를 함께 전달합니다. Trade Explorer에서 evidence-only 필터를 해제해도 원래 최소 수익률 범위로 Quality Analysis와 거래 목록을 복원합니다.

## 분석 시점

진입 feature는 진입 전에 완료된 candle만 사용합니다. 거래 종료 이후 데이터는 MFE/MAE, 추가 홀딩, 가상 청산, 손절 사후 분석에만 사용해 look-ahead bias가 진입 분석에 섞이지 않도록 분리합니다.

## VWAP 분석 경계

`core/indicator_primitives.py`의 `compute_vwap_standard_deviation`이 일간·주간·월간 Anchored VWAP별 HLC3, Length 14 표준편차, 실제 사용 완료봉 수(`sample_count`), 현재 σ 위치와 1σ·2σ·3σ 밴드를 공통 계산합니다. 거래 리포트 응답의 `vwap_deviations`에 세 앵커의 VWAP·표준편차·표본 수·σ·구간·밴드를 담고, 화면은 이를 한 묶음으로 표시합니다. 종료 포지션의 진입 분석 스냅샷은 종료 시각이 아니라 알려진 최초 진입 시각(`cTime`)까지의 완료봉만 사용합니다. VPVR는 별도 거래량 프로파일 계약으로 유지합니다.

## 시장 데이터와 진행중 포지션

- OHLCV는 모든 저널 분석에서 Binance USDT-M Futures 공개 시장 데이터를 사용합니다. 거래소별 API는 체결·포지션 동기화에만 사용하며, 리포트·분석 응답에 `Binance USDT-M Futures` 출처를 표시합니다.
- MFE/MAE, Stop, SL/TP, VPVR, VWAP, 거래 리포트는 같은 시장 데이터 선택 경로를 공유합니다.
- `backend/utils/data_service.py`는 Binance USDT-M 원본의 `volume`(기초자산 수량)을 canonical OHLCV 거래량으로 정규화하고, `quote_volume`·taker-buy volume 필드도 보존합니다. canonical volume이 누락된 원본 봉은 `0`으로 대체하지 않고 unavailable로 제외합니다. 저널 프레임은 이 거래량 의미를 `volume_metadata` attrs로 보존합니다.
- 진입 snapshot과 Regime은 `close_time < entry_time`인 완료봉만 사용하므로, 진입이 진행 중인 봉의 최종 full volume은 entry-time feature로 사용할 수 없습니다. `backend/modules/deepcoin/snapshot.py`의 canonical Entry RVOL20도 같은 완료봉 경계를 사용하며, 마지막 완료봉 거래량을 그 이전 20개 완료봉 평균으로 나눕니다. reference 봉은 baseline에 포함하지 않고, 거래량 누락·20봉 부족·0 평균은 unavailable(`null`)로 유지합니다. RVOL20은 현재 시장 맥락 표시용이며 Quality·Attribution·Optimizer의 공식 feature가 아닙니다.
- 진행중 포지션은 raw fill에 `exit_price` 또는 `realized_pnl`이 비어 있는지로 판단하지 않습니다. `/api/exchanges/open-positions`가 Deepcoin native API와 Binance의 CCXT 현재 포지션 API를 조회한 non-zero SWAP 포지션만 반환하며, UI는 그 결과만 표시합니다.
