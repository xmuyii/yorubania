import { requireSession } from "../auth";
import { apiGet } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/family-tree.html");

const NODE_RADIUS = 26;
const H_SPACING = 90;
const V_SPACING = 110;
const MARGIN = 60;

type TreeNode = {
  id: string;
  fullName: string;
  profileImageMediaId: string | null;
  isDeceased: boolean;
  generation: number;
};
type TreeEdge = { from: string; to: string; type: "parent_child" | "spouse" | "sibling" };

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

async function loadTree() {
  const message = document.getElementById("message")!;
  message.innerHTML = "";
  const rootInput = document.getElementById("root-person-id") as HTMLInputElement;

  let rootPersonId = rootInput.value.trim();
  if (!rootPersonId) {
    try {
      const me = await apiGet("/accounts/me");
      if (!me.person) {
        message.innerHTML = `<div class="error">Your account has no linked person record yet.</div>`;
        return;
      }
      rootPersonId = me.person.id;
      rootInput.value = rootPersonId;
    } catch {
      message.innerHTML = `<div class="error">Couldn't determine your person record.</div>`;
      return;
    }
  }

  try {
    const data = await apiGet(`/persons/${rootPersonId}/tree`);
    render(data.nodes, data.edges, rootPersonId);
  } catch (err: any) {
    message.innerHTML = `<div class="error">${err.message}</div>`;
  }
}

function render(nodes: TreeNode[], edges: TreeEdge[], rootPersonId: string) {
  const svg = document.getElementById("tree-svg")!;
  svg.innerHTML = "";

  // Group by generation.
  const byGeneration = new Map<number, TreeNode[]>();
  for (const n of nodes) {
    if (!byGeneration.has(n.generation)) byGeneration.set(n.generation, []);
    byGeneration.get(n.generation)!.push(n);
  }

  // Within each generation, keep spouses adjacent — a simple heuristic
  // pass rather than a full graph-layout algorithm: walk nodes in the
  // level, and whenever a node has an unplaced spouse in the same level,
  // insert that spouse immediately after it.
  const spousePairs = edges.filter((e) => e.type === "spouse");
  for (const [, levelNodes] of byGeneration) {
    const ordered: TreeNode[] = [];
    const placed = new Set<string>();
    for (const n of levelNodes) {
      if (placed.has(n.id)) continue;
      ordered.push(n);
      placed.add(n.id);
      const spouseEdge = spousePairs.find(
        (e) => (e.from === n.id || e.to === n.id) && !placed.has(e.from === n.id ? e.to : e.from)
      );
      if (spouseEdge) {
        const spouseId = spouseEdge.from === n.id ? spouseEdge.to : spouseEdge.from;
        const spouseNode = levelNodes.find((x) => x.id === spouseId);
        if (spouseNode) {
          ordered.push(spouseNode);
          placed.add(spouseId);
        }
      }
    }
    byGeneration.set(
      [...byGeneration.entries()].find(([, v]) => v === levelNodes)![0],
      ordered
    );
  }

  const positions = new Map<string, { x: number; y: number }>();
  const generations = [...byGeneration.keys()].sort((a, b) => a - b);
  const minGen = generations[0] ?? 0;
  let maxWidth = 0;

  for (const gen of generations) {
    const levelNodes = byGeneration.get(gen)!;
    const y = MARGIN + (gen - minGen) * V_SPACING;
    levelNodes.forEach((n, i) => {
      const x = MARGIN + i * H_SPACING;
      positions.set(n.id, { x, y });
    });
    maxWidth = Math.max(maxWidth, levelNodes.length * H_SPACING + MARGIN * 2);
  }

  const totalHeight = MARGIN * 2 + (generations.length - 1) * V_SPACING;
  svg.setAttribute("width", String(Math.max(maxWidth, 400)));
  svg.setAttribute("height", String(Math.max(totalHeight, 200)));
  svg.setAttribute("viewBox", `0 0 ${Math.max(maxWidth, 400)} ${Math.max(totalHeight, 200)}`);

  const ns = "http://www.w3.org/2000/svg";

  // Draw edges first, so nodes render on top.
  for (const edge of edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;

    const path = document.createElementNS(ns, "path");
    if (edge.type === "spouse") {
      path.setAttribute("class", "tree-edge-spouse");
      path.setAttribute("d", `M ${from.x + NODE_RADIUS} ${from.y} L ${to.x - NODE_RADIUS} ${to.y}`);
    } else if (edge.type === "sibling") {
      path.setAttribute("class", "tree-edge-sibling");
      const midY = Math.min(from.y, to.y) - 20;
      path.setAttribute(
        "d",
        `M ${from.x} ${from.y - NODE_RADIUS} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y - NODE_RADIUS}`
      );
    } else {
      path.setAttribute("class", "tree-edge-parent-child");
      const midY = (from.y + to.y) / 2;
      path.setAttribute(
        "d",
        `M ${from.x} ${from.y + NODE_RADIUS} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y - NODE_RADIUS}`
      );
    }
    svg.appendChild(path);
  }

  // Draw nodes.
  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;

    const g = document.createElementNS(ns, "g");
    g.setAttribute("style", "cursor:pointer");
    g.addEventListener("click", () => {
      window.location.href = `/family-media.html?person=${node.id}`;
    });

    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", String(pos.x));
    circle.setAttribute("cy", String(pos.y));
    circle.setAttribute("r", String(NODE_RADIUS));
    circle.setAttribute("class", `tree-node-circle ${node.isDeceased ? "deceased" : ""}`);
    g.appendChild(circle);

    const initialsText = document.createElementNS(ns, "text");
    initialsText.setAttribute("x", String(pos.x));
    initialsText.setAttribute("y", String(pos.y));
    initialsText.setAttribute("class", "tree-node-initials");
    initialsText.textContent = initials(node.fullName);
    g.appendChild(initialsText);

    const nameText = document.createElementNS(ns, "text");
    nameText.setAttribute("x", String(pos.x));
    nameText.setAttribute("y", String(pos.y + NODE_RADIUS + 14));
    nameText.setAttribute("class", "tree-node-name");
    nameText.textContent = node.fullName.length > 14 ? node.fullName.slice(0, 13) + "…" : node.fullName;
    g.appendChild(nameText);

    if (node.id === rootPersonId) {
      const ring = document.createElementNS(ns, "circle");
      ring.setAttribute("cx", String(pos.x));
      ring.setAttribute("cy", String(pos.y));
      ring.setAttribute("r", String(NODE_RADIUS + 4));
      ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", "var(--evergreen)");
      ring.setAttribute("stroke-width", "1.5");
      g.appendChild(ring);
    }

    svg.appendChild(g);
  }
}

document.getElementById("reload-tree")!.addEventListener("click", loadTree);
loadTree();
