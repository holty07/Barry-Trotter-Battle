# 02 — Engine specification

This is the part that decides whether the project survives to Year 5. Read it fully before
writing engine code.

## The core contract

```ts
export function reduce(state: GameState, action: Action): ReduceResult;

type ReduceResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: RejectReason };
```

Pure, synchronous, total. Same inputs always produce the same outputs. `state` is never mutated —
use structural copies (a small `produce`-style helper is fine; do not add Immer to the engine).

## Deterministic randomness

```ts
type Rng = { seed: number; cursor: number };   // lives inside GameState
function nextInt(rng: Rng, maxExclusive: number): [number, Rng];
function shuffle<T>(items: T[], rng: Rng): [T[], Rng];
```

Use splitmix32 or xorshift32 — small, fast, no dependency. Every shuffle, dice roll and random
selection advances the cursor and returns a new `Rng`. Because the seed and cursor are inside the
state, a state snapshot plus an action log replays byte-identically. This gives you, for free:
crash recovery, bug reports as replay files, and a determinism test that catches accidental
impurity immediately.

Nothing in the engine may call `Math.random`, `Date.now`, or `crypto`. The room supplies the seed
at game creation.

## State shape

Sketch, not gospel — refine it in M2, but keep the structural decisions.

```ts
type GameState = {
  schema: 1;
  rng: Rng;
  year: YearId;                        // 1..7
  status: "setup" | "playing" | "won" | "lost";
  phase: Phase;                        // see turn structure below
  turn: { activeSeat: SeatId; number: number };
  seats: SeatId[];                     // fixed turn order
  players: Record<SeatId, PlayerState>;
  market: {
    deck: CardId[];                    // order matters, hidden from clients
    row: (CardId | null)[];            // the face-up offer
    discard: CardId[];
  };
  darkArts: { deck: CardId[]; discard: CardId[]; revealedThisTurn: CardId[] };
  villains: {
    deck: CardId[];
    slots: (VillainInPlay | null)[];   // slot count varies by year/player count
    defeated: CardId[];
  };
  locations: { order: CardId[]; current: number; controlTokens: number };
  // Year-gated subsystems. Absent, not empty, when the year doesn't use them.
  horcruxes?: { deck: CardId[]; active: CardId | null; destroyed: CardId[] };
  proficiency?: Record<SeatId, CardId>;
  resolution: Frame[];                 // the effect stack — see below
  pending: PendingInput | null;        // what the engine is waiting for
  modifiers: Modifier[];               // active triggers and lasting effects
  counters: Record<string, number>;    // per-turn tallies (cards played, villains defeated…)
  log: LogEntry[];
};

type PlayerState = {
  heroId: HeroId;
  heroLevel: 1 | 2 | 3;                // Heroes gain new cards in Years 1, 3 and 7
  deck: CardId[]; hand: CardId[]; discard: CardId[]; inPlay: CardId[];
  health: number; maxHealth: number; stunned: boolean;
  attack: number; influence: number;   // reset each turn
  tokens: Record<string, number>;      // spell tokens, dice results, etc.
};
```

Notes on the decisions:

- **Card instances are just IDs.** Cards have no per-instance mutable state in the base game, so
  a `CardId[]` per zone is enough. If a card ever needs attached state (a token sitting on it),
  put it in `VillainInPlay` or `PlayerState.tokens`, keyed by card id — do not promote every card
  to an object.
- **Zones are arrays and order is meaningful.** Deck order is the whole reason the server is
  authoritative. Never model a deck as a multiset.
- **Year-gated subsystems are optional keys**, so Year 1 code can't accidentally reference
  Horcruxes and Year 7 can't forget to initialise them.
- **`counters`** exists because a surprising number of effects are conditional on something that
  happened earlier this turn. Clear the per-turn ones in the turn-end step, explicitly, in one
  place.

## Turn structure

Model the turn as an explicit `phase` and advance it with a `stepPhase` action rather than
letting the client drive it. The broad sequence per player turn:

```
turnStart → darkArts → villainAbilities → main → discardAndDraw → turnEnd → (next seat)
```

`main` is the only phase that accepts free-form player commands. Everything else is a scripted
advance that may push effects and may block on `pending`.

Per-year rule deltas (extra Dark Arts cards, dice, when control tokens are added, how Villains
are replaced) live in the year scenario file, **not** in the phase code, as flags and numbers.
The per-year mini-manuals are the authority for these. Where you don't know a delta, leave a
`TODO(rules)` in the scenario file rather than a guess in the engine.

## Effect resolution: a stack, not a function call

This is the single most important design decision in the codebase.

Card effects are not functions that run to completion, because many of them need to stop and ask
a player something ("discard a card", "choose a Hero"), and the answer arrives over a network
minutes later. If effects are async or callback-based, the engine stops being pure and the state
stops being serialisable. So resolution is an explicit stack held in state.

```ts
type Frame = { effect: Effect; ctx: EffectContext };
type EffectContext = { source: CardId; controller: SeatId; target?: SeatId; vars: Record<string, unknown> };

type PendingInput = {
  id: string;                    // echoed back by the client
  seat: SeatId;                  // who must answer
  prompt: PromptSpec;            // machine-readable, NOT a display string
  minChoices: number; maxChoices: number;
  options: ChoiceOption[];
};
```

The loop:

1. A player command (or a phase advance) pushes one or more `Frame`s.
2. `drain(state)` pops the top frame and applies it. Applying may push further frames — that's
   how `forEach`, `chooseOne` and sequences compose.
3. If an effect needs input, it sets `state.pending` and returns immediately, leaving its
   remaining work on the stack. `drain` stops.
