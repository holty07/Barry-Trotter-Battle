// Canonical engine types — docs/02-engine-spec.md. Pure types, no runtime
// dependency on anything (packages/content imports these, never the other
// way around — see docs/01-architecture.md "Repository boundaries").
//
// A few sub-types below are referenced in docs/02 but never shaped there
// (PromptSpec, ChoiceOption, ChoiceRef, GameEventType, GameEvent, LogEntry,
// VillainInPlay, RejectReason). Each is marked TODO(spec) with a minimal
// inferred shape — tighten these once M2b/2c need more from them, per the
// "extend the vocabulary, don't special-case" rule.

export type SeatId = string;
export type CardId = string;
export type HeroId = string;
export type YearId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Rng = { seed: number; cursor: number };

export type LabelKey = string;

// --- TargetSpec — docs/02 "Effect vocabulary", verbatim, plus two additions ---
// TODO(spec): `{ who: "target" }` isn't in docs/02's union. `chooseTarget`
// binds ctx.target but nothing in the original union can reference it
// afterwards, so this is the mechanism until confirmed otherwise.
// `{ who: "eventSeat" }` (added for villain reactions to a discard): the seat named on the
// event a modifier is reacting to (`ctx.vars.event.seat`) — e.g. "that hero
// loses 1 health" needs the hero from the discard event, not necessarily
// the active player.
export type TargetSpec =
  | { who: "controller" }
  | { who: "activePlayer" }
  | { who: "allHeroes" }
  | { who: "target" }
  | { who: "eventSeat" }
  | { who: "choose"; from: "anyHero" | "otherHeroes" | "activeVillains"; chooser: TargetSpec }
  | { who: "each"; from: "heroes" };

// --- ZoneRef / CardSelector / CardFilter / CountableRef / Predicate / DieId
// --- referenced in docs/02 but never defined there. TODO(spec): inferred
// minimal shapes — see packages/content's original schema for the same note.
export type ZoneOwner = TargetSpec | "market" | "darkArts" | "villains" | "locations" | "horcruxes";
export type ZoneRef = { owner: ZoneOwner; zone: string };
export type CardFilter = { types?: string[]; maxCost?: number };
// `fromEvent` (added for "put the card you acquire on top of your deck" cards): select
// exactly the one card named on the triggering event (`ctx.vars.event.cardId`)
// — "you may put the card you just acquired on top of your deck", not every
// card in the zone.
export type CardSelector = { zone?: ZoneRef; types?: string[]; matchAll?: boolean; fromEvent?: boolean };
// `{ counter: string }` (added for "for each ally played this turn"): a named running tally in
// `state.counters` (docs/02 itself names "cards played" as an example use),
// as opposed to counting cards currently sitting in a zone.
export type CountableRef = { matching: CardSelector } | { counter: string };
export type Amount = number | { expr: "count"; of: CountableRef };
export type DieId = string;

// `cardTypeIs`/`eventCardIsSource` added for "caused by a Dark Arts event or
// Villain" reactions and "if you discard this card" checks
// ("this exact card"). `ref: "eventCard"` looks at `ctx.vars.event.cardId`
// (the card the event is about, e.g. which card got discarded); `ref:
// "eventSource"` looks at `ctx.vars.event.sourceCardId` (the card whose
// effect caused the event — deliberately *not* `ctx.source`, which for a
// *reacting* modifier is always the reacting card itself, never the card
// that triggered it).
export type Predicate =
  | { kind: "always" }
  | { kind: "not"; of: Predicate }
  | { kind: "and"; of: Predicate[] }
  | { kind: "or"; of: Predicate[] }
  | { kind: "countAtLeast"; ref: CountableRef; amount: number }
  | { kind: "cardTypeIs"; ref: "eventCard" | "eventSource"; cardType: string }
  | { kind: "eventCardIsSource" };

