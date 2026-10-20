export type Ring = [number, number][];
export type Shape = Ring[];
export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";

export interface PathGeometry {
  points: readonly number[];
  curves?: readonly number[];
  breaks?: readonly number[];
  closed?: boolean;
}

type Point = [number, number];
type Vertex = { x: number; y: number; id: number };
type Segment = {
  id: number;
  start: Vertex;
  end: Vertex;
  minY: number;
  maxY: number;
  mask: number;
  cuts: Vertex[];
  sweepPoint?: Vertex;
};
type Boundary = { from: Vertex; to: Vertex; next?: Boundary; used: boolean };
type SweepEvent = { point: Vertex; starts: Segment[]; ends: Segment[]; crossings: Set<Segment>; verticals: Segment[] };

const AREA_EPSILON = 1e-9;
const COORD_EPSILON = 1e-9;

class VertexPool {
  readonly epsilon: number;
  private readonly columns = new Map<number, Map<number, Vertex[]>>();
  private count = 0;

  constructor(epsilon: number) {
    this.epsilon = epsilon;
  }

  get(x: number, y: number): Vertex {
    const gx = Math.round(x / this.epsilon);
    const gy = Math.round(y / this.epsilon);
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      const column = this.columns.get(ix);
      if (!column) continue;
      for (let iy = gy - 1; iy <= gy + 1; iy++) {
        const bucket = column.get(iy);
        if (!bucket) continue;
        for (const point of bucket) {
          if (Math.abs(point.x - x) <= this.epsilon && Math.abs(point.y - y) <= this.epsilon) {
            return point;
          }
        }
      }
    }
    const point = { x, y, id: this.count++ };
    let column = this.columns.get(gx);
    if (!column) {
      column = new Map();
      this.columns.set(gx, column);
    }
    const bucket = column.get(gy);
    if (bucket) bucket.push(point);
    else column.set(gy, [point]);
    return point;
  }
}

class SweepNode {
  left: SweepNode | undefined;
  right: SweepNode | undefined;
  parent: SweepNode | undefined;
  readonly priority: number;
  parity: number;
  readonly edge: Segment;

  constructor(edge: Segment) {
    this.edge = edge;
    let hash = edge.id + 1;
    hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
    hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
    this.priority = (hash ^ (hash >>> 15)) >>> 0;
    this.parity = edge.mask;
  }
}

class EventQueue {
  private readonly heap: SweepEvent[] = [];
  private readonly pending = new Map<number, SweepEvent>();

  get first(): SweepEvent | undefined {
    return this.heap[0];
  }

  at(point: Vertex): SweepEvent {
    const pending = this.pending.get(point.id);
    if (pending) return pending;
    const event: SweepEvent = { point, starts: [], ends: [], crossings: new Set(), verticals: [] };
    this.pending.set(point.id, event);
    let index = this.heap.length;
    this.heap.push(event);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (compareVertices(this.heap[parent].point, point) <= 0) break;
      this.heap[index] = this.heap[parent];
      index = parent;
    }
    this.heap[index] = event;
    return event;
  }

  pop(): SweepEvent {
    const first = this.heap[0];
    const last = this.heap.pop()!;
    this.pending.delete(first.point.id);
    if (this.heap.length) {
      let index = 0;
      while (index * 2 + 1 < this.heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.heap.length && compareVertices(this.heap[child + 1].point, this.heap[child].point) < 0) child++;
        if (compareVertices(last.point, this.heap[child].point) <= 0) break;
        this.heap[index] = this.heap[child];
        index = child;
      }
      this.heap[index] = last;
    }
    return first;
  }
}

class SweepStatus {
  root: SweepNode | undefined;

  private readonly compare: (a: Segment, b: Segment) => number;

  constructor(compare: (a: Segment, b: Segment) => number) {
    this.compare = compare;
  }

  private update(node: SweepNode): void {
    node.parity = (node.left?.parity ?? 0) ^ node.edge.mask ^ (node.right?.parity ?? 0);
  }

  private updateParents(node: SweepNode | undefined): void {
    while (node) {
      this.update(node);
      node = node.parent;
    }
  }