4. The client sends `{ type: "respondToInput", id, choices }`. The engine validates against
   `pending`, clears it, pushes the frames implied by the answer, and calls `drain` again.
5. When the stack empties and `pending` is null, the state is stable and safe to broadcast.

Invariant to assert in tests: **a state is only ever broadcast when `resolution` is empty or
`pending` is non-null.** Never both empty-and-blocked, never mid-resolution with no pending.

While `pending` is set, the engine rejects every action except `respondToInput` from that seat
(and `undo`, if implemented). No exceptions — this is what stops two players from racing.

## Effect vocabulary

Effects are plain data. Start with this set and extend only when a real card needs it. Every op
needs a handler and a test.

```ts
type Effect =
  // resources
  | { op: "gainAttack"; amount: Amount; target?: TargetSpec }
  | { op: "gainInfluence"; amount: Amount }
  | { op: "heal"; amount: Amount; target: TargetSpec }
  | { op: "damage"; amount: Amount; target: TargetSpec }
  // cards
  | { op: "draw"; count: Amount; target?: TargetSpec }
  | { op: "discard"; count: Amount; target: TargetSpec; chooser: "target" | "controller" }
  | { op: "moveCard"; from: ZoneRef; to: ZoneRef; select: CardSelector }
  | { op: "revealTop"; zone: ZoneRef; count: number; then: Effect }
  | { op: "acquireFree"; filter: CardFilter; maxCost?: number }
  // board
  | { op: "addControl"; amount: Amount }
  | { op: "removeControl"; amount: Amount }
  | { op: "assignDamageToVillain"; villain: TargetSpec; amount: Amount }
  | { op: "stun"; target: TargetSpec }
  | { op: "rollDie"; die: DieId; then: Effect }
  // control flow
  | { op: "sequence"; effects: Effect[] }
  | { op: "chooseOne"; options: { label: LabelKey; effect: Effect }[]; chooser: TargetSpec }
  | { op: "chooseTarget"; spec: TargetSpec; then: Effect }        // binds ctx.target
  | { op: "forEach"; over: TargetSpec | CardSelector; effect: Effect }
  | { op: "ifThen"; cond: Predicate; then: Effect; else?: Effect }
  | { op: "repeat"; times: Amount; effect: Effect }
  // lasting
  | { op: "addModifier"; modifier: Omit<Modifier, "id"> }
  | { op: "noop" };

type Amount = number | { expr: "count"; of: CountableRef };   // "1 per Ally in play"
type TargetSpec =
  | { who: "controller" } | { who: "activePlayer" } | { who: "allHeroes" }
  | { who: "choose"; from: "anyHero" | "otherHeroes" | "activeVillains"; chooser: TargetSpec }
  | { who: "each"; from: "heroes" };
```

Two rules about this vocabulary:

- **`label` is a key, never a sentence.** The engine emits `{ label: "discard1" }`; the client
  maps keys to display strings. This keeps card text out of the engine and makes the UI
  translatable, and it's what lets the repo stay free of printed card text.
- **When a card doesn't fit the vocabulary, extend the vocabulary — don't special-case the card.**
  If you find yourself writing a handler that checks a card id, the model is wrong.

Expect roughly 70% of cards to be one or two ops, 25% to need `chooseOne`/`ifThen`, and a handful
to need a genuinely new op. That handful is fine. A registry of bespoke functions keyed by card id
is not.

## Triggers and lasting effects

Anything that fires on something else happening is a `Modifier`:

```ts
type Modifier = {
  id: string;
  source: { kind: "card" | "location" | "villain" | "horcrux" | "proficiency"; id: CardId };
  on: GameEventType;                  // "cardPlayed", "villainDefeated", "damageAssigned"…
  condition?: Predicate;
  effect: Effect;
  duration: "thisTurn" | "thisRound" | "whileSourceActive" | "permanent";
  limitPerTurn?: number;
  usesThisTurn?: number;
};
```

`emit(state, event)` walks `state.modifiers`, filters by `on` and `condition`, and pushes their
effects onto the resolution stack in a defined order: active villains first, then locations, then
the active player's cards, then other players' cards, then permanents. Write that order down in
code as a comment and a test, because two triggers firing on the same event in the wrong order is
the classic subtle bug in this genre.

Villain abilities that say "when X happens, Y" are modifiers registered when the villain enters
play and removed when it's defeated. Locations are the same. This means there is no separate
"villain ability system" to keep in sync.

## Actions

```ts
type Action =
  | { type: "playCard"; cardId: CardId }
  | { type: "acquireCard"; cardId: CardId }              // from the market row
  | { type: "assignAttack"; villainSlot: number; amount: number }
  | { type: "respondToInput"; id: string; choices: ChoiceRef[] }
  | { type: "advancePhase" }
  | { type: "concede" };
```

Deliberately small. Anything else — refilling the market, resetting resources, drawing back up —
is a consequence the engine performs, never something the client asks for. If the client can ask
for it, someone will ask for it twice.

Every action returns `{ ok: false, reason }` rather than throwing, so the DO can reply to the
offending client without unwinding.

## Invariants to test as properties

- **Card conservation.** For every card id in the year's setup, the total count across all zones
  is constant for the whole game. This one test catches the majority of zone-movement bugs.
- **Replay determinism.** `snapshot + actionLog` replayed gives an identical state hash.
- **Serialisation round-trip.** `parse(stringify(state))` deep-equals `state`.
- **No broadcast mid-resolution.** As described above.
- **Resource reset.** At `turnEnd`, every player's `attack` and `influence` are 0 and per-turn
  counters are cleared.
- **Termination.** `drain` cannot loop forever: cap iterations (say 10,000) and throw a loud
  internal error, because an infinite trigger loop is a real possibility with modifiers.