// --- Effect vocabulary — docs/02 "Effect vocabulary", plus two additions ---
// TODO(spec): docs/02 gives `gainInfluence` no `target` field at all (unlike
// the otherwise-identical `gainAttack`), but real content needs "all heroes
// gain 1 influence". Added the
// same optional `target` gainAttack already has, for symmetry.
// `adjustCounter` (added for "cannot draw extra cards this turn" and "for each
// ally played this turn"): a generic way
// for content to read/write a named `state.counters` entry — docs/02's own
// comment on `counters` names exactly this use ("cards played, villains
// defeated…").
export type Effect =
  | { op: "gainAttack"; amount: Amount; target?: TargetSpec }
  | { op: "gainInfluence"; amount: Amount; target?: TargetSpec }
  | { op: "heal"; amount: Amount; target: TargetSpec }
  | { op: "damage"; amount: Amount; target: TargetSpec }
  | { op: "draw"; count: Amount; target?: TargetSpec }
  | { op: "discard"; count: Amount; target: TargetSpec; chooser: "target" | "controller" }
  | { op: "moveCard"; from: ZoneRef; to: ZoneRef; select: CardSelector }
  | { op: "revealTop"; zone: ZoneRef; count: number; then: Effect }
  | { op: "acquireFree"; filter: CardFilter; maxCost?: number }
  | { op: "addControl"; amount: Amount }
  | { op: "removeControl"; amount: Amount }
  | { op: "assignDamageToVillain"; villain: TargetSpec; amount: Amount }
  | { op: "stun"; target: TargetSpec }
  | { op: "rollDie"; die: DieId; then: Effect }
  | { op: "sequence"; effects: Effect[] }
  | { op: "chooseOne"; options: { label: LabelKey; effect: Effect }[]; chooser: TargetSpec }
  | { op: "chooseTarget"; spec: TargetSpec; then: Effect }
  | { op: "forEach"; over: TargetSpec | CardSelector; effect: Effect }
  | { op: "ifThen"; cond: Predicate; then: Effect; else?: Effect }
  | { op: "repeat"; times: Amount; effect: Effect }
  // `source` is optional here (unlike the base Modifier type) for the same
  // reason `controller` already was: a card registering its own reactive
  // modifier doesn't need to restate its own id
  // — it defaults to whichever card's effect is currently resolving.
  | { op: "addModifier"; modifier: Omit<Modifier, "id" | "source"> & { source?: Modifier["source"] } }
  | { op: "adjustCounter"; key: string; amount: Amount }
  | { op: "noop" };

export const EFFECT_OPS = [
  "gainAttack",
  "gainInfluence",
  "heal",
  "damage",
  "draw",
  "discard",
  "moveCard",
  "revealTop",
  "acquireFree",
  "addControl",
  "removeControl",
  "assignDamageToVillain",
  "stun",
  "rollDie",
  "sequence",
  "chooseOne",
  "chooseTarget",
  "forEach",
  "ifThen",
  "repeat",
  "addModifier",
  "adjustCounter",
  "noop",
] as const;

// --- Modifier — docs/02 "Triggers and lasting effects", verbatim ---
// TODO(spec): `on` (GameEventType) has no exhaustive list in docs/02, only
// examples ("cardPlayed", "villainDefeated", "damageAssigned") — left open.
export type GameEventType = string;
export type GameEvent = { type: GameEventType; [key: string]: unknown };

// TODO(spec): `controller` isn't in docs/02's Modifier shape. The trigger
// order (docs/02 "the active player's cards, then other players' cards")
// needs to know which seat a card-sourced modifier belongs to; source alone
// doesn't say. Undefined for modifiers with no owning seat (villain,
// location, horcrux).
export type Modifier = {
  id: string;
  source: { kind: "card" | "location" | "villain" | "horcrux" | "proficiency"; id: CardId };
  controller?: SeatId;
  on: GameEventType;
  condition?: Predicate;
  effect: Effect;
  duration: "thisTurn" | "thisRound" | "whileSourceActive" | "permanent";
  limitPerTurn?: number;
  usesThisTurn?: number;
};

// --- Resolution stack — docs/02 "Effect resolution: a stack, not a function
// call", verbatim, plus inferred PromptSpec/ChoiceOption/ChoiceRef shapes.
export type Frame = { effect: Effect; ctx: EffectContext };
export type EffectContext = { source: CardId; controller: SeatId; target?: SeatId; vars: Record<string, unknown> };