  private rotate(node: SweepNode): void {
    const parent = node.parent!;
    const grandparent = parent.parent;
    if (parent.left === node) {
      parent.left = node.right;
      if (node.right) node.right.parent = parent;
      node.right = parent;
    } else {
      parent.right = node.left;
      if (node.left) node.left.parent = parent;
      node.left = parent;
    }
    parent.parent = node;
    node.parent = grandparent;
    if (!grandparent) this.root = node;
    else if (grandparent.left === parent) grandparent.left = node;
    else grandparent.right = node;
    this.update(parent);
    this.update(node);
  }

  insert(edge: Segment): SweepNode {
    const node = new SweepNode(edge);
    let current = this.root;
    if (!current) this.root = node;
    while (current) {
      const side = this.compare(edge, current.edge) < 0 ? "left" : "right";
      if (current[side]) current = current[side];
      else {
        current[side] = node;
        node.parent = current;
        break;
      }
    }
    this.updateParents(node.parent);
    while (node.parent && node.priority < node.parent.priority) this.rotate(node);
    return node;
  }

  remove(node: SweepNode): void {
    while (node.left || node.right) {
      const child = !node.right || (node.left && node.left.priority < node.right.priority)
        ? node.left!
        : node.right;
      this.rotate(child);
    }
    const parent = node.parent;
    if (!parent) this.root = undefined;
    else if (parent.left === node) parent.left = undefined;
    else parent.right = undefined;
    this.updateParents(parent);
  }

  below(node: SweepNode): number {
    let parity = node.left?.parity ?? 0;
    while (node.parent) {
      if (node.parent.right === node) {
        parity ^= (node.parent.left?.parity ?? 0) ^ node.parent.edge.mask;
      }
      node = node.parent;
    }
    return parity;
  }

  at(x: number, y: number): number {
    let parity = 0;
    let node = this.root;
    while (node) {
      if (ordinate(node.edge, x) < y) {
        parity ^= (node.left?.parity ?? 0) ^ node.edge.mask;
        node = node.right;
      } else node = node.left;
    }
    return parity;
  }

  neighbor(node: SweepNode, side: "left" | "right"): SweepNode | undefined {
    const opposite = side === "left" ? "right" : "left";
    if (node[side]) {
      node = node[side];
      while (node[opposite]) node = node[opposite];
      return node;
    }
    while (node.parent && node.parent[side] === node) node = node.parent;
    return node.parent;
  }

  through(point: Vertex, epsilon: number, visit: (edge: Segment) => void): void {
    const search = (node: SweepNode | undefined): void => {
      if (!node) return;
      const edge = node.edge;
      const dx = edge.end.x - edge.start.x;
      const dy = edge.end.y - edge.start.y;
      const side = cross(dx, dy, point.x - edge.start.x, point.y - edge.start.y);
      const tolerance = epsilon * Math.hypot(dx, dy);
      if (side >= -tolerance) search(node.right);
      if (Math.abs(side) <= tolerance) visit(edge);
      if (side <= tolerance) search(node.left);
    };
    search(this.root);
  }

  within(x: number, minY: number, maxY: number, visit: (edge: Segment) => void): void {
    const search = (node: SweepNode | undefined): void => {
      if (!node) return;
      const y = ordinate(node.edge, x);
      if (y >= minY) search(node.left);
      if (y >= minY && y <= maxY) visit(node.edge);
      if (y <= maxY) search(node.right);
    };
    search(this.root);
  }
}

function compareVertices(a: Vertex, b: Vertex): number {
  return a.x - b.x || a.y - b.y;
}

