/* Central Limit Theorem simulation
   -------------------------------------------------------------
   Observations physically fall from the population plot into the
   sample plot, where each one lands as a dot. When the sample is
   complete, its statistic flies across to the sampling
   distribution and lands as a bar.
   ------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {

  /* ---------------------------------------------------------------
     Elements
     --------------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  const workbench   = $('workbench');
  const flightLayer = $('flightLayer');
  const flightCtx   = flightLayer.getContext('2d');

  const popCanvas          = $('populationCanvas');
  const sampleCanvas       = $('sampleCanvas');
  const samplingDistCanvas = $('samplingDistCanvas');

  const popCtx          = popCanvas.getContext('2d');
  const sampleCtx       = sampleCanvas.getContext('2d');
  const samplingDistCtx = samplingDistCanvas.getContext('2d');

  const PLOTS = [popCanvas, sampleCanvas, samplingDistCanvas];

  const popStats = {
    mean: $('popMeanVal'), median: $('popMedianVal'), stdDev: $('popStdDevVal')
  };
  const sampleStats = {
    mean: $('sampleMeanVal'), median: $('sampleMedianVal'),
    stdDev: $('sampleStdDevVal'), n: $('sampleNVal')
  };
  const distStats = {
    count: $('samplesDrawnVal'), mean: $('samplingMeanVal'),
    median: $('samplingMedianVal'), stdDev: $('samplingStdDevVal')
  };

  const presetControls = $('presetControls');
  const sampleControls = $('sampleControls');
  const distControls   = $('samplingDistControls');
  const drawOneBtn     = $('drawSampleBtn');
  const draw100Btn     = $('draw100SamplesBtn');
  const draw1000Btn    = $('draw1000SamplesBtn');
  const resetBtn       = $('resetBtn');
  const normalCurveBox = $('showNormalCurve');
  const nValDisplay    = $('nValDisplay');
  const statNameSpan   = $('samplingDistStatName');

  /* ---------------------------------------------------------------
     Constants
     --------------------------------------------------------------- */
  const NUM_BINS       = 50;
  const NUM_DIST_BINS  = 50;
  const MIN_VALUE      = 0;
  const MAX_VALUE      = 100;
  const RANGE          = MAX_VALUE - MIN_VALUE;
  const binWidth       = RANGE / NUM_BINS;
  const distBinWidth   = RANGE / NUM_DIST_BINS;
  const MAX_POTENTIAL  = 1.0;
  const INITIAL_Y_MAX  = 10;
  const AXIS_SPACE     = 18;
  const TICK_LENGTH    = 4;
  const LABEL_PADDING  = 4;

  const reducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fmt   = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
  const binOf = (value) => clamp(Math.floor((value - MIN_VALUE) / binWidth), 0, NUM_BINS - 1);

  /* ---------------------------------------------------------------
     Theme colours, read from CSS and refreshed on scheme change
     --------------------------------------------------------------- */
  let themeCache = new Map();
  const themeColor = (name, fallback) => {
    if (!themeCache.has(name)) {
      const v = getComputedStyle(document.documentElement)
                  .getPropertyValue(name).trim();
      themeCache.set(name, v || fallback);
    }
    return themeCache.get(name);
  };
  const uiFont = (size, weight = '') =>
    `${weight} ${size}px ${getComputedStyle(document.body).fontFamily}`.trim();

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  darkQuery.addEventListener?.('change', () => { themeCache = new Map(); redrawAll(); });

  /* ---------------------------------------------------------------
     State
     --------------------------------------------------------------- */
  let population       = new Array(NUM_BINS).fill(0);
  let sampleValues     = [];
  let sampleBins       = new Array(NUM_BINS).fill(0);
  let pendingBins      = new Array(NUM_BINS).fill(0);   // in flight
  let distValues       = [];
  let distBins         = new Array(NUM_DIST_BINS).fill(0);
  let distYMax         = INITIAL_Y_MAX;
  let sampleSize       = 5;
  let selectedStat     = 'mean';
  let sizeOfLastDist   = 5;
  let numSamplesDrawn  = 0;
  let isProcessing     = false;
  let isDrawingPop     = false;
  let lastHighlight    = null;

  /* ---------------------------------------------------------------
     High-DPI canvas sizing. All drawing below is in CSS pixels.
     --------------------------------------------------------------- */
  function sizeCanvas(canvas) {
    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.dataset.w = w;
    canvas.dataset.h = h;
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const sizeOf = (canvas) => ({
    width:  Number(canvas.dataset.w) || canvas.clientWidth  || 1,
    height: Number(canvas.dataset.h) || canvas.clientHeight || 1
  });

  const plotBox = (canvas) => {
    const { width, height } = sizeOf(canvas);
    const plotHeight = Math.max(1, height - AXIS_SPACE);
    return { width, height, plotHeight, baseline: plotHeight };
  };

  function sizeEverything() {
    PLOTS.forEach(sizeCanvas);
    sizeCanvas(flightLayer);
  }

  function redrawAll() {
    drawPopulation();
    drawSample();
    if (lastHighlight !== null) drawHighlight(lastHighlight);
    drawSamplingDistribution();
  }

  let resizeFrame = null;
  function onResize() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      sizeEverything();
      redrawAll();
    });
  }

  /* ---------------------------------------------------------------
     Shared plot chrome
     --------------------------------------------------------------- */
  function paintBackground(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = themeColor('--canvas-bg', '#ffffff');
    ctx.fillRect(0, 0, width, height);
  }

  function drawAxis(ctx, width, baseline, numTicks = 5) {
    const axis = themeColor('--axis-color', '#9aa4b0');
    ctx.strokeStyle = axis;
    ctx.fillStyle   = axis;
    ctx.lineWidth   = 1;

    ctx.beginPath();
    ctx.moveTo(0, baseline + 0.5);
    ctx.lineTo(width, baseline + 0.5);
    ctx.stroke();

    ctx.font = uiFont(10);
    ctx.textBaseline = 'top';
    const step = RANGE / (numTicks - 1);

    for (let i = 0; i < numTicks; i++) {
      const value = MIN_VALUE + i * step;
      const x = clamp((value - MIN_VALUE) / RANGE * width, 0, width);
      ctx.textAlign = i === 0 ? 'left' : i === numTicks - 1 ? 'right' : 'center';
      ctx.beginPath();
      ctx.moveTo(x, baseline);
      ctx.lineTo(x, baseline + TICK_LENGTH);
      ctx.stroke();
      ctx.fillText(value.toFixed(0), x, baseline + TICK_LENGTH + LABEL_PADDING);
    }
    ctx.textAlign = 'start';
  }

  /* ---------------------------------------------------------------
     01 Population
     --------------------------------------------------------------- */
  function loadPreset(type) {
    population = new Array(NUM_BINS).fill(0);
    const centreOf = (i) => MIN_VALUE + (i + 0.5) * binWidth;

    if (type === 'normal') {
      const mu = (MAX_VALUE + MIN_VALUE) / 2;
      const sd = RANGE / 6;
      for (let i = 0; i < NUM_BINS; i++) {
        population[i] = Math.exp(-0.5 * ((centreOf(i) - mu) / sd) ** 2);
      }
    } else if (type === 'uniform') {
      population.fill(MAX_POTENTIAL * 0.6);
    } else if (type === 'exponential') {
      const lambda = 5 / RANGE;
      for (let i = 0; i < NUM_BINS; i++) {
        population[i] = Math.exp(-lambda * centreOf(i)) * 0.95;
      }
    } else if (type === 'bimodal') {
      const m1 = RANGE / 4, m2 = RANGE * 3 / 4, sd = RANGE / 15;
      let peak = 0;
      for (let i = 0; i < NUM_BINS; i++) {
        const c = centreOf(i);
        population[i] = 0.6 * Math.exp(-0.5 * ((c - m1) / sd) ** 2)
                      + 0.6 * Math.exp(-0.5 * ((c - m2) / sd) ** 2);
        peak = Math.max(peak, population[i]);
      }
      if (peak > 1e-6) {
        const k = (MAX_POTENTIAL / peak) * 0.95;
        population = population.map((p) => Math.min(MAX_POTENTIAL, p * k));
      }
    } else {
      loadPreset('normal');
      return;
    }

    population = population.map((p) => clamp(p, 0, MAX_POTENTIAL));
    updatePopulation();
    clearSample();
    clearSamplingDistribution();
  }

  function populationHeight(binIndex) {
    return clamp(population[binIndex] || 0, 0, MAX_POTENTIAL) / MAX_POTENTIAL;
  }

  function drawPopulation() {
    const { width, height, plotHeight, baseline } = plotBox(popCanvas);
    paintBackground(popCtx, width, height);

    popCtx.beginPath();
    popCtx.strokeStyle = themeColor('--pop-line-color', '#3d5a80');
    popCtx.fillStyle   = themeColor('--pop-fill-color', 'rgba(61,90,128,0.16)');
    popCtx.lineWidth   = 2;
    popCtx.lineJoin    = 'round';
    popCtx.moveTo(0, baseline);

    for (let i = 0; i < NUM_BINS; i++) {
      const x = (i + 0.5) * (width / NUM_BINS);
      popCtx.lineTo(x, baseline - populationHeight(i) * plotHeight);
    }
    popCtx.lineTo(width, baseline);
    popCtx.closePath();
    popCtx.fill();
    popCtx.stroke();

    drawAxis(popCtx, width, baseline);
  }

  function populationStats() {
    const total = population.reduce((s, v) => s + Math.max(0, v), 0);
    if (total < 1e-9) return { mean: NaN, median: NaN, stdDev: NaN };

    let mean = 0, meanSq = 0;
    const cells = [];
    for (let i = 0; i < NUM_BINS; i++) {
      if (population[i] <= 1e-9) continue;
      const prob  = population[i] / total;
      const value = MIN_VALUE + (i + 0.5) * binWidth;
      mean   += value * prob;
      meanSq += value * value * prob;
      cells.push({ index: i, prob });
    }
    const stdDev = Math.sqrt(Math.max(0, meanSq - mean * mean));

    let cumulative = 0;
    let median = NaN;
    for (const cell of cells) {
      const next = cumulative + cell.prob;
      if (next >= 0.5 - 1e-9) {
        const fraction = clamp((0.5 - cumulative) / cell.prob, 0, 1);
        median = MIN_VALUE + (cell.index + fraction) * binWidth;
        break;
      }
      cumulative = next;
    }
    return { mean, median, stdDev };
  }

  function updatePopulation() {
    drawPopulation();
    const s = populationStats();
    popStats.mean.textContent   = fmt(s.mean);
    popStats.median.textContent = fmt(s.median);
    popStats.stdDev.textContent = fmt(s.stdDev);
  }

  function paintPopulationAt(event) {
    if (isProcessing) return;
    const rect = popCanvas.getBoundingClientRect();
    const index = clamp(Math.floor((event.clientX - rect.left) / (rect.width / NUM_BINS)),
                        0, NUM_BINS - 1);
    const plotHeight = Math.max(1, rect.height - AXIS_SPACE);
    const ratio = (plotHeight - Math.max(0, event.clientY - rect.top)) / plotHeight;

    population[index] = clamp(ratio * MAX_POTENTIAL * 1.05, 0, MAX_POTENTIAL);
    updatePopulation();
    clearSample();
    clearSamplingDistribution();
  }

  /* ---------------------------------------------------------------
     Drawing values from the population
     --------------------------------------------------------------- */
  function populationCDF() {
    const total = population.reduce((s, v) => s + Math.max(0, v), 0);
    if (!(total > 1e-9)) return null;
    const cdf = [];
    let acc = 0;
    for (let i = 0; i < NUM_BINS; i++) {
      acc += Math.max(0, population[i]) / total;
      cdf.push(Math.min(1, acc));
    }
    cdf[cdf.length - 1] = 1;
    return cdf;
  }

  function drawValue(cdf) {
    const r = Math.random();
    const index = cdf.findIndex((p) => p >= r - 1e-9);
    if (index === -1) return MAX_VALUE - binWidth / 2;
    const lower = index > 0 ? cdf[index - 1] : 0;
    const mass  = cdf[index] - lower;
    const offset = mass < 1e-9 ? 0.5 : clamp((r - lower) / mass, 0, 1);
    return clamp(MIN_VALUE + (index + offset) * binWidth, MIN_VALUE, MAX_VALUE);
  }

  /* ---------------------------------------------------------------
     02 Sample, drawn as stacked dots — one dot per observation
     --------------------------------------------------------------- */
  function dotGeometry() {
    const { width, plotHeight } = plotBox(sampleCanvas);
    const columnWidth = width / NUM_BINS;
    let tallest = 1;
    for (let i = 0; i < NUM_BINS; i++) {
      tallest = Math.max(tallest, sampleBins[i] + pendingBins[i]);
    }
    const radius = Math.max(1.4, Math.min(columnWidth * 0.46,
                                          plotHeight / (2.25 * tallest), 6));
    return { columnWidth, radius, gap: Math.max(0.5, radius * 0.28), plotHeight };
  }

  // Position of the dot sitting at `level` (0 = bottom) in a column
  function dotPosition(binIndex, level) {
    const g = dotGeometry();
    const { baseline } = plotBox(sampleCanvas);
    return {
      x: (binIndex + 0.5) * g.columnWidth,
      y: baseline - g.radius - level * (g.radius * 2 + g.gap),
      r: g.radius
    };
  }

  function drawSample() {
    const { width, height, baseline } = plotBox(sampleCanvas);
    paintBackground(sampleCtx, width, height);

    const g = dotGeometry();
    sampleCtx.fillStyle   = themeColor('--sample-dot-fill', '#d68a3c');
    sampleCtx.strokeStyle = themeColor('--sample-dot-stroke', '#9d5c1b');
    sampleCtx.lineWidth   = Math.min(1, g.radius * 0.35);

    for (let i = 0; i < NUM_BINS; i++) {
      for (let level = 0; level < sampleBins[i]; level++) {
        const x = (i + 0.5) * g.columnWidth;
        const y = baseline - g.radius - level * (g.radius * 2 + g.gap);
        sampleCtx.beginPath();
        sampleCtx.arc(x, y, g.radius, 0, Math.PI * 2);
        sampleCtx.fill();
        if (g.radius > 2) sampleCtx.stroke();
      }
    }

    drawAxis(sampleCtx, width, baseline);
  }

  function drawHighlight(statValue) {
    if (!Number.isFinite(statValue)) return;
    const { width, baseline } = plotBox(sampleCanvas);
    const colour = themeColor('--highlight-color', '#2f8f82');
    const x = clamp((statValue - MIN_VALUE) / RANGE, 0, 1) * width;

    const size = 6;
    const tipY = baseline - 1;
    const topY = tipY - size * 1.5;

    sampleCtx.fillStyle = colour;
    sampleCtx.beginPath();
    sampleCtx.moveTo(x - size, topY);
    sampleCtx.lineTo(x + size, topY);
    sampleCtx.lineTo(x, tipY);
    sampleCtx.closePath();
    sampleCtx.fill();

    const name  = selectedStat[0].toUpperCase() + selectedStat.slice(1);
    const label = `${name} ${statValue.toFixed(1)}`;
    sampleCtx.font = uiFont(11, '600');
    sampleCtx.textBaseline = 'bottom';
    sampleCtx.textAlign = 'center';

    const textWidth = sampleCtx.measureText(label).width;
    const labelX = clamp(x, textWidth / 2 + 4, width - textWidth / 2 - 4);
    const labelY = topY - 3;

    if (labelY > 12) {
      sampleCtx.globalAlpha = 0.85;
      sampleCtx.fillStyle = themeColor('--canvas-bg', '#ffffff');
      sampleCtx.fillRect(labelX - textWidth / 2 - 4, labelY - 13, textWidth + 8, 15);
      sampleCtx.globalAlpha = 1;
      sampleCtx.fillStyle = colour;
      sampleCtx.fillText(label, labelX, labelY);
    }
    sampleCtx.textAlign = 'start';
    lastHighlight = statValue;
  }

  function summarise(values) {
    const n = values.length;
    if (n === 0) return { mean: NaN, median: NaN, stdDev: NaN, n: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, v) => a + v, 0) / n;
    const mid = Math.floor(n / 2);
    const median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    const meanSq = values.reduce((a, v) => a + v * v, 0) / n;
    return { mean, median, stdDev: Math.sqrt(Math.max(0, meanSq - mean * mean)), n };
  }

  function clearSample() {
    sampleValues = [];
    sampleBins.fill(0);
    pendingBins.fill(0);
    lastHighlight = null;
    drawSample();
    sampleStats.mean.textContent   = '-';
    sampleStats.median.textContent = '-';
    sampleStats.stdDev.textContent = '-';
    sampleStats.n.textContent      = '-';
  }

  function showSampleStats(s) {
    sampleStats.mean.textContent   = fmt(s.mean);
    sampleStats.median.textContent = fmt(s.median);
    sampleStats.stdDev.textContent = fmt(s.stdDev);
    sampleStats.n.textContent      = s.n;
  }

  /* ---------------------------------------------------------------
     03 Sampling distribution
     --------------------------------------------------------------- */
  function clearSamplingDistribution() {
    distValues = [];
    distBins.fill(0);
    numSamplesDrawn = 0;
    sizeOfLastDist = sampleSize;
    distYMax = INITIAL_Y_MAX;
    drawSamplingDistribution();
    distStats.count.textContent  = '0';
    distStats.mean.textContent   = '-';
    distStats.median.textContent = '-';
    distStats.stdDev.textContent = '-';
  }

  function distBarTop(binIndex) {
    const { plotHeight, baseline } = plotBox(samplingDistCanvas);
    const height = (distBins[binIndex] / Math.max(1, distYMax)) * plotHeight;
    return baseline - Math.min(height, plotHeight);
  }

  function drawSamplingDistribution() {
    const { width, height, plotHeight, baseline } = plotBox(samplingDistCanvas);
    const tallest = distBins.length ? Math.max(...distBins) : 0;
    distYMax = Math.max(distYMax, INITIAL_Y_MAX, Math.ceil(tallest / 5) * 5);

    paintBackground(samplingDistCtx, width, height);

    const barWidth = width / NUM_DIST_BINS;
    samplingDistCtx.fillStyle   = themeColor('--sampling-bar-fill', '#45a99b');
    samplingDistCtx.strokeStyle = themeColor('--sampling-bar-stroke', '#2a7f73');
    samplingDistCtx.lineWidth   = 1;

    for (let i = 0; i < NUM_DIST_BINS; i++) {
      if (distBins[i] === 0) continue;
      const h = Math.min((distBins[i] / distYMax) * plotHeight, plotHeight);
      const x = i * barWidth;
      const y = baseline - h;
      samplingDistCtx.fillRect(x, y, barWidth, h);
      samplingDistCtx.strokeRect(x + 0.5, y + 0.5,
        Math.max(0, barWidth - 1), Math.max(0, h - 1));
    }

    if (normalCurveBox.checked && numSamplesDrawn > 1) {
      const s = summarise(distValues);
      if (Number.isFinite(s.mean) && s.stdDev > 1e-6) {
        drawNormalCurve(s.mean, s.stdDev, width, plotHeight, baseline);
      }
    }

    drawAxis(samplingDistCtx, width, baseline);
  }

  function drawNormalCurve(mu, sigma, width, plotHeight, baseline) {
    const scale = numSamplesDrawn * distBinWidth;
    const norm  = 1 / (sigma * Math.sqrt(2 * Math.PI));
    samplingDistCtx.strokeStyle = themeColor('--normal-curve-color', '#a8324f');
    samplingDistCtx.lineWidth = 1.75;
    samplingDistCtx.lineJoin = 'round';
    samplingDistCtx.beginPath();

    let started = false;
    for (let px = 0; px <= width; px++) {
      const value = MIN_VALUE + (px / width) * RANGE;
      const density = norm * Math.exp(-((value - mu) ** 2) / (2 * sigma * sigma));
      const y = baseline - (density * scale / Math.max(1, distYMax)) * plotHeight;
      if (y > baseline) continue;
      started ? samplingDistCtx.lineTo(px, Math.max(0, y))
              : (samplingDistCtx.moveTo(px, Math.max(0, y)), started = true);
    }
    samplingDistCtx.stroke();
  }

  function recordStatistic(value) {
    if (!Number.isFinite(value)) return -1;
    distValues.push(value);
    const index = clamp(Math.floor((value - MIN_VALUE) / distBinWidth), 0, NUM_DIST_BINS - 1);
    distBins[index]++;
    numSamplesDrawn++;
    return index;
  }

  function updateSamplingDistribution() {
    drawSamplingDistribution();
    const s = summarise(distValues);
    distStats.count.textContent  = s.n;
    distStats.mean.textContent   = fmt(s.mean);
    distStats.median.textContent = fmt(s.median);
    distStats.stdDev.textContent = fmt(s.stdDev);
  }

  /* ---------------------------------------------------------------
     Flight layer: particles that carry a value from one plot to
     the next, so the pipeline is visible rather than implied.
     --------------------------------------------------------------- */
  const particles = [];
  const ripples   = [];
  let flightFrame = null;

  function toLayer(canvas, x, y) {
    const c = canvas.getBoundingClientRect();
    const l = flightLayer.getBoundingClientRect();
    return { x: c.left - l.left + x, y: c.top - l.top + y };
  }

  function launch({ from, to, duration, radius, colour, lift = 26, onLand }) {
    particles.push({
      from, to, duration, radius, colour, lift,
      onLand, start: performance.now()
    });
    ripples.push({ x: from.x, y: from.y, start: performance.now(), colour, max: radius * 4 });
    startFlightLoop();
  }

  function startFlightLoop() {
    if (flightFrame === null) flightFrame = requestAnimationFrame(stepFlights);
  }

  function stopFlights() {
    particles.length = 0;
    ripples.length = 0;
    if (flightFrame !== null) cancelAnimationFrame(flightFrame);
    flightFrame = null;
    const { width, height } = sizeOf(flightLayer);
    flightCtx.clearRect(0, 0, width, height);
  }

  function stepFlights(now) {
    const { width, height } = sizeOf(flightLayer);
    flightCtx.clearRect(0, 0, width, height);

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const t = (now - r.start) / 420;
      if (t >= 1) { ripples.splice(i, 1); continue; }
      flightCtx.strokeStyle = r.colour;
      flightCtx.globalAlpha = (1 - t) * 0.55;
      flightCtx.lineWidth = 1.5;
      flightCtx.beginPath();
      flightCtx.arc(r.x, r.y, 2 + t * r.max, 0, Math.PI * 2);
      flightCtx.stroke();
      flightCtx.globalAlpha = 1;
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const t = (now - p.start) / p.duration;

      if (t >= 1) {
        particles.splice(i, 1);
        ripples.push({ x: p.to.x, y: p.to.y, start: now, colour: p.colour, max: p.radius * 3 });
        p.onLand?.();
        continue;
      }

      // Linear across, accelerating downward, with a small initial lift
      for (let ghost = 3; ghost >= 0; ghost--) {
        const tg = t - ghost * 0.045;
        if (tg <= 0) continue;
        const x = p.from.x + (p.to.x - p.from.x) * tg;
        const y = p.from.y + (p.to.y - p.from.y) * tg * tg - p.lift * 4 * tg * (1 - tg);
        flightCtx.globalAlpha = ghost === 0 ? 1 : 0.18 / ghost;
        flightCtx.fillStyle = p.colour;
        flightCtx.beginPath();
        flightCtx.arc(x, y, p.radius * (ghost === 0 ? 1 : 0.8), 0, Math.PI * 2);
        flightCtx.fill();
      }
      flightCtx.globalAlpha = 1;
    }

    flightFrame = (particles.length || ripples.length)
      ? requestAnimationFrame(stepFlights)
      : null;
    if (flightFrame === null) flightCtx.clearRect(0, 0, width, height);
  }

  /* ---------------------------------------------------------------
     Orchestration
     --------------------------------------------------------------- */
  function setControlsDisabled(disabled) {
    isProcessing = disabled;
    [drawOneBtn, draw100Btn, draw1000Btn, resetBtn]
      .forEach((b) => { b.disabled = disabled; });
    [presetControls, sampleControls, distControls].forEach((group) => {
      group.querySelectorAll('input').forEach((el) => { el.disabled = disabled; });
    });
    popCanvas.classList.toggle('is-locked', disabled);
  }

  function animateOneSample() {
    if (isProcessing) return;
    if (sampleSize !== sizeOfLastDist) {
      clearSamplingDistribution();
      sizeOfLastDist = sampleSize;
    }
    const cdf = populationCDF();
    if (!cdf) { alert('Draw a population first — the plot is empty.'); return; }

    setControlsDisabled(true);
    stopFlights();
    clearSample();

    const values = Array.from({ length: sampleSize }, () => drawValue(cdf));
    const interval = reducedMotion ? 12 : sampleSize <= 10 ? 250 : sampleSize <= 20 ? 130 : 32;
    const duration = reducedMotion ? 60 : sampleSize <= 10 ? 620 : 380;
    const dotColour = themeColor('--particle-color', '#d68a3c');

    let landed = 0;
    const timers = [];

    values.forEach((value, k) => {
      timers.push(setTimeout(() => {
        const bin = binOf(value);
        const level = sampleBins[bin] + pendingBins[bin];
        pendingBins[bin]++;

        const { width, plotHeight, baseline } = plotBox(popCanvas);
        const sourceX = (value - MIN_VALUE) / RANGE * width;
        const sourceY = baseline - populationHeight(bin) * plotHeight;
        const target  = dotPosition(bin, level);

        launch({
          from: toLayer(popCanvas, sourceX, sourceY),
          to:   toLayer(sampleCanvas, target.x, target.y),
          duration,
          radius: Math.max(2.5, target.r),
          colour: dotColour,
          onLand: () => {
            pendingBins[bin] = Math.max(0, pendingBins[bin] - 1);
            sampleBins[bin]++;
            sampleValues.push(value);
            drawSample();
            showSampleStats(summarise(sampleValues));
            if (++landed === values.length) handOverStatistic();
          }
        });
      }, k * interval));
    });

    function handOverStatistic() {
      const stats = summarise(sampleValues);
      const statValue = stats[selectedStat];
      showSampleStats(stats);
      drawSample();
      drawHighlight(statValue);

      if (!Number.isFinite(statValue)) { setControlsDisabled(false); return; }

      const sampleBoxRect = plotBox(sampleCanvas);
      const fromX = clamp((statValue - MIN_VALUE) / RANGE, 0, 1) * sampleBoxRect.width;
      const fromY = sampleBoxRect.baseline - 12;

      const bin = clamp(Math.floor((statValue - MIN_VALUE) / distBinWidth), 0, NUM_DIST_BINS - 1);
      const distBox = plotBox(samplingDistCanvas);
      const toX = (bin + 0.5) * (distBox.width / NUM_DIST_BINS);
      const toY = distBarTop(bin) - 4;

      launch({
        from: toLayer(sampleCanvas, fromX, fromY),
        to:   toLayer(samplingDistCanvas, toX, toY),
        duration: reducedMotion ? 80 : 640,
        radius: 5,
        colour: themeColor('--highlight-color', '#2f8f82'),
        lift: 46,
        onLand: () => {
          recordStatistic(statValue);
          updateSamplingDistribution();
          setControlsDisabled(false);
        }
      });
    }

    // Safety net: if a tab is backgrounded, rAF stalls — release controls
    timers.push(setTimeout(() => {
      if (isProcessing && particles.length === 0) setControlsDisabled(false);
    }, values.length * interval + duration + 3000));
  }

  function drawManySamples(count) {
    if (isProcessing) return;
    if (sampleSize !== sizeOfLastDist) {
      clearSamplingDistribution();
      sizeOfLastDist = sampleSize;
    }
    const cdf = populationCDF();
    if (!cdf) { alert('Draw a population first — the plot is empty.'); return; }

    setControlsDisabled(true);
    stopFlights();

    for (let i = 0; i < count; i++) {
      const values = Array.from({ length: sampleSize }, () => drawValue(cdf));
      recordStatistic(summarise(values)[selectedStat]);
    }

    updateSamplingDistribution();
    clearSample();
    setControlsDisabled(false);
  }

  function resetSimulation() {
    stopFlights();
    sampleSize = 5;
    selectedStat = 'mean';
    normalCurveBox.checked = false;
    $('presetNormal').checked = true;
    $('n5').checked = true;
    $('statMean').checked = true;
    nValDisplay.textContent = sampleSize;
    statNameSpan.textContent = 'Mean';
    loadPreset('normal');
    setControlsDisabled(false);
  }

  /* ---------------------------------------------------------------
     Events
     --------------------------------------------------------------- */
  presetControls.addEventListener('change', (e) => {
    if (e.target.name !== 'distType') return;
    if (isProcessing) { e.target.checked = false; return; }
    loadPreset(e.target.value);
  });

  sampleControls.addEventListener('change', (e) => {
    if (e.target.name !== 'sampleSize') return;
    sampleSize = parseInt(e.target.value, 10);
    nValDisplay.textContent = sampleSize;
    if (sampleSize !== sizeOfLastDist && numSamplesDrawn > 0) clearSamplingDistribution();
    clearSample();
  });

  distControls.addEventListener('change', (e) => {
    if (e.target.name === 'samplingStat') {
      selectedStat = e.target.value;
      statNameSpan.textContent = selectedStat[0].toUpperCase() + selectedStat.slice(1);
      clearSamplingDistribution();
      clearSample();
    }
  });

  normalCurveBox.addEventListener('change', drawSamplingDistribution);
  resetBtn.addEventListener('click', resetSimulation);
  drawOneBtn.addEventListener('click', animateOneSample);
  draw100Btn.addEventListener('click', () => drawManySamples(100));
  draw1000Btn.addEventListener('click', () => drawManySamples(1000));

  popCanvas.addEventListener('pointerdown', (e) => {
    if (isProcessing) return;
    isDrawingPop = true;
    popCanvas.setPointerCapture(e.pointerId);
    paintPopulationAt(e);
    const checked = presetControls.querySelector('input[name="distType"]:checked');
    if (checked) checked.checked = false;
    e.preventDefault();
  });

  popCanvas.addEventListener('pointermove', (e) => {
    if (!isDrawingPop || isProcessing) return;
    paintPopulationAt(e);
    e.preventDefault();
  });

  const endDrag = (e) => {
    if (!isDrawingPop) return;
    isDrawingPop = false;
    if (e?.pointerId !== undefined && popCanvas.hasPointerCapture(e.pointerId)) {
      popCanvas.releasePointerCapture(e.pointerId);
    }
  };
  popCanvas.addEventListener('pointerup', endDrag);
  popCanvas.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', () => endDrag());

  if (window.ResizeObserver) {
    const observer = new ResizeObserver(onResize);
    PLOTS.forEach((c) => observer.observe(c));
    observer.observe(workbench);
  } else {
    window.addEventListener('resize', onResize);
  }

  /* --------------------------------------------------------------- */
  sizeEverything();
  resetSimulation();
});
