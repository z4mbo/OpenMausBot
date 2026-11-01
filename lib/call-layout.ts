type Tile = { id: string; screenSharing?: boolean };

export function isScreenTrack(transceivers: { receiver: { track: { kind: string } } }[], track: { kind: string }) {
  return track.kind === "video" && transceivers.find(item => item.receiver.track.kind === "video")?.receiver.track !== track;
}

/**
 * The tile on the main stage. A newly shared screen always takes it. Otherwise a tile the person chose (`pinned`)
 * stays; an automatic choice prefers a shared screen, then someone else's camera, and your own camera only when you
 * are alone, so the stage moves to the first teammate who joins.
 */
export function selectCallFocus(tiles: Tile[], current: string | null, previousScreens: Set<string>, pinned = false): string | null {
  const screens = tiles.filter(tile => tile.screenSharing);
  const newScreen = screens.find(tile => !previousScreens.has(tile.id));
  if (newScreen) return newScreen.id;
  const automatic = screens[0]?.id ?? tiles.find(tile => tile.id !== "self:camera")?.id ?? tiles[0]?.id ?? null;
  if (tiles.some(tile => tile.id === current) && (pinned || current !== "self:camera")) return current;
  return automatic;
}
