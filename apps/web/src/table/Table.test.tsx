import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PlayerView } from "@hb/engine";
import type { ContentBundle } from "../game/content.ts";
import { tableModel } from "../game/selectors.ts";
import { Table, type TableHandlers } from "./Table.tsx";

afterEach(cleanup);

// Synthetic names only (CLAUDE.md hard rule 2).
const bundle = {
  faces: {
    "spell.test-a": { id: "spell.test-a", name: "Test Spell A", text: "Gain 1 influence.", kind: "spell" },
    "ally.test-a": { id: "ally.test-a", name: "Test Ally A", text: "Choose one.", kind: "ally", cost: 0 },
    "villain.test-a": { id: "villain.test-a", name: "Test Villain A", text: "Fixture.", kind: "villain", health: 5 },
    "location.test-a": { id: "location.test-a", name: "Test Location A", text: "", kind: "location" },
  },
  catalog: { "location.test-a": { controlSlots: 4 } },
  heroName: (heroId: string) => ({ "hero.a": "Hero A", "hero.b": "Hero B" })[heroId] ?? heroId,
} as unknown as ContentBundle;

const player = (heroId: string) => ({
  heroId,
  heroLevel: 1 as const,
  health: 10,
  maxHealth: 10,
  stunned: false,
  attack: 0,
  influence: 0,
  hand: ["spell.test-a"],
  handCount: 1,
  deckCount: 4,
  discard: [],
  inPlay: [],
});

const baseView: PlayerView = {
  you: "seat-1",
  year: 1,
  status: "playing",
  phase: "main",
  turn: { activeSeat: "seat-1", number: 3 },
  seats: ["seat-1", "seat-2"],
  players: { "seat-1": player("hero.a"), "seat-2": player("hero.b") },
  market: { row: [], deckCount: 10, discard: [] },
  darkArts: { deckCount: 5, discard: [], revealedThisTurn: [] },
  villains: { slots: [{ cardId: "villain.test-a", damageTaken: 1 }], deckCount: 0, defeated: [] },
  locations: { order: ["location.test-a"], current: 0, controlTokens: 1 },
  pending: null,
  waitingOn: null,
};

const handlers = (): TableHandlers => ({ onPlay: vi.fn(), onAcquire: vi.fn(), onAssign: vi.fn(), onEndTurn: vi.fn(), onAnswer: vi.fn() });

describe("pending-input sheet (docs/05)", () => {
  it("renders exactly the options in view.pending and answers with the chosen id", () => {
    const view: PlayerView = {
      ...baseView,
      pending: {
        id: "p7",
        seat: "seat-1",
        prompt: { key: "chooseOne" },
        minChoices: 1,
        maxChoices: 1,
        options: [
          { id: "0", label: "gainAttack" },
          { id: "1", label: "gainHealth" },
        ],
        source: "ally.test-a",
      },
      waitingOn: "seat-1",
    };
    const h = handlers();
    render(<Table model={tableModel(view, bundle)} rejection={null} announcement="" handlers={h} />);

    const sheet = screen.getByRole("dialog", { name: "Hero A: choose one" });
    expect(sheet).toBeTruthy();
    expect(screen.getByText("From Test Ally A.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Gain health" }));
    expect(h.onAnswer).toHaveBeenCalledWith("p7", ["1"]);
  });

  it("shows everyone else who the game is waiting on, in the same place", () => {
    const view: PlayerView = { ...baseView, waitingOn: "seat-2" };
    render(<Table model={tableModel(view, bundle)} rejection={null} announcement="" handlers={handlers()} />);
    expect(screen.getByRole("heading", { name: "Waiting for Hero B to choose." })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables playing while waiting on a prompt, and shows a rejection from the engine", () => {
    const view: PlayerView = { ...baseView, waitingOn: "seat-2" };
    const h = handlers();
    render(<Table model={tableModel(view, bundle)} rejection="not enough influence" announcement="" handlers={h} />);
    expect(screen.queryByRole("button", { name: /^Play: / })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Not enough influence.");
  });
});
