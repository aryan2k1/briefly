import {
  defaultHomeBlocks,
  homeBlockIds,
  type HomeLayout,
  type HomeLayoutBlock,
} from "../home-contracts.ts";
import { scoped, type Actor } from "./db.ts";
import { AppError } from "./errors.ts";
import { fields } from "./validation.ts";

// Only the allowlisted block ids, each exactly once, are ever stored: no free-form content.
function parseBlocks(value: unknown): HomeLayoutBlock[] {
  if (!Array.isArray(value) || value.length !== homeBlockIds.length)
    throw new AppError(400, "Layout must list each Home block exactly once");
  const blocks = value.map((item) => {
    const b = fields(item, ["id", "visible"]);
    if (!homeBlockIds.some((id) => id === b.id))
      throw new AppError(400, "Unknown Home block");
    if (typeof b.visible !== "boolean")
      throw new AppError(400, "Block visibility must be true or false");
    return { id: b.id as HomeLayoutBlock["id"], visible: b.visible };
  });
  if (new Set(blocks.map((b) => b.id)).size !== blocks.length)
    throw new AppError(400, "Layout must list each Home block exactly once");
  if (!blocks.some((b) => b.visible))
    throw new AppError(400, "Keep at least one Home block visible");
  return blocks;
}

// Personal preference: row-level security limits every row to the signed-in member.
export async function getHomeLayout(actor: Actor): Promise<HomeLayout> {
  return scoped(actor, async (c) => {
    const r = await c.query(
      "SELECT version,blocks FROM home_layouts WHERE org_id=$1 AND membership_id=$2",
      [actor.organisation.id, actor.membership.id],
    );
    return r.rows[0]
      ? { version: r.rows[0].version, blocks: r.rows[0].blocks }
      : { version: 0, blocks: defaultHomeBlocks() };
  });
}

export async function saveHomeLayout(
  actor: Actor,
  input: unknown,
): Promise<HomeLayout> {
  const f = fields(input, ["version", "blocks"]);
  if (!Number.isSafeInteger(f.version) || Number(f.version) < 0)
    throw new AppError(400, "A layout version is required");
  const expected = Number(f.version),
    blocks = parseBlocks(f.blocks);
  return scoped(actor, async (c) => {
    const org = actor.organisation.id;
    const saved =
      expected === 0
        ? await c.query(
            "INSERT INTO home_layouts(org_id,team_id,membership_id,version,blocks) VALUES($1,$2,$3,1,$4) ON CONFLICT DO NOTHING RETURNING version",
            [
              org,
              actor.membership.teamId,
              actor.membership.id,
              JSON.stringify(blocks),
            ],
          )
        : await c.query(
            "UPDATE home_layouts SET version=version+1,blocks=$4,updated_at=now() WHERE org_id=$1 AND membership_id=$2 AND version=$3 RETURNING version",
            [org, actor.membership.id, expected, JSON.stringify(blocks)],
          );
    if (!saved.rowCount)
      throw new AppError(409, "Your layout changed. Reload before saving.");
    return { version: saved.rows[0].version, blocks };
  });
}
