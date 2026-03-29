# PayLink Mobile Build Guide

Step-by-step instructions for building PayLink as a native Android and iOS app using Capacitor.

## Prerequisites

### General
- Node.js 18+ and npm installed
- PayLink project cloned and dependencies installed (`npm install`)

### Android
- [Android Studio](https://developer.android.com/studio) (latest stable)
- Android SDK 33+ (install via Android Studio SDK Manager)
- Java 17+ (bundled with Android Studio)
- An Android device or emulator for testing

### iOS (macOS only)
- macOS 13 (Ventura) or later
- [Xcode 15+](https://developer.apple.com/xcode/) from the Mac App Store
- Xcode Command Line Tools (`xcode-select --install`)
- CocoaPods (`sudo gem install cocoapods`)
- An Apple Developer account for device testing and distribution

## Step 1: Build the Web App

```bash
npm run build
```

This compiles the frontend into `dist/public/`, which Capacitor uses as the web layer.

## Step 2: Generate App Icons and Splash Screens

See `resources/ASSET_GENERATION.md` for detailed instructions.

Quick version:
```bash
npx @capacitor/assets generate --iconBackgroundColor '#0d9488' --splashBackgroundColor '#0d9488'
```

## Step 3: Add Native Platforms

### Android
```bash
npx cap add android
```

### iOS
```bash
npx cap add ios
```

## Step 4: Sync Web Assets to Native Projects

Run this after every web build:
```bash
npx cap sync
```

This copies `dist/public/` into the native projects and updates native plugin configurations.

## Step 5: Configure Server URL (Development Only)

For development with live reload, update `capacitor.config.ts`:

```typescript
server: {
  url: 'http://YOUR_LOCAL_IP:5000',
  cleartext: true, // Android only, for HTTP
}
```

Remove these settings before building for production.

## Step 6: Open in IDE

### Android
```bash
npx cap open android
```
This opens the project in Android Studio.

### iOS
```bash
npx cap open ios
```
This opens the project in Xcode.

## Step 7: Build and Run

### Android

1. In Android Studio, select your target device/emulator
2. Click the green Run button (or Shift+F10)
3. For a release APK:
   - Build > Generate Signed Bundle / APK
   - Choose APK
   - Create or select a keystore
   - Select "release" build variant
   - The APK will be in `android/app/build/outputs/apk/release/`

### iOS

1. In Xcode, select your target device
2. Set your development team in Signing & Capabilities
3. Click the Play button (or Cmd+R)
4. For a release build:
   - Product > Archive
   - Distribute App > App Store Connect (or Ad Hoc)
   - Follow the signing and upload prompts

## Production Configuration

Before building a production release:

1. **Set the API base URL** via environment variable before building:
   ```bash
   export VITE_API_BASE_URL=https://app.mypaylink.app
   ```
   This is used by `client/src/lib/queryClient.ts` to resolve API calls when running inside the Capacitor WebView. The frontend detects native platform via `Capacitor.isNativePlatform()` and prepends this URL to all fetch requests.

2. **Build the web app** with production settings:
   ```bash
   VITE_API_BASE_URL=https://app.mypaylink.app NODE_ENV=production npm run build
   ```

3. **Sync** the production build:
   ```bash
   npx cap sync
   ```

Note: Do NOT set `server.url` in `capacitor.config.ts` for production builds. The app loads from bundled web assets and resolves API URLs at runtime via the `VITE_API_BASE_URL` environment variable baked in at build time.

## Common Commands Reference

| Command | Description |
|---------|-------------|
| `npm run build` | Build the web app |
| `npx cap sync` | Sync web assets + update plugins |
| `npx cap copy` | Copy web assets only (no plugin update) |
| `npx cap add android` | Add Android platform |
| `npx cap add ios` | Add iOS platform |
| `npx cap open android` | Open in Android Studio |
| `npx cap open ios` | Open in Xcode |
| `npx cap run android` | Build and run on Android device |
| `npx cap run ios` | Build and run on iOS device |

## Pre-Submission Checklist

### Both Platforms
- [ ] App icons generated for all required sizes
- [ ] Splash screens generated for all required sizes
- [ ] `capacitor.config.ts` server URL points to production
- [ ] Web app built with `NODE_ENV=production`
- [ ] `npx cap sync` run after final build
- [ ] All Capacitor plugins synced (check for native errors on launch)
- [ ] Test login/logout flow in the WebView
- [ ] Test all navigation routes work correctly
- [ ] Verify API calls work with production server
- [ ] Check session cookies persist across app backgrounding

### Android
- [ ] `minSdkVersion` set to 22+ in `android/app/build.gradle`
- [ ] Release keystore created and stored securely
- [ ] Signed APK/AAB generated successfully
- [ ] App tested on at least 2 different screen sizes
- [ ] Camera and file permissions work correctly
- [ ] Push notification permissions requested at appropriate time
- [ ] Back button behavior works correctly (no unexpected exits)

### iOS
- [ ] Development team set in Xcode project settings
- [ ] Bundle identifier matches `app.mypaylink.paylink`
- [ ] Minimum deployment target set to iOS 14+
- [ ] App Transport Security configured for HTTPS
- [ ] Camera and photo library usage descriptions set in Info.plist
- [ ] Push notification entitlement enabled
- [ ] App tested on multiple device sizes (iPhone SE, iPhone 15 Pro, iPad)
- [ ] Archive builds and uploads to App Store Connect successfully

## Troubleshooting

### "Capacitor could not find the web assets directory"
Run `npm run build` first, then `npx cap sync`.

### Android: "SDK location not found"
Set `ANDROID_HOME` environment variable or create `android/local.properties`:
```
sdk.dir=/path/to/Android/sdk
```

### iOS: "No signing certificate"
Open Xcode > Preferences > Accounts, add your Apple ID, and download certificates.

### API calls fail in WebView
Ensure the server CORS config includes Capacitor origins. Check `server/index.ts` for the Capacitor CORS middleware.

### Session cookies not persisting
The server is configured with `sameSite: 'none'` and `secure: true` for Capacitor origins. Ensure the production server uses HTTPS.
