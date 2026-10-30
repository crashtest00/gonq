# M-14 SAF spike emulator harness (throwaway, never merged)

Branch `aigang/saf-spike-emulator`. Push to it runs `.github/workflows/saf-spike-emulator.yml` (GitHub-hosted ubuntu, KVM,
x86_64 `google_apis` API 30 image; API 30 x86 images run arm64-v8a apps via translation, proven by the M-13 smoke run).
1. Build the APK: `gh workflow run build-mobile.yml --ref <spike-branch> -f sha=<sha>`; note the run id.
2. Edit `params.env` (APK_RUN_ID, APK_ARTIFACT, APK_SHA, SCENARIOS=comma list of `scenarios/<name>.cjs`), commit, push.
3. Download artifact `saf-evidence-<sha>`: results.json, per-step PNGs, `<scenario>.logcat.txt`, picker UI dumps on failure.
`seed.sh` creates /sdcard/Documents/GonqSpike (a.md, b.md, notes.txt, sub/c.md, img/pic.png; a.md references img/pic.png and ../GonqSecond/d.md)
and /sdcard/Download/GonqSecond/d.md (second provider). `lib.cjs` has pickTree/tapText (uiautomator), externalWrite, forceStop/launch, logcat, persistedGrants.
