# PayLink Icon & Splash Screen Assets

## Source Logo
Use `attached_assets/PayLink_Logo_transparent_1771416877301.png` as the source image.

## Required Icon Sizes

### Android (`resources/android/icon/`)
| File | Size | Use |
|------|------|-----|
| `icon-ldpi.png` | 36x36 | Low density |
| `icon-mdpi.png` | 48x48 | Medium density |
| `icon-hdpi.png` | 72x72 | High density |
| `icon-xhdpi.png` | 96x96 | Extra-high density |
| `icon-xxhdpi.png` | 144x144 | Extra-extra-high density |
| `icon-xxxhdpi.png` | 192x192 | Extra-extra-extra-high density |
| `icon-foreground.png` | 432x432 | Adaptive icon foreground |

### iOS (`resources/ios/icon/`)
| File | Size | Use |
|------|------|-----|
| `icon-20.png` | 20x20 | Notifications |
| `icon-20@2x.png` | 40x40 | Notifications @2x |
| `icon-20@3x.png` | 60x60 | Notifications @3x |
| `icon-29.png` | 29x29 | Settings |
| `icon-29@2x.png` | 58x58 | Settings @2x |
| `icon-29@3x.png` | 87x87 | Settings @3x |
| `icon-40.png` | 40x40 | Spotlight |
| `icon-40@2x.png` | 80x80 | Spotlight @2x |
| `icon-40@3x.png` | 120x120 | Spotlight @3x |
| `icon-60@2x.png` | 120x120 | App icon @2x |
| `icon-60@3x.png` | 180x180 | App icon @3x |
| `icon-76.png` | 76x76 | iPad app |
| `icon-76@2x.png` | 152x152 | iPad app @2x |
| `icon-83.5@2x.png` | 167x167 | iPad Pro |
| `icon-1024.png` | 1024x1024 | App Store |

## Required Splash Screen Sizes

### Android (`resources/android/splash/`)
| File | Size |
|------|------|
| `splash-land-ldpi.png` | 320x200 |
| `splash-land-mdpi.png` | 480x320 |
| `splash-land-hdpi.png` | 800x480 |
| `splash-land-xhdpi.png` | 1280x720 |
| `splash-land-xxhdpi.png` | 1600x960 |
| `splash-land-xxxhdpi.png` | 1920x1280 |
| `splash-port-ldpi.png` | 200x320 |
| `splash-port-mdpi.png` | 320x480 |
| `splash-port-hdpi.png` | 480x800 |
| `splash-port-xhdpi.png` | 720x1280 |
| `splash-port-xxhdpi.png` | 960x1600 |
| `splash-port-xxxhdpi.png` | 1280x1920 |

### iOS (`resources/ios/splash/`)
| File | Size |
|------|------|
| `Default@2x~universal~anyany.png` | 2732x2732 |
| `Default@2x~universal~comany.png` | 1278x2732 |
| `Default@2x~universal~comcom.png` | 1278x1278 |
| `Default@3x~universal~anyany.png` | 2208x2208 |
| `Default@3x~universal~anycom.png` | 2208x1242 |
| `Default@3x~universal~comany.png` | 1242x2208 |

## Generation Commands

The easiest way to generate all assets is with `@capacitor/assets`:

```bash
npm install -g @capacitor/assets
npx @capacitor/assets generate --iconBackgroundColor '#0d9488' --splashBackgroundColor '#0d9488' --logoSplashScale 0.3
```

This reads from `resources/icon.png` (1024x1024) and `resources/splash.png` (2732x2732).

### Manual steps:
1. Create a 1024x1024 `resources/icon.png` with the PayLink logo centered on a teal (#0d9488) background
2. Create a 2732x2732 `resources/splash.png` with the PayLink logo centered on a teal (#0d9488) background
3. Run the generation command above