function segment(start: Vertex, end: Vertex, mask: number, id: number): Segment {
  if (compareVertices(start, end) > 0) [start, end] = [end, start];
  return { id, start, end, minY: Math.min(start.y, end.y), maxY: Math.max(start.y, end.y), mask, cuts: [start, end] };
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function ordinate(edge: Segment, x: number): number {
  if (edge.sweepPoint?.x === x) return edge.sweepPoint.y;
  const { start, end } = edge;
  if (x === start.x) return start.y;
  if (x === end.x) return end.y;
  return start.y + (end.y - start.y) * ((x - start.x) / (end.x - start.x));
}

function compareAt(a: Segment, b: Segment, x: number, epsilon: number): number {
  const difference = ordinate(a, x) - ordinate(b, x);
  if (Math.abs(difference) > epsilon) return difference;
  const ax = a.end.x - a.start.x;
  const ay = a.end.y - a.start.y;
  const bx = b.end.x - b.start.x;
  const by = b.end.y - b.start.y;
  return cross(bx, by, ax, ay) || a.id - b.id;
}

function addIntersections(a: Segment, b: Segment, pool: VertexPool): Vertex[] {
  const epsilon = pool.epsilon;
  const ax = a.end.x - a.start.x;
  const ay = a.end.y - a.start.y;
  const bx = b.end.x - b.start.x;
  const by = b.end.y - b.start.y;
  const qx = b.start.x - a.start.x;
  const qy = b.start.y - a.start.y;
  const aLength = Math.hypot(ax, ay);
  const bLength = Math.hypot(bx, by);
  const denominator = cross(ax, ay, bx, by);
  if (Math.abs(cross(ax, ay, qx, qy)) <= epsilon * aLength
    && Math.abs(cross(ax, ay, b.end.x - a.start.x, b.end.y - a.start.y)) <= epsilon * aLength) {
    const points: Vertex[] = [];
    for (const point of [a.start, a.end, b.start, b.end]) {
      if (point.x >= Math.max(a.start.x, b.start.x) - epsilon
        && point.x <= Math.min(a.end.x, b.end.x) + epsilon
        && point.y >= Math.max(a.minY, b.minY) - epsilon
        && point.y <= Math.min(a.maxY, b.maxY) + epsilon) {
        a.cuts.push(point);
        b.cuts.push(point);
        points.push(point);
      }
    }
    return points;
  }
  if (denominator === 0) return [];
  const t = cross(qx, qy, bx, by) / denominator;
  const u = cross(qx, qy, ax, ay) / denominator;
  const ta = epsilon / aLength;
  const tb = epsilon / bLength;
  if (t < -ta || t > 1 + ta || u < -tb || u > 1 + tb) return [];
  let point: Vertex;
  if (Math.abs(t) <= ta) point = a.start;
  else if (Math.abs(1 - t) <= ta) point = a.end;
  else if (Math.abs(u) <= tb) point = b.start;
  else if (Math.abs(1 - u) <= tb) point = b.end;
  else point = pool.get(a.start.x + t * ax, a.start.y + t * ay);
  a.cuts.push(point);
  b.cuts.push(point);
  return [point];
}

function splitIntersections(edges: Segment[], pool: VertexPool): Segment[] {
  const epsilon = pool.epsilon;
  let sweepX = -Infinity;
  const queue = new EventQueue();
  const status = new SweepStatus((a, b) => compareAt(a, b, sweepX, epsilon));
  const nodes: (SweepNode | undefined)[] = [];
  for (const edge of edges) {
    if (edge.start.x === edge.end.x) queue.at(edge.start).verticals.push(edge);
    else {
      queue.at(edge.start).starts.push(edge);
      queue.at(edge.end).ends.push(edge);
    }
  }
  const check = (a: Segment, b: Segment): void => {
    for (const point of addIntersections(a, b, pool)) {
      if (point.x <= sweepX) continue;
      const event = queue.at(point);
      event.crossings.add(a);
      event.crossings.add(b);
    }
  };
  while (queue.first) {
    sweepX = queue.first.point.x;
    const remove = new Set<Segment>();
    const insert = new Set<Segment>();
    const verticals: Segment[] = [];
    while (queue.first?.point.x === sweepX) {
      const event = queue.pop();
      for (const edge of event.starts) insert.add(edge);
      for (const edge of [...event.ends, ...event.crossings]) {
        if (nodes[edge.id]) {
          edge.sweepPoint = event.point;
          remove.add(edge);
        }
      }
      status.through(event.point, epsilon, (edge) => {
        edge.sweepPoint = event.point;
        edge.cuts.push(event.point);
        remove.add(edge);
      });
      verticals.push(...event.verticals);
    }
    const cutVerticals = (): void => {
      for (const edge of verticals) {
        status.within(sweepX, edge.minY - epsilon, edge.maxY + epsilon, (other) => addIntersections(edge, other, pool));
      }
    };
    cutVerticals();
    verticals.sort((a, b) => a.minY - b.minY);
    for (let i = 0; i < verticals.length; i++) {
      for (let j = i + 1; j < verticals.length && verticals[j].minY <= verticals[i].maxY + epsilon; j++) {
        addIntersections(verticals[i], verticals[j], pool);
      }
    }
    const nearby = new Set<Segment>();
    for (const edge of remove) {
      const node = nodes[edge.id]!;
      for (const side of ["left", "right"] as const) {
        const neighbor = status.neighbor(node, side);
        if (neighbor && !remove.has(neighbor.edge)) nearby.add(neighbor.edge);
      }
      if (edge.end.x > sweepX) insert.add(edge);
    }
    for (const edge of remove) {
      status.remove(nodes[edge.id]!);
      nodes[edge.id] = undefined;
    }
    for (const edge of insert) {
      nodes[edge.id] = status.insert(edge);
      nearby.add(edge);
    }
    cutVerticals();
    for (const edge of nearby) {
      const node = nodes[edge.id]!;
      for (const side of ["left", "right"] as const) {
        const neighbor = status.neighbor(node, side);
        if (neighbor) check(edge, neighbor.edge);
      }
    }
  }
  const pieces = new Map<string, Segment>();
  for (const edge of edges) {
    const dx = edge.end.x - edge.start.x;
    const dy = edge.end.y - edge.start.y;
    const byX = Math.abs(dx) >= Math.abs(dy);
    edge.cuts.sort(byX
      ? (a, b) => a.x - b.x || a.y - b.y
      : (a, b) => (dy > 0 ? a.y - b.y : b.y - a.y) || a.x - b.x);
    let previous = edge.cuts[0];
    for (let i = 1; i < edge.cuts.length; i++) {
      const point = edge.cuts[i];
      if (point.id === previous.id) continue;
      const key = previous.id < point.id ? `${previous.id}:${point.id}` : `${point.id}:${previous.id}`;
      const existing = pieces.get(key);
      if (existing) existing.mask ^= edge.mask;
      else pieces.set(key, segment(previous, point, edge.mask, pieces.size));
      previous = point;
    }
  }
  return [...pieces.values()].filter((edge) => edge.mask !== 0);
}

function filled(mask: number, op: BooleanOp): boolean {
  switch (op) {
    case "union": return mask !== 0;
    case "subtract": return mask === 1;
    case "intersect": return mask === 3;
    case "exclude": return mask === 1 || mask === 2;
  }
}

function classifyEdges(edges: Segment[], op: BooleanOp, epsilon: number): Boundary[] {
  let sweepX = 0;
  const status = new SweepStatus((a, b) => compareAt(a, b, sweepX, epsilon));
  const events = edges.flatMap((edge) => edge.start.x === edge.end.x
    ? [{ x: edge.start.x, kind: 2, edge }]
    : [{ x: edge.start.x, kind: 1, edge }, { x: edge.end.x, kind: 0, edge }]);
  events.sort((a, b) => a.x - b.x || a.kind - b.kind || a.edge.id - b.edge.id);
  const nodes: SweepNode[] = [];
  const boundary: Boundary[] = [];
  const append = (edge: Segment, left: boolean, right: boolean): void => {
    if (left === right) return;
    boundary.push({ from: left ? edge.start : edge.end, to: left ? edge.end : edge.start, used: false });
  };
  for (let i = 0; i < events.length;) {
    sweepX = events[i].x;
    let end = i;
    while (end < events.length && events[end].x === sweepX) end++;
    let j = i;
    while (j < end && events[j].kind === 0) {
      status.remove(nodes[events[j].edge.id]);
      j++;
    }
    const firstStart = j;
    while (j < end && events[j].kind === 1) {
      const edge = events[j].edge;
      nodes[edge.id] = status.insert(edge);
      j++;
    }
    for (let k = firstStart; k < j; k++) {
      const edge = events[k].edge;
      const below = status.below(nodes[edge.id]);
      append(edge, filled(below ^ edge.mask, op), filled(below, op));
    }
    while (j < end) {
      const edge = events[j++].edge;
      const right = status.at(sweepX, (edge.start.y + edge.end.y) / 2);
      append(edge, filled(right ^ edge.mask, op), filled(right, op));
    }
    i = end;
  }
  return boundary;
}

function signedArea(ring: Ring): number {
  if (ring.length < 3) return 0;
  const [ox, oy] = ring[0];
  let area = 0;
  for (let i = 1; i + 1 < ring.length; i++) {
    area += cross(ring[i][0] - ox, ring[i][1] - oy, ring[i + 1][0] - ox, ring[i + 1][1] - oy);
  }
  return area / 2;
}

function stitch(boundary: Boundary[], offsetX: number, offsetY: number): Shape {
  const outgoing = new Map<number, { edge: Boundary; angle: number }[]>();
  for (const edge of boundary) {
    const entry = { edge, angle: Math.atan2(edge.to.y - edge.from.y, edge.to.x - edge.from.x) };
    const list = outgoing.get(edge.from.id);
    if (list) list.push(entry);
    else outgoing.set(edge.from.id, [entry]);
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.angle - b.angle);
  for (const edge of boundary) {
    const list = outgoing.get(edge.to.id);
    if (!list?.length) throw new Error("Polygon boundary is not closed");
    const angle = Math.atan2(edge.from.y - edge.to.y, edge.from.x - edge.to.x);
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (list[mid].angle < angle) lo = mid + 1;
      else hi = mid;
    }
    edge.next = list[(lo + list.length - 1) % list.length].edge;
  }
  const rings: Shape = [];
  for (const first of boundary) {
    if (first.used) continue;
    const path: Vertex[] = [first.from];
    const positions = new Map<number, number>([[first.from.id, 0]]);
    let edge = first;
    while (!edge.used) {
      edge.used = true;
      const vertex = edge.to;
      const position = positions.get(vertex.id);
      if (position === undefined) {
        positions.set(vertex.id, path.length);
        path.push(vertex);
      } else {
        const ring: Ring = path.slice(position).map((point) => [point.x + offsetX, point.y + offsetY]);
        if (Math.abs(signedArea(ring)) >= AREA_EPSILON) rings.push(ring);
        for (let i = position + 1; i < path.length; i++) positions.delete(path[i].id);
        path.length = position + 1;
      }
      edge = edge.next!;
    }
  }
  return rings;
}

