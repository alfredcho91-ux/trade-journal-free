# Windows Start Guide

The Windows distribution may be unsigned. On first launch, Microsoft Defender SmartScreen may show **“Windows protected your PC”** or **“Microsoft Defender SmartScreen prevented an unrecognized app from starting.”**

## How to start

1. Download `Trade-Journal-Windows.zip` from the official GitHub Release.
2. Right-click the ZIP and open `Properties`.
3. If an `Unblock` checkbox is shown, select it and click `Apply`.
4. Extract the ZIP completely. Do not run the application from inside the ZIP.
5. Run `Trade Journal\Trade Journal.exe` from the extracted folder.
6. If SmartScreen appears, click `More info`, then `Run anyway`.
7. Use the local browser page that opens to connect an API and sync your history.

Do not disable SmartScreen or Windows real-time protection. Do not run the file if it did not come from the official repository or appears modified.

## How to exit

Click the power icon in the top-right corner of the application to shut down the local server cleanly. Closing the browser does not delete stored API credentials.
