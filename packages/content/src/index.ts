// Card schema, loader and validator for content/ (git-ignored — see
// docs/03-content-schema.md). Real zod schemas land in M1. This
// placeholder proves the package builds and may depend on @hb/engine.

import type { ENGINE_PLACEHOLDER } from "@hb/engine";

export type EngineMarker = typeof ENGINE_PLACEHOLDER;

export const CONTENT_PLACEHOLDER = "hogwarts-battle-content" as const;
