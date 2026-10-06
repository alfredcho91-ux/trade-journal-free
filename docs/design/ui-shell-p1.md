# P1 셸 레이아웃 정리

검증일: 2026-10-06. **P1 완료, P2 미착수.**

## 감사와 변경 범위

`ui-audit-p0.md`, `frontend/src/index.css`, `frontend/tailwind.config.js`와
기존 P0 diff를 검토했다. P1 제품 코드 변경은 `frontend/src/App.tsx` 하나다.
P0 CSS·Tailwind 설정·감사 문서는 작업 시작 시점의 SHA-256과 동일하다.
새 CSS, 토큰, 라이브러리, wrapper component를 추가하지 않았다.

기존 셸의 문제:

- 헤더 실측 높이는 60.8px인데 사이드 sticky 기준은 69px였다.
- 1440px에서 왼쪽 탐색 192px, 오른쪽 피드백 240px가 Journal 폭을 줄였다.
- 피드백 영역의 테두리와 내부 카드 테두리·여백이 중첩됐다.
- 최상위 `overflow-x-hidden`은 세로 scroll container도 만들어 window 기준 sticky를 방해했다.
- 768px의 7열 탐색은 작은 글씨와 truncate에 의존했다.

이번 변경:

- 헤더 56px, 사이드 offset 56px. 전역 버튼은 P0의 최소 컨트롤 높이인 32px,
  radius 토큰을 사용한다. 헤더는 기존 중립 색상 토큰의 불투명 표면이며 blur를 제거했다.
- 종료 상태 문구는 헤더 아래 정상 흐름에 둬 헤더 높이와 sticky 기준이 바뀌지 않게 했다.
  종료 처리 함수와 확인·응답·오류·disabled 동작은 변경하지 않았다.
- 전체 셸 상한은 1680 → 1600px. 좌우 영역은 각각 176px.
  넓은 화면의 최대 Journal 콘텐츠 폭은 1200px로 제한된다.
- 피드백의 내부 카드 테두리·추가 padding·강조 아이콘 색을 제거했다.
  기존 설명, 외부 링크, xl 이상 표시 조건은 유지한다.
- `overflow-x-clip`으로 가로 containment를 유지하면서 window 세로 스크롤을 사용한다.
  사이드 영역은 `self-start` + sticky, viewport 높이 제한과 필요한 경우 자체 스크롤을 사용한다.
- 기존 lg 아래 가로 탐색을 유지하고 P0 control 글씨 크기와 자연 폭을 적용했다.
  한·영 메뉴는 768px에 모두 들어간다. 더 좁을 때는 기존 메뉴 행 내부에서 스크롤한다.
  모바일 메뉴나 모바일 작업 흐름을 새로 만들지 않았다.

## 실측

동일한 production preview, 가상의 샘플 36건, viewport 높이 1000px 기준.
문서의 8px 차이는 세로 scrollbar다.

| 검증 폭 | 문서 폭 | 이전 Journal 콘텐츠 | P1 콘텐츠 | 왼쪽 / 오른쪽 |
|---|---:|---:|---:|---|
| 768px | 760px | 728px | 728px | 숨김 / 숨김 |
| 1024px | 1016px | 776px | 792px | 176px / 숨김 |
| 1440px | 1432px | 952px | 1032px | 176px / 176px |

Journal 목록과 기록이 있는 Daily Journal을 세 폭에서 직접 확인했다.
Daily Journal 필드는 컨테이너 안에 들어가며, 1440px의 기존 2열 구조를 유지한다.
768px 한·영 메뉴 레이블은 잘리지 않고 행 내부 가로 넘침도 없다.
긴 Journal의 맨 아래에서 헤더 top=0, 사이드 top≈56px를 확인했다.

## 검증

| 검사 | 결과 |
|---|---|
| `npm run lint` | 통과, 경고 허용 0 |
| `npx tsc --noEmit` | 통과 |
| `npm test` | 47개 파일 / 483개 테스트 통과 |
| `npm run build` | 통과, TypeScript + Vite, 1636 modules |
| `git diff --check` | 통과 |
| 768 / 1024 / 1440px visual check | Journal·Daily Journal, 페이지 가로 넘침 없음 |
| 전역 액션 | 한·영 전환 및 Risk Lab의 BTC → ETH → BTC 선택 확인 |
| 피드백 링크 | 기존 URL·새 탭 속성 유지, 외부 폼 제출하지 않음 |

최종 변경의 self-review:

- P0 palette·semantic 토큰·공통 card 위치 기준을 유지했다.
- 라우트, navigation handler, selected coin/language 상태, shutdown handler는 동일하다.
- 페이지 내부 KPI·표·필터·폼·차트·dialog는 수정하지 않았다.
- 우측 폭과 경계·강조를 줄이고 메인 읽기/입력 공간을 확보했다.
- CSS/Tailwind 설정에 중복 규칙을 추가하지 않았다.
- 백엔드, API, 데이터 모델, 의존성 변경은 없다.

## 제한사항

- 실시간 거래소·가격 차트·실제 사용자 데이터·저장/삭제 작업은 검증하지 않았다.
  샘플은 가상의 기록이며 시장 가격 차트가 없다.
- 종료 확인 호출 뒤 in-app browser 자동화가 응답하지 않았다.
  확인 취소와 실제 서버 종료 플로우는 완료 검증하지 못했다.
  종료 로직은 수정하지 않았고, 실제 서버 종료는 실행하지 않았다.
- 이 문제 이후의 추가 전체 메뉴 순회 결과는 검증 근거로 사용하지 않았다.
- 모바일 지원과 새 Windows 사용자/VM 검증은 이번 P1 범위에 없다.
- 기존 피드백 영역의 xl 미만 숨김 조건은 유지했다.

증거는 ignored `.cache/design-p1/`의 `journal-before-*.jpg`,
`journal-after-*.jpg`, `journal-english-768.jpg`, `journal-scroll-1440.jpg`,
`daily-after-*.jpg`, `risk-lab-1024.jpg` 및 layout JSON에 있다.

## 다음 단계와 Git

P2 후보는 공유 toolbar/filter/segmented control, chart theme, dialog focus,
공통 error/empty/loading 규칙이다. 이번에는 구현하지 않았다.

`main`, HEAD `b4e9b54`, upstream 대비 ahead/behind 0/0.
P0 기존 변경과 이번 P1 변경은 작업 트리에만 있으며 commit/push하지 않았다.
