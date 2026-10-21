/** One vector in the SVG's coordinate space after transforms and viewBox mapping. */
export interface ImportedVector {
  kind: "path" | "rect" | "ellipse" | "text";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: number[];
  curves?: number[];
  breaks?: number[];
  closed?: boolean;
  radius?: number;
  text?: string;
  fontSize?: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
}

/** The SVG viewport dimensions and its supported vectors. */
export interface ImportedSvg {
  width: number;
  height: number;
  vectors: ImportedVector[];
}

type Point = [number, number];
type Matrix = [number, number, number, number, number, number];
type Attributes = Record<string, string>;
type XmlNode = { tag: string; attributes: Attributes; children: (XmlNode | string)[] };
type Color = { hex: string; alpha: number };
type Anchor = { point: Point; incoming: Point; outgoing: Point };
type Subpath = { anchors: Anchor[]; closed: boolean };
type Presentation = {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fontSize: number;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  displayHidden: boolean;
  visibility: string;
};
type Paint = Pick<ImportedVector, "fill" | "stroke" | "strokeWidth" | "opacity">;

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const MAX_VECTORS = 2000;
const MAX_ANCHORS = 20000;
const NUMBER_SOURCE = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?";
const NAMED_COLORS: Record<string, string> = {
  black: "000000", silver: "C0C0C0", gray: "808080", white: "FFFFFF",
  maroon: "800000", red: "FF0000", purple: "800080", fuchsia: "FF00FF",
  green: "008000", lime: "00FF00", olive: "808000", yellow: "FFFF00",
  navy: "000080", blue: "0000FF", teal: "008080", aqua: "00FFFF", orange: "FFA500",
};
const DEFAULT_PRESENTATION: Presentation = {
  fill: "black", stroke: "none", strokeWidth: 1, fontSize: 16,
  fillOpacity: 1, strokeOpacity: 1, opacity: 1, displayHidden: false, visibility: "visible",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? match;
    const hex = entity[1].toLowerCase() === "x";
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : "\uFFFD";
  });
}

function localName(name: string): string {
  return name.toLowerCase().split(":").pop() ?? "";
}

