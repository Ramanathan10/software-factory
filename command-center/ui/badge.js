// Draws a crew member's badge from its role's `badge` in mission-console/roles.mjs. Every node is built as SVG,
// so nothing here is parsed as markup. The part of the glyph that moves carries the class `k-<motion>`, which
// app.css animates only while the badge's avatar is `moving`.
const SVG = 'http://www.w3.org/2000/svg';

function svg(tag, attrs, ...children) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

export function badgeSvg(badge) {
  return svg('svg', { viewBox: '0 0 48 48', 'aria-hidden': 'true', focusable: 'false', color: badge.ink },
    svg('circle', { class: 'edge', cx: 24, cy: 24, r: 23, fill: badge.fill }),
    svg('circle', { class: 'ring ' + badge.ring, cx: 24, cy: 24, r: 19.5, stroke: badge.accent }),
    svg('svg', { x: 12, y: 12, width: 24, height: 24, viewBox: '0 0 24 24', overflow: 'visible' },
      badge.glyph && svg('path', { class: 'glyph', d: badge.glyph, stroke: badge.ink }),
      badge.move && svg('path', { class: 'glyph mv k-' + badge.motion, d: badge.move, stroke: badge.ink })));
}
