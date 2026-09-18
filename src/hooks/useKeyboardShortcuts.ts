import { useEffect, useRef } from "react";

type Handlers = {
  toggle: () => void;
  step: () => void;
  reset: () => void;
};

/** Elements where a key press should keep its native meaning. */
function isInteractive(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(target.tagName);
}

/** Global shortcuts: Space = start/pause, S = one step, R = reset. */
export function useKeyboardShortcuts(handlers: Handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isInteractive(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        ref.current.toggle();
      } else if (e.key === "s" || e.key === "S") {
        ref.current.step();
      } else if (e.key === "r" || e.key === "R") {
        ref.current.reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