function readXml(markup: string): XmlNode | null {
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let offset = 0;
  while (offset < markup.length) {
    if (markup[offset] !== "<") {
      const end = markup.indexOf("<", offset);
      const next = end < 0 ? markup.length : end;
      stack[stack.length - 1]?.children.push(decodeEntities(markup.slice(offset, next)));
      offset = next;
      continue;
    }
    const terminator = markup.startsWith("<!--", offset) ? "-->"
      : markup.startsWith("<![CDATA[", offset) ? "]]>"
      : markup.startsWith("<?", offset) ? "?>" : null;
    if (terminator) {
      const end = markup.indexOf(terminator, offset + 2);
      offset = end < 0 ? markup.length : end + terminator.length;
      continue;
    }
    let end = offset + 1;
    let quote = "";
    let brackets = 0;
    for (; end < markup.length; end++) {
      const character = markup[end];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === "\"" || character === "'") {
        quote = character;
      } else if (character === "[") {
        brackets++;
      } else if (character === "]") {
        brackets = Math.max(0, brackets - 1);
      } else if (character === ">" && brackets === 0) {
        break;
      }
    }
    const token = markup.slice(offset + 1, end).trim();
    offset = Math.min(end + 1, markup.length);
    if (token.startsWith("!")) continue;
    if (token.startsWith("/")) {
      const tag = localName(token.slice(1).trim().split(/\s/)[0]);
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const name = /^[^\s/>]+/.exec(token)?.[0];
    if (!name) continue;
    const attributes: Attributes = Object.create(null);
    const attributePattern = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    const body = token.slice(name.length).replace(/\/\s*$/, "");
    for (const match of body.matchAll(attributePattern)) {
      attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
    const node: XmlNode = { tag: localName(name), attributes, children: [] };
    if (!root) {
      if (node.tag !== "svg") return null;
      root = node;
    } else if (stack.length === 0) {
      continue;
    }
    stack[stack.length - 1]?.children.push(node);
    if (!token.endsWith("/")) stack.push(node);
  }
  return root;
}

function number(value: string | undefined, fallback = 0): number {
  const result = Number.parseFloat(value ?? "");
  return Number.isFinite(result) ? result : fallback;
}

function numbers(value: string): number[] {
  return Array.from(value.matchAll(new RegExp(NUMBER_SOURCE, "g")), (match) => Number(match[0]));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function alpha(value: string | undefined, fallback = 1): number {
  return value === undefined ? fallback : clamp(number(value, fallback) / (value.trim().endsWith("%") ? 100 : 1));
}

function properties(attributes: Attributes): Attributes {
  const result = { ...attributes };
  for (const declaration of (attributes.style ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    result[declaration.slice(0, colon).trim().toLowerCase()] = declaration.slice(colon + 1).trim();
  }
  return result;
}

function presentation(attributes: Attributes, parent: Presentation): Presentation {
  const props = properties(attributes);
  const inherited = (key: string, fallback: string): string =>
    props[key] === undefined || props[key] === "inherit" ? fallback : props[key];
  return {
    fill: inherited("fill", parent.fill),
    stroke: inherited("stroke", parent.stroke),
    strokeWidth: Math.max(0, number(inherited("stroke-width", String(parent.strokeWidth)), parent.strokeWidth)),
    fontSize: Math.max(0, number(inherited("font-size", String(parent.fontSize)), parent.fontSize)),
    fillOpacity: alpha(inherited("fill-opacity", String(parent.fillOpacity))),
    strokeOpacity: alpha(inherited("stroke-opacity", String(parent.strokeOpacity))),
    opacity: parent.opacity * alpha(props.opacity),
    displayHidden: parent.displayHidden || props.display?.toLowerCase() === "none",
    visibility: inherited("visibility", parent.visibility).toLowerCase(),
  };
}

function color(value: string): Color | null {
  const source = value.trim().toLowerCase();
  if (source === "none" || source === "transparent") return null;
  const named = Object.hasOwn(NAMED_COLORS, source) ? NAMED_COLORS[source] : undefined;
  if (named) return { hex: `#${named}`, alpha: 1 };
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/.test(source)) {
    let hex = source.slice(1);
    if (hex.length <= 4) hex = Array.from(hex, (digit) => digit + digit).join("");
    return { hex: `#${hex.slice(0, 6).toUpperCase()}`, alpha: hex.length === 8 ? Number.parseInt(hex.slice(6), 16) / 255 : 1 };
  }
  const rgb = /^rgba?\((.*)\)$/.exec(source);
  if (rgb) {
    const components = rgb[1].trim().split(/[\s,/]+/);
    if (components.length >= 3 && components.length <= 4 && components.every((item) => /^[-+\d.e]+%?$/i.test(item) && Number.isFinite(Number.parseFloat(item)))) {
      const hex = components.slice(0, 3).map((item) => {
        const channel = item.endsWith("%") ? number(item) / 100 * 255 : number(item);
        return Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0");
      }).join("").toUpperCase();
      return { hex: `#${hex}`, alpha: alpha(components[3]) };
    }
  }
  return { hex: "#000000", alpha: 1 };
}

function gradients(root: XmlNode): Map<string, Color | null> {
  const result = new Map<string, Color | null>();
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if ((node.tag === "lineargradient" || node.tag === "radialgradient") && node.attributes.id) {
      const stop = node.children.find((child): child is XmlNode => typeof child !== "string" && child.tag === "stop");
      const props = properties(stop?.attributes ?? {});
      const first = color(props["stop-color"] ?? "black");
      result.set(node.attributes.id, first && { hex: first.hex, alpha: first.alpha * alpha(props["stop-opacity"]) });
    }
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index];
      if (typeof child !== "string") pending.push(child);
    }
  }
  return result;
}

function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

