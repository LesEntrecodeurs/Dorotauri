import { useState, useEffect } from 'react';

type AnimationState = 'entering' | 'entered' | 'exiting' | 'exited';

export function useAnimatePresence(isOpen: boolean, duration = 150) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animationState, setAnimationState] = useState<AnimationState>(
    isOpen ? 'entered' : 'exited'
  );

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setAnimationState('entering');
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => {
          setAnimationState('entered');
        });
        (cleanup as any).raf2 = raf2;
      });
      const cleanup: any = { raf1 };
      return () => {
        cancelAnimationFrame(cleanup.raf1);
        if (cleanup.raf2) cancelAnimationFrame(cleanup.raf2);
      };
    } else {
      setAnimationState('exiting');
      const timer = setTimeout(() => {
        setShouldRender(false);
        setAnimationState('exited');
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, duration]);

  return { shouldRender, animationState } as const;
}
