package com.gonq.app

import android.content.res.Configuration
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // The WebView only reports prefers-color-scheme: dark (which the web app's Auto theme follows) when its
  // dark mode is on, so tie that to the system night mode instead of leaving it to the WebView default.
  override fun onWebViewCreate(webView: WebView) {
    // Many Android WebViews report env(safe-area-inset-*) as 0 even when drawing edge to edge, which put the top
    // bar under the status bar. Pad the WebView by the system bars, cutout and keyboard natively instead, so the
    // page never draws under them (and env() stays 0 there, so the CSS does not pad twice).
    ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
      )
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(webView)
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
      // The web app themes itself; do not let the WebView invert its colours on top.
      WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
    }
    @Suppress("DEPRECATION")
    if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
      WebSettingsCompat.setForceDark(
        webView.settings,
        if (night) WebSettingsCompat.FORCE_DARK_ON else WebSettingsCompat.FORCE_DARK_OFF,
      )
      if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK_STRATEGY)) {
        WebSettingsCompat.setForceDarkStrategy(webView.settings, WebSettingsCompat.DARK_STRATEGY_WEB_THEME_DARKENING_ONLY)
      }
    }
  }
}
