# 03 — Content schema and transcription

## Why content is separate and git-ignored

Game rules and mechanics aren't protectable, but printed card text and artwork belong to their
publisher. Keeping the data out of the repository means the code is clean to push to GitHub, and
the data stays a private local asset you transcribed from the copy you own. It also has a real
engineering benefit: the engine can't depend on specific cards if it has never seen them.

```
content/                 # git-ignored
  years/1.json           # scenario: which cards, how many slots, rule flags
  cards/spells.json
  cards/items.json
  cards/allies.json
  cards/villains.json
  cards/darkarts.json
  cards/locations.json
  cards/heroes.json
  cards/proficiencies.json
  cards/horcruxes.json
packages/content/fixtures/   # committed — synthetic cards for engine tests
```

Add `content/` to `.gitignore` in M0. Back it up somewhere private (a private repo, or your own
Drive) — it will represent many hours of work.

## Card ID convention

`<type>.<slug>` — stable, lowercase, never renamed once used. Examples: `spell.incendio`,
`villain.quirrell`, `location.forbidden-forest`. The year a card is *introduced* is metadata, not
part of the id, because a card can appear in the market across several years.

## Schema

```ts
type CardBase = {
  id: CardId;
  name: string;                  // as printed — lives only in content/
  type: CardType;
  introducedIn: YearId;
  copies: number;                // how many of this card the box contains
  text: string;                  // as printed, for display only. Never parsed.
  effects: Effect[];             // the machine-readable version of `text`
  notes?: string;                // your transcription notes, ambiguities
};

type MarketCard = CardBase & { type: "spell" | "item" | "ally"; cost: number };
type VillainCard = CardBase & {
  type: "villain"; health: number;
  ability?: Modifier[];          // "while active" triggers
  reward: Effect[];              // on defeat
};
type DarkArtsCard = CardBase & { type: "darkArts" };
type LocationCard = CardBase & { type: "location"; controlSlots: number; effects: Effect[] };
type HeroCard = CardBase & { type: "hero"; hero: HeroId; level: 1 | 2 | 3 };
```

`text` and `effects` are both required and must agree. `text` is what renders on the card face in
the UI; `effects` is what actually happens. The transcription step is: copy `text` verbatim, then
express it as `effects`, then have the reviewer check that the two match.

## Year scenario file

```jsonc
// content/years/1.json
{
  "year": 1,
  "villainSlots": 1,              // varies by year and sometimes player count
  "marketRowSize": 6,
  "darkArtsPerTurn": 1,
  "startingHealth": 10,
  "locations": ["location.diagon-alley", "location.mirror-of-erised"],
  "villains": ["villain.quirrell", "..."],
  "darkArts": ["darkarts.flipendo", "..."],
  "market": ["spell.incendio", "..."],
  "heroLevel": 1,
  "flags": { "usesDice": false, "usesProficiencies": false, "usesHorcruxes": false },
  "rulesDeltas": ["TODO(rules): confirm from the Game 1 manual"]
}
```

Player-count-dependent numbers go here as either a scalar or `{ "2": x, "3": y, "4": z }`. The
loader normalises.

## The validation target

This count matrix is sourced from a community physical inventory of a retail copy, so it's a
genuine completeness test — not a reconstruction. `npm run content:check` must assert your
transcribed `copies` totals against it, per year, per type.

| Card type | Y0 (starters) | Y1 | Y2 | Y3 | Y4 | Y5 | Y6 | Y7 | Total |
|---|---|---|---|---|---|---|---|---|---|
| Location | – | 2 | 3 | 3 | 3 | 3 | 3 | 4 | 21 |
| Dark Arts | – | 10 | 5 | 4 | 8 | 7 | 3 | 4 | 41 |
| Villain | – | 3 | 3 | 2 | 2 | 3 | 3 | 1 | 17 |
| Spell | 28 | 17 | 4 | 4 | 5 | 2 | 2 | 0 | 62 |
| Item | 8 | 10 | 4 | 9 | 8 | 2 | 7 | 1 | 49 |
| Ally | 4 | 3 | 6 | 3 | 8 | 6 | 1 | 0 | 31 |
| Hero | – | 4 | – | 4 | – | – | – | 4 | 12 |
| Proficiency | 4 | – | – | – | – | – | 9 | – | 13 |
| Horcrux | – | – | – | – | – | – | – | 6 | 6 |
| **Total** | **44** | **49** | **25** | **29** | **34** | **23** | **28** | **20** | **252** |

Spell + Item + Ally together are the Hogwarts (market) deck — 142 cards. The four "Proficiency"
cards in the Y0 column are the turn-order cards, which occupy the same board slot; model them
separately from real Proficiencies. Note that the twelve Hero cards arrive in three waves (Years
1, 3 and 7, four each), which is why `heroLevel` is a scenario field rather than a constant.

Non-card components, by the year that introduces them: Year 3 adds two tokens tied to the
Petrificus Totalus spells, Year 4 adds the four house dice, Year 7 adds four Horcrux tokens.
Every box from Game 2 onward has its own mini-manual, and those manuals are the authoritative
spec for that year's rule changes.

Known printing quirk: some early copies shipped two Confundus cards in Year 5 in place of
Stupefy. If your copy is one of them, transcribe what the intended contents are, not what's in
the box, and note it.

## Transcription workflow

Do it year by year, and do Year 1 completely before writing any engine code beyond the skeleton.
Year 1 exercises almost every mechanic in the base game.

1. Sort the year's cards by type.
2. For each card: id, name, type, cost/health, `copies`, then `text` verbatim.
3. Then a second pass turning `text` into `effects`. Do this pass *separately* — mixing
   transcription and modelling is how "may" becomes "must".
4. Run `npm run content:check`. Fix count mismatches before moving on.
5. Anything you can't express in the effect vocabulary: leave `effects: []`, add a `notes` entry,
   and collect them. Then extend the vocabulary in one batch rather than per card.

A CSV staging file is fine for step 2 if it's faster to type — write a small importer. Don't let
the CSV become the source of truth; JSON in `content/` is.

## Where AI helps and where it doesn't

Claude Code is good at: writing the schema, the loader, the validator, the CSV importer, and at
turning a `text` string *you* supply into candidate `effects` for you to check. It is bad at
recalling card text — it will produce something that reads authoritatively and is wrong in a
dozen places you won't find until much later. Never let it fill in `text` or a card list from
memory. The rule in `CLAUDE.md` covers this; hold it to that.
