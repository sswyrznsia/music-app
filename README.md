# Pulse Shelf

## Windows icon refresh

- Source PNG: `assets/icons/pulse-shelf-source.png`
- Runtime PNG: `assets/icons/pulse-shelf.png`
- Windows ICO: `assets/icons/pulse-shelf.ico`
- Regenerate the Windows icon with `npm run make:icon`.
- The generated ICO includes `16x16`, `24x24`, `32x32`, `48x48`, `64x64`, `128x128`, and `256x256` images.
- The Windows build uses `assets/icons/pulse-shelf.ico` through `build.win.icon`.
- Existing desktop shortcuts can keep showing a cached old icon. Delete and recreate the shortcut, or make sure the shortcut icon points to `assets/icons/pulse-shelf.ico`.
- If the icon still looks stale, refresh the desktop, restart Explorer, or clear the Windows icon cache.
- Discord Rich Presence art is separate from the Windows app icon.

유튜브 링크를 넣으면 오디오를 로컬 `library/` 폴더에 저장하고, 다음에 앱을 열어도 플레이리스트에서 바로 재생할 수 있는 작은 음악 앱입니다.

## 실행

```bash
npm start
```

브라우저에서 `http://localhost:4173`을 엽니다.
4173 포트가 이미 사용 중이면 앱이 자동으로 다음 포트에서 열리고, 터미널에 실제 주소가 표시됩니다.

Windows 작업 표시줄 진행도와 재생/다음 곡 버튼을 쓰려면 데스크톱 모드로 실행합니다.

```bash
npm run desktop
```

## 필요한 도구

유튜브 오디오 저장에는 `yt-dlp`가 필요합니다. 설치되어 있지 않으면 앱은 실행되지만 새 링크 저장 버튼이 비활성화됩니다.

Windows 설치 예시:

```powershell
pip install yt-dlp
```

## 데이터 위치

- `library/`: 저장된 mp3 파일
- `data/tracks.json`: 플레이리스트 정보

권한이 있는 콘텐츠나 직접 올린 콘텐츠만 저장해 주세요.
## App icon

- 앱 아이콘 PNG: `assets/icons/pulse-shelf.png`
- Windows 빌드 아이콘 ICO: `assets/icons/pulse-shelf.ico`
- Windows 설치 파일을 만들기 전 아이콘을 다시 생성해야 하면 `npm run make:icon`을 실행하세요.
- Windows 아이콘 캐시 때문에 설치 후에도 예전 아이콘이 잠깐 보일 수 있습니다. 이 경우 바로가기 재생성, 재부팅, 아이콘 캐시 갱신이 필요할 수 있습니다.
- Discord Rich Presence 이미지는 앱 아이콘과 별개입니다. Discord에 보이는 이미지는 Discord Developer Portal에 따로 업로드해야 합니다.
