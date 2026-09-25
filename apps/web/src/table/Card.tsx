import type { CardFace, CardKind } from "./model.ts";

const KIND_LABEL: Record<CardKind, string> = {
  spell: "Spell",
  item: "Item",
  ally: "Ally",
  villain: "Villain",
  darkArts: "Dark Arts",
  location: "Location",
};

const KIND_FILL: Record<CardKind, string> = {
  spell: "bg-spell",
  item: "bg-item",
  ally: "bg-ally",
  villain: "bg-signal",
  darkArts: "bg-signal",
  location: "bg-panel",
};

// Stands in for the printed artwork (which we can't ship): a large abstract
// mark per type, so type still reads at a glance without a caption.
function KindGlyph({ kind }: { kind: CardKind }) {
  const base = "border-bone/35";
  if (kind === "spell") return <span aria-hidden className={`size-8 border-t-4 border-l-4 ${base}`} />;
  if (kind === "item") return <span aria-hidden className="size-6 bg-bone/35" />;
  if (kind === "ally")
    return (
      <span aria-hidden className="flex w-9 flex-col gap-1.5">
        <span className="h-1 bg-bone/35" />
        <span className="h-1 bg-bone/35" />
      </span>
    );
  return <span aria-hidden className={`size-7 rotate-45 border-4 ${base}`} />;
}

type CardProps = {
  face: CardFace;
  damage?: number;
  dimmed?: boolean;
  onClick?: () => void;
  actionLabel?: string;
  showCost?: boolean;
};

// Layout follows the physical card: dark frame; cost top-left and "Game N"
// top-right over the picture area; a type plaque on the seam; name and
// rules text centred on parchment; the owning hero on a bottom ribbon.
export function Card({ face, damage = 0, dimmed = false, onClick, actionLabel, showCost = true }: CardProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={actionLabel ? `${actionLabel}: ${face.name}` : undefined}
      className={[
        "relative flex aspect-[5/7] w-full flex-col rounded-md bg-frame p-1 text-center text-table",
        dimmed ? "opacity-50 saturate-50" : "",
        onClick ? "cursor-pointer" : "",
      ].join(" ")}
    >
      <div className={`relative flex h-[30%] shrink-0 items-center justify-center rounded-t-sm ${KIND_FILL[face.kind]}`}>
        <KindGlyph kind={face.kind} />
        {showCost && face.cost !== undefined && (
          <span
            className="absolute top-1 left-1 flex size-6 items-center justify-center rounded-full border border-frame bg-brass text-body font-semibold text-table"
            aria-label={`costs ${face.cost}`}
          >
            {face.cost}
          </span>
        )}
        {face.year !== undefined && face.year > 0 && (
          <span className="absolute top-1 right-1.5 text-caption font-semibold text-bone/80">Game {face.year}</span>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col items-center rounded-b-sm bg-parchment px-1.5 pt-3.5 pb-1.5">
        <span
          className={`absolute -top-2.5 rounded-sm border border-parchment/70 px-2 text-caption font-semibold text-bone ${KIND_FILL[face.kind]}`}
        >
          {KIND_LABEL[face.kind]}
        </span>
        <span className="font-serif text-title font-semibold [font-variant-caps:small-caps]">{face.name}</span>
        <span className="mt-1 min-h-0 overflow-hidden text-caption">{face.text}</span>
        {face.health !== undefined && (
          <span className="mt-auto flex items-center gap-1.5 pt-1" aria-label={`${face.health - damage} of ${face.health} health left`}>
            <span className="flex flex-wrap justify-center gap-0.5" aria-hidden>
              {Array.from({ length: face.health }, (_, i) => (
                <span key={i} className={`h-2 w-2 ${i < damage ? "bg-table/15" : "bg-signal"}`} />
              ))}
            </span>
            <span className="text-body font-semibold" aria-hidden>
              {face.health - damage}
            </span>
          </span>
        )}
      </div>

      {face.hero && (
        <span className="mx-4 mt-1 shrink-0 truncate rounded-sm bg-parchment/80 px-1 text-caption leading-4 font-semibold [font-variant-caps:small-caps]">
          {face.hero}
        </span>
      )}
    </Tag>
  );
}
