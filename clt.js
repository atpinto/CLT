/* Central Limit Theorem — interactive simulation
   =================================================================
   The population is rendered as a crowd of individual dots under its
   density curve. Sampling literally picks dots out of that crowd:
   each chosen individual flashes, detaches, and flies into the
   sample panel (a replacement fades in behind it — sampling from an
   effectively infinite population). When the sample is complete, its
   dots visibly collapse onto one value — the statistic — and that
   single dot drops into the sampling distribution.
   ================================================================= */

document.addEventListener('DOMContentLoaded', () => {

  /* ----------------------------------------------------------------
     Elements
     ---------------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  const workbench   = $('workbench');
  const flightLayer = $('flightLayer');
  const flightCtx   = flightLayer.getContext('2d');

  const popCanvas  = $('populationCanvas');
  const sampCanvas = $('sampleCanvas');
  const distCanvas = $('samplingDistCanvas');
  const popCtx  = popCanvas.getContext('2d');
  const sampCtx = sampCanvas.getContext('2d');
  const distCtx = distCanvas.getContext('2d');
  const PLOTS = [popCanvas, sampCanvas, distCanvas];

  const el = {
    popMean: $('popMeanVal'), popMedian: $('popMedianVal'), popSD: $('popStdDevVal'),
    sMean: $('sampleMeanVal'), sMedian: $('sampleMedianVal'),
    sSD: $('sampleStdDevVal'), sN: $('sampleNVal'),
    dCount: $('samplesDrawnVal'), dMean: $('samplingMeanVal'),
    dSE: $('samplingStdDevVal'), theorySE: $('theorySEVal'),
    nVal: $('nValDisplay'), statName: $('samplingDistStatName')
  };

  const presetControls = $('presetControls');
  const sampleControls = $('sampleControls');
  const distControls   = $('samplingDistControls');
  const drawOneBtn  = $('drawSampleBtn');
  const draw100Btn  = $('draw100SamplesBtn');
  const draw1000Btn = $('draw1000SamplesBtn');
  const resetBtn    = $('resetBtn');
  const normalCurveBox = $('showNormalCurve');
  const popOutlineBox  = $('showPopOutline');

  /* ----------------------------------------------------------------
     Constants & helpers
     ---------------------------------------------------------------- */
  const NUM_BINS      = 50;
  const NUM_DIST_BINS = 50;
  const MIN_VALUE = 0, MAX_VALUE = 100;
  const RANGE = MAX_VALUE - MIN_VALUE;
  const binWidth = RANGE / NUM_BINS;
  const distBinWidth = RANGE / NUM_DIST_BINS;
  const MAX_POTENTIAL = 1;
  const INITIAL_Y_MAX = 10;
  const AXIS_SPACE = 18;
  const CLOUD_SIZE = 380;

  const reducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const T = (ms) => (reducedMotion ? Math.min(ms, 40) : ms);   // duration
  const G = (ms) => (reducedMotion ? 0 : ms);                  // stagger

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
  const binOf = (v) => clamp(Math.floor((v - MIN_VALUE) / binWidth), 0, NUM_BINS - 1);
  const distBinOf = (v) => clamp(Math.floor((v - MIN_VALUE) / distBinWidth), 0, NUM_DIST_BINS - 1);
  const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const easeOut = (t) => 1 - (1 - t) ** 3;

  let themeCache = new Map();
  const colorOf = (name, fallback) => {
    if (!themeCache.has(name)) {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue(name).trim();
      themeCache.set(name, v || fallback);
    }
    return themeCache.get(name);
  };
  const uiFont = (size, weight = '') =>
    `${weight} ${size}px ${getComputedStyle(document.body).fontFamily}`.trim();

  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener?.('change', () => { themeCache = new Map(); redrawAll(); });

  /* ----------------------------------------------------------------
     State
     ---------------------------------------------------------------- */
  let population = new Array(NUM_BINS).fill(0);
  let cloud = [];                 // the visible individuals
  let cloudHidden = false;        // hidden while sculpting

  let sampleValues = [];
  let sampleBins  = new Array(NUM_BINS).fill(0);
  let pendingBins = new Array(NUM_BINS).fill(0);
  let sampleDimmed = false;       // during / after collapse
  let lastHighlight = null;

  let distValues = [];
  let distBins = new Array(NUM_DIST_BINS).fill(0);
  let distYMax = INITIAL_Y_MAX;
  let numSamplesDrawn = 0;

  let sampleSize = 5;
  let selectedStat = 'mean';
  let sizeOfLastDist = 5;
  let isProcessing = false;
  let isSculpting = false;

  /* ----------------------------------------------------------------
     High-DPI sizing (all drawing is in CSS pixels)
     ---------------------------------------------------------------- */
  function sizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.dataset.w = w;
    canvas.dataset.h = h;
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const sizeOf = (c) => ({
    width: Number(c.dataset.w) || c.clientWidth || 1,
    height: Number(c.dataset.h) || c.clientHeight || 1
  });
  const box = (c) => {
    const { width, height } = sizeOf(c);
    const baseline = Math.max(1, height - AXIS_SPACE);
    return { width, height, baseline, plotHeight: baseline };
  };
  const toLayer = (canvas, x, y) => {
    const a = canvas.getBoundingClientRect();
    const b = flightLayer.getBoundingClientRect();
    return { x: a.left - b.left + x, y: a.top - b.top + y };
  };

  function sizeEverything() { PLOTS.forEach(sizeCanvas); sizeCanvas(flightLayer); }

  let resizeFrame = null;
  function onResize() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      sizeEverything();
      redrawAll();
    });
  }

  /* ----------------------------------------------------------------
     Animation engine: one rAF loop, a list of tweens
     ---------------------------------------------------------------- */
  const tweens = [];
  let loopHandle = null;

  function tween(spec) {           // {dur, delay?, tick(k, now)?, done()?}
    tweens.push({ ...spec, start: performance.now() + (spec.delay || 0) });
    if (loopHandle === null) loopHandle = requestAnimationFrame(step);
  }

  function killTweens() {
    tweens.length = 0;
    if (loopHandle !== null) cancelAnimationFrame(loopHandle);
    loopHandle = null;
    const { width, height } = sizeOf(flightLayer);
    flightCtx.clearRect(0, 0, width, height);
  }

  function step(now) {
    const { width, height } = sizeOf(flightLayer);
    flightCtx.clearRect(0, 0, width, height);

    let cloudChanged = false;
    for (const d of cloud) {
      if (d.alpha < 1 && now >= d.fadeFrom) {
        d.alpha = Math.min(1, (now - d.fadeFrom) / 500);
        cloudChanged = true;
      }
    }
    if (cloudChanged) drawPopulation();

    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      if (now < tw.start) continue;
      const k = clamp((now - tw.start) / tw.dur, 0, 1);
      tw.tick?.(k, now);
      if (k >= 1) { tweens.splice(i, 1); tw.done?.(); }
    }

    const cloudFading = cloud.some((d) => d.alpha < 1);
    loopHandle = (tweens.length || cloudFading)
      ? requestAnimationFrame(step)
      : null;
    if (loopHandle === null) flightCtx.clearRect(0, 0, width, height);
  }

  /* Flight dot with a soft trail along a quadratic arc */
  function fly({ from, to, dur, delay = 0, r = 4, colour, arc = 40, done }) {
    const cx = (from.x + to.x) / 2;
    const cy = Math.min(from.y, to.y) - arc;
    const at = (t) => ({
      x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * cx + t * t * to.x,
      y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * cy + t * t * to.y
    });
    tween({
      dur: T(dur), delay: G(delay),
      tick: (k) => {
        const e = easeInOut(k);
        for (let g = 3; g >= 0; g--) {
          const p = at(clamp(e - g * 0.06, 0, 1));
          flightCtx.globalAlpha = g === 0 ? 1 : 0.16 / g;
          flightCtx.fillStyle = colour;
          flightCtx.beginPath();
          flightCtx.arc(p.x, p.y, r * (g === 0 ? 1 : 0.75), 0, Math.PI * 2);
          flightCtx.fill();
        }
        flightCtx.globalAlpha = 1;
      },
      done: () => { ripple(to, colour, r * 3.2); done?.(); }
    });
  }

  function ripple(at, colour, max) {
    tween({
      dur: T(420),
      tick: (k) => {
        flightCtx.strokeStyle = colour;
        flightCtx.globalAlpha = (1 - k) * 0.55;
        flightCtx.lineWidth = 1.5;
        flightCtx.beginPath();
        flightCtx.arc(at.x, at.y, 2 + easeOut(k) * max, 0, Math.PI * 2);
        flightCtx.stroke();
        flightCtx.globalAlpha = 1;
      }
    });
  }

  /* ----------------------------------------------------------------
     01 · Population: density curve + crowd of individuals
     ---------------------------------------------------------------- */
  function loadPreset(type) {
    population = new Array(NUM_BINS).fill(0);
    const centre = (i) => MIN_VALUE + (i + 0.5) * binWidth;

    if (type === 'normal') {
      const mu = RANGE / 2, sd = RANGE / 6;
      for (let i = 0; i < NUM_BINS; i++)
        population[i] = Math.exp(-0.5 * ((centre(i) - mu) / sd) ** 2);
    } else if (type === 'uniform') {
      population.fill(0.6);
    } else if (type === 'exponential') {
      const lambda = 5 / RANGE;
      for (let i = 0; i < NUM_BINS; i++)
        population[i] = Math.exp(-lambda * centre(i)) * 0.95;
    } else if (type === 'bimodal') {
      const m1 = RANGE / 4, m2 = RANGE * 3 / 4, sd = RANGE / 15;
      let peak = 0;
      for (let i = 0; i < NUM_BINS; i++) {
        const c = centre(i);
        population[i] = 0.6 * Math.exp(-0.5 * ((c - m1) / sd) ** 2)
                      + 0.6 * Math.exp(-0.5 * ((c - m2) / sd) ** 2);
        peak = Math.max(peak, population[i]);
      }
      if (peak > 1e-6) population = population.map((p) => p / peak * 0.95);
    } else { loadPreset('normal'); return; }

    population = population.map((p) => clamp(p, 0, MAX_POTENTIAL));
    rebuildCloud();
    updatePopulation();
    clearSample();
    clearDist();
  }

  const heightAt = (value) =>
    clamp(population[binOf(value)] || 0, 0, MAX_POTENTIAL) / MAX_POTENTIAL;

  function populationCDF() {
    const total = population.reduce((s, v) => s + Math.max(0, v), 0);
    if (!(total > 1e-9)) return null;
    const cdf = []; let acc = 0;
    for (let i = 0; i < NUM_BINS; i++) {
      acc += Math.max(0, population[i]) / total;
      cdf.push(Math.min(1, acc));
    }
    cdf[cdf.length - 1] = 1;
    return cdf;
  }

  function drawValue(cdf) {
    const r = Math.random();
    const i = cdf.findIndex((p) => p >= r - 1e-9);
    if (i === -1) return MAX_VALUE - binWidth / 2;
    const lower = i > 0 ? cdf[i - 1] : 0;
    const mass = cdf[i] - lower;
    const f = mass < 1e-9 ? 0.5 : clamp((r - lower) / mass, 0, 1);
    return clamp(MIN_VALUE + (i + f) * binWidth, MIN_VALUE, MAX_VALUE);
  }

  function makeCloudDot(cdf, instant) {
    const value = drawValue(cdf);
    return {
      value,
      fy: 0.08 + Math.random() * 0.84,   // fraction of curve height
      alpha: instant ? 1 : 0,
      fadeFrom: instant ? 0 : performance.now()
    };
  }

  function rebuildCloud() {
    const cdf = populationCDF();
    cloud = cdf
      ? Array.from({ length: CLOUD_SIZE }, () => makeCloudDot(cdf, true))
      : [];
  }

  function cloudDotXY(d) {
    const { width, plotHeight, baseline } = box(popCanvas);
    return {
      x: (d.value - MIN_VALUE) / RANGE * width,
      y: baseline - d.fy * heightAt(d.value) * plotHeight
    };
  }

  /* Pull the nearest individual out of the crowd for a drawn value */
  function takeCloudDot(value) {
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < cloud.length; i++) {
      if (cloud[i].alpha < 1) continue;
      const d = Math.abs(cloud[i].value - value);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best === -1) return null;
    const dot = cloud[best];
    cloud.splice(best, 1);
    return dot;
  }

  function respawnCloudDot(delay) {
    const cdf = populationCDF();
    if (!cdf) return;
    const dot = makeCloudDot(cdf, false);
    dot.fadeFrom = performance.now() + delay;
    cloud.push(dot);
    if (loopHandle === null) loopHandle = requestAnimationFrame(step);
  }

  function drawPopulation() {
    const { width, height, plotHeight, baseline } = box(popCanvas);
    paintBackground(popCtx, width, height);

    // density curve
    popCtx.beginPath();
    popCtx.strokeStyle = colorOf('--pop-line-color', '#3d5a80');
    popCtx.fillStyle = colorOf('--pop-fill-color', 'rgba(61,90,128,0.1)');
    popCtx.lineWidth = 2;
    popCtx.lineJoin = 'round';
    popCtx.moveTo(0, baseline);
    for (let i = 0; i < NUM_BINS; i++) {
      const x = (i + 0.5) * (width / NUM_BINS);
      const y = baseline - (clamp(population[i], 0, 1)) * plotHeight;
      popCtx.lineTo(x, y);
    }
    popCtx.lineTo(width, baseline);
    popCtx.closePath();
    popCtx.fill();
    popCtx.stroke();

    // the crowd
    if (!cloudHidden) {
      const base = colorOf('--pop-dot-color', 'rgba(61,90,128,0.38)');
      popCtx.fillStyle = base;
      for (const d of cloud) {
        const p = cloudDotXY(d);
        popCtx.globalAlpha = d.alpha;
        popCtx.beginPath();
        popCtx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        popCtx.fill();
      }
      popCtx.globalAlpha = 1;
    }

    drawAxis(popCtx, width, baseline);
  }

  function populationStats() {
    const total = population.reduce((s, v) => s + Math.max(0, v), 0);
    if (total < 1e-9) return { mean: NaN, median: NaN, stdDev: NaN };
    let mean = 0, meanSq = 0, cum = 0, median = NaN;
    for (let i = 0; i < NUM_BINS; i++) {
      const prob = Math.max(0, population[i]) / total;
      const v = MIN_VALUE + (i + 0.5) * binWidth;
      mean += v * prob; meanSq += v * v * prob;
    }
    for (let i = 0; i < NUM_BINS; i++) {
      const prob = Math.max(0, population[i]) / total;
      if (prob <= 0) continue;
      if (cum + prob >= 0.5 - 1e-9) {
        median = MIN_VALUE + (i + clamp((0.5 - cum) / prob, 0, 1)) * binWidth;
        break;
      }
      cum += prob;
    }
    return { mean, median, stdDev: Math.sqrt(Math.max(0, meanSq - mean * mean)) };
  }

  function updatePopulation() {
    drawPopulation();
    const s = populationStats();
    el.popMean.textContent = fmt(s.mean);
    el.popMedian.textContent = fmt(s.median);
    el.popSD.textContent = fmt(s.stdDev);
    updateTheorySE();
  }

  function updateTheorySE() {
    if (selectedStat !== 'mean') { el.theorySE.textContent = '-'; return; }
    const sd = populationStats().stdDev;
    el.theorySE.textContent = Number.isFinite(sd)
      ? (sd / Math.sqrt(sampleSize)).toFixed(1) : '-';
  }

  function sculptAt(event) {
    if (isProcessing) return;
    const rect = popCanvas.getBoundingClientRect();
    const index = clamp(
      Math.floor((event.clientX - rect.left) / (rect.width / NUM_BINS)),
      0, NUM_BINS - 1);
    const plotHeight = Math.max(1, rect.height - AXIS_SPACE);
    const ratio = (plotHeight - Math.max(0, event.clientY - rect.top)) / plotHeight;
    population[index] = clamp(ratio * 1.05, 0, MAX_POTENTIAL);
    updatePopulation();
    clearSample();
    clearDist();
  }

  /* ----------------------------------------------------------------
     Shared chrome
     ---------------------------------------------------------------- */
  function paintBackground(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colorOf('--canvas-bg', '#ffffff');
    ctx.fillRect(0, 0, width, height);
  }

  function drawAxis(ctx, width, baseline, ticks = 5) {
    const axis = colorOf('--axis-color', '#9aa4b0');
    ctx.strokeStyle = axis; ctx.fillStyle = axis; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baseline + 0.5);
    ctx.lineTo(width, baseline + 0.5);
    ctx.stroke();
    ctx.font = uiFont(10);
    ctx.textBaseline = 'top';
    for (let i = 0; i < ticks; i++) {
      const v = MIN_VALUE + i * RANGE / (ticks - 1);
      const x = clamp((v - MIN_VALUE) / RANGE * width, 0, width);
      ctx.textAlign = i === 0 ? 'left' : i === ticks - 1 ? 'right' : 'center';
      ctx.beginPath(); ctx.moveTo(x, baseline); ctx.lineTo(x, baseline + 4); ctx.stroke();
      ctx.fillText(v.toFixed(0), x, baseline + 8);
    }
    ctx.textAlign = 'start';
  }

  function summarise(values) {
    const n = values.length;
    if (!n) return { mean: NaN, median: NaN, stdDev: NaN, n: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, v) => a + v, 0) / n;
    const mid = Math.floor(n / 2);
    const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const meanSq = values.reduce((a, v) => a + v * v, 0) / n;
    return { mean, median, stdDev: Math.sqrt(Math.max(0, meanSq - mean * mean)), n };
  }

  /* ----------------------------------------------------------------
     02 · Sample: stacked dots
     ---------------------------------------------------------------- */
  function dotGeometry() {
    const { width, plotHeight } = box(sampCanvas);
    const col = width / NUM_BINS;
    let tallest = 1;
    for (let i = 0; i < NUM_BINS; i++)
      tallest = Math.max(tallest, sampleBins[i] + pendingBins[i]);
    const r = Math.max(1.4, Math.min(col * 0.46, plotHeight / (2.3 * tallest), 6.5));
    return { col, r, gap: Math.max(0.5, r * 0.26) };
  }

  function dotSlot(binIndex, level) {
    const g = dotGeometry();
    const { baseline } = box(sampCanvas);
    return {
      x: (binIndex + 0.5) * g.col,
      y: baseline - g.r - level * (g.r * 2 + g.gap),
      r: g.r
    };
  }

  function drawSample() {
    const { width, height, baseline } = box(sampCanvas);
    paintBackground(sampCtx, width, height);
    const g = dotGeometry();
    sampCtx.fillStyle = sampleDimmed
      ? colorOf('--sample-dot-dim', 'rgba(214,138,60,0.35)')
      : colorOf('--sample-dot-fill', '#d68a3c');
    sampCtx.strokeStyle = colorOf('--sample-dot-stroke', '#9d5c1b');
    sampCtx.lineWidth = Math.min(1, g.r * 0.35);
    for (let i = 0; i < NUM_BINS; i++) {
      for (let level = 0; level < sampleBins[i]; level++) {
        const x = (i + 0.5) * g.col;
        const y = baseline - g.r - level * (g.r * 2 + g.gap);
        sampCtx.beginPath();
        sampCtx.arc(x, y, g.r, 0, Math.PI * 2);
        sampCtx.fill();
        if (!sampleDimmed && g.r > 2) sampCtx.stroke();
      }
    }
    drawAxis(sampCtx, width, baseline);
  }

  function drawStatMarker(statValue) {
    if (!Number.isFinite(statValue)) return;
    const { width, baseline } = box(sampCanvas);
    const colour = colorOf('--highlight-color', '#2f8f82');
    const x = clamp((statValue - MIN_VALUE) / RANGE, 0, 1) * width;
    const tipY = baseline - 1, topY = tipY - 9;

    sampCtx.fillStyle = colour;
    sampCtx.beginPath();
    sampCtx.moveTo(x - 6, topY); sampCtx.lineTo(x + 6, topY); sampCtx.lineTo(x, tipY);
    sampCtx.closePath(); sampCtx.fill();

    const name = selectedStat[0].toUpperCase() + selectedStat.slice(1);
    const label = `${name} ${statValue.toFixed(1)}`;
    sampCtx.font = uiFont(11, '600');
    sampCtx.textBaseline = 'bottom';
    sampCtx.textAlign = 'center';
    const tw = sampCtx.measureText(label).width;
    const lx = clamp(x, tw / 2 + 4, width - tw / 2 - 4);
    sampCtx.globalAlpha = 0.85;
    sampCtx.fillStyle = colorOf('--canvas-bg', '#fff');
    sampCtx.fillRect(lx - tw / 2 - 4, topY - 16, tw + 8, 14);
    sampCtx.globalAlpha = 1;
    sampCtx.fillStyle = colour;
    sampCtx.fillText(label, lx, topY - 3);
    sampCtx.textAlign = 'start';
    lastHighlight = statValue;
  }

  function clearSample() {
    sampleValues = [];
    sampleBins.fill(0);
    pendingBins.fill(0);
    sampleDimmed = false;
    lastHighlight = null;
    drawSample();
    el.sMean.textContent = el.sMedian.textContent =
      el.sSD.textContent = el.sN.textContent = '-';
  }

  function showSampleStats(s) {
    el.sMean.textContent = fmt(s.mean);
    el.sMedian.textContent = fmt(s.median);
    el.sSD.textContent = fmt(s.stdDev);
    el.sN.textContent = s.n;
  }

  /* ----------------------------------------------------------------
     03 · Sampling distribution
     ---------------------------------------------------------------- */
  function clearDist() {
    distValues = [];
    distBins.fill(0);
    numSamplesDrawn = 0;
    sizeOfLastDist = sampleSize;
    distYMax = INITIAL_Y_MAX;
    drawDist();
    el.dCount.textContent = '0';
    el.dMean.textContent = el.dSE.textContent = '-';
  }

  function drawDist() {
    const { width, height, plotHeight, baseline } = box(distCanvas);
    const tallest = Math.max(0, ...distBins);
    distYMax = Math.max(distYMax, INITIAL_Y_MAX, Math.ceil(tallest / 5) * 5);

    paintBackground(distCtx, width, height);
    const bw = width / NUM_DIST_BINS;
    distCtx.fillStyle = colorOf('--sampling-bar-fill', '#45a99b');
    distCtx.strokeStyle = colorOf('--sampling-bar-stroke', '#2a7f73');
    distCtx.lineWidth = 1;

    for (let i = 0; i < NUM_DIST_BINS; i++) {
      if (!distBins[i]) continue;
      const h = Math.min(distBins[i] / distYMax * plotHeight, plotHeight);
      distCtx.fillRect(i * bw, baseline - h, bw, h);
      distCtx.strokeRect(i * bw + 0.5, baseline - h + 0.5,
        Math.max(0, bw - 1), Math.max(0, h - 1));
    }

    const scale = numSamplesDrawn * distBinWidth;

    if (popOutlineBox.checked && numSamplesDrawn > 0) {
      const total = population.reduce((s, v) => s + Math.max(0, v), 0);
      if (total > 1e-9) {
        distCtx.strokeStyle = colorOf('--pop-outline-color', 'rgba(61,90,128,0.55)');
        distCtx.lineWidth = 1.5;
        distCtx.setLineDash([5, 4]);
        distCtx.beginPath();
        let started = false;
        for (let px = 0; px <= width; px++) {
          const v = MIN_VALUE + px / width * RANGE;
          const density = Math.max(0, population[binOf(v)]) / (total * binWidth);
          const y = baseline - density * scale / Math.max(1, distYMax) * plotHeight;
          if (y > baseline) { started = false; continue; }
          started ? distCtx.lineTo(px, Math.max(0, y))
                  : (distCtx.moveTo(px, Math.max(0, y)), started = true);
        }
        distCtx.stroke();
        distCtx.setLineDash([]);
      }
    }

    if (normalCurveBox.checked && numSamplesDrawn > 1) {
      const s = summarise(distValues);
      if (Number.isFinite(s.mean) && s.stdDev > 1e-6) {
        const norm = 1 / (s.stdDev * Math.sqrt(2 * Math.PI));
        distCtx.strokeStyle = colorOf('--normal-curve-color', '#a8324f');
        distCtx.lineWidth = 1.75;
        distCtx.beginPath();
        let started = false;
        for (let px = 0; px <= width; px++) {
          const v = MIN_VALUE + px / width * RANGE;
          const density = norm * Math.exp(-((v - s.mean) ** 2) / (2 * s.stdDev ** 2));
          const y = baseline - density * scale / Math.max(1, distYMax) * plotHeight;
          if (y > baseline) { started = false; continue; }
          started ? distCtx.lineTo(px, Math.max(0, y))
                  : (distCtx.moveTo(px, Math.max(0, y)), started = true);
        }
        distCtx.stroke();
      }
    }

    drawAxis(distCtx, width, baseline);
  }

  function recordStat(value) {
    if (!Number.isFinite(value)) return;
    distValues.push(value);
    distBins[distBinOf(value)]++;
    numSamplesDrawn++;
  }

  function updateDistStats() {
    const s = summarise(distValues);
    el.dCount.textContent = s.n;
    el.dMean.textContent = fmt(s.mean);
    el.dSE.textContent = fmt(s.stdDev);
  }

  function distBarTopXY(value) {
    const { width, plotHeight, baseline } = box(distCanvas);
    const i = distBinOf(value);
    const h = Math.min(distBins[i] / Math.max(1, distYMax) * plotHeight, plotHeight);
    return { x: (i + 0.5) * (width / NUM_DIST_BINS), y: baseline - h - 4 };
  }

  /* ----------------------------------------------------------------
     Orchestration
     ---------------------------------------------------------------- */
  function setControlsDisabled(disabled) {
    isProcessing = disabled;
    [drawOneBtn, draw100Btn, draw1000Btn, resetBtn]
      .forEach((b) => { b.disabled = disabled; });
    [presetControls, sampleControls, distControls].forEach((g) =>
      g.querySelectorAll('input').forEach((i) => { i.disabled = disabled; }));
    popCanvas.classList.toggle('is-locked', disabled);
  }

  function maybeResetDistForNewN() {
    if (sampleSize !== sizeOfLastDist) {
      clearDist();
      sizeOfLastDist = sampleSize;
    }
  }

  /* One sample, fully animated: pick individuals out of the crowd,
     collapse them onto the statistic, drop the statistic into 03. */
  function animateOneSample() {
    if (isProcessing) return;
    maybeResetDistForNewN();
    const cdf = populationCDF();
    if (!cdf) { alert('Draw a population first — the plot is empty.'); return; }

    setControlsDisabled(true);
    killTweens();
    clearSample();

    const values = Array.from({ length: sampleSize }, () => drawValue(cdf));
    const stagger = sampleSize <= 10 ? 210 : sampleSize <= 20 ? 110 : 26;
    const flightDur = sampleSize <= 10 ? 560 : 400;
    const dotColour = colorOf('--sample-dot-fill', '#d68a3c');
    const hotColour = colorOf('--pop-dot-hot', '#c2762c');
    let landed = 0;

    values.forEach((value, k) => {
      tween({
        dur: 1, delay: G(k * stagger),
        done: () => {
          const taken = takeCloudDot(value) ?? { value, fy: 0.5 };
          respawnCloudDot(900);
          const from = toLayer(popCanvas, ...(() => {
            const p = cloudDotXY(taken); return [p.x, p.y];
          })());
          drawPopulation();

          // brief flash where the individual was picked
          ripple(from, hotColour, 10);

          const bin = binOf(value);
          const level = sampleBins[bin] + pendingBins[bin];
          pendingBins[bin]++;
          const slot = dotSlot(bin, level);

          fly({
            from,
            to: toLayer(sampCanvas, slot.x, slot.y),
            dur: flightDur,
            r: Math.max(2.5, slot.r),
            colour: dotColour,
            arc: 30,
            done: () => {
              pendingBins[bin] = Math.max(0, pendingBins[bin] - 1);
              sampleBins[bin]++;
              sampleValues.push(value);
              drawSample();
              showSampleStats(summarise(sampleValues));
              if (++landed === values.length) collapseToStatistic();
            }
          });
        }
      });
    });

    function collapseToStatistic() {
      const stats = summarise(sampleValues);
      const statValue = stats[selectedStat];
      if (!Number.isFinite(statValue)) { setControlsDisabled(false); return; }

      const { width, baseline } = box(sampCanvas);
      const statX = clamp((statValue - MIN_VALUE) / RANGE, 0, 1) * width;
      const targetY = baseline - 12;
      const teal = colorOf('--highlight-color', '#2f8f82');

      // Ghost of every observation slides onto the statistic
      const ghosts = [];
      const g = dotGeometry();
      for (let i = 0; i < NUM_BINS; i++) {
        for (let level = 0; level < sampleBins[i]; level++) {
          const s = dotSlot(i, level);
          ghosts.push({ x: s.x, y: s.y, r: Math.max(2, g.r * 0.9) });
        }
      }

      tween({
        dur: T(650), delay: G(280),
        tick: (k) => {
          if (!sampleDimmed) { sampleDimmed = true; drawSample(); }
          const e = easeInOut(k);
          flightCtx.fillStyle = teal;
          for (const gh of ghosts) {
            const p = toLayer(sampCanvas,
              gh.x + (statX - gh.x) * e,
              gh.y + (targetY - gh.y) * e);
            flightCtx.globalAlpha = 0.28 + 0.5 * e;
            flightCtx.beginPath();
            flightCtx.arc(p.x, p.y, gh.r * (1 - 0.35 * e), 0, Math.PI * 2);
            flightCtx.fill();
          }
          flightCtx.globalAlpha = 1;
        },
        done: () => {
          drawSample();
          drawStatMarker(statValue);
          handOff(statValue);
        }
      });

      function handOff(v) {
        const target = distBarTopXY(v);
        fly({
          from: toLayer(sampCanvas, statX, targetY),
          to: toLayer(distCanvas, target.x, target.y),
          dur: 620, delay: 160,
          r: 5,
          colour: teal,
          arc: 55,
          done: () => {
            recordStat(v);
            drawDist();
            updateDistStats();
            setControlsDisabled(false);
          }
        });
      }
    }

    // Safety net if rAF stalls (backgrounded tab)
    setTimeout(() => {
      if (isProcessing && tweens.length === 0) setControlsDisabled(false);
    }, values.length * G(stagger) + T(flightDur) + T(650) + T(620) + 4000);
  }

  /* Many samples: rain the statistics into the distribution */
  function drawManySamples(count) {
    if (isProcessing) return;
    maybeResetDistForNewN();
    const cdf = populationCDF();
    if (!cdf) { alert('Draw a population first — the plot is empty.'); return; }

    setControlsDisabled(true);
    killTweens();
    clearSample();

    const stats = Array.from({ length: count }, () => {
      const values = Array.from({ length: sampleSize }, () => drawValue(cdf));
      return summarise(values)[selectedStat];
    }).filter(Number.isFinite);

    if (count <= 100 && !reducedMotion) {
      // Visible rain, one drop per sample
      const teal = colorOf('--highlight-color', '#2f8f82');
      let landed = 0;
      stats.forEach((v, k) => {
        tween({
          dur: 1, delay: k * 14,
          done: () => {
            const target = distBarTopXY(v);
            fly({
              from: toLayer(distCanvas, target.x, -14),
              to: toLayer(distCanvas, target.x, target.y),
              dur: 300, r: 3.5, colour: teal, arc: 0,
              done: () => {
                recordStat(v);
                drawDist();
                if (++landed === stats.length) {
                  updateDistStats();
                  setControlsDisabled(false);
                }
              }
            });
          }
        });
      });
      setTimeout(() => {
        if (isProcessing && tweens.length === 0) setControlsDisabled(false);
      }, stats.length * 14 + 4000);
    } else {
      // Progressive fill in chunks, counter ticking up
      let i = 0;
      const chunk = Math.max(25, Math.ceil(stats.length / 40));
      tween({
        dur: T(900),
        tick: (k) => {
          const upTo = Math.floor(easeOut(k) * stats.length);
          while (i < upTo) recordStat(stats[i++]);
          drawDist();
          el.dCount.textContent = numSamplesDrawn;
        },
        done: () => {
          while (i < stats.length) recordStat(stats[i++]);
          drawDist();
          updateDistStats();
          setControlsDisabled(false);
        }
      });
      void chunk;
    }
  }

  /* ----------------------------------------------------------------
     Redraw / reset
     ---------------------------------------------------------------- */
  function redrawAll() {
    drawPopulation();
    drawSample();
    if (lastHighlight !== null) drawStatMarker(lastHighlight);
    drawDist();
  }

  function resetSimulation() {
    killTweens();
    sampleSize = 5;
    selectedStat = 'mean';
    normalCurveBox.checked = false;
    popOutlineBox.checked = false;
    $('presetNormal').checked = true;
    $('n5').checked = true;
    $('statMean').checked = true;
    el.nVal.textContent = sampleSize;
    el.statName.textContent = 'mean';
    loadPreset('normal');
    setControlsDisabled(false);
  }

  /* ----------------------------------------------------------------
     Events
     ---------------------------------------------------------------- */
  presetControls.addEventListener('change', (e) => {
    if (e.target.name !== 'distType') return;
    if (isProcessing) { e.target.checked = false; return; }
    loadPreset(e.target.value);
  });

  sampleControls.addEventListener('change', (e) => {
    if (e.target.name !== 'sampleSize') return;
    sampleSize = parseInt(e.target.value, 10);
    el.nVal.textContent = sampleSize;
    if (sampleSize !== sizeOfLastDist && numSamplesDrawn > 0) clearDist();
    clearSample();
    updateTheorySE();
  });

  distControls.addEventListener('change', (e) => {
    if (e.target.name === 'samplingStat') {
      selectedStat = e.target.value;
      el.statName.textContent = selectedStat;
      clearDist();
      clearSample();
      updateTheorySE();
    }
  });

  normalCurveBox.addEventListener('change', drawDist);
  popOutlineBox.addEventListener('change', drawDist);
  resetBtn.addEventListener('click', resetSimulation);
  drawOneBtn.addEventListener('click', animateOneSample);
  draw100Btn.addEventListener('click', () => drawManySamples(100));
  draw1000Btn.addEventListener('click', () => drawManySamples(1000));

  popCanvas.addEventListener('pointerdown', (e) => {
    if (isProcessing) return;
    isSculpting = true;
    cloudHidden = true;
    popCanvas.setPointerCapture(e.pointerId);
    sculptAt(e);
    const checked = presetControls.querySelector('input[name="distType"]:checked');
    if (checked) checked.checked = false;
    e.preventDefault();
  });

  popCanvas.addEventListener('pointermove', (e) => {
    if (!isSculpting || isProcessing) return;
    sculptAt(e);
    e.preventDefault();
  });

  const endSculpt = (e) => {
    if (!isSculpting) return;
    isSculpting = false;
    cloudHidden = false;
    if (e?.pointerId !== undefined && popCanvas.hasPointerCapture(e.pointerId)) {
      popCanvas.releasePointerCapture(e.pointerId);
    }
    rebuildCloud();          // the crowd re-forms under the new shape
    cloud.forEach((d, i) => {
      d.alpha = 0;
      d.fadeFrom = performance.now() + (reducedMotion ? 0 : i * 1.2);
    });
    if (loopHandle === null) loopHandle = requestAnimationFrame(step);
    drawPopulation();
  };
  popCanvas.addEventListener('pointerup', endSculpt);
  popCanvas.addEventListener('pointercancel', endSculpt);
  window.addEventListener('blur', () => endSculpt());

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(onResize);
    PLOTS.forEach((c) => ro.observe(c));
    ro.observe(workbench);
  } else {
    window.addEventListener('resize', onResize);
  }

  /* ---------------------------------------------------------------- */
  sizeEverything();
  resetSimulation();
});
