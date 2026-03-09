import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

export function useAdMobBanner() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup = false;

    const showBanner = async () => {
      try {
        const { AdMob, BannerAdSize, BannerAdPosition } = await import(
          "@capacitor-community/admob"
        );

        await AdMob.initialize({ initializeForTesting: false });

        if (cleanup) return;

        await AdMob.showBanner({
          adId: "ca-app-pub-5311550066318725/1291622942",
          adSize: BannerAdSize.ADAPTIVE_BANNER,
          position: BannerAdPosition.BOTTOM_CENTER,
          margin: 0,
        });
      } catch (e) {
        console.warn("AdMob banner failed:", e);
      }
    };

    showBanner();

    return () => {
      cleanup = true;
      if (Capacitor.isNativePlatform()) {
        import("@capacitor-community/admob").then(({ AdMob }) => {
          AdMob.removeBanner().catch(() => {});
        });
      }
    };
  }, []);
}
