export function normalizeProjectEmoji(value: string) {
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value.trim())];
  if (segments.length !== 1 || !/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)/u.test(segments[0].segment)) throw new Error("Choose a single emoji for your project");
  return segments[0].segment;
}
