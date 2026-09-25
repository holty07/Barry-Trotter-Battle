import { useMemo } from "react";
import { useGame } from "../game/connection.tsx";
import type { ContentBundle } from "../game/content.ts";
import { logLine, tableModel } from "../game/selectors.ts";
import { Table } from "../table/Table.tsx";

export function TableScreen({ bundle }: { bundle: ContentBundle }) {
  const { view, recent, rejection, send } = useGame();
  const model = useMemo(() => tableModel(view, bundle), [view, bundle]);
  const announcement = useMemo(() => recent.map((e) => logLine(e, view, bundle)).join(" "), [recent, view, bundle]);

  return (
    <Table
      model={model}
      rejection={rejection}
      announcement={announcement}
      handlers={{
        onPlay: (cardId) => send({ type: "playCard", cardId }),
        onAcquire: (cardId) => send({ type: "acquireCard", cardId }),
        onAssign: (villainSlot, amount) => send({ type: "assignAttack", villainSlot, amount }),
        onEndTurn: () => send({ type: "advancePhase" }),
        onAnswer: (id, choices) => send({ type: "respondToInput", id, choices }),
      }}
    />
  );
}
