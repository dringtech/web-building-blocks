/**
 * HexJSON layout, q and r are mandatory. Optional context also defined.
 */
type HexJson = {
  layout: string;
  hexes: {
    [key: string]: {
      q: number;
      r: number;
    } & HexContext;
  };
};
/**
 * Hex Context - arbitrary key:value mappings for the hex.
 */
type HexContext = Record<string, string | number>;
/**
 * Hex Container - a base SVG `<g>` element.
 */
type HexContainer = SVGGElement & { context: HexContext };
/**
 * Type for function which maps a hex context to something. Used for title, label and style.
 */
type ContextMapper<T> = (context: HexContext) => T;

const ns = "http://www.w3.org/2000/svg";

/**
 * Web Component to create a HexMap
 * 
 * Needs to be registered with a call to `customElements.define`.
 * 
 * ```
 * customElements.define("hex-map", HexMap);
 * ```
 * 
 * You can then add to the page as follows:
 * 
 * ```html
 * <hex-map id="result" layout="/lookup/calderdale.hexjson"></hex-map>
 * ```
 * 
 * This can be used as an HTML element in the usual ways:
 * 
 * ```
 * const hex = document.querySelector('hex-map#result');
 * ```
 * 
 * Set data on this reference. This needs to be an object which has the same keys as the HexJSON layout.
 * 
 * ```
 * hex.data = resultData;
 * ```
 * 
 * Label (displayed in the hex), title (popup/tooltip content) and style can be controlled by providing a function which will be called with the HexJSON context for
 * each hex item. Label and title must return a string, and style must return an object with the style to set.
 * 
 * ```
 * hexMap.labelSpec = (c) => c.sn as string;
 * hexMap.titleSpec = (c) => `${c.n}: ${c.count} attendees`;
 * hexMap.styleSpec = (c) => ({ fill: colourScale(c.value).hex() });
 * ```
 */
export class HexMap extends HTMLElement {
  /** Which attributed will be reactive (standard WebComponents property) */
  static observedAttributes = ["data"];

  /**
   * The size of the side of a hex. Also
   * * the height of a row (for pointy-topped)
   * * the width of a quolumn (for flat-topped)
   */
  private size = 90;
  /**
   * The orthogonal dimension to the size:
   * * the width of a quolumn (for pointy-topped)
   * * the height of a row (for flat-topped)
   */
  private cadence: number;
  /**
   * The rotation of the hexes:
   * * false == pointy-topped
   * * true == flat-topped
   */
  private rotated: boolean;
  /**
   * Offset even (true) or odd (false) rows
   */
  private even: boolean;

  /** Data to to present */
  private _data: Record<string, Record<string, number>> = {};

  /** Root of the Hex map */
  private shadow?: ShadowRoot = undefined;

  /** The row/quolum spacing of the main axis */
  private mainPitch: number;
  /** The row/quolum spacing of the cross axis */
  private crossPitch: number;
  /** Calculated height of the chart */
  private height = 0;
  /** Calculated width of the chart */
  private width = 0;

  /** The HexJSON layout */
  private hexJson?: HexJson;
  /** The corners of the hexmap */
  private corners: { min: [number, number]; max: [number, number] };
  /** The number of rows in the layout */
  private nRows = 0;
  /** The number of rows in the layout */
  private nQuols = 0;

  /** function to generate label for Hex */
  labelSpec: ContextMapper<string>;

  /** function which returns style for hex */
  styleSpec: ContextMapper<Record<string, string>>;

  /** function to generate title for Hex */
  titleSpec: ContextMapper<string>;

  /** Is the component connected? */
  private connected = false;

  constructor() {
    super();
    // Cadence calculated by trigonometry
    this.cadence = this.size * Math.cos(Math.PI / 6);
    // Assume not rotated (i.e. pointy-topped)
    this.rotated = false;
    // Assume odd offset
    this.even = false;

    // Calculate pitches
    this.mainPitch = this.cadence * 2;
    this.crossPitch = this.size * 3 / 2;

    // Define default label, title and style pitches
    this.labelSpec = (ctx) => `${(ctx.n as string).slice(0, 3)}`;
    this.titleSpec = (ctx) => `${ctx.n}`;
    this.styleSpec = (_ctx) => ({ fill: "#333" });

    // Define default corners
    this.corners = {
      min: [Infinity, Infinity],
      max: [-Infinity, -Infinity],
    };

    // Load dataset
    this.data = this.dataset.data && JSON.parse(this.dataset.data);
  }

