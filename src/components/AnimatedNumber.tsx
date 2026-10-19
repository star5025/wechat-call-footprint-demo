import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type NumberValue = number | null;

type NumberScheduler = {
  now: () => number;
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
};

// The scheduler is injected so the same animation used by React can be tested without a DOM.
export function createNumberAnimator(
  initial: NumberValue,
  publish: (value: NumberValue) => void,
  scheduler: NumberScheduler,
) {
  let current = initial;
  let target = initial;
  let frame: number | null = null;

  const cancel = () => {
    if (frame !== null) scheduler.cancel(frame);
    frame = null;
  };
  const display = (value: NumberValue) => {
    if (current === value) return;
    current = value;
    publish(value);
  };
  const finish = () => {
    cancel();
    display(target);
  };
  const update = (value: NumberValue, snap = false) => {
    if (value === target) {
      if (snap) finish();
      return;
    }
    cancel();
    target = value;
    if (snap || current === null || value === null || current === value) {
      display(value);
      return;
    }
    const from = current;
    const started = scheduler.now();
    const tick = (time: number) => {
      frame = null;
      const progress = Math.min(1, Math.max(0, (time - started) / 720));
      display(progress === 1 ? value : Math.round(from + (value - from) * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = scheduler.request(tick);
    };
    frame = scheduler.request(tick);
  };

  return { update, finish, cancel };
}

type AnimatedNumberProps = {
  value: NumberValue;
  format: (value: NumberValue) => string;
  children?: (value: NumberValue) => ReactNode;
  className?: string;
  reducedMotion?: boolean;
};

export function AnimatedNumber({ value, format, children, className, reducedMotion = false }: AnimatedNumberProps) {
  const [displayed, setDisplayed] = useState(value);
  const animator = useRef<ReturnType<typeof createNumberAnimator> | null>(null);
  const media = useRef<MediaQueryList | null>(null);
  const reduced = useRef(reducedMotion);

  useLayoutEffect(() => {
    const animation = createNumberAnimator(value, setDisplayed, {
      now: () => performance.now(),
      request: (callback) => window.requestAnimationFrame(callback),
      cancel: (id) => window.cancelAnimationFrame(id),
    });
    animator.current = animation;
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    media.current = preference;
    const motionChanged = () => {
      if (reduced.current || preference?.matches) animation.finish();
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") animation.finish();
    };
    preference?.addEventListener("change", motionChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      animation.cancel();
      preference?.removeEventListener("change", motionChanged);
      document.removeEventListener("visibilitychange", visibilityChanged);
      animator.current = null;
      media.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    reduced.current = reducedMotion;
    animator.current?.update(value, reducedMotion || !!media.current?.matches || document.visibilityState === "hidden");
  }, [value, reducedMotion]);

  return (
    <span role="img" aria-label={format(value)} className={className} data-number-target={value ?? ""} data-number-current={displayed ?? ""}>
      <span className="number-visual" aria-hidden="true">{children ? children(displayed) : format(displayed)}</span>
    </span>
  );
}