function transform(value = ""): Matrix {
  let result: Matrix = IDENTITY;
  for (const match of value.matchAll(/([a-z]+)\s*\(([^)]*)\)/gi)) {
    const values = numbers(match[2]);
    if (!values.every(Number.isFinite)) continue;
    const [x = 0, y = 0, z = 0] = values;
    let next: Matrix = IDENTITY;
    switch (match[1].toLowerCase()) {
      case "matrix":
        if (values.length === 6) next = [values[0], values[1], values[2], values[3], values[4], values[5]];
        break;
      case "translate": next = [1, 0, 0, 1, x, y]; break;
      case "scale": next = [x, 0, 0, values[1] ?? x, 0, 0]; break;
      case "rotate": {
        const radians = x * Math.PI / 180;
        const cosine = Math.cos(radians);
        const sine = Math.sin(radians);
        next = [cosine, sine, -sine, cosine, y - cosine * y + sine * z, z - sine * y - cosine * z];
        break;
      }
      case "skewx": next = [1, 0, Math.tan(x * Math.PI / 180), 1, 0, 0]; break;
      case "skewy": next = [1, Math.tan(x * Math.PI / 180), 0, 1, 0, 0]; break;
    }
    result = multiply(result, next);
  }
  return result;
}

function mapPoint(matrix: Matrix, point: Point): Point {
  return [matrix[0] * point[0] + matrix[2] * point[1] + matrix[4], matrix[1] * point[0] + matrix[3] * point[1] + matrix[5]];
}

function meanScale(matrix: Matrix): number {
  return (Math.hypot(matrix[0], matrix[1]) + Math.hypot(matrix[2], matrix[3])) / 2;
}

function paint(style: Presentation, matrix: Matrix, palette: Map<string, Color | null>): Paint {
  const resolve = (value: string): Color | null => {
    const reference = /^url\(\s*["']?#([^\s"')]+)["']?\s*\)/i.exec(value.trim());
    return reference ? (palette.has(reference[1]) ? palette.get(reference[1])! : color("black")) : color(value);
  };
  const fill = resolve(style.fill);
  const stroke = resolve(style.stroke);
  const fillAlpha = (fill?.alpha ?? 1) * style.fillOpacity;
  const strokeAlpha = (stroke?.alpha ?? 1) * style.strokeOpacity;
  const both = fill !== null && stroke !== null;
  const encode = (entry: Color | null, opacity: number): string | null => entry
    ? entry.hex + (both && opacity < 1 ? Math.round(opacity * 255).toString(16).padStart(2, "0").toUpperCase() : "") : null;
  return {
    fill: encode(fill, fillAlpha),
    stroke: encode(stroke, strokeAlpha),
    strokeWidth: style.strokeWidth * meanScale(matrix),
    opacity: clamp(style.opacity * (both ? 1 : fill ? fillAlpha : stroke ? strokeAlpha : 1)),
  };
}

function anchor(point: Point, incoming = point): Anchor {
  return { point, incoming, outgoing: point };
}

function cubic(subpath: Subpath, first: Point, second: Point, end: Point): void {
  subpath.anchors[subpath.anchors.length - 1].outgoing = first;
  subpath.anchors.push(anchor(end, second));
}

function close(subpath: Subpath): void {
  subpath.closed = true;
  if (subpath.anchors.length < 2) return;
  const first = subpath.anchors[0];
  const last = subpath.anchors[subpath.anchors.length - 1];
  if (first.point[0] === last.point[0] && first.point[1] === last.point[1]) {
    first.incoming = last.incoming;
    subpath.anchors.pop();
  }
}

