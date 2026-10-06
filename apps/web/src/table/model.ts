// Display-ready shape the Table renders. Derived from the engine's
// PlayerView by plain selectors (game/selectors.ts, docs/05
// "Implementation notes") — components never read GameState or content.

export type CardKind = "spell" | "item" | "ally" | "villain" | "darkArts" | "location";

export type CardFace = {
  id: string;
  name: string;
  text: string;
  kind: CardKind;
  cost?: number;
  health?: number;
  year?: number; // introducedIn — the "Game N" tag; 0 = starter, no tag
  hero?: string; // owning hero's display name, for starter cards — the bottom ribbon
};

export type HeroSummary = {
  seat: string;
  heroName: string;
  health: number;
  maxHealth: number;
  attack: number;
  influence: number;
  stunned: boolean;
};

export type PromptModel = {
  id: string;
  heroName: string;
  hero: HeroSummary; // the chooser's own numbers, visible while choosing
  title: string;
  source: CardFace | null;
  minChoices: number;
  maxChoices: number;
  options: { id: string; label: string }[];
};

export type TableModel = {
  location: { name: string; number: number; of: number; control: number; slots: number };
  turn: number;
  threat: number;
  villains: { slot: number; face: CardFace; damage: number }[];
  darkArts: CardFace[];
  market: { row: (CardFace | null)[]; deckCount: number };
  // Everyone but the viewer. Hands are only shown when a profile is opened.
  others: (HeroSummary & { active: boolean; hand: CardFace[] | null; handCount: number; played: CardFace[] })[];
  // The viewer's own hero — online that's your seat, hot-seat the seat the game is waiting on.
  you: HeroSummary & { deckCount: number; discardCount: number; hand: CardFace[]; played: CardFace[] };
  activeHero: string; // whose turn it is
  yourTurn: boolean;
  canAct: boolean;
  prompt: PromptModel | null; // the viewer must answer
  waitingOn: string | null; // hero name the game is waiting on, when it isn't the viewer
};
