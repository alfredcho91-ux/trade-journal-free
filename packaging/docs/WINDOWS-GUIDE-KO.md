# Windows 실행 안내

현재 Windows 배포 파일은 코드 서명이 없을 수 있습니다. 처음 실행할 때 Microsoft Defender SmartScreen의 **“Windows의 PC 보호”** 또는 **“인식할 수 없는 앱의 시작을 차단했습니다”** 메시지가 표시될 수 있습니다.

## 실행 방법

1. 공식 GitHub Releases에서 `Trade-Journal-Windows.zip`을 내려받습니다.
2. ZIP 파일을 우클릭하고 `속성`을 엽니다.
3. `차단 해제`가 보이면 체크하고 `적용`을 누릅니다.
4. ZIP 압축을 완전히 풉니다. ZIP 안에서 바로 실행하지 마세요.
5. 압축을 푼 폴더의 `Trade Journal\Trade Journal.exe`를 실행합니다.
6. SmartScreen 화면이 나오면 `추가 정보`를 누른 뒤 `실행`을 선택합니다.
7. 브라우저에 열리는 로컬 화면에서 API 연결과 동기화를 진행합니다.

SmartScreen이나 Windows 실시간 보호를 끌 필요는 없습니다. 파일이 공식 저장소에서 받은 것이 아니거나 변조된 것으로 보이면 실행하지 마세요.

## 종료 방법

프로그램 화면 오른쪽 위의 전원 아이콘을 누르면 로컬 서버까지 정상 종료됩니다. 브라우저만 닫아도 API 자격 증명은 삭제되지 않습니다.
