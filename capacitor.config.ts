import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.megumii.icyteru',
  appName: 'Icyteru',
  webDir: 'dist/renderer',
  server: {
    androidScheme: 'https',
    // Hermes on a LAN or Tailscale address is usually plain HTTP.
    cleartext: true
  },
  android: {
    allowMixedContent: true,
    // Android 15 is edge-to-edge by default. Let Capacitor apply the system-bar
    // margins itself instead of the WebView drawing under the clock.
    adjustMarginsForEdgeToEdge: 'force'
  },
  plugins: {
    CapacitorHttp: {
      // Native HTTP skips the WebView CORS check. The gateway only allows its own web origin.
      enabled: true
    },
    Keyboard: {
      // Resize the native WebView when the IME opens, including full-screen
      // edge-to-edge windows on Android 15.
      resize: 'native',
      resizeOnFullScreen: true,
      style: 'dark'
    }
  }
}

export default config
