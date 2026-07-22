# Hearthnote deploy guide

One codebase → **website (PWA)** + **Android (Play Store)** + **iOS (App Store)** via Vite + Capacitor.

App ID: `uk.co.hearthnote.app`

## Prerequisites

- Node 20+
- Android Studio (Play Store builds)
- Xcode 15+ on macOS (App Store builds)
- Apple Developer + Google Play Console accounts

```bash
cd /Users/pd3rvr/Documents/TCS/Voice-to-care-notes
npm install
npm run icons
```

## 1) Website / PWA

```bash
npm run build
npm run preview   # http://localhost:4173
```

Deploy the `dist/` folder to any static host:

- **Netlify / Cloudflare Pages / Vercel / S3+CloudFront / nginx**
- SPA/PWA: publish `dist` as the site root
- HTTPS required for mic + service worker in browsers

Installable PWA: open the site on mobile → “Add to Home Screen”.

## 2) Android (Play Store)

```bash
npm run android:sync
npm run android:open
```

In Android Studio:

1. Wait for Gradle sync
2. Run on emulator/device to test mic permissions
3. **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**
4. Upload `.aab` to [Google Play Console](https://play.google.com/console)

Store listing tips:

- Title: Hearthnote
- Short description: Voice-to-care-notes for care home staff
- Category: Medical / Productivity
- Privacy policy URL required (host a simple page stating on-device processing)

## 3) iOS (App Store)

Requires **full Xcode** from the Mac App Store (Command Line Tools alone are not enough), plus CocoaPods:

```bash
brew install cocoapods
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
export LANG=en_US.UTF-8
npm run ios:sync
npm run ios:open
```

The `ios/` project is already scaffolded. After installing Xcode, run the commands above so `pod install` can finish.

In Xcode:

1. Select Team + signing for `uk.co.hearthnote.app`
2. Confirm `Info.plist` mic usage string (Capacitor Speech plugin adds permission flow)
3. Archive → **Distribute App** → App Store Connect
4. Complete listing, privacy nutrition labels, review notes

If `ios:add` fails with “Xcode not found”, install Xcode from the Mac App Store, then re-run.

## Daily native workflow

```bash
# after web changes
npm run mobile:sync
npm run android:open   # or ios:open
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Local web (http://localhost:5173) |
| `npm run build` | Production web/PWA bundle → `dist/` |
| `npm run preview` | Preview production web |
| `npm run icons` | Regenerate PWA/app icons |
| `npm run android:sync` | Build web + sync Android |
| `npm run ios:sync` | Build web + sync iOS |
| `npm run mobile:sync` | Sync all native projects |

## Notes

- Speech: Web Speech API in browsers; Capacitor Speech Recognition on native
- Notes are stored locally per device/user profile (not a clinical system of record)
- Before store submission, replace demo privacy copy with your organisation policy
