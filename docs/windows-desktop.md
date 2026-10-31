# Windows dedicated application window

## Scope

Starting with v1.0.29, Windows desktop builds launch in a pywebview 6.2.1 / Edge WebView2 window. React, FastAPI, the database, exchange adapters and financial calculations retain their existing implementations. macOS and explicit browser mode keep the browser launcher.

Run `Trade Journal.exe` with its complete adjacent `_internal` directory. A local preview is built under `Windows/Standalone-preview/`; the ZIP contains the entire application folder and KO/EN guides. Python and Chrome are not required on the destination PC. Microsoft Edge WebView2 Runtime is required; this build does not bundle or automatically install it and never selects MSHTML as a fallback.

## Lifecycle and boundaries

- The native window runs on the main thread, with the loopback-only Uvicorn server in a worker. The launcher waits for server readiness before opening the window.
- The existing profile OS lock remains authoritative. A second launch sends a random per-run activation token to the owner's local activation endpoint and restores its existing window.
- WebView navigation stays within the normal workspace origin or the sample child origin owned by that launcher. External HTTP(S) links open in the default browser. No new permissive CORS or Origin exception was introduced.
- The page bridge exposes only `request_close`. It exposes no file, database, credential or shell operations.
- X, Alt+F4 and the in-app power button use the same cancelable close check. Active React Query mutations block close. Existing beforeunload guards and guards added to the daily journal, report editors and API key form ask before discarding dirty inputs. JavaScript evaluation runs outside the blocking native FormClosing callback to avoid a UI-thread deadlock.
- Closing the window stops the parent server. Its existing lifespan cleanup stops the sample child and cleans its temporary workspace. `TRADE_JOURNAL_NO_BROWSER=1` remains the sample child's headless execution contract.
- WebView storage is under `APP_DATA_DIR/webview`, outside the executable folder. Existing DB and OS vault paths are unchanged. Browser preferences are not imported from Chrome; normal workspace WebView preferences persist separately. Sample origins remain temporary.

## Source and package builds

Install `backend/requirements.txt` and `packaging/requirements-build.txt` into the backend environment, install frontend dependencies and build the frontend. From the repository root, run `python -m backend.desktop` using that environment. `TRADE_JOURNAL_DESKTOP_MODE=browser` opts into the browser launcher; `TRADE_JOURNAL_NO_BROWSER=1` starts only the server.

`packaging/build_windows_app.ps1` builds the frontend and bundles WebView2/.NET bridge assets with PyInstaller. It checks subprocess exit codes, uses `.cache/windows-build` for intermediate output, and checks absolute parent/child paths before removing generated directories or moving the app. `TRADE_JOURNAL_RELEASE_DIR` selects an output directory. A new build must pass the repository's normal release/signing gates before public distribution.

## Verification — 2026-10-31

- Production frontend build and Windows PyInstaller build succeeded. KO/EN start guides are included in the ZIP.
- Backend full suite: 1,106 passed, 1 optional TA-Lib test skipped; 215 existing dependency warnings. Subsequent desktop-only security coverage: all 19 tests passed.
- Frontend: lint and TypeScript passed; full suite passed all 50 files / 505 tests using `npm test -- --pool=threads --maxWorkers=1 --reporter=verbose`. An initial parallel run timed out on 4 tests under memory pressure; two fork-pool retries were interrupted when they stopped progressing. The final thread-pool run completed without changing tests, assertions or timeouts.
- Core imports, route imports, Plan Lab Target R:R isolation and release-version guards passed. The Python guard commands require `PYTHONUTF8=1` on this CP949 console to print their success symbols.
- Source Windows app: first-run screen, same-window sample transition, second launch producing one window, dirty daily-journal close confirmation, cancel retaining the draft, and power-button shutdown from the sample workspace passed.
- Packaged EXE: first-run screen, bundled headless sample child, sample Journal, Trade Report opening, Escape closing the report, and Alt+F4 closing the window passed. Parent/sample listening ports and instance metadata disappeared after shutdown.
- The same EXE was moved to the final `Windows/Standalone-preview` location and launched successfully twice. The normal workspace language setting survived a full close/relaunch. Verification windows were closed afterward; the user's ordinary profile was not opened.
- ZIP content inspection found no user DB, CSV, environment file, private key or log. The included `certifi/cacert.pem` is the public CA trust bundle. ZIP SHA-256: `2F7979AC41303B3A197A11EF4B9EADD41C02882FAD2DF4D2F0DA81CE6E317966`.
- All GUI and subprocess checks used isolated profiles without real exchange credentials. Existing user databases, OS credentials and the prior browser preview were not modified.

## Limitations

- The local preview described above was unsigned. v1.0.29 remains a limited-beta prerelease with the existing release hold; publication does not certify clean-machine or live exchange acceptance. Release assets are built from the tested commit by GitHub Actions, not copied from this pre-version-bump local preview.
- No clean Windows user/VM or missing-WebView2 environment was available. Runtime installation guidance was added, but clean-machine acceptance remains outstanding.
- No live exchange credentials, synchronization or live chart data were exercised. Sample charts are offline fixtures.
- Native report Escape was verified. The Windows accessibility snapshot did not reliably report the focused web element after Tab; automated frontend focus-management tests remain the evidence for detailed Tab/focus behavior.
- macOS native-window packaging and an installer/auto-updater are outside this implementation.
