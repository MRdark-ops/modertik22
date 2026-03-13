import { useEffect, useRef } from "react";

declare global {
  interface Window {
    atOptions?: Record<string, unknown>;
  }
}

export default function AdBanner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current || !containerRef.current) return;
    loaded.current = true;

    const configScript = document.createElement("script");
    configScript.text = `
      atOptions = {
        'key' : '88a59ca5015149811d63351ef573e3b1',
        'format' : 'iframe',
        'height' : 250,
        'width' : 300,
        'params' : {}
      };
    `;
    containerRef.current.appendChild(configScript);

    const invokeScript = document.createElement("script");
    invokeScript.src = "https://www.highperformanceformat.com/88a59ca5015149811d63351ef573e3b1/invoke.js";
    containerRef.current.appendChild(invokeScript);
  }, []);

  return (
    <div className="flex justify-center py-4">
      <div ref={containerRef} style={{ minWidth: 300, minHeight: 250 }} />
    </div>
  );
}
