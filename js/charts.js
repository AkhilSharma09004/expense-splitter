/**
 * charts.js
 * ---------------------------------------------------------------------------
 * A tiny donut-chart renderer built on raw SVG <circle> stroke-dasharray
 * trickery instead of pulling in a charting library — for a project this
 * size the whole "library" is ~40 lines and it keeps the bundle at zero
 * dependencies while still doing real geometry (circumference math, running
 * offsets per slice).
 * ---------------------------------------------------------------------------
 */
const Charts = (() => {
  function donut(segments, { size = 132, thickness = 16 } = {}) {
    const total = segments.reduce((s, seg) => s + seg.value, 0);
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    const cx = size / 2, cy = size / 2;

    if (total <= 0) {
      return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${thickness}"/>
      </svg>`;
    }

    let offset = 0;
    const circles = segments.map((seg) => {
      const frac = seg.value / total;
      const dash = frac * c;
      const gap = c - dash;
      const rotation = (offset / total) * 360 - 90;
      offset += seg.value;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}"
        stroke-width="${thickness}" stroke-dasharray="${dash} ${gap}"
        transform="rotate(${rotation} ${cx} ${cy})" stroke-linecap="butt"/>`;
    }).join('');

    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Spending by category">
      ${circles}
    </svg>`;
  }

  return { donut };
})();