function arcPieces(start: Point, end: Point, rx: number, ry: number, rotation: number, large: number, sweep: number): [Point, Point, Point][] {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (start[0] === end[0] && start[1] === end[1]) return [];
  if (rx === 0 || ry === 0) return [[start, end, end]];
  const phi = rotation % 360 * Math.PI / 180;
  const cosine = Math.cos(phi);
  const sine = Math.sin(phi);
  const dx = (start[0] - end[0]) / 2;
  const dy = (start[1] - end[1]) / 2;
  const xp = cosine * dx + sine * dy;
  const yp = -sine * dx + cosine * dy;
  const radiiScale = Math.hypot(xp / rx, yp / ry);
  if (radiiScale > 1) {
    rx *= radiiScale;
    ry *= radiiScale;
  }
  const ux = xp / rx;
  const uy = yp / ry;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (1 - ux * ux - uy * uy) / (ux * ux + uy * uy)));
  const cxp = factor * rx * uy;
  const cyp = -factor * ry * ux;
  const cx = cosine * cxp - sine * cyp + (start[0] + end[0]) / 2;
  const cy = sine * cxp + cosine * cyp + (start[1] + end[1]) / 2;
  const firstAngle = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
  const lastAngle = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx);
  let delta = lastAngle - firstAngle;
  if (sweep === 0 && delta > 0) delta -= Math.PI * 2;
  if (sweep === 1 && delta < 0) delta += Math.PI * 2;
  const count = Math.max(1, Math.min(4, Math.ceil(Math.abs(delta) / (Math.PI / 2))));
  const step = delta / count;
  const position = (angle: number): Point => [cx + cosine * rx * Math.cos(angle) - sine * ry * Math.sin(angle), cy + sine * rx * Math.cos(angle) + cosine * ry * Math.sin(angle)];
  const derivative = (angle: number): Point => [-cosine * rx * Math.sin(angle) - sine * ry * Math.cos(angle), -sine * rx * Math.sin(angle) + cosine * ry * Math.cos(angle)];
  const result: [Point, Point, Point][] = [];
  for (let index = 0; index < count; index++) {
    const angle = firstAngle + index * step;
    const from = index === 0 ? start : position(angle);
    const to = index === count - 1 ? end : position(angle + step);
    const fromDerivative = derivative(angle);
    const toDerivative = derivative(angle + step);
    const handle = 4 / 3 * Math.tan(step / 4);
    result.push([[from[0] + handle * fromDerivative[0], from[1] + handle * fromDerivative[1]], [to[0] - handle * toDerivative[0], to[1] - handle * toDerivative[1]], to]);
  }
  return result;
}

function parsePath(data: string, limit: number): Subpath[] {
  const result: Subpath[] = [];
  const pattern = new RegExp(NUMBER_SOURCE, "y");
  let offset = 0;
  let command = "";
  let previous = "";
  let current: Subpath | undefined;
  let cursor: Point = [0, 0];
  let start: Point = [0, 0];
  let cubicControl: Point = cursor;
  let quadraticControl: Point = cursor;
  let count = 0;
  const whitespace = (): void => { while (offset < data.length && /[\s,]/.test(data[offset])) offset++; };
  const read = (flag = false): number | undefined => {
    whitespace();
    if (flag) {
      if (data[offset] !== "0" && data[offset] !== "1") return undefined;
      return Number(data[offset++]);
    }
    pattern.lastIndex = offset;
    const match = pattern.exec(data);
    if (!match) return undefined;
    offset = pattern.lastIndex;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : undefined;
  };
  const move = (point: Point): boolean => {
    if (count >= limit) return false;
    current = { anchors: [anchor(point)], closed: false };
    result.push(current);
    cursor = point;
    start = point;
    count++;
    return true;
  };
  while (offset < data.length) {
    whitespace();
    if (/[a-z]/i.test(data[offset] ?? "")) command = data[offset++];
    const upper = command.toUpperCase();
    if (upper === "Z") {
      if (current) {
        const before = current.anchors.length;
        close(current);
        count -= before - current.anchors.length;
        current = undefined;
        cursor = start;
      }
      command = "";
      previous = "Z";
      continue;
    }
    const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
    const length = arity[upper];
    if (!length) {
      command = "";
      if (offset < data.length) offset++;
      continue;
    }
    const values: number[] = [];
    for (let index = 0; index < length; index++) {
      const value = read(upper === "A" && (index === 3 || index === 4));
      if (value === undefined) break;
      values.push(value);
    }
    if (values.length !== length) {
      command = "";
      continue;
    }
    const relative = command !== upper;
    const point = (index: number): Point => [values[index] + (relative ? cursor[0] : 0), values[index + 1] + (relative ? cursor[1] : 0)];
    if (upper === "M") {
      if (!move(point(0))) break;
      command = relative ? "l" : "L";
      previous = "M";
      continue;
    }
    if (!current && !move(cursor)) break;
    const subpath = current!;
    const end: Point = upper === "H" ? [values[0] + (relative ? cursor[0] : 0), cursor[1]]
      : upper === "V" ? [cursor[0], values[0] + (relative ? cursor[1] : 0)] : point(length - 2);
    if (upper === "A") {
      const pieces = arcPieces(cursor, end, values[0], values[1], values[2], values[3], values[4]);
      let complete = true;
      for (const piece of pieces) {
        if (count >= limit) { complete = false; break; }
        cubic(subpath, ...piece);
        count++;
        cursor = piece[2];
      }
      if (!complete) break;
    } else {
      if (count >= limit) break;
      if (upper === "C" || upper === "S") {
        const first: Point = upper === "C" ? point(0) : previous === "C" || previous === "S"
          ? [2 * cursor[0] - cubicControl[0], 2 * cursor[1] - cubicControl[1]] : cursor;
        cubicControl = point(length - 4);
        cubic(subpath, first, cubicControl, end);
      } else if (upper === "Q" || upper === "T") {
        quadraticControl = upper === "Q" ? point(0) : previous === "Q" || previous === "T"
          ? [2 * cursor[0] - quadraticControl[0], 2 * cursor[1] - quadraticControl[1]] : cursor;
        cubic(subpath, [cursor[0] + (quadraticControl[0] - cursor[0]) * 2 / 3, cursor[1] + (quadraticControl[1] - cursor[1]) * 2 / 3], [end[0] + (quadraticControl[0] - end[0]) * 2 / 3, end[1] + (quadraticControl[1] - end[1]) * 2 / 3], end);
      } else {
        subpath.anchors.push(anchor(end));
      }
      count++;
    }
    cursor = end;
    previous = upper;
  }
  return result;
}