  get data() {
    return this._data;
  }

  set data(newValue: Record<string, Record<string, number>>) {
    this._data = newValue;
    this._updateHexes();
  }

  get hexes() {
    if (!this.hexJson) throw new ReferenceError("GeoJSON layout not defined");
    return Object.entries(this.hexJson.hexes)
      .map(([key, definition]) => ({ key, ...definition }))
      .toSorted((a, b) => {
        // Sort descending by row
        if (a.r < b.r) return 1;
        if (a.r > b.r) return -1;
        // In this case the two are on the same row
        // Sort ascending by quolumn
        if (a.q < b.q) return -1;
        if (a.q > b.q) return 1;
        // They are the same!
        return 0;
      });
  }

  private async loadLayout() {
    const layoutUrl = this.getAttribute("layout");
    const req = await fetch(layoutUrl!);
    this.hexJson = await req.json();
    if (this.hexJson == undefined) {
      throw new ReferenceError("Not a HexJson layout");
    }

    // If flat topped, set rotated
    this.rotated = this.hexJson.layout.match(/q$/) !== null;
    this.even = this.hexJson.layout.match(/^even/) !== null;

    // Calculate corners from hexes (min == BL, max == TR)
    this.corners = Object.values(this.hexJson.hexes).reduce(
      (
        { min: [qMin, rMin], max: [qMax, rMax] },
        { q, r },
      ) => ({
        min: [Math.min(qMin, q), Math.min(rMin, r)],
        max: [Math.max(qMax, q), Math.max(rMax, r)],
      }),
      {
        min: [Infinity, Infinity],
        max: [-Infinity, -Infinity],
      },
    );

    this.nQuols = this.corners.max[0] - this.corners.min[0] + 1;
    this.nRows = this.corners.max[1] - this.corners.min[1] + 1;

    // Config
    this.width = this.rotated
      ? this.crossDimension(this.nQuols)
      : this.mainDimension(this.nQuols);
    this.height = this.rotated
      ? this.mainDimension(this.nRows)
      : this.crossDimension(this.nRows);

    return Promise.resolve();
  }

  private crossDimension(n: number) {
    return this.crossPitch * (n - 1);
  }
  private mainDimension(n: number) {
    return this.mainPitch * (n - 1 + 0.5);
  }

  private coordinates(q: number, r: number): [number, number] {
    const offsetTest = this.even ? 0 : 1;
    const qOffset = !this.rotated && Math.abs(r % 2) == offsetTest
      ? this.cadence
      : 0;
    const rOffset = this.rotated && Math.abs(q % 2) == offsetTest
      ? this.cadence
      : 0;

    return [
      (this.rotated ? this.crossPitch : this.mainPitch) * q + qOffset,
      this.height - (this.rotated ? this.mainPitch : this.crossPitch) * r -
      rOffset,
    ];
  }

  private generateHex(
    x: number,
    y: number,
    context: Record<string, string | number>,
  ) {
    const group = document.createElementNS(ns, "g") as HexContainer;
    group.setAttribute("transform", `translate(${x} ${y})`);
    group.classList.add("hex");
    group.setAttribute("clip-path", "url(#clip)");
    group.setAttribute("tabindex", "0");
    group.setAttribute("data-key", context.key.toString());

    const hex = document.createElementNS(ns, "use");
    hex.setAttribute("href", "#hex");
    hex.setAttribute("clip-path", "url(#clip)");
    // use.setAttribute("fill", r % 2 == 0 ? "red" : "blue")

    group.context = context;

    const text = document.createElementNS(ns, "text");
    text.textContent = this.labelSpec(context);

    const title = document.createElementNS(ns, "title");
    title.innerHTML = this.titleSpec(context);

    group.appendChild(hex);
    group.appendChild(text);
    group.append(title);
    return group;
  }

