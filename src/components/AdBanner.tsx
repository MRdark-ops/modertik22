import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    atOptions?: {
      key: string;
      format: "iframe";
      height: number;
      width: number;
      params: Record<string, unknown>;
    };
  }
}

const AD_KEY = "88a59ca5015149811d63351ef573e3b1";
const AD_WIDTH = 300;
const AD_HEIGHT = 250;

export default function AdBanner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const retriesRef = useRef(0);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    const renderAd = () => {
      if (cancelled || !containerRef.current) return;

      setBlocked(false);
      containerRef.current.innerHTML = "";

      window.atOptions = {
        key: AD_KEY,
        format: "iframe",
        height: AD_HEIGHT,
        width: AD_WIDTH,
        params: {},
      };

      const invokeScript = document.createElement("script");
      invokeScript.type = "text/javascript";
      invokeScript.src = `https://www.highperformanceformat.com/${AD_KEY}/invoke.js`;
      invokeScript.async = true;
      invokeScript.referrerPolicy = "unsafe-url";

      invokeScript.onerror = () => {
        if (cancelled) return;

        if (retriesRef.current < 1) {
          retriesRef.current += 1;
          window.setTimeout(renderAd, 1200);
          return;
        }

        setBlocked(true);
      };

      containerRef.current.appendChild(invokeScript);
    };

    renderAd();

    return () => {
      cancelled = true;
      container.innerHTML = "";
    };
  }, []);

  return (
    <div className="flex justify-center py-4">
      <div className="flex flex-col items-center gap-2">
        <div ref={containerRef} style={{ minWidth: AD_WIDTH, minHeight: AD_HEIGHT }} />
        {blocked ? (
          <p className="text-xs text-muted-foreground">تعذّر تحميل الإعلان حالياً على هذا الدومين.</p>
        ) : null}
      </div>
    </div>
  );
}
