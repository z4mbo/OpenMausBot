type Tile = { id: string; screenSharing?: boolean };

export function isScreenTrack(transceivers: { receiver: { track: { kind: string } } }[], track: { kind: string }) {
  return track.kind === "video" && transceivers.find(item => item.receiver.track.kind === "video")?.receiver.track !== track;
}

export function selectCallFocus(tiles: Tile[], current: string | null, previousScreens: Set<string>): string | null {
  const screens = tiles.filter(tile => tile.screenSharing);
  const newScreen = screens.find(tile => !previousScreens.has(tile.id));
  if (newScreen) return newScreen.id;
  if (tiles.some(tile => tile.id === current)) return current;
  return screens[0]?.id ?? tiles.find(tile => tile.id !== "self:camera")?.id ?? tiles[0]?.id ?? null;
}
