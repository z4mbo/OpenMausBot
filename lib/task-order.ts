/**
 * Issue ordering inside a board column. Shared by the `tasks.moveTask` mutation and the board's optimistic update,
 * so a dropped card lands exactly where the server will put it.
 */
export type OrderedTask<Id extends string = string> = { _id: Id; order: number; _creationTime: number };

/** Column order: `order`, then creation time, then id, so equal orders never shuffle between renders. */
export function compareTaskOrder(a: OrderedTask, b: OrderedTask) {
  return a.order - b.order || a._creationTime - b._creationTime || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
}

export type TaskMovePlan<Id extends string> = {
  /** The task already sits at that position; nothing to write. */
  noop: boolean;
  /** New order of the moved task. */
  order: number;
  /** Other tasks of the column that need a new order (only when the gap between neighbours is used up). */
  renumber: { _id: Id; order: number }[];
};

/**
 * Plans moving `taskId` into the column holding `columnTasks`, right before `beforeTaskId`
 * (or to the end when it is missing or not in the column). `columnTasks` may include the moved task itself.
 * Uses the midpoint between the neighbours and renumbers the column 0..n-1 only when no distinct midpoint exists.
 */
export function planTaskMove<Id extends string>(columnTasks: readonly OrderedTask<Id>[], taskId: Id, beforeTaskId?: Id | null): TaskMovePlan<Id> {
  const sorted = [...columnTasks].sort(compareTaskOrder);
  const currentIndex = sorted.findIndex(task => task._id === taskId);
  const others = sorted.filter(task => task._id !== taskId);
  const beforeIndex = beforeTaskId ? others.findIndex(task => task._id === beforeTaskId) : -1;
  const index = beforeIndex < 0 ? others.length : beforeIndex;
  if (currentIndex >= 0 && currentIndex === index) return { noop: true, order: sorted[currentIndex]!.order, renumber: [] };

  const previous = others[index - 1];
  const next = others[index];
  const between = (low: number, value: number, high: number) => Number.isFinite(value) && low < value && value < high;
  let order: number | null = null;
  if (previous && next) {
    const middle = previous.order + (next.order - previous.order) / 2;
    if (between(previous.order, middle, next.order)) order = middle;
  } else if (next) {
    if (between(-Infinity, next.order - 1, next.order)) order = next.order - 1;
  } else if (previous) {
    if (between(previous.order, previous.order + 1, Infinity)) order = previous.order + 1;
  } else {
    order = 0;
  }
  if (order !== null) return { noop: false, order, renumber: [] };

  const renumber: { _id: Id; order: number }[] = [];
  others.forEach((task, position) => {
    const value = position < index ? position : position + 1;
    if (task.order !== value) renumber.push({ _id: task._id, order: value });
  });
  return { noop: false, order: index, renumber };
}