function bounds(points: Point[]): Pick<ImportedVector, "x" | "y" | "width" | "height"> {
  let x = Infinity;
  let y = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    x = Math.min(x, point[0]);
    y = Math.min(y, point[1]);
    right = Math.max(right, point[0]);
    bottom = Math.max(bottom, point[1]);
  }
  return { x, y, width: right - x, height: bottom - y };
}

function pathVectors(subpaths: Subpath[], matrix: Matrix, name: string, appearance: Paint): ImportedVector[] {
  const groups: Subpath[][] = [];
  for (const subpath of subpaths) {
    if (subpath.anchors.length === 0) continue;
    const last = groups[groups.length - 1];
    if (last && last[0].closed === subpath.closed) last.push(subpath);
    else groups.push([subpath]);
  }
  return groups.map((group) => {
    const anchors: Anchor[] = [];
    const breaks: number[] = [];
    for (const subpath of group) {
      if (anchors.length > 0) breaks.push(anchors.length);
      for (const entry of subpath.anchors) {
        anchors.push({ point: mapPoint(matrix, entry.point), incoming: mapPoint(matrix, entry.incoming), outgoing: mapPoint(matrix, entry.outgoing) });
      }
    }
    const box = bounds(anchors.flatMap((entry) => [entry.point, entry.incoming, entry.outgoing]));
    const points = anchors.flatMap((entry) => [entry.point[0] - box.x, entry.point[1] - box.y]);
    const curves = anchors.flatMap((entry) => [entry.incoming[0] - entry.point[0], entry.incoming[1] - entry.point[1], entry.outgoing[0] - entry.point[0], entry.outgoing[1] - entry.point[1]]);
    return {
      kind: "path", name, ...box, points, ...appearance, closed: group[0].closed,
      ...(curves.some((value) => value !== 0) ? { curves } : {}),
      ...(breaks.length > 0 ? { breaks } : {}),
    };
  });
}

function polygon(points: Point[], closed: boolean): Subpath[] {
  const subpath: Subpath = { anchors: points.map((point) => anchor(point)), closed: false };
  if (closed) close(subpath);
  return [subpath];
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): Subpath[] {
  const k = 4 / 3 * Math.tan(Math.PI / 8);
  const subpath: Subpath = { anchors: [anchor([cx + rx, cy])], closed: false };
  cubic(subpath, [cx + rx, cy + k * ry], [cx + k * rx, cy + ry], [cx, cy + ry]);
  cubic(subpath, [cx - k * rx, cy + ry], [cx - rx, cy + k * ry], [cx - rx, cy]);
  cubic(subpath, [cx - rx, cy - k * ry], [cx - k * rx, cy - ry], [cx, cy - ry]);
  cubic(subpath, [cx + k * rx, cy - ry], [cx + rx, cy - k * ry], [cx + rx, cy]);
  close(subpath);
  return [subpath];
}

