import { useEffect, useState, type ReactNode } from "react";
import { Card } from "./Card.tsx";
import type { CardFace, HeroSummary, PromptModel, TableModel } from "./model.ts";

export type TableHandlers = {
  onPlay: (cardId: string) => void;
  onAcquire: (cardId: string) => void;
  onAssign: (villainSlot: number, amount: number) => void;
  onEndTurn: () => void;
  onAnswer: (promptId: string, choiceIds: string[]) => void;
};

type Inspect = (face: CardFace | null, viaTouch?: boolean) => void;

// Cards clip long rules text at table size; hovering, focusing or
// long-pressing one shows it full size in the inspector.
function Inspectable({ face, inspect, children }: { face: CardFace; inspect: Inspect; children: ReactNode }) {
  return (
    <div
      onMouseEnter={() => inspect(face)}
      onMouseLeave={() => inspect(null)}
      onFocus={() => inspect(face)}
      onBlur={() => inspect(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        inspect(face, true);
      }}
    >
      {children}
    </div>
  );
}

function LocationSpine({ location }: { location: TableModel["location"] }) {
  return (
    <header className="flex items-center gap-4 border-b border-bone/10 px-4 py-2.5 sm:px-6">
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: location.slots }, (_, i) => (
          <span key={i} className={`h-4 w-7 ${i < location.control ? "bg-signal" : "bg-panel"}`} />
        ))}
      </div>
      <p className="min-w-0 truncate">
        <span className="font-serif text-title font-semibold">{location.name}</span>
        <span className="text-bone/60">
          {" "}
          · {location.control} of {location.slots} control · location {location.number} of {location.of}
        </span>
      </p>
    </header>
  );
}

function PanelHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-4">
      <h2 className="font-serif text-title font-semibold">{children}</h2>
      {aside && <span className="text-bone/60">{aside}</span>}
    </div>
  );
}

