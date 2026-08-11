'use strict';

(function () {
  const LANE_COLORS = [
    '#00e5ff', '#ff2bd6', '#00ff9d', '#ffe600',
    '#b44dff', '#ff6d00', '#00bfff', '#ff4d6d',
    '#7dffb2', '#ffd166', '#8a5cff', '#00e5ff',
  ];

  const MARGIN = { x: 26, y: 18 };
  const ROW_H = 34;
  const LANE_W = 34;
  const NODE_R = 6;

  function assignLanes(commits) {
    const laneOf = new Map();
    const lanes = [];
    const order = new Map(commits.map((c, i) => [c.hash, i]));

    for (const c of commits) {
      let lane = -1;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] === c.hash) {
          lane = i;
          for (let j = i + 1; j < lanes.length; j++) {
            if (lanes[j] === c.hash) lanes[j] = null;
          }
          break;
        }
      }
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(c.hash);
      }
      laneOf.set(c.hash, lane);

      const p1 = c.parents[0];
      if (p1 && !laneOf.has(p1)) lanes[lane] = p1;
      else lanes[lane] = null;
    }
    return laneOf;
  }

  function buildEdges(commits, laneOf) {
    const edges = [];
    const idx = new Map(commits.map((c, i) => [c.hash, i]));
    for (const c of commits) {
      const x0 = laneOf.get(c.hash);
      const y0 = idx.get(c.hash);
      const seen = new Set();
      for (const p of c.parents) {
        if (!idx.has(p) || seen.has(p)) continue;
        seen.add(p);
        edges.push({
          x0, y0,
          x1: laneOf.get(p),
          y1: idx.get(p),
          color: LANE_COLORS[x0 % LANE_COLORS.length],
        });
      }
    }
    return edges;
  }

  function GraphRenderer(canvas, opts) {
    this.canvas = canvas;
    this.commits = [];
    this.laneOf = new Map();
    this.edges = [];
    this.currentHead = opts.currentHead || null;
    this.onSelect = opts.onSelect || (() => {});
    this.onHover = opts.onHover || (() => {});
    this.selectedHash = null;
    this.dpr = window.devicePixelRatio || 1;
    this._register();
  }

  GraphRenderer.prototype._register = function () {
    const self = this;
    this._resize = () => {
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.max(200, Math.floor(rect.width * this.dpr));
      this.canvas.height = Math.max(200, Math.floor(rect.height * this.dpr));
      this.render();
    };
    this._click = (e) => {
      const hit = this._hitTest(e);
      if (hit) {
        this.selectedHash = hit.hash;
        this.onSelect(hit);
        this.render();
      }
    };
    this._move = (e) => {
      const hit = this._hitTest(e);
      if (hit) {
        this.canvas.style.cursor = 'pointer';
        this.onHover(hit);
      } else {
        this.canvas.style.cursor = 'crosshair';
      }
    };
    this._wheel = (e) => {
      const hit = this._hitTest(e);
      if (hit) this.onHover(hit);
    };
    this._raf = null;
    this._onResizeDebounced = () => {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this._resize();
      });
    };
    window.addEventListener('resize', this._onResizeDebounced);
    this.canvas.addEventListener('click', this._click);
    this.canvas.addEventListener('mousemove', this._move);
  };

  GraphRenderer.prototype.setData = function (commits, currentHead) {
    this.commits = commits;
    this.currentHead = currentHead || null;
    this.laneOf = assignLanes(commits);
    this.edges = buildEdges(commits, this.laneOf);
    this.render();
  };

  GraphRenderer.prototype.setSelected = function (hash) {
    this.selectedHash = hash;
    this.render();
  };

  GraphRenderer.prototype._x = function (lane) {
    return MARGIN.x + lane * LANE_W + LANE_W / 2;
  };
  GraphRenderer.prototype._y = function (row) {
    return MARGIN.y + row * ROW_H + ROW_H / 2;
  };

  GraphRenderer.prototype._hitTest = function (e) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.commits.length; i++) {
      const c = this.commits[i];
      const x = this._x(this.laneOf.get(c.hash));
      const y = this._y(i);
      const d = Math.hypot(cx - x, cy - y);
      if (d < 14 && d < bestDist) {
        bestDist = d;
        best = { hash: c.hash, commit: c, row: i, x, y };
      }
    }
    return best;
  };

  GraphRenderer.prototype.render = function () {
    const { canvas } = this;
    if (!canvas.width) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    ctx.clearRect(0, 0, cssW, cssH);

    if (!this.commits.length) return;

    this.edges.forEach((edge) => {
      const x0 = this._x(edge.x0);
      const y0 = this._y(edge.y0);
      const x1 = this._x(edge.x1);
      const y1 = this._y(edge.y1);
      const midY = (y0 + y1) / 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0, midY, x1, midY, x1, y1);
      ctx.strokeStyle = edge.color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = edge.color;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
    ctx.shadowBlur = 0;

    const heads = new Map();
    for (const c of this.commits) {
      for (const r of c.refs) heads.set(r, c.hash);
    }

    for (let i = 0; i < this.commits.length; i++) {
      const c = this.commits[i];
      const x = this._x(this.laneOf.get(c.hash));
      const y = this._y(i);
      const isHead = c.hash === this.currentHead;
      const isSel = c.hash === this.selectedHash;
      const color = this.laneOf.get(c.hash) % LANE_COLORS.length;

      ctx.beginPath();
      ctx.arc(x, y, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = LANE_COLORS[color];
      ctx.shadowColor = LANE_COLORS[color];
      ctx.shadowBlur = isHead || isSel ? 18 : 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      if (isSel) {
        ctx.beginPath();
        ctx.arc(x, y, NODE_R + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (isHead) {
        ctx.beginPath();
        ctx.arc(x, y, NODE_R + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      const labelX = x + NODE_R + 8;
      ctx.font = '11px "Cascadia Mono", Consolas, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#cfe9f7';
      ctx.fillText(c.short, labelX, y);

      ctx.fillStyle = '#5a6a80';
      let msgX = labelX + 7 + ctx.measureText(c.short).width;
      ctx.fillText(c.subject, msgX, y);

      let pillX = cssW - 12;
      for (const ref of c.refs) {
        if (heads.get(ref) !== c.hash) continue;
        const label = ref.replace(/^refs\/heads\//, '');
        const isLocal = !label.startsWith('remotes/');
        ctx.font = 'bold 9px "Cascadia Mono", Consolas, monospace';
        const tw = ctx.measureText(label).width;
        const pw = tw + 14;
        const px = pillX - pw;
        const py = y - 8;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, 16, 3);
        ctx.fillStyle = isLocal ? 'rgba(255,43,214,0.18)' : 'rgba(107,123,148,0.14)';
        ctx.fill();
        ctx.strokeStyle = isLocal ? 'rgba(255,43,214,0.8)' : 'rgba(107,123,148,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = isLocal ? '#ff7fe0' : '#8b9bb2';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, px + 7, y);
        pillX = px - 8;
      }

      if (c.isMerge) {
        ctx.fillStyle = '#ffe600';
        ctx.font = 'bold 9px Consolas, monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText('M', x - NODE_R - 9, y - 1);
      }
    }

    const latest = this.commits[0];
    if (latest) {
      ctx.font = '9px "Cascadia Mono", Consolas, monospace';
      ctx.fillStyle = 'rgba(0,229,255,0.55)';
      ctx.textBaseline = 'top';
      ctx.fillText('LATEST', MARGIN.x - 4, 4);
    }
  };

  GraphRenderer.prototype.destroy = function () {
    window.removeEventListener('resize', this._onResizeDebounced);
    this.canvas.removeEventListener('click', this._click);
    this.canvas.removeEventListener('mousemove', this._move);
  };

  window.GraphRenderer = GraphRenderer;
})();