/** Clips two even-odd shapes into simple boundary rings, dropping areas below 1e-9. */
export function booleanShapes(a: Shape, b: Shape, op: BooleanOp): Shape {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of [a, b]) {
    for (const ring of shape) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (minX === Infinity) return [];
  const magnitude = Math.max(1, maxX - minX, maxY - minY);
  const epsilon = Math.max(COORD_EPSILON, magnitude * Number.EPSILON * 8);
  const pool = new VertexPool(epsilon);
  const edges: Segment[] = [];
  for (const [shape, mask] of [[a, 1], [b, 2]] as const) {
    for (const ring of shape) {
      if (ring.length < 3) continue;
      const vertices = ring.map(([x, y]) => pool.get(x - minX, y - minY));
      for (let i = 0; i < vertices.length; i++) {
        const start = vertices[i];
        const end = vertices[(i + 1) % vertices.length];
        if (start.id !== end.id) edges.push(segment(start, end, mask, edges.length));
      }
    }
  }
  return stitch(classifyEdges(splitIntersections(edges, pool), op, epsilon), minX, minY);
}

/** Folds an operation left to right, with subtraction removing every later shape. */
export function booleanMany(shapes: readonly Shape[], op: BooleanOp): Shape {
  if (!shapes.length) return [];
  let result = booleanShapes(shapes[0], [], "union");
  for (let i = 1; i < shapes.length; i++) result = booleanShapes(result, shapes[i], op);
  return result;
}