// Wide: side by side. Narrow (below lg): a swipeable pair of panes via
// native scroll-snap — docs/05 "the threat bands become a swipeable pair".
function ThreatBands({ model, inspect, onAssign }: { model: TableModel; inspect: Inspect; onAssign: TableHandlers["onAssign"] }) {
  const attack = model.you.attack;
  return (
    <section aria-label="Threats">
      <nav className="mb-2 flex gap-4 text-bone/60 lg:hidden" aria-label="Threat panes">
        <a href="#villains" className="underline-offset-4 hover:underline">
          Villains
        </a>
        <a href="#dark-arts" className="underline-offset-4 hover:underline">
          Dark Arts ({model.darkArts.length})
        </a>
      </nav>
      <div className="flex snap-x snap-mandatory gap-6 overflow-x-auto lg:grid lg:grid-cols-2 lg:overflow-visible">
        <div id="villains" className="w-full shrink-0 snap-start lg:w-auto">
          <PanelHeading>Villains</PanelHeading>
          <div className="flex gap-3">
            {model.villains.map((v) => (
              <div key={v.slot} className="w-34">
                <Inspectable face={v.face} inspect={inspect}>
                  <Card
                    face={v.face}
                    damage={v.damage}
                    onClick={model.canAct && attack > 0 ? () => onAssign(v.slot, attack) : undefined}
                    actionLabel={`Assign ${attack} attack to`}
                  />
                </Inspectable>
              </div>
            ))}
            {model.villains.length === 0 && <p className="text-bone/60">No villains left in play.</p>}
          </div>
        </div>
        <div id="dark-arts" className="w-full shrink-0 snap-start lg:w-auto">
          <PanelHeading>Dark Arts revealed this turn</PanelHeading>
          <div className="flex gap-3">
            {model.darkArts.length === 0 && <p className="text-bone/60">Nothing revealed this turn.</p>}
            {model.darkArts.map((face, i) => (
              <div key={`${face.id}-${i}`} className="w-34">
                <Inspectable face={face} inspect={inspect}>
                  <Card face={face} />
                </Inspectable>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Market({ model, inspect, onAcquire }: { model: TableModel; inspect: Inspect; onAcquire: TableHandlers["onAcquire"] }) {
  return (
    <section aria-label="Market">
      <PanelHeading aside={`deck: ${model.market.deckCount} left`}>Market</PanelHeading>
      <div className="grid grid-cols-6 gap-2.5 lg:grid-cols-[repeat(6,minmax(0,8.5rem))]">
        {model.market.row.map((face, i) =>
          face ? (
            <Inspectable key={i} face={face} inspect={inspect}>
              <Card
                face={face}
                // A hint only — the engine decides, and a rejection is shown.
                dimmed={(face.cost ?? 0) > model.you.influence}
                onClick={model.canAct ? () => onAcquire(face.id) : undefined}
                actionLabel="Acquire"
              />
            </Inspectable>
          ) : (
            <div key={i} className="aspect-[5/7] rounded-md border border-dashed border-bone/20" />
          ),
        )}
      </div>
    </section>
  );
}

function Stats({ hero, size }: { hero: HeroSummary; size: "stat" | "body" }) {
  const num = size === "stat" ? "text-stat font-semibold" : "font-semibold";
  return (
    <span className="inline-flex items-baseline gap-3">
      <span aria-label={`${hero.health} of ${hero.maxHealth} health`}>
        <span className={hero.health <= 3 ? "text-signal" : ""}>♥ </span>
        <span className={num}>{hero.health}</span>
        <span className="text-bone/50">/{hero.maxHealth}</span>
      </span>
      <span className="text-brass" aria-label={`${hero.attack} attack`}>
        ⚡ <span className={`${num} text-bone`}>{hero.attack}</span>
        {size === "stat" && <span className="text-bone/60"> attack</span>}
      </span>
      <span className="text-brass" aria-label={`${hero.influence} influence`}>
        ◈ <span className={`${num} text-bone`}>{hero.influence}</span>
        {size === "stat" && <span className="text-bone/60"> influence</span>}
      </span>
      {hero.stunned && <span className="font-semibold text-signal">stunned</span>}
    </span>
  );
}

function OtherHeroes({ others }: { others: HeroSummary[] }) {
  return (
    <section aria-label="Other heroes" className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      {others.map((hero) => (
        <span key={hero.seat} className="inline-flex items-baseline gap-2">
          <span className="font-serif text-title font-semibold">{hero.heroName}</span>
          <Stats hero={hero} size="body" />
        </span>
      ))}
    </section>
  );
}

function Dock({ model, rejection, inspect, handlers }: { model: TableModel; rejection: string | null; inspect: Inspect; handlers: TableHandlers }) {
  const { you, canAct } = model;
  const onlyVillain = model.villains.length === 1 ? model.villains[0]! : null;
  return (
    <section aria-label={`${you.heroName}'s turn`} className="border-t border-bone/10 bg-panel/60 px-4 pt-3 pb-4 sm:px-6">
      <div className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-2">
        <h2 className="font-serif text-display font-semibold">{you.heroName}'s turn</h2>
        <Stats hero={you} size="stat" />
        <span className="text-bone/60">
          deck {you.deckCount} · discard {you.discardCount}
        </span>
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={!canAct || you.attack === 0 || !onlyVillain}
            onClick={() => onlyVillain && handlers.onAssign(onlyVillain.slot, you.attack)}
            title={model.villains.length > 1 ? "Click a villain to assign your attack to it" : undefined}
            className="rounded-md border border-brass px-4 py-2 font-semibold text-brass disabled:opacity-40"
          >
            Assign {you.attack} attack
          </button>
          <button
            type="button"
            disabled={!canAct}
            onClick={handlers.onEndTurn}
            className="rounded-md bg-bone px-4 py-2 font-semibold text-table disabled:opacity-40"
          >
            End turn
          </button>
        </span>
      </div>
      <p className="mb-2 min-h-5 text-bone/60">
        {rejection ? (
          <span className="font-semibold text-signal" role="alert">
            {rejection.charAt(0).toUpperCase() + rejection.slice(1)}.
          </span>
        ) : you.played.length > 0 ? (
          <>Played this turn: {you.played.map((c) => c.name).join(", ")}</>
        ) : you.hand.length > 0 ? (
          "Play cards from your hand, buy from the market, then end your turn."
        ) : null}
      </p>
      <div className="grid grid-cols-5 gap-2.5 lg:grid-cols-[repeat(5,minmax(0,8.5rem))]">
        {you.hand.map((face, i) => (
          <Inspectable key={`${face.id}-${i}`} face={face} inspect={inspect}>
            <Card face={face} onClick={canAct ? () => handlers.onPlay(face.id) : undefined} actionLabel="Play" showCost={false} />
          </Inspectable>
        ))}
        {you.hand.length === 0 && <p className="col-span-5 text-bone/60">No cards left in hand.</p>}
      </div>
    </section>
  );
}

// docs/05: when the game waits on someone, the prompt takes the lower third
// as a sheet — never a centred modal — and names who it's for. Everyone
// else sees "waiting for …" in the same place, with the same words.
function PendingSheet({ prompt, onAnswer }: { prompt: PromptModel; onAnswer: TableHandlers["onAnswer"] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const single = prompt.maxChoices === 1;
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < prompt.maxChoices ? [...s, id] : s));

  return (
    <section
      role="dialog"
      aria-labelledby="pending-title"
      className="fixed inset-x-0 bottom-0 flex min-h-[34dvh] gap-5 border-t-2 border-brass bg-panel px-4 py-5 sm:px-6"
    >
      {prompt.source && (
        <div className="hidden w-34 shrink-0 sm:block">
          <Card face={prompt.source} />
        </div>
      )}
      <div className="flex flex-col gap-4">
        <h2 id="pending-title" className="font-serif text-display font-semibold">
          {prompt.heroName}: {prompt.title}
        </h2>
        {prompt.source && <p className="text-bone/60">From {prompt.source.name}.</p>}
        <div className="flex flex-wrap gap-3">
          {prompt.options.map((option, i) => (
            <button
              key={option.id}
              type="button"
              autoFocus={i === 0}
              aria-pressed={single ? undefined : selected.includes(option.id)}
              onClick={() => (single ? onAnswer(prompt.id, [option.id]) : toggle(option.id))}
              className={`rounded-md px-5 py-3 text-title font-semibold ${
                selected.includes(option.id) ? "bg-brass text-table" : "bg-bone text-table"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {!single && (
          <button
            type="button"
            disabled={selected.length < prompt.minChoices}
            onClick={() => onAnswer(prompt.id, selected)}
            className="self-start rounded-md border border-brass px-4 py-2 font-semibold text-brass disabled:opacity-40"
          >
            Confirm
          </button>
        )}
      </div>
    </section>
  );
}

function WaitingSheet({ heroName }: { heroName: string }) {
  return (
    <section className="fixed inset-x-0 bottom-0 flex min-h-[34dvh] items-start border-t-2 border-bone/20 bg-panel px-4 py-5 sm:px-6">
      <h2 className="font-serif text-display font-semibold text-bone/80">Waiting for {heroName} to choose.</h2>
    </section>
  );
}

export function Table({
  model,
  rejection,
  announcement,
  handlers,
}: {
  model: TableModel;
  rejection: string | null;
  announcement: string;
  handlers: TableHandlers;
}) {
  const [inspected, setInspected] = useState<CardFace | null>(null);
  const [touchInspect, setTouchInspect] = useState(false);
  const inspect: Inspect = (face, viaTouch = false) => {
    setInspected(face);
    setTouchInspect(viaTouch && face !== null);
  };

  useEffect(() => {
    document.documentElement.style.setProperty("--threat", String(model.threat));
  }, [model.threat]);

  // A played or acquired card unmounts without firing mouseleave/blur, so
  // any state change closes the inspector rather than leaving it stuck.
  useEffect(() => {
    setInspected(null);
    setTouchInspect(false);
  }, [model]);

  // A long-press inspection stays open until the next tap anywhere.
  useEffect(() => {
    if (!touchInspect) return;
    const close = () => {
      setInspected(null);
      setTouchInspect(false);
    };
    window.addEventListener("pointerdown", close, { once: true });
    return () => window.removeEventListener("pointerdown", close);
  }, [touchInspect]);

  return (
    <div className="flex h-dvh flex-col">
      <LocationSpine location={model.location} />
      <main className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-4 sm:px-6">
        <ThreatBands model={model} inspect={inspect} onAssign={handlers.onAssign} />
        <Market model={model} inspect={inspect} onAcquire={handlers.onAcquire} />
        <OtherHeroes others={model.others} />
      </main>
      <Dock model={model} rejection={rejection} inspect={inspect} handlers={handlers} />
      {model.prompt && <PendingSheet key={model.prompt.id} prompt={model.prompt} onAnswer={handlers.onAnswer} />}
      {model.waitingOn && <WaitingSheet heroName={model.waitingOn} />}
      {inspected && (
        <div className="pointer-events-none fixed top-16 right-4 z-10 w-64 shadow-2xl shadow-black/60" aria-hidden>
          <Card face={inspected} />
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
