# Trade Analysis UI/UX Contract

## 05. 매매일지 연계

매매일지의 계획 요약은 Plan Lab의 공식 집계와 같은 표본·용어를 사용합니다.

```text
계획 입력 72/118 · Plan Exp +0.31R · Actual +0.08R · Δ -0.23R
```

- `계획 입력`: 선택 기간 종료 거래 중 Plan이 연결된 거래 수 / 전체 종료 거래 수
- `Plan Exp`: 계획대로 실행했을 때의 공식 비교 표본 거래당 기대 R
- `Actual`: 같은 공식 비교 표본의 실제 거래당 기대 R
- `Δ`: `Actual - Plan`. 음수는 실제 실행이 계획보다 불리했다는 뜻
- 최소 순수익률 필터는 현재 Plan Lab에서 지원하지 않으므로 이 필터가 0보다 크면 Plan KPI 대신 `최소 수익률 필터 미적용` 안내를 표시
- Plan이 없는 거래는 미준수 또는 손실로 간주하지 않음
- `VERIFIED_PRETRADE`는 서버 수신 시각이 최초 실제 Entry보다 빠른 Revision에만 사용
- Entry 이후 입력한 계획은 클라이언트 과거 시각과 무관하게 `RETROSPECTIVE`

CTA 문구는 아래로 통일합니다.

```text
Plan Lab에서 자세히 보기 →
```

Trade Report의 종료 거래에는 `당시 계획 입력` CTA를 제공하며, 저장 전에는 실제 청산·손익·사후 유리/불리 움직임을 노출하지 않습니다.

Plan Lab의 분석은 실제 Entry 가격에 계획 SL/TP를 적용한 Historical Counterfactual입니다. 기본 경로는 실제 종료 뒤 경과시간 40시간까지 확인하며, Trading Style Optimizer의 Discovery/Validation 표본 수와 신뢰도는 각각 따로 표시합니다.

Entry 또는 Horizon이 5분봉 내부에 있으면 경계 봉을 조용히 버리지 않습니다. 해당 봉이 SL/TP 결과에 영향을 줄 가능성이 있으면 공식 결과를 `NOT_EVALUABLE`로 분리하며, Plan ↔ Trade 연결은 동일 거래 재요청 외에는 변경할 수 없습니다.

Setup은 현재 stable ID가 아닌 Revision별 문자열 스냅샷입니다. 이름 변경 전후 자동 병합은 지원하지 않으며, 이 제약은 향후 Setup identity 도입 전까지 UI와 문서에서 명시합니다.