function distanceToSegmentSquared(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length));
  return (point[0] - start[0] - t * dx) ** 2 + (point[1] - start[1] - t * dy) ** 2;
}

function midpoint(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function flattenCubic(a: Point, b: Point, c: Point, d: Point, toleranceSquared: number, ring: Ring, depth = 0): void {
  if (depth >= 24 || Math.max(distanceToSegmentSquared(b, a, d), distanceToSegmentSquared(c, a, d)) <= toleranceSquared) {
    ring.push(d);
    return;
  }
  const ab = midpoint(a, b);
  const bc = midpoint(b, c);
  const cd = midpoint(c, d);
  const abc = midpoint(ab, bc);
  const bcd = midpoint(bc, cd);
  const middle = midpoint(abc, bcd);
  flattenCubic(a, ab, abc, middle, toleranceSquared, ring, depth + 1);
  flattenCubic(middle, bcd, cd, d, toleranceSquared, ring, depth + 1);
}

function cleanRing(ring: Ring): Ring {
  const result: Ring = [];
  for (const point of ring) {
    const previous = result[result.length - 1];
    if (!previous || point[0] !== previous[0] || point[1] !== previous[1]) result.push(point);
  }
  if (result.length > 1 && result[0][0] === result[result.length - 1][0] && result[0][1] === result[result.length - 1][1]) result.pop();
  return result;
}

/** Samples closed subpaths with adaptive cubic subdivision at the given tolerance. */
export function flattenPath(path: PathGeometry, tolerance = 0.25): Shape {
  const count = Math.floor(path.points.length / 2);
  const starts = [0];
  for (const index of path.breaks ?? []) {
    if (Number.isInteger(index) && index > starts[starts.length - 1] && index < count) starts.push(index);
  }
  starts.push(count);
  const toleranceSquared = (Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0.25) ** 2;
  const shape: Shape = [];
  for (let subpath = 0; subpath + 1 < starts.length; subpath++) {
    const start = starts[subpath];
    const end = starts[subpath + 1];
    if (end <= start) continue;
    const ring: Ring = [[path.points[start * 2], path.points[start * 2 + 1]]];
    for (let i = start; i < end; i++) {
      const j = i + 1 < end ? i + 1 : start;
      const a: Point = [path.points[i * 2], path.points[i * 2 + 1]];
      const d: Point = [path.points[j * 2], path.points[j * 2 + 1]];
      const outX = path.curves?.[i * 4 + 2] ?? 0;
      const outY = path.curves?.[i * 4 + 3] ?? 0;
      const inX = path.curves?.[j * 4] ?? 0;
      const inY = path.curves?.[j * 4 + 1] ?? 0;
      if (outX === 0 && outY === 0 && inX === 0 && inY === 0) ring.push(d);
      else flattenCubic(a, [a[0] + outX, a[1] + outY], [d[0] + inX, d[1] + inY], d, toleranceSquared, ring);
    }
    const cleaned = cleanRing(ring);
    if (cleaned.length >= 3) shape.push(cleaned);
  }
  return shape;
}

function circleSegments(radius: number): number {
  return 4 * Math.ceil(Math.max(48, Math.PI * Math.sqrt(2 * radius)) / 4);
}

/** Creates a rectangle with a clamped corner radius and sampled circular corners. */
export function rectShape(x: number, y: number, width: number, height: number, radius = 0): Shape {
  if (![x, y, width, height, radius].every(Number.isFinite) || width === 0 || height === 0) return [];
  if (width < 0) { x += width; width = -width; }
  if (height < 0) { y += height; height = -height; }
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r === 0) return [[[x, y], [x + width, y], [x + width, y + height], [x, y + height]]];
  const centers: Point[] = [[x + width - r, y + r], [x + width - r, y + height - r], [x + r, y + height - r], [x + r, y + r]];
  const steps = circleSegments(r) / 4;
  const ring: Ring = [];
  for (let corner = 0; corner < 4; corner++) {
    for (let i = 0; i <= steps; i++) {
      const angle = (corner - 1 + i / steps) * Math.PI / 2;
      ring.push([centers[corner][0] + r * Math.cos(angle), centers[corner][1] + r * Math.sin(angle)]);
    }
  }
  return [cleanRing(ring)];
}

