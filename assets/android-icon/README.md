# Android launcher icon sources

Inputs for the Android launcher icons of `apps/mobile` (the `mipmap-*` PNGs and
`mipmap-anydpi-v26/ic_launcher.xml` under `apps/mobile/src-tauri/gen/android/app/src/main/res/`).
Those files are generated: change the inputs here and regenerate, never edit them by hand.

- `gonq-logo.svg` is a copy of `assets/gonq-logo-OUTLINE.svg`, used for the legacy and round icons
  (tauri scales it to 62% of the canvas on the background colour).
- `gonq-logo-fg.svg` is the same logo centred on a larger canvas so it spans 56% of the width. The adaptive
  foreground layer is 108dp and launchers mask it to a circle, squircle or rounded square, so everything
  must stay inside the central 66% (the safe zone).
- `android-bg.png` and `bg_color` in `manifest.json` (`#14211C`, a deep green) are the background layer. It is dark
  so the cream logo bubble reads on dark launcher themes and light wallpapers alike.

Regenerate (from the repo root, Node deps installed):

```
cd apps/mobile/src-tauri
../../../node_modules/.bin/tauri icon ../../../assets/android-icon/manifest.json
git checkout icons && git clean -fd icons   # keep only the Android res output
```

`tauri icon` also rewrites `apps/mobile/src-tauri/icons/` (desktop and iOS sizes), which the mobile app does not use;
the second line discards that. Check the result in an emulator: legacy square, round, circle and squircle masks, and
the dark theme.
