# Windows 실행 안내

현재 Windows 배포 파일은 코드 서명이 없을 수 있습니다. 처음 실행할 때 Microsoft Defender SmartScreen의 **“Windows의 PC 보호”** 또는 **“인식할 수 없는 앱의 시작을 차단했습니다”** 메시지가 표시될 수 있습니다.

## 실행 방법

1. 공식 GitHub Releases에서 `Trade-Journal-Windows.zip`을 내려받습니다.
2. ZIP 파일을 우클릭하고 `속성`을 엽니다.
3. `차단 해제`가 보이면 체크하고 `적용`을 누릅니다.
4. ZIP 압축을 완전히 풉니다. ZIP 안에서 바로 실행하지 마세요.
5. 압축을 푼 폴더의 `Trade Journal\Trade Journal.exe`를 실행합니다.
6. SmartScreen 화면이 나오면 `추가 정보`를 누른 뒤 `실행`을 선택합니다.
7. Trade Journal 전용 창에서 API 연결과 동기화를 진행합니다.

Microsoft Edge WebView2 Runtime이 필요합니다. 실행 시 Runtime이 없다는 안내가 나오면 [Microsoft 공식 페이지](https://developer.microsoft.com/microsoft-edge/webview2/)에서 Evergreen Runtime을 설치한 뒤 다시 실행하세요. Chrome 설치는 필요하지 않습니다.

SmartScreen이나 Windows 실시간 보호를 끌 필요는 없습니다. 파일이 공식 저장소에서 받은 것이 아니거나 변조된 것으로 보이면 실행하지 마세요.

## 종료 방법

창의 X 버튼 또는 화면 오른쪽 위의 전원 아이콘으로 종료하면 로컬 서버와 샘플 작업공간 서버도 함께 종료됩니다. 저장 중에는 완료를 기다려야 하며, 미저장 변경사항은 버릴지 확인합니다. API 자격 증명은 삭제되지 않습니다. 중복 실행하면 기존 창을 다시 표시합니다.