/** Samples an ellipse with at least 48 segments and finer sampling for large radii. */
export function ellipseShape(cx: number, cy: number, rx: number, ry: number): Shape {
  if (![cx, cy, rx, ry].every(Number.isFinite) || rx === 0 || ry === 0) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const count = circleSegments(Math.max(rx, ry));
  const ring: Ring = [];
  for (let i = 0; i < count; i++) {
    const angle = i * 2 * Math.PI / count;
    ring.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  return [ring];
}

/** Converts rings to handle-free subpaths relative to their minimum x and y bounds. */
export function shapeToPath(shape: Shape): { points: number[]; breaks: number[]; x: number; y: number; width: number; height: number } {
  let x = Infinity;
  let y = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of shape) {
    for (const [px, py] of ring) {
      x = Math.min(x, px);
      y = Math.min(y, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }
  if (x === Infinity) return { points: [], breaks: [], x: 0, y: 0, width: 0, height: 0 };
  const points: number[] = [];
  const breaks: number[] = [];
  for (const ring of shape) {
    if (!ring.length) continue;
    if (points.length) breaks.push(points.length / 2);
    for (const [px, py] of ring) points.push(px - x, py - y);
  }
  return { points, breaks, x, y, width: maxX - x, height: maxY - y };
}

/** Returns a translated copy without mutating the original rings. */
export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  return shape.map((ring) => ring.map(([x, y]) => [x + dx, y + dy]));
}
