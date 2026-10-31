# Windows Start Guide

The Windows distribution may be unsigned. On first launch, Microsoft Defender SmartScreen may show **“Windows protected your PC”** or **“Microsoft Defender SmartScreen prevented an unrecognized app from starting.”**

## How to start

1. Download `Trade-Journal-Windows.zip` from the official GitHub Release.
2. Right-click the ZIP and open `Properties`.
3. If an `Unblock` checkbox is shown, select it and click `Apply`.
4. Extract the ZIP completely. Do not run the application from inside the ZIP.
5. Run `Trade Journal\Trade Journal.exe` from the extracted folder.
6. If SmartScreen appears, click `More info`, then `Run anyway`.
7. Use the dedicated Trade Journal window to connect an API and sync your history.

Microsoft Edge WebView2 Runtime is required. If the app reports a missing Runtime, install the Evergreen Runtime from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/) and launch again. Chrome is not required.

Do not disable SmartScreen or Windows real-time protection. Do not run the file if it did not come from the official repository or appears modified.

## How to exit

Close the application window or use its power icon to stop both the local server and any sample workspace server. Wait for active operations to complete; unsaved changes require confirmation before discarding. Stored API credentials are retained. Launching again while the app is running restores the existing window.
