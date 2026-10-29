const UNMEASURED = { w: 180, h: 90 }

export function marqueeRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

export function nodeBox(node) {
  return {
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0,
    w: node.width || UNMEASURED.w,
    h: node.height || UNMEASURED.h,
  }
}

export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function nodesInMarquee(nodes, rect) {
  return nodes.filter((n) => overlaps(nodeBox(n), rect)).map((n) => n.id)
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export const MARQUEE_THRESHOLD = 4
