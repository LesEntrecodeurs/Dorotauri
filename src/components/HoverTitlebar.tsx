import { useState, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

const appWindow = getCurrentWindow();

export default function HoverTitlebar() {
  const [visible, setVisible] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (hideTimeout.current) {
      clearTimeout(hideTimeout.current);
      hideTimeout.current = null;
    }
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    hideTimeout.current = setTimeout(() => setVisible(false), 200);
  }, []);

  return (
    <>
      {/* Invisible trigger strip at top edge */}
      <div
        className="fixed top-0 left-0 right-0 h-1.5 z-[200]"
        onMouseEnter={show}
      />
      {/* Titlebar */}
      <div
        className={`fixed top-0 left-0 right-0 h-8 z-[200] flex items-center transition-transform duration-200 ease-out ${
          visible ? 'translate-y-0' : '-translate-y-full'
        }`}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {/* Drag region — fills entire bar */}
        <div
          className="absolute inset-0 window-drag-region"
          data-tauri-drag-region
        />
        {/* Window controls — right-aligned, above drag region */}
        <div className="ml-auto flex items-center relative z-10">
          <button
            onClick={() => appWindow.minimize()}
            className="h-8 w-11 flex items-center justify-center text-foreground/60 hover:bg-foreground/10 hover:text-foreground transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => appWindow.toggleMaximize()}
            className="h-8 w-11 flex items-center justify-center text-foreground/60 hover:bg-foreground/10 hover:text-foreground transition-colors"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => appWindow.close()}
            className="h-8 w-11 flex items-center justify-center text-foreground/60 hover:bg-red-500/80 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </>
  );
}
