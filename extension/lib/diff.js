// Minimal LCS-based unified-ish line diff for the preview UI.
export function lineDiff(oldText = "", newText = "") {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "ctx", text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ type: "del", text: a[i++] });
    } else {
      rows.push({ type: "add", text: b[j++] });
    }
  }
  while (i < n) rows.push({ type: "del", text: a[i++] });
  while (j < m) rows.push({ type: "add", text: b[j++] });
  return rows;
}

// Collapses long runs of unchanged lines.
export function collapseContext(rows, context = 3) {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((row, index) => {
    if (row.type === "ctx") return;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(rows.length - 1, index + context);
      k++
    ) {
      keep[k] = true;
    }
  });
  const out = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (skipped) {
        out.push({ type: "gap", text: `… ${skipped} unchanged lines` });
        skipped = 0;
      }
      out.push(row);
    } else {
      skipped++;
    }
  });
  if (skipped) out.push({ type: "gap", text: `… ${skipped} unchanged lines` });
  return out;
}

export function diffStats(rows) {
  return rows.reduce(
    (acc, row) => {
      if (row.type === "add") acc.added++;
      if (row.type === "del") acc.removed++;
      return acc;
    },
    { added: 0, removed: 0 },
  );
}