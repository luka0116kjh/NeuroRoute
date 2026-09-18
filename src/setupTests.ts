import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom has no canvas implementation. A recording no-op 2D context is enough for
// the renderer to run; drawing correctness is checked in the browser.
function createFakeContext(canvas: HTMLCanvasElement) {
  const calls: string[] = [];
  const target: Record<string | symbol, unknown> = { canvas, __calls: calls };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return (..._args: unknown[]) => {
        calls.push(String(prop));
      };
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
  let ctx = contexts.get(this);
  if (!ctx) {
    ctx = createFakeContext(this);
    contexts.set(this, ctx);
  }
  return ctx;
} as unknown as HTMLCanvasElement["getContext"]);
