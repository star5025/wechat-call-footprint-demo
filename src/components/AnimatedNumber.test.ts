import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnimatedNumber, createNumberAnimator } from "./AnimatedNumber";

function setup(initial: number | null) {
  let time = 0;
  let nextId = 0;
  const pending = new Map<number, (time: number) => void>();
  const cancelled: number[] = [];
  const values: Array<number | null> = [];
  const animator = createNumberAnimator(initial, (value) => values.push(value), {
    now: () => time,
    request: (callback) => {
      pending.set(++nextId, callback);
      return nextId;
    },
    cancel: (id) => {
      cancelled.push(id);
      pending.delete(id);
    },
  });
  const advance = (elapsed: number) => {
    time += elapsed;
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((callback) => callback(time));
  };
  return { animator, advance, values, pending, cancelled };
}

const format = (value: number | null) => value === null ? "未知" : `${value} 次`;

describe("AnimatedNumber initial markup", () => {
  it("renders the initial exact value, final accessible label, and hidden visual span", () => {
    const html = renderToStaticMarkup(createElement(AnimatedNumber, { value: 123, format, className: "metric" }));
    expect(html).toBe('<span role="img" aria-label="123 次" class="metric" data-number-target="123" data-number-current="123"><span class="number-visual" aria-hidden="true">123 次</span></span>');
    expect(html).not.toContain("aria-live");
  });

  it("preserves unknown values rather than substituting zero", () => {
    const html = renderToStaticMarkup(createElement(AnimatedNumber, { value: null, format }));
    expect(html).toContain('aria-label="未知"');
    expect(html).toContain('data-number-target="" data-number-current=""');
    expect(html).toContain('aria-hidden="true">未知</span>');
  });

  it("uses custom visual children without changing the formatted accessible label", () => {
    const html = renderToStaticMarkup(createElement(AnimatedNumber, {
      value: 65,
      format,
      children: (value) => createElement("strong", null, `${value}秒`),
    }));
    expect(html).toContain('aria-label="65 次"');
    expect(html).toContain('aria-hidden="true"><strong>65秒</strong>');
  });
});

describe("numeric animation engine", () => {
  it("does not animate the initial or unchanged target", () => {
    const { animator, pending, values } = setup(65);
    animator.update(65);
    expect(pending.size).toBe(0);
    expect(values).toEqual([]);
  });

  it.each([[0, 100], [100, 0], [-120, 240], [3500, 7213]])(
    "animates %i to %i with finite monotonic integers and an exact endpoint",
    (initial, target) => {
      const { animator, advance, values, pending } = setup(initial);
      animator.update(target);
      for (const elapsed of [0, 16, 64, 160, 160, 319, 1]) advance(elapsed);
      expect(values.at(-1)).toBe(target);
      expect(pending.size).toBe(0);
      let previous = initial;
      for (const value of values) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(Math.min(initial, target));
        expect(value).toBeLessThanOrEqual(Math.max(initial, target));
        expect((value! - previous) * Math.sign(target - initial)).toBeGreaterThanOrEqual(0);
        previous = value!;
      }
    },
  );

  it("uses a 720ms ease-out cubic curve", () => {
    const { animator, advance, values, pending } = setup(0);
    animator.update(1000);
    advance(360);
    expect(values).toEqual([875]);
    advance(360);
    expect(values).toEqual([875, 1000]);
    expect(pending.size).toBe(0);
  });

  it("retargets from the displayed integer, including a direction reversal", () => {
    const { animator, advance, values, cancelled, pending } = setup(0);
    animator.update(100);
    advance(360);
    expect(values).toEqual([88]);
    animator.update(20);
    expect(cancelled).toHaveLength(1);
    advance(0);
    expect(values).toEqual([88]);
    advance(360);
    expect(values.at(-1)).toBe(29);
    advance(360);
    expect(values.at(-1)).toBe(20);
    expect(pending.size).toBe(0);
  });

  it("does not restart an ongoing animation when its target is unchanged", () => {
    const { animator, advance, values, cancelled, pending } = setup(0);
    animator.update(1000);
    advance(360);
    animator.update(1000);
    expect(cancelled).toHaveLength(0);
    expect(pending.size).toBe(1);
    advance(360);
    expect(values.at(-1)).toBe(1000);
    expect(pending.size).toBe(0);
  });

  it("snaps both directions across null and cancels an ongoing animation", () => {
    const { animator, advance, values, pending } = setup(30);
    animator.update(100);
    advance(100);
    animator.update(null);
    expect(values.at(-1)).toBeNull();
    expect(pending.size).toBe(0);
    animator.update(70);
    expect(values.at(-1)).toBe(70);
    expect(pending.size).toBe(0);
  });

  it("snaps immediately for reduced motion or a hidden document", () => {
    const { animator, values, pending } = setup(10);
    animator.update(200, true);
    expect(values).toEqual([200]);
    expect(pending.size).toBe(0);
  });

  it("finishes the current target when motion preference or visibility changes", () => {
    const { animator, advance, values, pending } = setup(0);
    animator.update(1000);
    advance(120);
    animator.finish();
    expect(values.at(-1)).toBe(1000);
    expect(pending.size).toBe(0);
    const count = values.length;
    advance(1000);
    expect(values).toHaveLength(count);
  });

  it("snaps an unchanged ongoing target when reducedMotion becomes true", () => {
    const { animator, advance, values, pending } = setup(0);
    animator.update(1000);
    advance(120);
    animator.update(1000, true);
    expect(values.at(-1)).toBe(1000);
    expect(pending.size).toBe(0);
  });

  it("cancels pending work on unmount without publishing a final frame", () => {
    const { animator, advance, values, pending, cancelled } = setup(10);
    animator.update(200);
    advance(120);
    const displayed = [...values];
    animator.cancel();
    expect(cancelled).toHaveLength(1);
    expect(pending.size).toBe(0);
    advance(1000);
    expect(values).toEqual(displayed);
  });
});
