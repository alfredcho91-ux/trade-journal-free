# API

`backend/main.py`의 등록 라우터와 각 route 정의 기준입니다. 아래는 제품 API의 method/path 목록이며 전체 요청·응답 필드와 validation 제약은 해당 router/schema 및 실행 중 `/docs`에서 확인합니다. 로컬 개발 기본 주소는 `http://localhost:8011/docs`, Docker 기본은 `http://localhost:8000/docs`이고 desktop은 실제 열린 로컬 포트를 사용합니다.

개발 모드는 loopback 요청만 허용하고 production은 Basic Auth를 요구합니다. credential 저장·삭제는 production에서 HTTPS가 필요합니다. 거래소 읽기 전용은 주문·출금 기능이 없다는 뜻이며 Journal·Plan·Strategy·Experiment 등 로컬 데이터의 쓰기 API는 존재합니다. GET도 일부 repository의 schema 보정이나 Plan link reconciliation을 수행할 수 있으므로 무변경 보장이 아닙니다.

## Journal / Daily Journal

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET | `/api/journal` | 저장된 종료 거래와 내부 체결 조회 |
| DELETE | `/api/journal/{entry_id}` | 저널 기록 삭제 |
| PATCH | `/api/journal/{entry_id}/behavior` | 거래 annotation·심리·legacy 계획 메모 수정 |
| GET | `/api/journal/{entry_id}/planning-context` | 메모·실제 실행·Plan 이력의 읽기 전용 결합; 원본은 별도 |
| GET | `/api/journal/performance` | 기간 성과 집계 |
| GET | `/api/journal/excursions` | 거래별 15분봉 MFE/MAE |
| GET | `/api/journal/current-market` | 현재 시장 스냅샷과 유사 거래 비교 입력 |
| GET | `/api/journal/quality-analysis` | MTF Regime과 진입·청산 품질 |
| GET | `/api/journal/exit-hold-analysis` | 실제 종료 뒤 추가 보유 분석 |
| GET | `/api/journal/behavior-analysis` | 행동·Setup·Mistake 분석 |
| POST | `/api/journal/behavior-analysis/compare` | 조건별 행동 분석 비교 |
| GET | `/api/journal/stop-loss-analysis` | 실제 손절 이후 4H 사후 분석 |
| GET | `/api/journal/stop-optimization` | 고정%·ATR Stop 후보 비교 |
| GET | `/api/journal/sl-tp-analysis` | 5분봉 SL/TP 조합 시뮬레이션 |
| GET, POST | `/api/journal/behavior-rules` | 기존 Journal 행동 규칙 목록·생성 |
| PATCH, DELETE | `/api/journal/behavior-rules/{rule_id}` | 기존 행동 규칙 수정·삭제 |
| GET | `/api/journal/daily` | 날짜 범위의 Daily Journal 목록 |
| GET, PUT, DELETE | `/api/journal/daily/{trade_date}` | 날짜별 준비·회고 조회·저장·삭제 |

## Plan / PlanningContext

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET, POST | `/api/plans` | Plan 목록·독립 계획 생성 |
| POST | `/api/plans/retrospective` | 종료 거래에 회고 Plan·Revision·link를 원자적으로 생성 |
| POST | `/api/plans/in-trade` | 서버가 현재 포지션을 확인한 진행중 계획 생성 |
| GET | `/api/plans/{plan_id}` | Plan과 불변 수정 이력 조회 |
| POST | `/api/plans/{plan_id}/revisions` | 새로운 Revision 추가 |
| POST | `/api/plans/{plan_id}/in-trade-revisions` | 포지션 재검증 후 진행중 Revision 추가 |
| POST | `/api/plans/{plan_id}/link` | 정확한 거래로 연결; 다른 거래로 재연결 불가 |
| PATCH | `/api/plans/{plan_id}/status` | 계획 상태 변경 |
| GET | `/api/plan-lab` | 공식 Plan/Actual 분석·coverage·경로 시뮬레이션·Optimizer |

`/api/journal/{entry_id}/planning-context`는 읽기 전용이며 후보를 자동 연결하지 않습니다. Journal `planned_*` 메모는 PlanRevision이 아닙니다. `VERIFIED_PRETRADE`는 서버 수신 시각이 실제 첫 Entry보다 엄격히 빠른 Revision에만 적용합니다. `RETROSPECTIVE`와 서버 확인된 `IN_TRADE`는 별도 출처이며 actual Entry를 회고 planned Entry로 복사하지 않습니다. 상세 출처·Revision 의미는 [ARCHITECTURE.md](ARCHITECTURE.md)를 참고하세요.

## Strategy / StrategyVersion / Rule Engine

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET, POST | `/api/strategies` | Strategy 목록·생성 |
| GET, PATCH | `/api/strategies/{strategy_id}` | Strategy 조회·메타데이터 수정 |
| POST | `/api/strategies/{strategy_id}/archive` | 보관 처리 |
| POST | `/api/strategies/{strategy_id}/restore` | 보관 해제 |
| GET, POST | `/api/strategies/{strategy_id}/versions` | 버전 목록·새 규칙 버전 생성 |
| GET | `/api/strategies/{strategy_id}/versions/{version_id}` | 정확한 과거/현재 버전 조회 |
| POST | `/api/strategies/{strategy_id}/versions/{version_id}/activate` | 활성 버전 선택 |
| POST | `/api/strategies/{strategy_id}/versions/{version_id}/retire` | 버전 사용 종료 |
| GET, PUT, DELETE | `/api/journal/{journal_entry_id}/strategy-version` | 거래에 정확한 버전 조회·할당·해제 |
| GET | `/api/rule-engine/metadata` | 결정론적 evaluator 메타데이터 |
| GET | `/api/journal/{journal_entry_id}/strategy-evaluation` | 할당 버전의 현재 재구성 평가; 미할당이면 data는 null |

