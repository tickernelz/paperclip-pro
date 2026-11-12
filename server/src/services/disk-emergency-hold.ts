export type DiskEmergencyHold = {
  since: string;
  freeBytes: number;
  totalBytes: number;
};

let hold: DiskEmergencyHold | null = null;

export function setDiskEmergencyHold(next: DiskEmergencyHold | null) {
  hold = next;
}

export function readDiskEmergencyHold(): DiskEmergencyHold | null {
  return hold;
}
