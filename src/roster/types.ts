export type Region = 'NA' | 'JP';

export interface OwnedServant {
  collectionNo: number;
  lv: number;
  npLv: number;
  skillLv: [number, number, number];
  append2Lv: number;
  fou: number;
  defaultCe?: number;
}

export interface OwnedCE {
  collectionNo: number;
  lv: number;
  mlb: boolean;
}

export interface Friend {
  name: string;
  servant: OwnedServant;
  ce?: OwnedCE;
}

export interface RosterDoc {
  version: 1;
  region: Region;
  servants: OwnedServant[];
  ces: OwnedCE[];
  mcs: { id: number; lv: number }[];
  friends: Friend[];
  updatedAt: string;
}

export interface RosterStore {
  /** Returns an empty doc if none is saved. */
  load(region: Region): Promise<RosterDoc>;
  /** Returns the doc with a fresh updatedAt (ISO). */
  save(doc: RosterDoc): Promise<RosterDoc>;
}