Rule 상태는 `FOLLOWED`, `VIOLATED`, `NOT_EVALUABLE`입니다. 준수율 분모는 평가 가능한 규칙만이며 coverage는 별도입니다. 텍스트 전용 규칙이나 없는 근거는 위반이 아닙니다. Setup 태그를 Strategy identity로 해석하지 않습니다.

## Analytics / Review / Experiments

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET | `/api/analytics/metadata` | 지표·차원·필터 호환성과 제한 |
| POST | `/api/analytics/query` | 검증된 bounded 질의를 단일 읽기 snapshot에서 집계 |
| POST | `/api/review/trading` | 결정론적 통합 Review |
| POST | `/api/review/patterns` | 관찰된 그룹 차이 |
| POST | `/api/review/strategy-execution` | Strategy/실행 근거의 진단 |
| GET, POST | `/api/experiments` | 사용자 실험 목록·초안 생성 |
| GET, PATCH | `/api/experiments/{identifier}` | 정의 조회·revision 확인 후 초안 수정 |
| POST | `/api/experiments/{identifier}/transition` | 사용자 lifecycle 전이 |
| GET | `/api/experiments/{identifier}/measurement` | 같은 그룹의 기준/실험 기간 측정; 결과 저장 없음 |

Guided/Advanced는 같은 Analytics API를 사용합니다. Review는 LLM·인과 추론·예측 API가 아닙니다. 현재 Analytics/Review/Measurement의 `OBSERVED_ASSOCIATION`을 인과 효과로 해석하지 않습니다. Review의 하위 그룹 대 전체 비교와 Experiment의 동일 그룹 기간 간 비교는 다릅니다. Review → Experiment prefill은 프런트엔드 초안 동작이며 자동 저장 endpoint가 따로 있지 않습니다. 행동·가설·판정 기준은 사용자가 정합니다.

## Exchanges / Credentials

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET | `/api/deepcoin/status` | credential 설정 여부와 read_only 모드; 비밀값 없음 |
| GET | `/api/deepcoin/open-positions` | 현재 Deepcoin 포지션 |
| POST | `/api/deepcoin/sync` | 읽기 전용 체결·종료 포지션 동기화 |
| GET | `/api/deepcoin/trade-markers` | 실제 발동 TP 마커 조회 |
| GET | `/api/exchanges` | 지원 거래소와 읽기 전용 연결 상태 |
| GET | `/api/exchanges/executions` | 저장된 개별 체결 |
| GET | `/api/exchanges/open-positions` | 거래소 API가 확인한 현재 포지션 |
| POST | `/api/exchanges/{exchange_id}/credentials` | 연결 확인 후 로컬 읽기 전용 자격 증명 저장 |
| DELETE | `/api/exchanges/{exchange_id}/credentials` | 현재 프로필 credential 삭제; 배포 환경 override는 별도 |
| POST | `/api/exchanges/{exchange_id}/sync` | 선택 거래소 체결·종료 포지션 동기화 |

공개 연결 목록은 `service.PUBLIC_SUPPORTED_EXCHANGES`의 Deepcoin·Binance입니다. schema/registry에는 Bybit·OKX 항목도 있지만 공식 배포 지원 목록으로 확대하지 않습니다. 읽기 연결 검증은 주문·출금 권한의 부재를 입증하지 않습니다. credential 상태 조회는 비밀을 반환하지 않지만 자동 암호화 DB 복사를 유발할 수 있습니다. 자동 이전은 원본을 보존하고 명시적 save/delete만 소유한 legacy `.env`를 정리합니다. 실패 시 `EXCHANGE_CREDENTIAL_CLEANUP_PENDING` 등 오류가 발생하며 세부 순서는 [SECURITY.md](SECURITY.md)를 따릅니다.

## Indicators / Trade report

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET | `/api/indicators/trade-report/{coin}/{interval}` | 거래 복기 캔들과 지표 |
| GET | `/api/indicators/projection` | 현재 지표 기준 예상 가격대 |
| GET | `/api/indicators/vpvr/{coin}/{interval}` | Binance kline 기반 VPVR |
| GET | `/api/indicators/vpvr-source/{coin}/{interval}` | VPVR 입력 데이터 검증 |

## Workspace / Desktop

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET | `/api/health` | 서비스 상태 |
| GET | `/api/workspace` | 모드·프로필 identity·첫 실행·거래 수·샘플 상태 |
| POST | `/api/workspace/acknowledge` | 정상 프로필의 onboarding 선택 저장 |
| POST | `/api/workspace/sample` | 로컬 정상 workspace에서 격리 child 시작/재사용; `reset=true`이면 재생성 |
| POST | `/api/desktop/shutdown` | 로컬 desktop server 종료; desktop server가 없으면 409 |

샘플 endpoint는 loopback HTTP의 정상 workspace에서만 진입할 수 있습니다. child는 별도 프로필·DB, disabled credentials, 합성 fixture와 offline 경계를 사용합니다. 샘플에서는 exchange/deepcoin의 비-GET 요청을 403으로 거부합니다. 샘플 exit는 정상 origin으로 돌아가는 프런트엔드 동작이며 별도 exit API는 없습니다. reset/parent shutdown이 child와 소유한 임시 디렉터리를 정리합니다.