function rectanglePath(x: number, y: number, width: number, height: number, rx: number, ry: number): Subpath[] {
  if (rx === 0 || ry === 0) return polygon([[x, y], [x + width, y], [x + width, y + height], [x, y + height]], true);
  const k = 4 / 3 * Math.tan(Math.PI / 8);
  const subpath: Subpath = { anchors: [anchor([x + rx, y]), anchor([x + width - rx, y])], closed: false };
  cubic(subpath, [x + width - rx + k * rx, y], [x + width, y + ry - k * ry], [x + width, y + ry]);
  subpath.anchors.push(anchor([x + width, y + height - ry]));
  cubic(subpath, [x + width, y + height - ry + k * ry], [x + width - rx + k * rx, y + height], [x + width - rx, y + height]);
  subpath.anchors.push(anchor([x + rx, y + height]));
  cubic(subpath, [x + rx - k * rx, y + height], [x, y + height - ry + k * ry], [x, y + height - ry]);
  subpath.anchors.push(anchor([x, y + ry]));
  cubic(subpath, [x, y + ry - k * ry], [x + rx - k * rx, y], [x + rx, y]);
  close(subpath);
  return [subpath];
}

function textContent(node: XmlNode): string {
  const result: string[] = [];
  const pending: (XmlNode | string)[] = [node];
  while (pending.length > 0) {
    const child = pending.pop()!;
    if (typeof child === "string") result.push(child);
    else if (child === node || child.tag === "tspan" || child.tag === "textpath") {
      for (let index = child.children.length - 1; index >= 0; index--) pending.push(child.children[index]);
    }
  }
  return result.join("");
}

function elementVectors(node: XmlNode, matrix: Matrix, style: Presentation, palette: Map<string, Color | null>, remaining: number): ImportedVector[] {
  const attributes = node.attributes;
  const appearance = paint(style, matrix, palette);
  const axisAligned = Math.abs(matrix[1]) < 1e-12 && Math.abs(matrix[2]) < 1e-12;
  const x = number(attributes.x);
  const y = number(attributes.y);
  const name = attributes.id;
  let subpaths: Subpath[];
  switch (node.tag) {
    case "path":
      subpaths = parsePath(attributes.d ?? "", remaining);
      break;
    case "line":
      subpaths = polygon([[number(attributes.x1), number(attributes.y1)], [number(attributes.x2), number(attributes.y2)]], false);
      break;
    case "polyline":
    case "polygon": {
      const points: Point[] = [];
      const matches = (attributes.points ?? "").matchAll(new RegExp(NUMBER_SOURCE, "g"));
      let first: number | undefined;
      for (const match of matches) {
        if (points.length >= remaining) break;
        if (first === undefined) first = Number(match[0]);
        else { points.push([first, Number(match[0])]); first = undefined; }
      }
      subpaths = polygon(points, node.tag === "polygon");
      break;
    }
    case "rect": {
      const width = number(attributes.width);
      const height = number(attributes.height);
      if (width <= 0 || height <= 0) return [];
      const rx = Math.min(width / 2, Math.max(0, number(attributes.rx, number(attributes.ry))));
      const ry = Math.min(height / 2, Math.max(0, number(attributes.ry, number(attributes.rx))));
      if (axisAligned) {
        return [{ kind: "rect", name: name || "Rectangle", ...bounds([mapPoint(matrix, [x, y]), mapPoint(matrix, [x + width, y + height])]), radius: ry > 0 ? rx * Math.abs(matrix[0]) : 0, ...appearance }];
      }
      subpaths = rectanglePath(x, y, width, height, rx, ry);
      break;
    }
    case "circle":
    case "ellipse": {
      const cx = number(attributes.cx);
      const cy = number(attributes.cy);
      const rx = number(node.tag === "circle" ? attributes.r : attributes.rx);
      const ry = number(node.tag === "circle" ? attributes.r : attributes.ry);
      if (rx <= 0 || ry <= 0) return [];
      if (axisAligned) return [{ kind: "ellipse", name: name || "Ellipse", ...bounds([mapPoint(matrix, [cx - rx, cy - ry]), mapPoint(matrix, [cx + rx, cy + ry])]), ...appearance }];
      subpaths = ellipsePath(cx, cy, rx, ry);
      break;
    }
    case "text": {
      const text = textContent(node);
      const size = style.fontSize;
      const top = y - size * 0.8;
      const right = x + size * 0.55 * Array.from(text).length;
      const bottom = top + size * 1.2;
      return [{ kind: "text", name: name || "Text", ...bounds([[x, top], [right, top], [right, bottom], [x, bottom]].map((point) => mapPoint(matrix, point as Point))), text, fontSize: size * meanScale(matrix), ...appearance }];
    }
    default: return [];
  }
  if (subpaths.reduce((total, subpath) => total + subpath.anchors.length, 0) > remaining) return [];
  return pathVectors(subpaths, matrix, name || "Path", appearance);
}

