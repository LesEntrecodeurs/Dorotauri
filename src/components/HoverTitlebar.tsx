import { useState, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

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

  const handleMinimize = useCallback(() => { getCurrentWindow().minimize(); }, []);
  const handleMaximize = useCallback(() => { getCurrentWindow().toggleMaximize(); }, []);
  const handleClose = useCallback(() => { getCurrentWindow().close(); }, []);

  // Programmatic drag — more reliable than data-tauri-drag-region on Linux/WebKitGTK
  const handleDrag = useCallback((e: React.MouseEvent) => {
    // Only drag if clicking the bar itself, not a button
    if ((e.target as HTMLElement).closest('button')) return;
    getCurrentWindow().startDragging();
  }, []);

  return (
    <>
      {/* Invisible trigger strip at top edge */}
      <div
        className="fixed top-0 left-0 right-0 h-1.5 z-[200]"
        onMouseEnter={show}
      />
      {/* Titlebar — drag region via Tauri attribute only (no -webkit-app-region which breaks clicks on WebKitGTK) */}
      <div
        className={`fixed top-0 left-0 right-0 h-8 z-[200] flex items-center bg-background/90 backdrop-blur-sm transition-transform duration-200 ease-out ${
          visible ? 'translate-y-0' : '-translate-y-full'
        }`}
        onMouseDown={handleDrag}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {/* Window controls — right-aligned */}
        <div className="ml-auto flex items-center">
          <button
            onClick={handleMinimize}
            className="h-8 w-11 flex items-center justify-center text-foreground/60 hover:bg-foreground/10 hover:text-foreground transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            className="h-8 w-11 flex items-center justify-center text-foreground/60 hover:bg-foreground/10 hover:text-foreground transition-colors"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={handleClose}
            className="h-8 w-11 flex items-center justify-center text-foreground/60 hover:bg-red-500/80 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </>
  );
}
