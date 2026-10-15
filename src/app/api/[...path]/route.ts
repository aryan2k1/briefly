import "server-only";
import { handle } from "@/lib/server/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
