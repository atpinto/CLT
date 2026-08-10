
        document.addEventListener('DOMContentLoaded', () => {
            // --- Canvas and Context Setup ---
            const popCanvas = document.getElementById('populationCanvas');
            const popCtx = popCanvas.getContext('2d');
            const sampleCanvas = document.getElementById('sampleCanvas');
            const sampleCtx = sampleCanvas.getContext('2d');
            const samplingDistCanvas = document.getElementById('samplingDistCanvas');
            const samplingDistCtx = samplingDistCanvas.getContext('2d');

            // --- Stats Display Elements ---
            const popStatsDisplay = {
                mean: document.getElementById('popMeanVal'),
                median: document.getElementById('popMedianVal'),
                stdDev: document.getElementById('popStdDevVal')
            };
            const sampleStatsDisplay = {
                mean: document.getElementById('sampleMeanVal'),
                median: document.getElementById('sampleMedianVal'),
                stdDev: document.getElementById('sampleStdDevVal'),
                n: document.getElementById('sampleNVal')
            };
            const samplingDistStatsDisplay = {
                count: document.getElementById('samplesDrawnVal'),
                mean: document.getElementById('samplingMeanVal'),
                median: document.getElementById('samplingMedianVal'),
                stdDev: document.getElementById('samplingStdDevVal')
            };

            // --- Controls ---
            const presetControlsDiv = document.getElementById('presetControls');
            const sampleControlsDiv = document.getElementById('sampleControls');
            const samplingDistControlsDiv = document.getElementById('samplingDistControls');
            const drawSampleBtn = document.getElementById('drawSampleBtn');
            const draw100SamplesBtn = document.getElementById('draw100SamplesBtn');
            const draw1000SamplesBtn = document.getElementById('draw1000SamplesBtn');
            const nValDisplay = document.getElementById('nValDisplay');
            const resetBtn = document.getElementById('resetBtn');
            const showNormalCurveCheckbox = document.getElementById('showNormalCurve');
            const samplingDistStatNameSpan = document.getElementById('samplingDistStatName');

            // --- Constants ---
            const NUM_BINS = 50;
            const NUM_SAMPLING_DIST_BINS = 50;
            const MIN_VALUE = 0;
            const MAX_VALUE = 100;
            const SAMPLING_DIST_MIN = 0;
            const SAMPLING_DIST_MAX = 100;
            const binWidthValue = (MAX_VALUE - MIN_VALUE) / NUM_BINS;
            const samplingDistBinWidth = (SAMPLING_DIST_MAX - SAMPLING_DIST_MIN) / NUM_SAMPLING_DIST_BINS;
            const MAX_POTENTIAL = 1.0;
            const ANIMATION_DELAY_VERY_SLOW_MS = 180;
            const ANIMATION_DELAY_SLOW_MS = 100;
            const ANIMATION_DELAY_FAST_MS = 40;
            const HIGHLIGHT_COLOR = getComputedStyle(document.documentElement)
                                    .getPropertyValue('--highlight-color').trim() || '#6f42c1';
            const NORMAL_CURVE_COLOR = getComputedStyle(document.documentElement)
                                       .getPropertyValue('--normal-curve-color').trim() || '#17a2b8';
            const ANIM_MARKER_COLOR = getComputedStyle(document.documentElement)
                                      .getPropertyValue('--anim-marker-color').trim() || 'rgba(40, 167, 69, 0.8)';
            const INITIAL_Y_MAX = 10;
            // --- Axis Styling Constants ---
            const AXIS_LABEL_FONT = '7px sans-serif'; // Smaller font size, explicitly non-bold
            const AXIS_COLOR = '#333'; // Color for axis lines and text
            const TICK_LENGTH = 4; // Length of axis ticks
            const LABEL_PADDING = 3; // Padding below tick for label

            // --- State Variables ---
            let populationDistribution = [];
            let isDraggingPop = false;
            let currentSampleData = [];
            let sampleBins = new Array(NUM_BINS).fill(0);
            let isProcessing = false;
            let currentSampleSize = 5;
            let samplingDistributionData = [];
            let samplingDistributionBins = new Array(NUM_SAMPLING_DIST_BINS).fill(0);
            let selectedSamplingStat = 'mean';
            let numSamplesDrawn = 0;
            let lastSampleSizeForSamplingDist = 5;
            let currentSampleYMax = INITIAL_Y_MAX;
            let currentSamplingDistYMax = INITIAL_Y_MAX;

            // ==================================================================
            // --- Helper: Draw X Axis Ticks ---
            // ==================================================================
            function drawXAxisTicks(ctx, width, height, minValue, maxValue, numTicks = 5) {
                try {
                    ctx.font = AXIS_LABEL_FONT; // Use the constant defined above
                    ctx.fillStyle = AXIS_COLOR;
                    ctx.strokeStyle = AXIS_COLOR;
                    ctx.lineWidth = 1;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top'; // Position text below the tick

                    const valueRange = maxValue - minValue;
                    // Ensure numTicks is valid to avoid division by zero or less
                    const validNumTicks = Math.max(2, numTicks);
                    const tickIncrement = valueRange / (validNumTicks - 1);

                    for (let i = 0; i < validNumTicks; i++) {
                        const value = minValue + (i * tickIncrement);
                        // Calculate x position slightly more robustly
                        let x = 0;
                        if (valueRange > 1e-9) { // Avoid division by zero if range is effectively zero
                            x = ((value - minValue) / valueRange) * width;
                        } else if (i === 0) {
                            x = 0; // Position at start if range is zero
                        } else {
                            x = width; // Position at end otherwise
                        }
                        x = Math.max(0, Math.min(width, x)); // Clamp within canvas bounds


                        // Adjust alignment for edge ticks
                        if (i === 0) ctx.textAlign = 'left';
                        else if (i === validNumTicks - 1) ctx.textAlign = 'right';
                        else ctx.textAlign = 'center';

                        // Draw Tick Mark
                        ctx.beginPath();
                        ctx.moveTo(x, height);
                        ctx.lineTo(x, height + TICK_LENGTH);
                        ctx.stroke();

                        // Draw Label
                        ctx.fillText(value.toFixed(0), x, height + TICK_LENGTH + LABEL_PADDING);
                    }
                    // Reset alignment for other text potentially
                    ctx.textAlign = 'start';
                } catch (e) {
                    console.error("Error drawing X axis ticks:", e);
                }
            }

            // ==================================================================
            // --- Helper: Enable/Disable Controls ---
            // ==================================================================
            function setControlsDisabled(disabled) {
                isProcessing = disabled;
                drawSampleBtn.disabled = disabled;
                draw100SamplesBtn.disabled = disabled;
                draw1000SamplesBtn.disabled = disabled;
                resetBtn.disabled = disabled;
                presetControlsDiv.querySelectorAll('input')
                    .forEach(el => el.disabled = disabled);
                sampleControlsDiv.querySelectorAll('input')
                    .forEach(el => el.disabled = disabled);
                samplingDistControlsDiv.querySelectorAll('input')
                    .forEach(el => el.disabled = disabled);
                popCanvas.style.cursor = disabled ? 'not-allowed' : 'crosshair';
            }

            // ==================================================================
            // --- Population Functions ---
            // ==================================================================
            function loadPreset(distributionType) {
                populationDistribution = new Array(NUM_BINS).fill(0);
                const midVal = (MAX_VALUE + MIN_VALUE) / 2;
                const range = MAX_VALUE - MIN_VALUE;

                switch (distributionType) {
                    case 'normal': {
                        const meanN = midVal;
                        const stdDevN = range / 6;
                        for (let i = 0; i < NUM_BINS; i++) {
                            const center = MIN_VALUE + (i + 0.5) * binWidthValue;
                            const exponent = -0.5 * Math.pow((center - meanN) / stdDevN, 2);
                            const potential = Math.exp(exponent);
                            populationDistribution[i] = Math.min(MAX_POTENTIAL, potential * MAX_POTENTIAL);
                        }
                        break;
                    }
                    case 'uniform': {
                        populationDistribution = populationDistribution.map(() => MAX_POTENTIAL * 0.6);
                        break;
                    }
                    case 'exponential': {
                        const lambda = 5 / range;
                        const maxExpPotential = lambda;
                        for (let i = 0; i < NUM_BINS; i++) {
                            const center = MIN_VALUE + (i + 0.5) * binWidthValue;
                            const potential = lambda * Math.exp(-lambda * center);
                            const scaledPotential = (potential / maxExpPotential) * MAX_POTENTIAL * 0.95;
                            populationDistribution[i] = Math.min(MAX_POTENTIAL, scaledPotential);
                        }
                        break;
                    }
                    case 'bimodal': {
                        const meanB1 = range / 4;
                        const meanB2 = range * 3 / 4;
                        const stdDevB = range / 15;
                        let peakPotential = 0;
                        for (let i = 0; i < NUM_BINS; i++) {
                            const center = MIN_VALUE + (i + 0.5) * binWidthValue;
                            const exp1 = -0.5 * Math.pow((center - meanB1) / stdDevB, 2);
                            const exp2 = -0.5 * Math.pow((center - meanB2) / stdDevB, 2);
                            const potential1 = 0.6 * Math.exp(exp1);
                            const potential2 = 0.6 * Math.exp(exp2);
                            populationDistribution[i] = potential1 + potential2;
                            peakPotential = Math.max(peakPotential, populationDistribution[i]);
                        }
                        if (peakPotential > 1e-6) {
                            const scaleFactor = (MAX_POTENTIAL / peakPotential) * 0.95;
                            populationDistribution = populationDistribution
                                .map(p => Math.min(MAX_POTENTIAL, p * scaleFactor));
                        }
                        break;
                    }
                    default:
                        loadPreset('normal'); // Fallback
                        return;
                }
                updatePopulation();
                clearSample();
                clearSamplingDistribution();
            }

            function drawPopulationHistogram() {
                try {
                    const { width, height } = popCanvas;
                    // Reserve space at the bottom for axis labels
                    const axisLabelSpace = 15;
                    const plotHeight = height - axisLabelSpace; // Actual plotting area height
                    const plotBottomY = plotHeight; // Y coordinate of the X axis line

                    const canvasBg = getComputedStyle(document.documentElement)
                                     .getPropertyValue('--canvas-bg').trim() || '#ffffff';
                    const popLineColor = getComputedStyle(document.documentElement)
                                         .getPropertyValue('--pop-line-color').trim() || '#007bff';
                    const popFillColor = getComputedStyle(document.documentElement)
                                         .getPropertyValue('--pop-fill-color').trim() || 'rgba(0, 123, 255, 0.15)';


                    popCtx.clearRect(0, 0, width, height);
                    popCtx.fillStyle = canvasBg;
                    popCtx.fillRect(0, 0, width, height);

                    popCtx.beginPath();
                    popCtx.strokeStyle = popLineColor;
                    popCtx.fillStyle = popFillColor;
                    popCtx.lineWidth = 2;

                    let firstPoint = true;
                    for (let i = 0; i < NUM_BINS; i++) {
                        const potential = populationDistribution[i] || 0;
                        const yRatio = Math.min(potential, MAX_POTENTIAL) / MAX_POTENTIAL;
                        const y = plotBottomY - Math.max(0, yRatio * plotHeight); // Adjust y based on plotBottomY
                        // Use center of bin for x coordinate of the curve point
                        const x = (i + 0.5) * (width / NUM_BINS);

                        if (firstPoint) {
                            popCtx.moveTo(0, plotBottomY); // Start fill from bottom-left of plot area
                            popCtx.lineTo(x, y);
                            firstPoint = false;
                        } else {
                            popCtx.lineTo(x, y);
                        }
                    }
                    popCtx.lineTo(width, plotBottomY); // End fill at bottom-right of plot area
                    popCtx.closePath(); // Close path for filling
                    popCtx.fill();
                    popCtx.stroke(); // Draw the outline curve

                    // Draw X axis line
                    popCtx.strokeStyle = AXIS_COLOR;
                    popCtx.lineWidth = 1;
                    popCtx.beginPath();
                    popCtx.moveTo(0, plotBottomY);
                    popCtx.lineTo(width, plotBottomY);
                    popCtx.stroke();

                    // Draw X axis ticks and labels
                    drawXAxisTicks(popCtx, width, plotBottomY, MIN_VALUE, MAX_VALUE, 5); // Pass plotBottomY

                } catch (e) {
                    console.error("Err drawPopHist:", e);
                }
            }

            function calculatePopulationStats() {
                try {
                    const totalWeight = populationDistribution.reduce((s, v) => s + (v > 0 ? v : 0), 0);
                    if (totalWeight < 1e-9) return { mean: NaN, median: NaN, stdDev: NaN };

                    let weightedSum = 0;
                    let weightedSumSq = 0;
                    const dataPoints = [];

                    for (let i = 0; i < NUM_BINS; i++) {
                        const potential = populationDistribution[i];
                        if (potential <= 1e-9) continue;
                        const prob = potential / totalWeight;
                        const value = MIN_VALUE + (i + 0.5) * binWidthValue;
                        weightedSum += value * prob;
                        weightedSumSq += (value * value) * prob;
                        dataPoints.push({ value, prob });
                    }

                    const mean = weightedSum;
                    const variance = weightedSumSq - (mean * mean);
                    const stdDev = Math.sqrt(Math.max(0, variance));

                    // Calculate Median via CDF
                    dataPoints.sort((a, b) => a.value - b.value);
                    let cumulativeProb = 0;
                    const cumulativeData = dataPoints.map(dp => {
                        cumulativeProb += dp.prob;
                        return { value: dp.value, cumulativeProb: Math.min(1.0, cumulativeProb) };
                    });

                    const findValueAtQuantile = (quantile) => {
                        if (cumulativeData.length === 0) return NaN;
                        const epsilon = 1e-9;
                        const targetBinIndex = cumulativeData
                            .findIndex(dp => dp.cumulativeProb >= quantile - epsilon);
                        if (targetBinIndex === -1) return cumulativeData[cumulativeData.length - 1]?.value ?? NaN;

                        const targetBin = cumulativeData[targetBinIndex];
                        const originalDataPoint = dataPoints.find(dp => dp.value === targetBin.value);
                        if (!originalDataPoint) return targetBin.value;

                        const binProb = originalDataPoint.prob;
                        const prevCumulativeProb = targetBinIndex > 0 ? cumulativeData[targetBinIndex - 1].cumulativeProb : 0;
                        if (binProb <= epsilon) return targetBin.value;

                        const fractionIntoBin = (quantile - prevCumulativeProb) / binProb;
                        const clampedFraction = Math.max(0, Math.min(1, fractionIntoBin));

                        let originalPopBinIndex = -1;
                         for(let idx=0; idx<populationDistribution.length; idx++){
                             const binCenter = MIN_VALUE + (idx + 0.5) * binWidthValue;
                             if(Math.abs(binCenter - targetBin.value) < epsilon){ originalPopBinIndex=idx; break;}
                         }
                         if(originalPopBinIndex<0) return targetBin.value;

                        const lowerBound = MIN_VALUE + originalPopBinIndex * binWidthValue;
                        return lowerBound + (clampedFraction * binWidthValue);
                    };

                    const median = findValueAtQuantile(0.50);
                    return { mean, median, stdDev };
                } catch (e) {
                    console.error("Err calcPopStats:", e);
                    return { mean: NaN, median: NaN, stdDev: NaN };
                }
            }

            function updatePopulationStatsDisplay(stats) {
                try {
                    popStatsDisplay.mean.textContent = isNaN(stats.mean) ? '-' : stats.mean.toFixed(1);
                    popStatsDisplay.median.textContent = isNaN(stats.median) ? '-' : stats.median.toFixed(1);
                    popStatsDisplay.stdDev.textContent = isNaN(stats.stdDev) ? '-' : stats.stdDev.toFixed(1);
                } catch (e) {
                    console.error("Err updatePopStatsDisp:", e);
                }
            }

            function updatePopulation() {
                try {
                    drawPopulationHistogram();
                    const stats = calculatePopulationStats();
                    updatePopulationStatsDisplay(stats);
                } catch (e) {
                    console.error("Error updating population:", e);
                }
            }

            function getPopBinIndexFromX(clientX) {
                try {
                    const rect = popCanvas.getBoundingClientRect();
                    const x = clientX - rect.left;
                    const displayWidth = popCanvas.clientWidth || 1;
                    const scaleX = popCanvas.width / displayWidth;
                    const trueX = x * scaleX;
                    const binPixelWidth = popCanvas.width / NUM_BINS;
                    let index = Math.floor(trueX / binPixelWidth);
                    return Math.max(0, Math.min(NUM_BINS - 1, index));
                } catch (e) {
                    console.error("Error in getPopBinIndexFromX:", e);
                    return -1;
                }
            }

            function applyPopulationDrawing(e) {
                try {
                    if (isProcessing) return;
                    const index = getPopBinIndexFromX(e.clientX);
                    if (index < 0) return;

                    const rect = popCanvas.getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    const displayHeight = popCanvas.clientHeight || 1;
                    const scaleY = popCanvas.height / displayHeight;
                    const trueY = y * scaleY;
                    // Adjust potential calculation based on reduced plot height
                    const axisLabelSpace = 15;
                    const plotHeight = popCanvas.height - axisLabelSpace;

                    const potentialRatio = (plotHeight - Math.max(0, trueY)) / plotHeight; // Use plotHeight
                    const boostFactor = 1.05;
                    let potential = potentialRatio * MAX_POTENTIAL * boostFactor;
                    potential = Math.max(0.0, Math.min(MAX_POTENTIAL, potential));

                    populationDistribution[index] = potential;
                    updatePopulation();
                    clearSample();
                    clearSamplingDistribution();
                } catch (e) {
                    console.error("Error applying population drawing:", e);
                }
            }

            // ==================================================================
            // --- Sampling Functions ---
            // ==================================================================
            function getPopulationCDF() {
                try {
                    const totalWeight = populationDistribution.reduce((s, v) => s + (v > 0 ? v : 0), 0);
                    if (totalWeight < 1e-9 || isNaN(totalWeight)) return null;
                    let cdf = [], cP = 0;
                    for (let i = 0; i < NUM_BINS; i++) {
                        const potVal = populationDistribution[i] || 0;
                        const p = (potVal > 0 ? potVal : 0) / totalWeight;
                        cP += p;
                        cdf.push(Math.min(1.0, cP));
                    }
                    if (cdf.length > 0) cdf[cdf.length - 1] = 1.0;
                    return cdf;
                } catch (e) { console.error("Error generating population CDF:", e); return null; }
            }

            function drawOneValue(cdf) {
                try {
                    if (!cdf || cdf.length === 0) return null;
                    const r = Math.random();
                    const binIndex = cdf.findIndex(p => p >= r - 1e-9);
                    if (binIndex === -1) return MIN_VALUE + (NUM_BINS - 0.5) * binWidthValue;

                    const pS = binIndex > 0 ? cdf[binIndex - 1] : 0;
                    const pE = cdf[binIndex];
                    const bPM = pE - pS;
                    let v;
                    if (bPM < 1e-9) {
                        v = MIN_VALUE + (binIndex + 0.5) * binWidthValue;
                    } else {
                        const f = (r - pS) / bPM;
                        const binStartValue = MIN_VALUE + binIndex * binWidthValue;
                        v = binStartValue + (Math.max(0, Math.min(1, f)) * binWidthValue);
                    }
                    return Math.max(MIN_VALUE, Math.min(MAX_VALUE, v));
                } catch (e) { console.error("Error drawing one value:", e); return null; }
            }

            function animateSingleDraw(value, sourceBinIndex, highlightClearDelay) {
                try {
                    if (value === null) return;
                    const { width: popW, height: popH } = popCanvas;
                    // Adjust marker position based on reduced plot height
                    const axisLabelSpace = 15;
                    const plotHeight = popH - axisLabelSpace;
                    const plotBottomY = plotHeight;

                    const valueRange = MAX_VALUE - MIN_VALUE;
                    const clampedValue = Math.max(MIN_VALUE, Math.min(MAX_VALUE, value));
                    const markerX = ((clampedValue - MIN_VALUE) / valueRange) * popW;
                    const markerY = plotBottomY; // Marker appears at the axis line
                    const markerSize = 4;

                    const originalFillStyle = popCtx.fillStyle;
                    popCtx.fillStyle = ANIM_MARKER_COLOR;
                    popCtx.beginPath();
                    // Draw marker slightly above the axis line
                    popCtx.arc(markerX, markerY - markerSize, markerSize, 0, 2 * Math.PI);
                    popCtx.fill();
                    popCtx.fillStyle = originalFillStyle;

                    setTimeout(() => { updatePopulation(); }, highlightClearDelay);

                    const targetBinIndex = Math.max(0, Math.min(NUM_BINS - 1,
                         Math.floor((value - MIN_VALUE) / binWidthValue)));
                    if (targetBinIndex >= 0 && targetBinIndex < NUM_BINS) {
                        sampleBins[targetBinIndex]++;
                        currentSampleData.push(value);
                        drawSampleHistogram();
                    } else { console.warn("Sample target bin index out of range:", targetBinIndex); }
                } catch (e) { console.error("Error in animateSingleDraw:", e); }
            }

            // ==================================================================
            // --- Sample Display & Stats ---
            // ==================================================================
            function clearSample() {
                try {
                    currentSampleData = [];
                    sampleBins.fill(0);
                    currentSampleYMax = INITIAL_Y_MAX;
                    drawSampleHistogram();
                    Object.values(sampleStatsDisplay).forEach(el => el.textContent = '-');
                    sampleStatsDisplay.n.textContent = '-';
                } catch (e) { console.error("Error clearing sample:", e); }
            }

            function drawSampleHistogram() {
                try {
                    const { width, height } = sampleCanvas;
                    // Reserve space at the bottom for axis labels
                    const axisLabelSpace = 15;
                    const plotHeight = height - axisLabelSpace; // Actual plotting area height
                    const plotBottomY = plotHeight; // Y coordinate of the X axis line

                    const maxCount = sampleBins.length > 0 ? Math.max(...sampleBins) : 0;
                    const requiredYMax = Math.max(INITIAL_Y_MAX, Math.ceil(maxCount / 5) * 5);
                    if (requiredYMax > currentSampleYMax) { currentSampleYMax = requiredYMax; }

                    const canvasBg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#ffffff';
                    const barFill = getComputedStyle(document.documentElement).getPropertyValue('--sample-bar-fill').trim() || '#28a745';
                    const barStroke = getComputedStyle(document.documentElement).getPropertyValue('--sample-bar-stroke').trim() || '#1c7430';

                    sampleCtx.clearRect(0, 0, width, height);
                    sampleCtx.fillStyle = canvasBg;
                    sampleCtx.fillRect(0, 0, width, height);
                    const barWidthPixels = width / NUM_BINS;
                    sampleCtx.fillStyle = barFill;
                    sampleCtx.strokeStyle = barStroke;
                    sampleCtx.lineWidth = 1;

                    for (let i = 0; i < NUM_BINS; i++) {
                        const count = sampleBins[i];
                        if (count === 0) continue;
                        const barHeightRatio = count / currentSampleYMax;
                        const barHeight = Math.max(0, barHeightRatio * plotHeight);
                        const x = i * barWidthPixels;
                        const y = plotBottomY - barHeight; // Adjust y based on plotBottomY
                        const clampedHeight = Math.min(barHeight, plotHeight);
                        sampleCtx.fillRect(x, y, barWidthPixels, clampedHeight);
                        sampleCtx.strokeRect(x + 0.5, y + 0.5, barWidthPixels - 1, Math.max(0, clampedHeight - 1));
                    }
                    sampleCtx.strokeStyle = AXIS_COLOR;
                    sampleCtx.lineWidth = 1;
                    sampleCtx.beginPath();
                    sampleCtx.moveTo(0, plotBottomY);
                    sampleCtx.lineTo(width, plotBottomY);
                    sampleCtx.stroke();

                    // Draw X axis ticks and labels
                    drawXAxisTicks(sampleCtx, width, plotBottomY, MIN_VALUE, MAX_VALUE, 5); // Pass plotBottomY

                } catch (e) { console.error("Error drawing sample histogram:", e); }
            }

            function highlightSampleStat(statValue) {
                if (statValue === undefined || isNaN(statValue)) return;
                try {
                    const { width, height } = sampleCanvas;
                    // Reserve space at the bottom for axis labels
                    const axisLabelSpace = 15;
                    const plotHeight = height - axisLabelSpace; // Actual plotting area height
                    const plotBottomY = plotHeight; // Y coordinate of the X axis line

                    const valueRange = MAX_VALUE - MIN_VALUE;
                    const clampedValue = Math.max(MIN_VALUE, Math.min(MAX_VALUE, statValue));
                    const x = ((clampedValue - MIN_VALUE) / valueRange) * width;

                    const markerSize = 6;
                    const labelPadding = 2;
                    const textHeightEstimate = 10; // Estimate height based on 11px font
                    const markerHeight = markerSize * 1.5;
                    const markerTipY = plotBottomY - 1; // Tip near axis
                    const markerBaseY = markerTipY - markerHeight; // Base above tip

                    // Draw Triangle Marker in the Sample Distribution
                    sampleCtx.fillStyle = HIGHLIGHT_COLOR;
                    sampleCtx.beginPath();
                    sampleCtx.moveTo(x - markerSize, markerBaseY);
                    sampleCtx.lineTo(x + markerSize, markerBaseY);
                    sampleCtx.lineTo(x, markerTipY);
                    sampleCtx.closePath();
                    sampleCtx.fill();

                    // Add Text Label to the Mean or Median in the Histogram
                    let statName = selectedSamplingStat.charAt(0).toUpperCase() + selectedSamplingStat.slice(1);
                    if (statName === 'StdDev') statName = 'Std Dev';
                    const labelText = `${statName}: ${statValue.toFixed(1)}`;
                    sampleCtx.fillStyle = HIGHLIGHT_COLOR;
                    sampleCtx.font = '11px sans-serif'; // Keep highlight label size potentially larger
                    sampleCtx.textAlign = 'center';
                    sampleCtx.textBaseline = 'bottom';
                    const labelY = markerBaseY - labelPadding;

                    // Adjust label X near edges
                    let labelX = x;
                    const textMetrics = sampleCtx.measureText(labelText);
                    const textWidth = textMetrics.width;
                    const edgePadding = 4;
                    if (labelX - textWidth / 2 < edgePadding) {
                        labelX = textWidth / 2 + edgePadding;
                        sampleCtx.textAlign = 'left';
                    } else if (labelX + textWidth / 2 > width - edgePadding) {
                        labelX = width - textWidth / 2 - edgePadding;
                        sampleCtx.textAlign = 'right';
                    }

                    // Draw label if fits vertically
                    if (labelY > textHeightEstimate) {
                        sampleCtx.fillText(labelText, labelX, labelY);
                    } else {
                        console.warn("Highlight label too close to top edge.");
                    }
                     // Reset alignment
                    sampleCtx.textAlign = 'start';
                } catch (e) { console.error("Error drawing sample stat highlight:", e); }
            }

            function calculateSampleStats(data) {
                try {
                    const n = data.length;
                    if (n === 0) return { mean: NaN, median: NaN, stdDev: NaN, n: 0 };
                    const sortedData = [...data].sort((a, b) => a - b);
                    const sum = data.reduce((acc, val) => acc + val, 0);
                    const mean = sum / n;
                    let median;
                    const mid = Math.floor(n / 2);
                    if (n % 2 === 0) median = (sortedData[mid - 1] + sortedData[mid]) / 2;
                    else median = sortedData[mid];
                    const sumSq = data.reduce((acc, val) => acc + (val * val), 0);
                    const variance = (sumSq / n) - (mean * mean);
                    const stdDev = Math.sqrt(Math.max(0, variance));
                    return { mean, median, stdDev, n };
                } catch (e) {
                    console.error("Error calculating sample stats:", e);
                    return { mean: NaN, median: NaN, stdDev: NaN, n: data.length };
                }
            }

            function updateSampleStatsDisplay(stats) {
                try {
                    sampleStatsDisplay.mean.textContent = isNaN(stats.mean)?'-':stats.mean.toFixed(1);
                    sampleStatsDisplay.median.textContent = isNaN(stats.median)?'-':stats.median.toFixed(1);
                    sampleStatsDisplay.stdDev.textContent = isNaN(stats.stdDev)?'-':stats.stdDev.toFixed(1);
                    sampleStatsDisplay.n.textContent = stats.n;
                } catch (e) { console.error("Error updating sample stats display:", e); }
            }

            // ==================================================================
            // --- Sampling Statistics Distribution Functions ---
            // ==================================================================
             function clearSamplingDistribution() {
                 try {
                     samplingDistributionData = [];
                     samplingDistributionBins.fill(0);
                     numSamplesDrawn = 0;
                     lastSampleSizeForSamplingDist = currentSampleSize;
                     currentSamplingDistYMax = INITIAL_Y_MAX;
                     drawSamplingDistributionHistogram(); // Redraw empty plot
                     // Reset stats display
                     samplingDistStatsDisplay.count.textContent = '0';
                     samplingDistStatsDisplay.mean.textContent = '-';
                     samplingDistStatsDisplay.median.textContent = '-';
                     samplingDistStatsDisplay.stdDev.textContent = '-';
                 } catch(e) { console.error("Error clearing sampling distribution:", e); }
             }

             function drawSamplingDistributionHistogram() {
                 try {
                     const { width, height } = samplingDistCanvas;
                     // Reserve space at the bottom for axis labels
                     const axisLabelSpace = 15;
                     const plotHeight = height - axisLabelSpace; // Actual plotting area height
                     const plotBottomY = plotHeight; // Y coordinate of the X axis line

                     const maxCount = samplingDistributionBins.length > 0
                                      ? Math.max(...samplingDistributionBins) : 0;
                     const requiredYMax = Math.max(INITIAL_Y_MAX, Math.ceil(maxCount / 5) * 5);
                     if (requiredYMax > currentSamplingDistYMax) {
                         currentSamplingDistYMax = requiredYMax;
                     }

                     const canvasBg = getComputedStyle(document.documentElement)
                                      .getPropertyValue('--canvas-bg').trim() || '#ffffff';
                     const barFill = getComputedStyle(document.documentElement)
                                     .getPropertyValue('--sampling-bar-fill').trim() || '#28a745';
                     const barStroke = getComputedStyle(document.documentElement)
                                       .getPropertyValue('--sampling-bar-stroke').trim() || '#1c7430';

                     samplingDistCtx.clearRect(0, 0, width, height);
                     samplingDistCtx.fillStyle = canvasBg;
                     samplingDistCtx.fillRect(0, 0, width, height);
                     const barWidthPixels = width / NUM_SAMPLING_DIST_BINS;
                     samplingDistCtx.fillStyle = barFill;
                     samplingDistCtx.strokeStyle = barStroke;
                     samplingDistCtx.lineWidth = 1;

                     for (let i = 0; i < NUM_SAMPLING_DIST_BINS; i++) {
                         const count = samplingDistributionBins[i];
                         if (count === 0) continue;
                         const barHeightRatio = count / currentSamplingDistYMax;
                         const barHeight = Math.max(0, barHeightRatio * plotHeight);
                         const x = i * barWidthPixels;
                         const y = plotBottomY - barHeight; // Adjust y based on plotBottomY
                         const clampedHeight = Math.min(barHeight, plotHeight);
                         samplingDistCtx.fillRect(x, y, barWidthPixels, clampedHeight);
                         samplingDistCtx.strokeRect(x + 0.5, y + 0.5, barWidthPixels - 1, Math.max(0, clampedHeight - 1));
                     }

                     // Draw Normal Curve if checked and feasible
                     if (showNormalCurveCheckbox.checked && numSamplesDrawn > 1) {
                         const stats = calculateSamplingDistributionStats(samplingDistributionData);
                         const mean = stats.mean;
                         const stdDev = stats.stdDev;
                         if (!isNaN(mean) && !isNaN(stdDev) && stdDev > 1e-6) {
                              // Pass plotBottomY and plotHeight to the normal curve drawing function
                             drawNormalCurve(mean, stdDev, width, height, plotHeight, plotBottomY);
                         }
                     }

                     // Draw X axis
                     samplingDistCtx.strokeStyle = AXIS_COLOR;
                     samplingDistCtx.lineWidth = 1;
                     samplingDistCtx.beginPath();
                     samplingDistCtx.moveTo(0, plotBottomY);
                     samplingDistCtx.lineTo(width, plotBottomY);
                     samplingDistCtx.stroke();

                     // Draw X axis ticks and labels
                     drawXAxisTicks(samplingDistCtx, width, plotBottomY, SAMPLING_DIST_MIN, SAMPLING_DIST_MAX, 5); // Pass plotBottomY

                 } catch(e) { console.error("Error drawing sampling dist histogram:", e); }
             }

             function drawNormalCurve(mean, stdDev, canvasWidth, canvasHeight, plotHeight, plotBottomY) {
                 const SQRT_2PI = Math.sqrt(2 * Math.PI);
                 function normalPDF(x, mu, sigma) {
                     // Handle potential zero std dev gracefully if needed, though outer check helps
                     if (Math.abs(sigma) < 1e-9) return 0;
                     const sigmaSq = sigma * sigma;
                     const exponent = -((x - mu) * (x - mu)) / (2 * sigmaSq);
                     return (1 / (sigma * SQRT_2PI)) * Math.exp(exponent);
                 }
                 // Scale PDF area to match histogram area
                 const scaleFactor = numSamplesDrawn * samplingDistBinWidth;
                 samplingDistCtx.strokeStyle = NORMAL_CURVE_COLOR;
                 samplingDistCtx.lineWidth = 1.5;
                 samplingDistCtx.beginPath();
                 let firstPoint = true;
                 // Draw curve smoothly
                 for (let px = 0; px <= canvasWidth; px += 2) {
                     const value = SAMPLING_DIST_MIN
                                 + (px / canvasWidth) * (SAMPLING_DIST_MAX - SAMPLING_DIST_MIN);
                     const pdfValue = normalPDF(value, mean, stdDev);
                     const scaledPdfHeight = pdfValue * scaleFactor;
                     // Convert height to y-coordinate using dynamic scale and adjusted plot height
                     // Ensure currentSamplingDistYMax is not zero
                     const yMaxForScaling = Math.max(1, currentSamplingDistYMax);
                     const y = plotBottomY - (scaledPdfHeight / yMaxForScaling) * plotHeight;
                     if (y > plotBottomY) continue; // Avoid drawing below axis

                     if (firstPoint) { samplingDistCtx.moveTo(px, Math.max(0,y)); firstPoint = false; } // Clamp y to >= 0
                     else { samplingDistCtx.lineTo(px, Math.max(0,y)); }
                 }
                 samplingDistCtx.stroke();
             }

             function calculateSamplingDistributionStats(data) {
                 try {
                     const n = data.length;
                     if (n === 0) return { mean: NaN, median: NaN, stdDev: NaN, n: 0 };
                     const sortedData = [...data].sort((a, b) => a - b);
                     const sum = data.reduce((acc, val) => acc + val, 0);
                     const mean = sum / n;
                     let median;
                     const mid = Math.floor(n / 2);
                     if (n % 2 === 0) median = (sortedData[mid - 1] + sortedData[mid]) / 2;
                     else median = sortedData[mid];
                     const sumSq = data.reduce((acc, val) => acc + (val * val), 0);
                     const variance = (sumSq / n) - (mean * mean);
                     const stdDev = Math.sqrt(Math.max(0, variance)); // This is Std Dev of the stats (Std Error)
                     return { mean, median, stdDev, n };
                 } catch (e) {
                     console.error("Error calculating sampling dist stats:", e);
                     return { mean: NaN, median: NaN, stdDev: NaN, n: data.length };
                 }
             }

             function updateSamplingDistributionStatsDisplay(stats) {
                 try {
                     samplingDistStatsDisplay.count.textContent = stats.n;
                     samplingDistStatsDisplay.mean.textContent = isNaN(stats.mean)?'-':stats.mean.toFixed(1);
                     samplingDistStatsDisplay.median.textContent = isNaN(stats.median)?'-':stats.median.toFixed(1);
                     samplingDistStatsDisplay.stdDev.textContent = isNaN(stats.stdDev)?'-':stats.stdDev.toFixed(1); // Displaying Std Error
                 } catch(e) { console.error("Error updating sampling dist stats display:", e); }
             }

             function updateSamplingDistribution() {
                 try {
                     drawSamplingDistributionHistogram();
                     const stats = calculateSamplingDistributionStats(samplingDistributionData);
                     updateSamplingDistributionStatsDisplay(stats);
                 } catch(e) { console.error("Error updating sampling distribution:", e); }
             }


            // ==================================================================
            // --- Core Animation & Bulk Sampling ---
            // ==================================================================
             function runSamplingAnimation() {
                 try {
                     if (isProcessing) return;
                     if (currentSampleSize !== lastSampleSizeForSamplingDist) {
                         clearSamplingDistribution();
                         lastSampleSizeForSamplingDist = currentSampleSize;
                     }
                     const populationCDF = getPopulationCDF();
                     if (!populationCDF) { alert("Cannot draw sample: Population is empty."); return; }

                     const currentAnimDelay = (currentSampleSize <= 10)
                                              ? ANIMATION_DELAY_VERY_SLOW_MS // n=5 or n=10 uses very slow
                                              : ANIMATION_DELAY_FAST_MS; // n=20 or n=100 uses fast
                     const highlightClearDelay = currentAnimDelay ; // Make highlight slightly shorter than step

                     setControlsDisabled(true);
                     clearSample(); // This calls drawSampleHistogram initially (empty)
                     let samplesDrawnThisRun = 0;

                     function drawNext() {
                         if (samplesDrawnThisRun >= currentSampleSize) {
                             // Finalize
                             const sampleStats = calculateSampleStats(currentSampleData);
                             updateSampleStatsDisplay(sampleStats);
                             const statValue = sampleStats[selectedSamplingStat];
                             // Redraw sample histogram cleanly before highlighting
                             drawSampleHistogram();
                             highlightSampleStat(statValue); // Add highlight marker

                             // Update sampling distribution plot
                             if (statValue !== undefined && !isNaN(statValue)) {
                                 samplingDistributionData.push(statValue);
                                 const binIndex = Math.max(0, Math.min(NUM_SAMPLING_DIST_BINS - 1,
                                     Math.floor((statValue - SAMPLING_DIST_MIN) / samplingDistBinWidth)));
                                 if (binIndex >= 0 && binIndex < NUM_SAMPLING_DIST_BINS) {
                                     samplingDistributionBins[binIndex]++;
                                 }
                                 numSamplesDrawn++;
                                 updateSamplingDistribution(); // This calls drawSamplingDistributionHistogram
                             }
                             setControlsDisabled(false); // Re-enable controls
                             return; // End animation loop
                         }

                         // Draw next value in animation
                         const value = drawOneValue(populationCDF);
                         if (value !== null) {
                              const rHighlight = Math.random(); // For finding approx source bin
                              const sourceBinIndex = populationCDF.findIndex(prob => prob >= rHighlight);
                              // animateSingleDraw calls drawSampleHistogram internally after adding point
                              animateSingleDraw(value, sourceBinIndex >= 0 ? sourceBinIndex : 0, highlightClearDelay);
                              samplesDrawnThisRun++;
                              setTimeout(drawNext, currentAnimDelay); // Schedule next step
                         } else {
                             console.error("Error drawing sample value (null). Stopping animation.");
                             setControlsDisabled(false);
                             drawSampleHistogram(); // Ensure final state is drawn
                             updateSampleStatsDisplay(calculateSampleStats(currentSampleData)); // Update with any partial data
                         }
                     } // end drawNext
                     drawNext(); // Start animation loop
                 } catch (e) {
                     console.error("Error in runSamplingAnimation:", e);
                     setControlsDisabled(false); // Ensure controls enabled on error
                     // Attempt to draw current state on error
                     drawSampleHistogram();
                     drawSamplingDistributionHistogram();
                 }
             } // end runSamplingAnimation

             function runBulkSampling(numSamplesToDraw) {
                 console.log(`runBulkSampling called for ${numSamplesToDraw} samples.`);
                 try {
                     if (isProcessing) return;
                     if (currentSampleSize !== lastSampleSizeForSamplingDist) {
                         console.log(`Sample size changed, resetting sampling distribution.`);
                         clearSamplingDistribution();
                         lastSampleSizeForSamplingDist = currentSampleSize;
                     }
                     const populationCDF = getPopulationCDF();
                     if (!populationCDF) { alert("Cannot draw samples: Population is empty."); return; }

                     setControlsDisabled(true);
                     // Bulk Calculation Loop
                     for (let i = 0; i < numSamplesToDraw; i++) {
                         let singleSample = [];
                         for (let j = 0; j < currentSampleSize; j++) {
                             const value = drawOneValue(populationCDF);
                             if (value !== null) singleSample.push(value);
                             else console.warn(`Error drawing value in bulk sample ${i+1}, item ${j+1}`);
                         }
                         if (singleSample.length > 0) {
                             const sampleStats = calculateSampleStats(singleSample);
                             const statValue = sampleStats[selectedSamplingStat];
                             if (statValue !== undefined && !isNaN(statValue)) {
                                 samplingDistributionData.push(statValue);
                                 const binIndex = Math.max(0, Math.min(NUM_SAMPLING_DIST_BINS - 1,
                                     Math.floor((statValue - SAMPLING_DIST_MIN) / samplingDistBinWidth)));
                                 if (binIndex >= 0 && binIndex < NUM_SAMPLING_DIST_BINS) {
                                     samplingDistributionBins[binIndex]++;
                                 }
                                 numSamplesDrawn++;
                             } else { console.warn(`Invalid stat value for bulk sample ${i+1}:`, statValue); }
                         } else { console.warn(`Empty sample generated in bulk run ${i+1}`); }
                     } // End Bulk Loop

                     console.log(`Finished drawing ${numSamplesToDraw} samples.`);
                     updateSamplingDistribution(); // Update the third plot ONCE (calls drawSamplingDistributionHistogram)
                     clearSample(); // Clear the middle plot display (calls drawSampleHistogram)
                     setControlsDisabled(false); // Re-enable controls
                 } catch (e) {
                     console.error("Error in runBulkSampling:", e);
                     setControlsDisabled(false);
                     // Attempt to draw current state on error
                     drawSampleHistogram();
                     drawSamplingDistributionHistogram();
                 }
             }

            // ==================================================================
            // --- Reset Simulation Function ---
            // ==================================================================
            function resetSimulation() {
                console.log("Resetting Simulation...");
                try {
                    currentSampleSize = 5; selectedSamplingStat = 'mean'; isProcessing = false;
                    showNormalCurveCheckbox.checked = false;
                    document.getElementById('presetNormal').checked = true;
                    document.getElementById('n5').checked = true;
                    document.getElementById('statMean').checked = true;
                    nValDisplay.textContent = currentSampleSize;
                    samplingDistStatNameSpan.textContent = 'Mean'; // Reset title span
                    // Load preset first, which calls updatePopulation -> drawPopulationHistogram
                    loadPreset('normal');
                    // clearSample and clearSamplingDistribution are called within loadPreset
                    // Need to ensure they draw the axes correctly on reset
                    clearSample(); // Explicitly call again to ensure axes are drawn if loadPreset's internal call somehow missed it
                    clearSamplingDistribution(); // Explicitly call again
                    setControlsDisabled(false);
                    console.log("Simulation Reset Complete.");
                 } catch(e) { console.error("Error during reset:", e); setControlsDisabled(false); }
            }

            // ==================================================================
            // --- Event Listeners ---
            // ==================================================================
             try {
                 // Sample Size Change Listener
                 sampleControlsDiv.addEventListener('change', (e) => {
                     if (e.target.type === 'radio' && e.target.name === 'sampleSize') {
                         const newSize = parseInt(e.target.value, 10);
                         currentSampleSize = newSize;
                         nValDisplay.textContent = currentSampleSize;
                         if (newSize !== lastSampleSizeForSamplingDist && numSamplesDrawn > 0) {
                             clearSamplingDistribution(); // Will redraw with axes
                         }
                     }
                 });
                 // Statistic Change Listener
                 samplingDistControlsDiv.addEventListener('change', (e) => {
                     if (e.target.type === 'radio' && e.target.name === 'samplingStat') {
                         selectedSamplingStat = e.target.value;
                         let statName = selectedSamplingStat.charAt(0).toUpperCase() + selectedSamplingStat.slice(1);
                         if (statName === 'StdDev') statName = 'Std Dev';
                         samplingDistStatNameSpan.textContent = statName; // Update title
                         clearSamplingDistribution(); // Will redraw with axes
                         drawSampleHistogram(); // Redraw sample to clear old highlight and draw axis
                     }
                 });
                 // Preset Change Listener
                 presetControlsDiv.addEventListener('change',(e) => {
                     if(e.target.type==='radio' && e.target.name==='distType'){
                         if(isProcessing) e.target.checked = false; // Prevent change during processing
                         else {
                             loadPreset(e.target.value); // Will redraw population with axes
                             // clearSample/clearSamplingDistribution called within loadPreset redraw correctly
                         }
                     }
                 });
                 // Population Drawing Mouse Events
                 popCanvas.addEventListener('mousedown',(e) => {
                     if(isProcessing) return;
                     isDraggingPop = true;
                     popCanvas.style.cursor = 'grabbing';
                     applyPopulationDrawing(e); // Calls updatePopulation -> drawPopulationHistogram
                     const checkedRadio = presetControlsDiv.querySelector('input[name="distType"]:checked');
                     if(checkedRadio) checkedRadio.checked = false; // Deselect preset
                 });
                 popCanvas.addEventListener('mousemove',(e) => {
                     // Calls applyPopulationDrawing -> updatePopulation -> drawPopulationHistogram
                     if(isDraggingPop && !isProcessing) applyPopulationDrawing(e);
                 });
                 document.addEventListener('mouseup',(e) => {
                     if(isDraggingPop){
                         isDraggingPop = false;
                         if(!isProcessing) popCanvas.style.cursor = 'crosshair';
                     }
                 }, true); // Capture phase
                 popCanvas.addEventListener('mouseleave',() => {
                     if(!isDraggingPop && !isProcessing) popCanvas.style.cursor = 'crosshair';
                 });
                 popCanvas.addEventListener('mouseenter',(e) => {
                     if(!isProcessing) {
                         // Correct dragging state if mouseup happened outside
                         if (e.buttons !== 1 && isDraggingPop) isDraggingPop = false;
                         popCanvas.style.cursor = isDraggingPop ? 'grabbing' : 'crosshair';
                     }
                 });

                 // Checkbox Listener
                 if (showNormalCurveCheckbox) {
                     showNormalCurveCheckbox.addEventListener('change', () => {
                         drawSamplingDistributionHistogram(); // Redraw immediately with axis
                     });
                 } else { console.error("Show Normal Curve checkbox not found!");}

                 // Reset Button Listener
                 if (resetBtn) { resetBtn.addEventListener('click', resetSimulation); } // reset calls redraws
                 else { console.error("Reset Button not found!"); }

                 // Draw Button Listeners
                 if (drawSampleBtn) { drawSampleBtn.addEventListener('click', runSamplingAnimation); } // Calls redraws internally
                 else { console.error("Draw 1 Sample button not found."); }
                 if (draw100SamplesBtn) { draw100SamplesBtn.addEventListener('click', () => runBulkSampling(100)); } // Calls redraws internally
                 else { console.error("Draw 100 Samples button not found."); }
                 if (draw1000SamplesBtn) { draw1000SamplesBtn.addEventListener('click', () => runBulkSampling(1000)); } // Calls redraws internally
                 else { console.error("Draw 1000 Samples button not found."); }

             } catch (e) { console.error("Error setting up event listeners:", e); }

            // ==================================================================
            // --- Initial Setup Call ---
            // ==================================================================
            try {
                resetSimulation(); // Initial load performs a reset which calls redraws
            } catch (e) {
                console.error("Error during initial setup:", e);
                alert("An error occurred during initialization. Please check the console.");
            }

        }); // End DOMContentLoaded listener
