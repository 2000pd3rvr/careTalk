import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { App } from "@capacitor/app";

export async function bootstrapNativeShell() {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add("native");
  document.documentElement.dataset.platform = Capacitor.getPlatform();

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#061114" });
  } catch {
    /* web or unsupported */
  }

  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
  } catch {
    /* ignore */
  }

  try {
    await SplashScreen.hide();
  } catch {
    /* ignore */
  }

  App.addListener("backButton", ({ canGoBack }) => {
    if (!canGoBack) App.exitApp();
    else window.history.back();
  });
}
