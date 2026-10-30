package com.gonq.app

import android.content.res.Configuration
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
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
