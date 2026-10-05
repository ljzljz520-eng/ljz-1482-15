import { z } from "zod";

const rateSchema = z.object({ num: z.number().int().positive(), den: z.number().int().positive() });

const deleteOptionsSchema = z.object({
  mode: z.enum(["ripple", "keep_absolute", "lift"]),
  captions: z.enum(["detach", "delete"]),
  markers: z.enum(["detach", "delete"]).optional(),
  music: z.enum(["ripple", "stay"])
});

const clipSchema = z.object({
  id: z.string().min(1),
  trackId: z.string().min(1),
  assetId: z.string().min(1),
  start: z.number().int().nonnegative(),
  duration: z.number().int().positive(),
  inPoint: z.number().int().nonnegative(),
  outPoint: z.number().int().nonnegative()
});

const transitionSchema = z.object({
  id: z.string().min(1),
  trackId: z.string().min(1),
  fromClipId: z.string().min(1),
  toClipId: z.string().min(1),
  overlap: z.number().int().positive(),
  kind: z.string().min(1)
});

const keyframeSchema = z.object({
  id: z.string().min(1),
  clipId: z.string().min(1),
  offset: z.number().int().nonnegative(),
  property: z.string().min(1),
  value: z.number()
});

const markerSchema = z.object({
  id: z.string().min(1),
  tick: z.number().int().nonnegative(),
  label: z.string(),
  clipId: z.string().nullable(),
  mode: z.enum(["clip", "absolute"])
});

const captionSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  mode: z.enum(["clip", "absolute"]),
  clipId: z.string().nullable(),
  offset: z.number().int().nonnegative(),
  absoluteTick: z.number().int().nonnegative()
});

const audioSchema = z.object({
  id: z.string().min(1),
  trackId: z.string().min(1),
  assetId: z.string().min(1),
  start: z.number().int().nonnegative(),
  duration: z.number().int().positive(),
  inPoint: z.number().int().nonnegative(),
  gain: z.number().min(0).max(4)
});

const trackSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["video", "audio"]),
  name: z.string().min(1),
  locked: z.boolean()
});

export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clip/add"), clip: clipSchema }),
  z.object({ type: z.literal("clip/move"), clipId: z.string(), newStart: z.number().int().nonnegative(), newTrackId: z.string().optional() }),
  z.object({
    type: z.literal("clip/trim"),
    clipId: z.string(),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().positive().optional(),
    inPoint: z.number().int().nonnegative().optional(),
    outPoint: z.number().int().nonnegative().optional()
  }),
  z.object({ type: z.literal("clip/delete"), clipId: z.string(), options: deleteOptionsSchema }),
  z.object({ type: z.literal("transition/add"), transition: transitionSchema }),
  z.object({ type: z.literal("transition/delete"), transitionId: z.string() }),
  z.object({ type: z.literal("keyframe/add"), keyframe: keyframeSchema }),
  z.object({ type: z.literal("keyframe/move"), keyframeId: z.string(), newOffset: z.number().int().nonnegative() }),
  z.object({ type: z.literal("keyframe/delete"), keyframeId: z.string() }),
  z.object({ type: z.literal("marker/add"), marker: markerSchema }),
  z.object({ type: z.literal("marker/move"), markerId: z.string(), newTick: z.number().int().nonnegative(), mode: z.enum(["clip", "absolute"]).optional() }),
  z.object({ type: z.literal("marker/delete"), markerId: z.string() }),
  z.object({ type: z.literal("caption/add"), caption: captionSchema }),
  z.object({ type: z.literal("caption/move"), captionId: z.string(), absoluteTick: z.number().int().nonnegative().optional(), offset: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("caption/delete"), captionId: z.string() }),
  z.object({ type: z.literal("audio/add"), audio: audioSchema }),
  z.object({ type: z.literal("audio/move"), audioId: z.string(), newStart: z.number().int().nonnegative() }),
  z.object({ type: z.literal("audio/trim"), audioId: z.string(), end: z.number().int().positive().optional() }),
  z.object({ type: z.literal("audio/delete"), audioId: z.string() }),
  z.object({ type: z.literal("track/add"), track: trackSchema }),
  z.object({ type: z.literal("track/delete"), trackId: z.string() }),
  z.object({ type: z.literal("export/set"), start: z.number().int().nonnegative(), end: z.number().int().positive().nullable() })
]);

export const mutateRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  operation: operationSchema,
  clientId: z.string().min(4).max(120).optional(),
  force: z.boolean().optional()
});

export const undoRequestSchema = z.object({
  historyId: z.string().optional(),
  clientId: z.string().min(4).max(120).optional()
});

export const assetCreateSchema = z.object({
  kind: z.enum(["video", "audio", "image"]),
  name: z.string().min(1).max(120),
  rate: rateSchema,
  duration: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});

export const renderCreateSchema = z.object({
  label: z.string().max(120).optional(),
  kind: z.enum(["edl", "preview"]).default("edl"),
  enqueue: z.boolean().default(true)
});
