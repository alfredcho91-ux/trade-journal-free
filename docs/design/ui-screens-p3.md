# P3 화면 정보 계층 정리

검증일: 2026-10-06. **P3 완료. P4 미착수.** Commit/push하지 않았다.

## P3 범위 확인과 감사

`ui-audit-p0.md`의 “우선순위와 중단 지점”에서 P3는 화면별 업무 계층 전환이다.
Journal 목록/요약 → 거래 상세 → 성과 개요 → Analytics/Review → Calendar/Daily →
Playbook/Plan → Risk/Explorer/Hold 순으로 확인하며, 새 기능이나 전역 디자인 시스템
재작성은 포함하지 않는다. P4는 KO/EN 줄바꿈, 아이콘 baseline, 200% 확대,
긴 값/결측/음수와 차트 대비 등의 별도 시각 마무리다.

P0/P1/P2 문서, Git diff, frontend 구조와 각 업무 흐름의 실제 구현을 먼저 확인했다.
작업 시작 시 frontend와 디자인 문서 192개를 `.cache/design-p3/baseline`에 보관하고
SHA-256을 기록했다. P3 diff는 이 기준과 비교하며 기존 P0–P2 diff와 구별했다.

| 기존 감사 항목 / 현재 상태 | P3 조치 | 충돌 가능성과 보존 기준 |
|---|---|---|
| Journal 9개 동등 KPI와 아래 중복 4개, 거래 목록까지 긴 이동 | 핵심 손익·승률·기대값·종료 표본 5개 요약, 나머지 성과·차트·달력 펼치기 | 계산/기간/단위 유지, 스타일별 각 그룹의 상대 순서 유지 |
| 최초 성과 응답 전에 기본 0을 표시 | 기존 query의 pending/error를 상태 문구로 표시 | query/key/재시도/동기화 함수 변경 없음 |
| Journal 제목 이모지와 큰 제목 | 이모지 제거, 기존 페이지 제목 토큰 적용 | 라우팅/컨텍스트/탭 유지 |
| 반복되는 큰 샘플 안내 | 샘플 상태와 돌아가기/다시 시작은 보이고 안내·단계는 펼치기 | first-run, 샘플 생성/전환/acknowledge 처리 유지 |
| 차트 없는 TradeReport의 빈 열과 긴 세부 정보 | 차트 가용성에 따른 표시 배치, 보조 snapshot/복기 펼치기, metric 중첩 테두리 축소 | 차트 데이터·편집 컴포넌트·authority·dirty guard 유지 |
| Plan/Analytics 금융 숫자 왼쪽 정렬, 작은 표 머리 | 숫자와 대응 헤더 오른쪽, 값 13px/헤더 12px 토큰, 표 내부 스크롤 | 표시 함수/정밀도/결측/표본 경고/기존 정렬 기능 유지 |
| Plan 패널 안의 반복 KPI 카드 | 기존 KPI helper의 한 단계 중첩 표면 제거 | KPI 데이터·분석 범위·계획 입력 흐름 유지 |
| Playbook 규칙 그룹 고정 3열과 조건 select 약 61px | 그룹 1→2→3열, 그룹 안의 조건은 세로로 배치 | evaluator/schema/권한/저장 로직 유지 |
| 이미 요약→근거 펼치기가 있는 Analytics/Review | 결과 표의 확인된 문제만 수정, 흐름 재작성 없음 | 진단/표본/인과 한계/실험 handoff 보존 |
| Calendar/Daily 및 Risk/Explorer/Hold의 기존 업무 구분 | 현재 계층과 편집/접기/비교 구조 유지 | 과거 roadmap의 이름만으로 정상 화면을 다시 디자인하지 않음 |

## 변경 파일

제품 코드 7개와 이 문서만 P3에서 수정했다.

- `frontend/src/pages/JournalPage.tsx`
- `frontend/src/features/journal/TradeReportModal.tsx`
- `frontend/src/features/onboarding/WorkspaceExperience.tsx`
- `frontend/src/features/analytics/AnalyticsResults.tsx`
- `frontend/src/pages/PlanLabPage.tsx`
- `frontend/src/features/playbook/PlaybookDialogs.tsx`
- `frontend/src/features/playbook/RuleEvaluatorEditor.tsx`
- `docs/design/ui-screens-p3.md`

새 component, wrapper abstraction, hook, 라이브러리, 토큰을 만들지 않았다.
기존 `AnalysisMetric`의 primary 표시와 `CompactSection`의 접기 옵션만 확장하고
기존 native `details/summary`를 사용했다. 접힌 콘텐츠는 계속 마운트되어 초안과
기존 데이터 조회를 유지하며 P2 focus 관리가 숨겨진 컨트롤을 건너뛴다.
중복 요약의 승률은 더 정밀한 기존 2자리 표시를 남겼다.

## 검증

- Lint, `tsc --noEmit`, production build 통과. 마지막 규칙 reflow 뒤에도 모두 통과.
- Frontend 전체: 첫 병렬 실행은 변경하지 않은 Review Save/Reload 테스트 1개가
  5초 timeout으로 실패, 나머지 486개 통과. 기존 테스트/제한 시간은 그대로 두고
  `npm test -- --maxWorkers=2`로 실행해 48개 파일·487개 테스트 모두 통과했다.
  마지막 규칙 reflow 뒤 같은 전체 명령으로 다시 실행해 48개 파일·487개 모두 통과했다.
