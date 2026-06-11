"use client";

// Shared motion primitives for DeliveryOps. Expressive spring entrances with
// a count-up for numeric stats. Everything honours `prefers-reduced-motion`:
// when set, entrances collapse to instant and numbers render at their final
// value with no animation.
//
// IMPORTANT: these wrappers apply CSS transforms while animating. Never wrap a
// component that renders a `position: fixed` overlay (e.g. the dashboard
// drill-down panels) — a transformed ancestor reparents fixed positioning and
// the overlay breaks. Animate the inner content instead.

import {
  animate,
  motion,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";

// Expressive spring — a touch of overshoot so cards settle with character.
const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 26, scale: 0.94 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 280, damping: 20, mass: 0.9 },
  },
};

// Orchestration-only parent: no transform/opacity of its own, so it never
// reparents any fixed-positioned descendant. It only cascades its children.
const GROUP_VARIANTS: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.095, delayChildren: 0.04 } },
};

/** Cascades its RevealItem children with a staggered spring entrance. */
export function RevealGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={GROUP_VARIANTS}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

/** A single staggered child. Must be a direct child of RevealGroup. */
export function RevealItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={ITEM_VARIANTS}>
      {children}
    </motion.div>
  );
}

/** Same item entrance, but self-contained (its own initial/animate). Use for a
 *  standalone block that is not inside a RevealGroup. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 26, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 280, damping: 20, mass: 0.9, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Animates a number from 0 to `value` on mount. `format` controls display
 *  (defaults to a locale-pinned integer). Renders final value instantly under
 *  reduced-motion. */
export function CountUp({
  value,
  format,
  duration = 1.1,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString("en-US"));
  // Server + first client render both start at 0 (or final, if reduced) so
  // there is no hydration mismatch.
  const [display, setDisplay] = useState(() => fmt(reduce ? value : 0));

  useEffect(() => {
    if (reduce) {
      setDisplay(fmt(value));
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.22, 0.61, 0.36, 1],
      onUpdate: (v) => setDisplay(fmt(v)),
    });
    return () => controls.stop();
    // fmt is derived from `format`; re-running on value change is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce, duration]);

  return <span className={className}>{display}</span>;
}
