import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// State-change animations (docs/05 "Motion"): each piece compares the value
// it last rendered with the new one, so nothing animates on first mount —
// only when the game actually changes something.

/** Last value shown per tracked stat ("health:seat-1"), kept by the Table
 * so a stat that remounts — the hot-seat dock switching heroes — still
 * animates from what that hero last showed, e.g. turn-start Dark Arts
 * damage landing on the incoming hero. */
export const MotionMemory = createContext<Map<string, number> | null>(null);

function useRemembered(track: string | undefined, value: number): number {
  const memory = useContext(MotionMemory);
  const [initial] = useState(() => (track && memory?.has(track) ? memory.get(track)! : value));
  useEffect(() => {
    if (track) memory?.set(track, value);
  }, [memory, track, value]);
  return initial;
}

/** True only during a component's first render. */
export function useFirstRender(): boolean {
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  return first.current;
}

/** Plays `className`'s animation once when it mounts — if `animate` was set
 * at mount. Captured once so a re-render never replays it. */
export function Pop({
  animate,
  delay = 0,
  className = "animate-drop-in",
  block = false,
  children,
}: {
  animate: boolean;
  delay?: number;
  className?: string;
  block?: boolean;
  children: ReactNode;
}) {
  const [anim] = useState(animate);
  const [d] = useState(delay);
  return (
    <span
      className={`${block ? "block" : "inline-block"} ${anim ? className : ""}`}
      style={anim && d ? { animationDelay: `${d}ms` } : undefined}
    >
      {children}
    </span>
  );
}

/** "+2" / "−3" floating up from wherever it's placed when `value` changes.
 * Gains in brass, losses in signal. Parent must be `relative`. */
export function Floaters({ value, track, className = "-top-3", big = false }: { value: number; track?: string; className?: string; big?: boolean }) {
  const prev = useRef(useRemembered(track, value));
  const nextId = useRef(0);
  const [items, setItems] = useState<{ id: number; delta: number }[]>([]);

  useEffect(() => {
    const delta = value - prev.current;
    prev.current = value;
    if (delta !== 0) setItems((xs) => [...xs, { id: nextId.current++, delta }]);
  }, [value]);

  return (
    <span aria-hidden className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center ${className}`}>
      {items.map((f) => (
        <span
          key={f.id}
          onAnimationEnd={() => setItems((xs) => xs.filter((x) => x.id !== f.id))}
          className={`absolute animate-float-up font-sans font-semibold whitespace-nowrap [text-shadow:0_0_2px_rgb(0_0_0),0_1px_4px_rgb(0_0_0/0.9)] ${
            big
              ? `rounded-md px-2 text-display text-bone ${f.delta > 0 ? "bg-brass" : "bg-signal"}`
              : `text-stat ${f.delta > 0 ? "text-brass" : "text-signal"}`
          }`}
        >
          {f.delta > 0 ? `+${f.delta}` : `−${-f.delta}`}
        </span>
      ))}
    </span>
  );
}

/** A red wash over a card each time `value` goes up (damage landing).
 * Parent must be `relative`. */
export function HitFlash({ value }: { value: number }) {
  const prev = useRef(value);
  const nextId = useRef(0);
  const [hits, setHits] = useState<number[]>([]);

  useEffect(() => {
    if (value > prev.current) setHits((h) => [...h, nextId.current++]);
    prev.current = value;
  }, [value]);

  return (
    <>
      {hits.map((id) => (
        <span
          key={id}
          aria-hidden
          onAnimationEnd={() => setHits((h) => h.filter((x) => x !== id))}
          className="pointer-events-none absolute inset-0 z-10 animate-hit rounded-md bg-signal"
        />
      ))}
    </>
  );
}

function Coin({ size }: { size: "sm" | "lg" }) {
  return (
    <span
      className={`-ml-1.5 block rounded-full border border-frame/70 bg-brass shadow-[inset_0_-2px_0_rgb(0_0_0/0.25)] ${size === "lg" ? "size-5" : "size-3.5"}`}
    />
  );
}

function Bolt({ size }: { size: "sm" | "lg" }) {
  return (
    <svg
      viewBox="0 0 12 16"
      className={`-ml-1 block text-brass drop-shadow-[0_1px_0_rgb(0_0_0/0.6)] ${size === "lg" ? "h-5 w-4" : "h-3.5 w-3"}`}
    >
      <path d="M7.5 0 0.5 9h4.2L3.5 16l8-10.2H7.2L8.8 0z" fill="currentColor" />
    </svg>
  );
}

const MAX_TOKENS = 12;

/** A little pile of coins (influence) or bolts (attack). New tokens drop
 * in one after another; spent ones just disappear. Empty shows a faint
 * token so the stat still reads. */
export function Pile({ count, kind, size, track }: { count: number; kind: "coin" | "bolt"; size: "sm" | "lg"; track?: string }) {
  const first = useFirstRender();
  const remembered = useRemembered(track, count);
  const prev = useRef(remembered);
  useEffect(() => {
    prev.current = count;
  }, [count]);

  const Token = kind === "coin" ? Coin : Bolt;
  const shown = Math.min(count, MAX_TOKENS);
  const from = Math.min(prev.current, MAX_TOKENS);

  if (count === 0) {
    return (
      <span aria-hidden className="inline-flex items-center pl-1.5 opacity-30">
        <Token size={size} />
      </span>
    );
  }
  return (
    <span aria-hidden className="inline-flex items-center pl-1.5">
      {Array.from({ length: shown }, (_, i) => (
        <Pop key={i} animate={first ? i >= remembered : true} delay={Math.max(0, i - from) * 70}>
          <Token size={size} />
        </Pop>
      ))}
    </span>
  );
}