- Backend 전체: `venv/Scripts/python.exe -X utf8 -m pytest -q`,
  1070개 통과, TA-Lib 미설치로 비교 1개 skip, 의존성 deprecation 경고 211개.
  기존 테스트의 임시 DB/credential 격리를 사용했다.
- 기존 테스트와 backend/API/데이터 모델은 수정하지 않았다.

Production preview의 가상 샘플 36건, viewport 높이 1000px에서 확인했다.

| 폭 | Journal 문서 폭 | P1 헤더 | Journal 거래 목록 시작 Y | Plan 표 / 내부 영역 폭 |
|---|---:|---:|---:|---|
| 768px | 760px | 56px | 약 1050px | 900 / 686px |
| 1024px | 1016px | 56px | 약 1009px | 900 / 750px |
| 1440px | 1432px | 56px | 약 865px | 990 / 990px |

1440px의 P2 목록 시작은 약 2058px였다. 기본 접힌 상태에서 실측했으며 모든
상세 통계, 차트와 달력은 펼치면 다시 표시된다. 문서 폭의 8px 차이는 scrollbar다.
P1 콘텐츠 폭 728/792/1032px와 헤더 56px를 유지한다. 표 가로 넘침은 내부에 한정한다.

세 폭에서 Journal, 차트 없는 거래 상세, Plan 표, Analytics 결과 표,
추가 규칙/자동 판정이 있는 Playbook drawer를 확인했다.
Playbook 그룹은 각각 1/2/3열이며, 내부 조건 select 폭은 약 471/291/200px다.
Analytics 값·표본 열과 헤더는 오른쪽, 값 13px/헤더 12px이며 계산/원본 표본은 동일하다.
거래 상세는 차트가 없으면 빈 2.2:1 차트 열을 만들지 않고 기록을 2열로 표시한다.
차트가 있거나 로딩 중이면 기존 차트+상세 split 배치를 유지한다.

키보드/interaction:

- Journal 상세 성과와 샘플 안내는 Enter로 열기/닫기, P0 focus ring 표시.
- 접힌 성과에서도 핵심 값/표본과 거래 목록을 읽고, 펼치면 기존 달력·통계를 확인.
- 샘플 안내에서 예시 거래 열기와 기존 거래 목록의 리포트 열기 확인.
- 거래 상세의 닫기 초기 focus, 내부 키보드 이동, snapshot 펼치기,
  Escape 닫기와 예시 열기 버튼 focus 복귀 확인.
- 임시 Setup 초안 입력 → Escape 미저장 확인 → Escape로 확인만 닫기 → 초안 유지 →
  임시 초안 버리기 확인. 실제 저장/삭제를 실행하지 않았다.
- Analytics의 기존 값순 정렬과 표/막대 보기 동작 확인.
- Playbook 규칙 추가/자동 판정 체크, Escape 미저장 확인과 임시 초안 버리기,
  새 전략 버튼으로 focus 복귀 확인. 전략을 저장하지 않았다.
- 기록이 있는 Daily Journal을 세 폭에서 열고, 거래 탭으로 돌아가는 기존 흐름 확인.
- 검증한 샘플 제품 탭의 console error/warn 없음. viewport override는 끝에 해제했다.

스크린샷·실측 JSON·P3 전용 diff는 Git ignored `.cache/design-p3`에 보관했다.

## Self review와 유지한 항목

P3 전용 diff에서 표시 구조/상태/정렬/글씨 크기 변경만 확인했다.
CSS/Tailwind 토큰, App 셸, P2 dialog hook과 차트 세 컴포넌트는 시작 시점과 동일하다.
새 hard-coded 색, gradient, blur, shadow/radius 체계, 모바일 navigation은 없다.
표 내부 최소 폭은 기존 overflow 패턴을 사용하며 페이지 전체 overflow로 숨기지 않는다.
Analytics의 640px 최소 폭은 6열 데이터 표에만 적용한 레이아웃 값이다.
색상·글씨·radius·shadow의 새 hard-coded 값을 만들지 않았다.
query와 mutation, filter 적용 의미, chart/거래 계산, 저장 권한과 미저장 경고는 유지한다.
P4 항목을 선행하지 않았다.

## 한계와 Git

실시간 거래소/외부 가격 데이터/인증정보 저장·삭제는 검증하지 않았다.
샘플은 캔들 및 오픈 포지션을 제공하지 않아 해당 데이터가 있는 split chart와
오픈 포지션 표는 코드 비교와 기존 테스트 기준이며 실제 화면 검증 완료로 주장하지 않는다.
pending/error 화면은 기존 query 상태에 연결했으며 네트워크 지연/오류를 강제로 만들지는 않았다.
TA-Lib 비교, 스크린리더 음성 출력, P4 200% 확대/전체 KO·EN 시각 마무리는 미수행이다.

기존 예시 열기 버튼은 같은 `?sampleTrade=1` URL에서 이미 닫은 리포트를 재열지 않는다.
기존 effect 의존성으로 확인한 동작이며 P3에서 기능을 바꾸지 않았다. 거래 목록의 리포트
버튼은 정상적으로 다시 열 수 있다.

`main` / HEAD `b4e9b54`, upstream 앞/뒤 0/0. 기존 P0–P2 변경을 보존했다.
사용자 승인 전까지 commit/push하지 않는다. **P4는 시작하지 않았다.**