export type PromptSpec = { key: string; vars?: Record<string, unknown> };
export type ChoiceOption = { id: string; label: LabelKey };
export type ChoiceRef = string;

export type PendingInput = {
  id: string;
  seat: SeatId;
  prompt: PromptSpec;
  minChoices: number;
  maxChoices: number;
  options: ChoiceOption[];
  resume: PendingResume;
};

// TODO(spec): VillainInPlay isn't shaped in docs/02 — inferred as the card
// in that slot plus damage assigned to it so far (health itself lives on
// the villain's card data, supplied by the caller, not duplicated here).
export type VillainInPlay = { cardId: CardId; damageTaken: number };

// --- M2b resolution internals ---
// `chooseTarget`'s bound result: a hero (seat) or a villain slot. Neither
// docs/02's `EffectContext.target: SeatId` nor its TargetSpec union can
// express "the villain the player just chose", so resolved choices live in
// `ctx.vars.boundTarget` instead — see packages/engine/src/target.ts.
export type BoundTarget = { kind: "seat"; seat: SeatId } | { kind: "villainSlot"; index: number };

// What to do once a pending input's answer comes back. Engine-internal —
// not part of docs/02's PendingInput sketch, but PendingInput itself never
// says how a paused effect resumes, so this fills that gap.
export type PendingResume =
  | { kind: "chooseOne"; ctx: EffectContext; chosenEffects: Effect[] }
  | { kind: "chooseTarget"; ctx: EffectContext; then: Effect; candidates: BoundTarget[] };

// Structured, not display text (docs/02: engine vocabulary is machine keys;
// the client renders the words). Written by log.ts from each action.
export type LogKind =
  | "turnStarted"
  | "cardPlayed"
  | "cardAcquired"
  | "attackAssigned"
  | "villainDefeated"
  | "darkArtsRevealed"
  | "controlAdded"
  | "controlRemoved"
  | "locationLost"
  | "heroStunned"
  | "gameWon"
  | "gameLost";
export type LogEntry = { turn: number; kind: LogKind; seat?: SeatId; cardId?: CardId; amount?: number };

export type PlayerState = {
  heroId: HeroId;
  heroLevel: 1 | 2 | 3;
  deck: CardId[];
  hand: CardId[];
  discard: CardId[];
  inPlay: CardId[];
  health: number;
  maxHealth: number;
  stunned: boolean;
  attack: number;
  influence: number;
  tokens: Record<string, number>;
};

export type Phase = "turnStart" | "darkArts" | "villainAbilities" | "main" | "discardAndDraw" | "turnEnd";

export type GameState = {
  schema: 1;
  rng: Rng;
  year: YearId;
  status: "setup" | "playing" | "won" | "lost";
  phase: Phase;
  turn: { activeSeat: SeatId; number: number };
  seats: SeatId[];
  players: Record<SeatId, PlayerState>;
  market: { deck: CardId[]; row: (CardId | null)[]; discard: CardId[] };
  darkArts: { deck: CardId[]; discard: CardId[]; revealedThisTurn: CardId[] };
  villains: { deck: CardId[]; slots: (VillainInPlay | null)[]; defeated: CardId[] };
  locations: { order: CardId[]; current: number; controlTokens: number };
  horcruxes?: { deck: CardId[]; active: CardId | null; destroyed: CardId[] };
  proficiency?: Record<SeatId, CardId>;
  resolution: Frame[];
  pending: PendingInput | null;
  modifiers: Modifier[];
  counters: Record<string, number>;
  log: LogEntry[];
};

// --- Actions — docs/02 "Actions", verbatim ---
// TODO(spec): RejectReason has no defined shape/union in docs/02 — left as
// an open string until real rejection cases in 2b/2c reveal a useful union.
export type RejectReason = string;

export type Action =
  | { type: "playCard"; cardId: CardId }
  | { type: "acquireCard"; cardId: CardId }
  | { type: "assignAttack"; villainSlot: number; amount: number }
  | { type: "respondToInput"; id: string; choices: ChoiceRef[] }
  | { type: "advancePhase" }
  | { type: "concede" };

export type ReduceResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: RejectReason };
