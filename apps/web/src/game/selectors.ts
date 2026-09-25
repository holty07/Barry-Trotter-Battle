import type { CardId, LogEntry, PlayerView } from "@hb/engine";
import type { CardFace, HeroSummary, PromptModel, TableModel } from "../table/model.ts";
import type { ContentBundle } from "./content.ts";

// Plain selectors from PlayerView (+ static card faces) to what the Table
// renders. No rules here: every choice comes from view.pending, every
// number from the view.

function face(bundle: ContentBundle, id: CardId): CardFace {
  return bundle.faces[id] ?? { id, name: id, text: "", kind: "spell" };
}

function heroOf(view: PlayerView, bundle: ContentBundle, seat: string): string {
  const player = view.players[seat];
  return player ? bundle.heroName(player.heroId) : seat;
}

function summary(view: PlayerView, bundle: ContentBundle, seat: string): HeroSummary {
  const p = view.players[seat]!;
  return {
    seat,
    heroName: bundle.heroName(p.heroId),
    health: p.health,
    maxHealth: p.maxHealth,
    attack: p.attack,
    influence: p.influence,
    stunned: p.stunned,
  };
}

// Prompt labels are machine keys authored in content (docs/02); this is
// only their wording. Unknown keys fall back to a readable version of the key.
const OPTION_LABELS: Record<string, string> = {
  gainAttack: "Gain attack",
  gainHealth: "Gain health",
  gainInfluence: "Gain influence",
  gainInfluence2: "Gain 2 influence",
  allGainInfluence1: "All heroes gain 1 influence",
  draw: "Draw a card",
  healAnyHero: "Heal any one hero",
  keepInDiscard: "Keep it in your discard pile",
  topOfDeck: "Put it on top of your deck",
};

const PROMPT_TITLES: Record<string, string> = {
  chooseOne: "choose one",
  chooseTarget: "choose a target",
};

export function humaniseKey(key: string): string {
  const words = key.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function optionLabel(view: PlayerView, bundle: ContentBundle, label: string): string {
  if (view.players[label]) return heroOf(view, bundle, label);
  const villainSlot = /^villainSlot:(\d+)$/.exec(label);
  if (villainSlot) {
    const villain = view.villains.slots[Number(villainSlot[1])];
    return villain ? face(bundle, villain.cardId).name : label;
  }
  return OPTION_LABELS[label] ?? humaniseKey(label);
}

export function promptModel(view: PlayerView, bundle: ContentBundle): PromptModel | null {
  const pending = view.pending;
  if (!pending) return null;
  return {
    id: pending.id,
    heroName: heroOf(view, bundle, pending.seat),
    title: PROMPT_TITLES[pending.prompt.key] ?? humaniseKey(pending.prompt.key).toLowerCase(),
    source: bundle.faces[pending.source] ?? null,
    minChoices: pending.minChoices,
    maxChoices: pending.maxChoices,
    options: pending.options.map((o) => ({ id: o.id, label: optionLabel(view, bundle, o.label) })),
  };
}

export function tableModel(view: PlayerView, bundle: ContentBundle): TableModel {
  const { order, current, controlTokens } = view.locations;
  const locationId = order[Math.min(current, order.length - 1)]!;
  const slots = bundle.catalog[locationId]?.controlSlots ?? 1;
  const active = view.turn.activeSeat;
  const you = view.players[active]!;

  return {
    location: { name: face(bundle, locationId).name, number: Math.min(current + 1, order.length), of: order.length, control: controlTokens, slots },
    threat: Math.min(1, (current + controlTokens / slots) / order.length),
    villains: view.villains.slots.flatMap((v, slot) => (v ? [{ slot, face: face(bundle, v.cardId), damage: v.damageTaken }] : [])),
    darkArts: view.darkArts.revealedThisTurn.map((id) => face(bundle, id)),
    market: { row: view.market.row.map((id) => (id ? face(bundle, id) : null)), deckCount: view.market.deckCount },
    others: view.seats.filter((s) => s !== active).map((s) => summary(view, bundle, s)),
    you: {
      ...summary(view, bundle, active),
      deckCount: you.deckCount,
      discardCount: you.discard.length,
      hand: (you.hand ?? []).map((id) => face(bundle, id)),
      played: you.inPlay.map((id) => face(bundle, id)),
    },
    canAct: view.status === "playing" && view.phase === "main" && view.waitingOn === null && view.you === active,
    prompt: promptModel(view, bundle),
    waitingOn: view.waitingOn && !view.pending ? heroOf(view, bundle, view.waitingOn) : null,
  };
}

export function logLine(entry: LogEntry, view: PlayerView, bundle: ContentBundle): string {
  const hero = entry.seat ? heroOf(view, bundle, entry.seat) : "";
  const card = entry.cardId ? face(bundle, entry.cardId).name : "";
  switch (entry.kind) {
    case "turnStarted":
      return `Turn ${entry.turn}: ${hero}'s turn.`;
    case "cardPlayed":
      return `${hero} played ${card}.`;
    case "cardAcquired":
      return `${hero} acquired ${card}.`;
    case "attackAssigned":
      return `${hero} assigned ${entry.amount} attack to ${card}.`;
    case "villainDefeated":
      return `${card} was defeated.`;
    case "darkArtsRevealed":
      return `Dark Arts revealed: ${card}.`;
    case "controlAdded":
      return `${entry.amount} villain control added to the location.`;
    case "controlRemoved":
      return `${entry.amount} villain control removed from the location.`;
    case "locationLost":
      return `${card} fell to the villains.`;
    case "heroStunned":
      return `${hero} was stunned.`;
    case "gameWon":
      return "The heroes won.";
    case "gameLost":
      return "The villains took every location.";
  }
}
