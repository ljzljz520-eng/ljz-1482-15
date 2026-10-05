import type { Prisma } from "@prisma/client";
import type {
  AssetDO,
  TimelineDoc,
  TrackDO,
  ClipDO,
  TransitionDO,
  KeyframeDO,
  MarkerDO,
  CaptionAnchorDO,
  AudioClipDO
} from "@timeline/shared";

export type PrismaTransaction = Prisma.TransactionClient;

export interface LoadedProject {
  id: string;
  name: string;
  ownerId: string;
  revision: number;
  doc: TimelineDoc;
  assets: AssetDO[];
}

export function assetMap(assets: AssetDO[]): Map<string, AssetDO> {
  return new Map(assets.map((a) => [a.id, a]));
}

export interface SerializedCollections {
  tracks: TrackDO[];
  clips: ClipDO[];
  transitions: TransitionDO[];
  keyframes: KeyframeDO[];
  markers: MarkerDO[];
  captions: CaptionAnchorDO[];
  audioClips: AudioClipDO[];
}
