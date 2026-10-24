import { translate } from "../i18n/index.js";
import { radarAngle, radarLayout, radarPoint, radarPolygon, statKeys, statLabelKeys } from "./shop-layout.js";

const svgNamespace = "http://www.w3.org/2000/svg";

// The five-axis radar, built once per shop render and then updated in place:
// hovering a card only moves the preview polygon, so the chart never flickers
// back to its default shape between pointer events.
//
// `labelSize` is in SVG user units, not pixels: the chart is drawn to a fixed
// viewBox and scaled by CSS, so the caller says how large the labels have to be
// *relative to the wheel* to stay readable at the size it will be shown.
export function createRadarChart(container, { labelSize = radarLayout.labelSize } = {}) {
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.classList.add("shop-radar");
  svg.setAttribute("viewBox", `0 0 ${radarLayout.width} ${radarLayout.height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", translate("shop.stats.chartLabel"));

  for (let level = 2; level <= radarLayout.maximum; level += 2) {
    const ring = document.createElementNS(svgNamespace, "polygon");
    ring.setAttribute("points", radarPolygon(statKeys.map(() => level)));
    ring.classList.add("radar-grid");
    svg.append(ring);
  }

  statKeys.forEach((_, index) => {
    const angle = radarAngle(index);
    const axis = document.createElementNS(svgNamespace, "line");
    axis.setAttribute("x1", String(radarLayout.centerX));
    axis.setAttribute("y1", String(radarLayout.centerY));
    axis.setAttribute("x2", String(radarLayout.centerX + Math.cos(angle) * radarLayout.radius));
    axis.setAttribute("y2", String(radarLayout.centerY + Math.sin(angle) * radarLayout.radius));
    axis.classList.add("radar-axis");
    svg.append(axis);
  });

  const currentShape = document.createElementNS(svgNamespace, "polygon");
  currentShape.classList.add("radar-current");
  const previewShape = document.createElementNS(svgNamespace, "polygon");
  previewShape.classList.add("radar-preview");
  svg.append(currentShape, previewShape);

  const labels = statKeys.map((key, index) => {
    const labelPosition = radarPoint(index, radarLayout.labelRadius);
    const label = document.createElementNS(svgNamespace, "text");
    label.classList.add("radar-label");
    label.setAttribute("x", String(labelPosition.x));
    label.setAttribute("y", String(labelPosition.y));
    label.setAttribute("font-size", String(labelSize));
    label.setAttribute("text-anchor", labelPosition.x < radarLayout.centerX - 10 ? "end"
      : labelPosition.x > radarLayout.centerX + 10 ? "start" : "middle");
    const name = document.createElementNS(svgNamespace, "tspan");
    name.textContent = translate(statLabelKeys[key]);
    name.setAttribute("x", String(labelPosition.x));
    const value = document.createElementNS(svgNamespace, "tspan");
    value.classList.add("radar-value");
    value.setAttribute("x", String(labelPosition.x));
    // The number sits under its label, so the gap follows the label size instead
    // of a fixed 15 units that a larger label would swallow.
    value.setAttribute("dy", String(Math.round(labelSize * 1.36)));
    value.setAttribute("font-size", String(Math.round(labelSize * 0.9)));
    label.append(name, value);
    svg.append(label);
    return { label, name, value };
  });

  container.replaceChildren(svg);

  return {
    update(current, preview) {
      currentShape.setAttribute("points", radarPolygon(statKeys.map((key) => current[key])));
      previewShape.setAttribute("points", radarPolygon(statKeys.map((key) => preview[key])));
      previewShape.classList.toggle("is-preview", statKeys.some((key) => current[key] !== preview[key]));
      statKeys.forEach((key, index) => {
        const change = preview[key] - current[key];
        labels[index].name.textContent = translate(statLabelKeys[key]);
        labels[index].value.textContent = change === 0
          ? String(current[key])
          : `${current[key]} ${change > 0 ? "▲" : "▼"} ${preview[key]}`;
        labels[index].label.classList.toggle("is-up", change > 0);
        labels[index].label.classList.toggle("is-down", change < 0);
      });
    },
  };
}
