export interface WakeTarget {
  id: string;
  name: string;
}

export interface WakeMatch {
  id: string;
  score: number;
  rest: string;
}

/** Italian "ehi", English "hey", and the spellings recognisers commonly produce for either. */
export const WAKE_WORDS: ReadonlySet<string> = new Set(["ehi", "hey", "hei", "ehy", "hej", "hay", "ei", "ey", "eh", "heh", "hi"]);

interface Word {
  norm: string;
  end: number;
}

function normalizeWord(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "");
}

function words(text: string): Word[] {
  const found: Word[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}'’]+/gu)) {
    const norm = normalizeWord(match[0]);
    if (norm) found.push({ norm, end: (match.index ?? 0) + match[0].length });
  }
  return found;
}

function soundKey(value: string): string {
  return value
    .replace(/ph/g, "f")
    .replace(/ck/g, "c")
    .replace(/[kq]/g, "c")
    .replace(/y/g, "i")
    .replace(/z/g, "s")
    .replace(/w/g, "v")
    .replace(/(?!^)h/g, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/[ae]r$/, "a");
}

function consonants(value: string): string {
  return value.slice(0, 1) + value.slice(1).replace(/[aeiou]/g, "");
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - editDistance(a, b) / longest;
}

function requiredScore(nameLength: number): number {
  if (nameLength <= 3) return 1;
  if (nameLength <= 5) return 0.75;
  return 0.7;
}

function nameScore(spoken: string, name: string): number {
  const plain = similarity(spoken, name);
  const sounded = similarity(soundKey(spoken), soundKey(name));
  const skeleton = similarity(consonants(soundKey(spoken)), consonants(soundKey(name))) * 0.85;
  return Math.max(plain, sounded, skeleton);
}

interface Candidate {
  match: WakeMatch;
  through: number;
}

function bestForTarget(target: WakeTarget, spoken: Word[], start: number, glued: string | null): Candidate | null {
  const nameWords = words(target.name).map((word) => word.norm);
  if (!nameWords.length) return null;
  const name = nameWords.join("");
  const needed = requiredScore(name.length);
  let best: Candidate | null = null;
  const consider = (score: number, through: number) => {
    if (score >= needed && (!best || score > best.match.score)) best = { match: { id: target.id, score, rest: "" }, through };
  };
  if (glued) consider(nameScore(glued, name), start - 1);
  const shortest = Math.max(1, nameWords.length - 1);
  const longest = nameWords.length + 1;
  for (let count = shortest; count <= longest && start + count <= spoken.length; count++) {
    const window = spoken.slice(start, start + count).map((word) => word.norm).join("");
    consider(nameScore(window, name), start + count - 1);
  }
  const first = nameWords[0];
  if (nameWords.length > 1 && first.length >= 4 && start < spoken.length) {
    consider(nameScore(spoken[start].norm, first) * 0.9, start);
  }
  return best;
}

export function matchWakePhrase(text: string, targets: readonly WakeTarget[]): WakeMatch | null {
  const spoken = words(text);
  let best: Candidate | null = null;
  for (let i = 0; i < spoken.length; i++) {
    const word = spoken[i].norm;
    const wake = WAKE_WORDS.has(word);
    const gluedWake = wake ? undefined : [...WAKE_WORDS].find((w) => w.length >= 3 && word.startsWith(w) && word.length - w.length >= 3);
    if (!wake && !gluedWake) continue;
    for (const target of targets) {
      const candidate = gluedWake
        ? bestForTarget(target, spoken, i + 1, word.slice(gluedWake.length))
        : bestForTarget(target, spoken, i + 1, null);
      if (candidate && (!best || candidate.match.score > best.match.score)) best = candidate;
    }
  }
  if (!best) return null;
  const end = spoken[best.through]?.end ?? 0;
  const rest = text.slice(end).replace(/^[\s,.;:!?…-]+/u, "").trim();
  return { ...best.match, rest };
}