  private _renderHexes() {
    const g = document.createElementNS(ns, "g");
    for (const definition of this.hexes) {
      const { q, r } = definition;
      const hexG = this.generateHex(
        ...this.coordinates(q, r),
        definition,
      );
      g.appendChild(hexG);
    }
    // const background = document.createElementNS(ns, "path")
    // background.setAttribute("d", `M0 0h${width}v${height}h-${width}z`)
    // background.setAttribute("fill", "none");
    // background.setAttribute("stroke", "white");
    // g.appendChild(background);
    this._updateHexes();
    return g;
  }

  private _updateHexes() {
    if (!this.data) return;
    if (!this.connected) {
      console.warn("Component not connected");
      setTimeout(() => this._updateHexes(), 250);
      return;
    }
    console.log({ data: this.data, shadow: this.shadowRoot });
    for (
      const hex of this.shadowRoot?.querySelectorAll<HexContainer>("g.hex") ||
        []
    ) {
      const key = hex.dataset.key!;
      const { count, value } = {
        value: 0,
        count: 0,
        ...this.data[key],
      };
      hex.dataset.value = value.toString();
      hex.context.count = count;
      hex.context.value = value;

      const title = hex.querySelector("title")!;
      title.innerHTML = this.titleSpec(hex.context);

      Object.entries(this.styleSpec(hex.context)).forEach(([k, v]) => {
        hex.style.setProperty(k, v);
      });
    }
  }

  async connectedCallback() {
    await this.loadLayout();

    this.shadow = this.attachShadow({ mode: "open" });

    const padding = this.rotated
      ? { x: this.size * 1.5, y: this.cadence * 1.5 }
      : { x: this.cadence * 1.5, y: this.size * 1.5 };

    const originShift = this.coordinates(
      this.corners.min[0],
      this.corners.max[1],
    );

    // Create some styles
    const style = document.createElement("style");
    style.textContent = `
          svg {
              background: #eee;
              image-rendering: optimizeQuality;
          }
          .hex {
              fill: #333;
              & * {
                  scale: 0.95;
                  transition: 0.2s;
              }
              &:hover * {
                  scale: 1;
              }
              &:hover use {
                  stroke: #999;
                  stroke-width: 20px;
              }
          }
          .hex text {
              fill: white;
              font-size: 40px;
              text-anchor: middle;
              transform: translateY(${40 * 0.35}px);
              pointer-events: none;
          }
          `;

    // Create svg
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute(
      "viewBox",
      `${originShift[0] - padding.x} ${originShift[1] - padding.y} ${
        this.width + 2 * padding.x
      } ${this.height + 2 * padding.y}`,
    );
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    const defs = document.createElementNS(ns, "defs");
    {
      const hex = document.createElementNS(ns, "path");
      const s = this.size;
      const c = this.cadence;

      // Pointy top odd/even-r
      const path = this.rotated
        ? `M${-s / 2} ${-c}h${s} l${s / 2} ${c} l${-s / 2} ${c}h${-s} l${
          -s / 2
        } ${-c}Z`
        : `M${-c} ${-s / 2}l${c} ${-s / 2}l${c} ${s / 2}v${s}l${-c} ${
          s / 2
        }l${-c} ${-s / 2}Z`;
      hex.setAttribute("d", path);
      hex.setAttribute("id", "hex");

      const clip = document.createElementNS(ns, "clipPath");
      clip.setAttribute("id", "clip");
      const use = document.createElementNS(ns, "use");
      use.setAttribute("href", "#hex");
      clip.append(use);
      defs.append(hex, clip);
    }

    const hexes = this._renderHexes();

    svg.appendChild(defs);
    svg.appendChild(hexes);

    this.shadow.appendChild(svg);
    this.shadow.appendChild(style);

    this.connected = true;
  }

  disconnectedCallback() {
    console.log("Custom element removed from page.");
    this.connected = false;
  }

  adoptedCallback() {
    console.log("Custom element moved to new page.");
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    switch (name) {
      case "data":
        this.data = JSON.parse(newValue);
        break;
      default:
        console.log(`Attribute ${name} has changed.`);
        break;
    }
  }
}