function viewport(root: XmlNode): { width: number; height: number; matrix: Matrix } {
  const attributes = root.attributes;
  const viewBox = numbers(attributes.viewbox ?? "");
  const validBox = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;
  const width = Math.max(0, number(attributes.width, validBox ? viewBox[2] : 300));
  const height = Math.max(0, number(attributes.height, validBox ? viewBox[3] : 150));
  if (!validBox) return { width, height, matrix: IDENTITY };
  let sx = width / viewBox[2];
  let sy = height / viewBox[3];
  const aspect = (attributes.preserveaspectratio ?? "xMidYMid meet").replace(/^defer\s+/, "").trim();
  let extraX = 0;
  let extraY = 0;
  if (!/^none(?:\s|$)/i.test(aspect)) {
    const scale = /\bslice\b/i.test(aspect) ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = scale;
    sy = scale;
    extraX = (width - viewBox[2] * scale) * (/xMin/i.test(aspect) ? 0 : /xMax/i.test(aspect) ? 1 : 0.5);
    extraY = (height - viewBox[3] * scale) * (/YMin/i.test(aspect) ? 0 : /YMax/i.test(aspect) ? 1 : 0.5);
  }
  return { width, height, matrix: [sx, 0, 0, sy, extraX - viewBox[0] * sx, extraY - viewBox[1] * sy] };
}

/** Parses supported SVG elements without a DOM; gradients use their first stop or black, with limits of 2000 vectors and 20000 anchors. */
export function parseSvg(markup: string): ImportedSvg | null {
  const root = readXml(markup);
  if (!root) return null;
  const { width, height, matrix } = viewport(root);
  const palette = gradients(root);
  const vectors: ImportedVector[] = [];
  const pending = [{ node: root, matrix, style: DEFAULT_PRESENTATION }];
  let anchorCount = 0;
  while (pending.length > 0 && vectors.length < MAX_VECTORS) {
    const entry = pending.pop()!;
    const node = entry.node;
    const style = presentation(node.attributes, entry.style);
    if (style.displayHidden) continue;
    const accumulated = multiply(entry.matrix, transform(node.attributes.transform));
    if (node === root || node.tag === "g") {
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index];
        if (typeof child !== "string") pending.push({ node: child, matrix: accumulated, style });
      }
      continue;
    }
    if (style.visibility === "hidden" || style.visibility === "collapse") continue;
    for (const vector of elementVectors(node, accumulated, style, palette, MAX_ANCHORS - anchorCount)) {
      if (vectors.length >= MAX_VECTORS) break;
      if (![vector.x, vector.y, vector.width, vector.height, vector.opacity, vector.strokeWidth, ...(vector.curves ?? [])].every(Number.isFinite)) continue;
      anchorCount += (vector.points?.length ?? 0) / 2;
      vectors.push(vector);
    }
  }
  return { width, height, vectors };
}
