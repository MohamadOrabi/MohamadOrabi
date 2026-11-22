document.addEventListener("DOMContentLoaded", function () {
    let max_bias = 50;
    const userGuesses = new Set();
    let satellites = [];
    let outliers = new Set();
    let includeClockBias = false;
    let trueClockBias = 0;
    let numSatellites = 10;
    let outlierProbability = 0.1;
    let currentTime;

    // Earth's constants
    const a = 6378137.0; // Earth's equatorial radius in meters
    const f = 1 / 298.257223563; // Earth's flattening
    const e2 = f * (2 - f); // Square of eccentricity

    // Define geodetic coordinates for the receiver
    const lat = 37.7749; // Latitude in degrees (San Francisco)
    const lon = -122.4194; // Longitude in degrees
    const alt = 0; // Altitude in meters

    // Convert geodetic coordinates to ECEF
    function geodeticToECEF(lat, lon, alt) {
        const observerGd = {
            latitude: satellite.degreesToRadians(lat),
            longitude: satellite.degreesToRadians(lon),
            height: alt / 1000 // satellite.js expects height in kilometers
        };
        const positionEcf = satellite.geodeticToEcf(observerGd);
        
        return { x: positionEcf.x, y: positionEcf.y, z: positionEcf.z };
    }

    // Set the true receiver position in ECEF
    const trueReceiverPosition = geodeticToECEF(lat, lon, alt);

    // Local TLE file (a frozen snapshot of Celestrak's GPS operational set)
    const TLE_URL = 'data/gps-ops.tle';
    // Pick the game time within +/- this many hours of the TLE epoch, so SGP4 stays accurate
    const TLE_WINDOW_HOURS = 12;
    let satrecsPromise = null;
    let tleEpoch = null;

    function showError(message) {
        console.error(message);
        const placeholder = document.querySelector('#skyplotPlotly .plot-loading');
        if (placeholder) placeholder.remove();
        const el = document.getElementById("gameResult");
        if (el) el.innerHTML = `<p style="color:#c00">${message}</p>`;
    }

    // Random date within +/- TLE_WINDOW_HOURS of the TLE set's own epoch
    function getRandomDateNearEpoch(epoch) {
        const span = TLE_WINDOW_HOURS * 3600 * 1000;
        return new Date(epoch.getTime() + (Math.random() * 2 - 1) * span);
    }

    // Load the bundled TLE file
    async function fetchTLEData() {
        const response = await fetch(TLE_URL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} while loading ${TLE_URL}`);
        }
        return response.text();
    }

    // Load, parse (name/line1/line2 triplets) and cache satrecs; sets tleEpoch
    function loadSatrecs() {
        if (!satrecsPromise) {
            satrecsPromise = (async () => {
                const tleData = await fetchTLEData();
                const lines = tleData.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
                const recs = [];
                for (let i = 0; i + 2 < lines.length; i += 3) {
                    if (!lines[i + 1].startsWith('1 ') || !lines[i + 2].startsWith('2 ')) {
                        throw new Error(`Malformed TLE entry near "${lines[i]}"`);
                    }
                    recs.push(satellite.twoline2satrec(lines[i + 1], lines[i + 2]));
                }
                if (recs.length === 0) throw new Error(`No TLE entries found in ${TLE_URL}`);
                // jdsatepoch is a Julian date; 2440587.5 is the Unix epoch
                tleEpoch = new Date((recs[0].jdsatepoch - 2440587.5) * 86400000);
                return recs;
            })();
            satrecsPromise.catch(() => { satrecsPromise = null; });
        }
        return satrecsPromise;
    }

    // Parse TLE data and compute satellite positions relative to trueReceiverPosition
    async function computeSatellitePositions() {
        const satrecs = await loadSatrecs();
        const satellitePositions = [];
    
        for (let i = 0; i < satrecs.length; i++) {
            const satrec = satrecs[i];
            const positionAndVelocity = satellite.propagate(satrec, currentTime);
    
            if (!positionAndVelocity.position) {
                console.warn(`Propagation failed for satellite at index ${i / 3}`);
                continue; // Skip this satellite if propagation failed
            }
    
            // Compute the satellite ECEF position at the specified time
            const positionEci = positionAndVelocity.position;
            const gmst = satellite.gstime(currentTime);
            const satelliteEcef = satellite.eciToEcf(positionEci, gmst);
    
            // Convert trueReceiverPosition to the format expected by satellite.js
            const observerPosition = {
                longitude: satellite.radiansToDegrees(Math.atan2(trueReceiverPosition.y, trueReceiverPosition.x)),
                latitude: satellite.radiansToDegrees(Math.asin(trueReceiverPosition.z / Math.sqrt(
                    trueReceiverPosition.x ** 2 +
                    trueReceiverPosition.y ** 2 +
                    trueReceiverPosition.z ** 2
                ))),
                height: 0 // Assuming observer is at ground level
            };
    
            // Use lookAngles to compute azimuth and elevation from observer to satellite
            const lookAngles = satellite.ecfToLookAngles(observerPosition, satelliteEcef);
    
            // Convert azimuth and elevation to degrees
            const azimuth = satellite.radiansToDegrees(lookAngles.azimuth);
            const elevation = satellite.radiansToDegrees(lookAngles.elevation);
    
            if (elevation > 0) {
                satellitePositions.push({
                    azimuth,
                    elevation,
                    x: satelliteEcef.x,
                    y: satelliteEcef.y,
                    z: satelliteEcef.z
                });
            }
        }
    
        if (satellitePositions.length === 0) {
            console.warn("No satellites with positive elevation found.");
        }
    
        return satellitePositions;
    }

    // Set difficulty configurations
    const difficultySettings = {
        easy: { numSatellites: 20, outlierProbability: 0.2 },
        medium: { numSatellites: 15, outlierProbability: 0.3 },
        hard: { numSatellites: 10, outlierProbability: 0.4 }
    };

    // Difficulty level change event
    document.getElementById("difficultyLevel").addEventListener("change", function (event) {
        const difficulty = event.target.value;
        const settings = difficultySettings[difficulty];
        numSatellites = settings.numSatellites;
        outlierProbability = settings.outlierProbability;
        initializeGame(); 
    });

    // Clock bias checkbox event
    document.getElementById("clockBias").addEventListener("change", function (event) {
        includeClockBias = event.target.checked;
        initializeGame(); 
    });

    // Generate satellites based on true receiver position
    async function generateSatellites() {
        satellites = [];
        outliers = new Set();
    
        // Fetch and compute satellite positions from TLE data
        const realSatellites = await computeSatellitePositions();
    
        // Check if any satellites are above the horizon and add them
        realSatellites.slice(0, numSatellites).forEach((sat, i) => {
            const isOutlier = Math.random() < outlierProbability;
            const bias = isOutlier ? 10 + Math.random() * max_bias : 0;
    
            // Calculate true range from the true receiver position
            const trueRange = Math.sqrt(
                (sat.x - trueReceiverPosition.x) ** 2 +
                (sat.y - trueReceiverPosition.y) ** 2 +
                (sat.z - trueReceiverPosition.z) ** 2
            );
    
            // Measurement based on true range, added bias, and clock bias
            const measurement = trueRange + bias + trueClockBias + (Math.random() - 0.5);
    
            // Only add satellites that are above the horizon (elevation > 0)
            if (sat.elevation > 0) {
                satellites.push({
                    id: i,
                    x: sat.x,
                    y: sat.y,
                    z: sat.z,
                    azimuth: sat.azimuth,
                    elevation: sat.elevation,
                    measurement,
                    bias,
                    isOutlier
                });
                if (isOutlier) outliers.add(i);
            }
        });
    
        // Check the satellite array length to confirm it has entries
        if (satellites.length === 0) {
            console.error("No satellites passed the horizon check.");
        }
    }

    // Function to compute residuals based on WLS estimate
    function computeWLS() {
        const initialGuess = { x: trueReceiverPosition.x, y: trueReceiverPosition.y, z: trueReceiverPosition.z, cb: 0 };
        const estimatedPosition = weightedLeastSquares(satellites, initialGuess);
    
        // Calculate residuals for each satellite
        satellites.forEach(sat => {
            const estimatedRange = Math.sqrt(
                (sat.x - estimatedPosition.x) ** 2 +
                (sat.y - estimatedPosition.y) ** 2 +
                (sat.z - estimatedPosition.z) ** 2
            ) + estimatedPosition.cb;
            sat.residual = sat.measurement - estimatedRange;
        });
    
        // Calculate 3D position error
        const positionError3D = Math.sqrt(
            (trueReceiverPosition.x - estimatedPosition.x) ** 2 +
            (trueReceiverPosition.y - estimatedPosition.y) ** 2 +
            (trueReceiverPosition.z - estimatedPosition.z) ** 2
        );
    
        // Calculate 4D position error, including clock bias
        const positionError4D = Math.sqrt(positionError3D ** 2 + estimatedPosition.cb ** 2);
    
        return { positionError3D, positionError4D };
    }

    // Weighted Least Squares (WLS) with clock bias estimation
    function weightedLeastSquares(satellites, initialGuess, maxIterations = 10, tolerance = 1e-12) {
        let { x, y, z, cb } = initialGuess;
    
        for (let iter = 0; iter < maxIterations; iter++) {
            let H = [];
            let deltaR = [];
    
            satellites.forEach(sat => {
                const rangeEstimate = Math.sqrt((sat.x - x) ** 2 + (sat.y - y) ** 2 + (sat.z - z) ** 2) + cb;
                const residual = sat.measurement - rangeEstimate;
    
                const row = [(x - sat.x) / rangeEstimate, (y - sat.y) / rangeEstimate, (z - sat.z) / rangeEstimate];
                if (includeClockBias) row.push(1); // Add column for clock bias if applicable
                H.push(row);
                deltaR.push(residual);
            });
    
            // Convert H and deltaR to matrices
            H = math.matrix(H);
            deltaR = math.matrix(deltaR);
    
            try {
                const Ht = math.transpose(H);
                const HtH = math.multiply(Ht, H); // No regularization
                const HtH_inv = math.inv(HtH); 
                const delta = math.multiply(HtH_inv, Ht, deltaR); 

                x += delta.get([0]);
                y += delta.get([1]);
                z += delta.get([2]);
                if (includeClockBias) cb += delta.get([3]);
                
                console.log("WLS error norm: ", math.norm(delta))
                console.log("clock bias estimted: ", cb)
                if (math.norm(delta) < tolerance) break;
            } catch (error) {
                console.error("Matrix inversion failed:", error);
                break;
            }
        }
        return { x, y, z, cb };
    }

    // Initialize the game with a new random date and settings
    async function initializeGame() {
        try {
            await loadSatrecs();
            currentTime = getRandomDateNearEpoch(tleEpoch); // Random time near the TLE epoch
            await generateSatellites(); // Populate satellites array
        } catch (error) {
            showError(`Could not load satellite ephemeris (${TLE_URL}): ${error.message}`);
            return;
        }
        if (satellites.length === 0) {
            console.error("No satellites generated. Check satellite data or horizon filtering.");
            return;
        }
    
        // Debug: Log the satellite data to ensure it's populated
        console.log("Generated satellites:", satellites);
    
        computeWLS(); // Compute WLS based on satellites array
    
        // Verify residuals calculation
        console.log("Satellites with residuals:", satellites.map(sat => ({
            id: sat.id,
            residual: sat.residual
        })));
    
        userGuesses.clear(); // Clear before plotting so no selection ring carries over
        document.getElementById("gameResult").innerHTML = ""; // Clear result text
        plotSkyplot();
    }

    document.getElementById("resetGame").addEventListener("click", () => {
        initializeGame();
    });

    // Site palette for the plot
    const PLOT_FONT = { family: 'Muli, -apple-system, "Segoe UI", Roboto, sans-serif', color: '#495057' };
    const RESIDUAL_COLORSCALE = [
        [0, '#2B4C6F'],    // negative residual: deep slate blue
        [0.5, '#EFE9E4'],  // zero: warm light grey
        [0.8, '#BD5D38'],  // positive residual: sidebar rust
        [1, '#7A2E12']     // extreme positive: deep rust
    ];
    const HALO_EXTRA_SIZE = 14;

    function removePlotPlaceholder() {
        const placeholder = document.querySelector('#skyplotPlotly .plot-loading');
        if (placeholder) placeholder.remove();
    }

    // Trace data for the "selected" halo drawn behind the chosen satellites
    function haloData(sizes) {
        const selected = satellites.map((sat, i) => ({ sat, size: sizes[i] })).filter(d => userGuesses.has(d.sat.id));
        return {
            r: selected.map(d => 90 - d.sat.elevation),
            theta: selected.map(d => d.sat.azimuth),
            size: selected.map(d => d.size + HALO_EXTRA_SIZE)
        };
    }

    // Plot satellites on skyplot with coloring by residuals and optional size adjustment based on bias
    function plotSkyplot(showBiasSize = false) {
        const container = document.getElementById('skyplotPlotly');
        removePlotPlaceholder();
        const width = container.clientWidth || 640;
        const narrow = width < 480;

        const sizes = satellites.map(sat => showBiasSize ? Math.min(10 + sat.bias * 2, 30) : 10);
        const hoverInfo = satellites.map(sat =>
            showBiasSize
                ? `ID: ${sat.id}<br>Residual: ${sat.residual.toFixed(2)} meters<br>Bias: ${sat.bias.toFixed(2)} meters`
                : `ID: ${sat.id}<br>Residual: ${sat.residual.toFixed(2)} meters`
        );

        const colorbar = {
            title: { text: 'Residual (m)', font: PLOT_FONT },
            tickfont: PLOT_FONT,
            thickness: 14,
            outlinewidth: 0
        };
        if (narrow) {
            // Slimmer colourbar so the polar plot keeps most of a phone-width screen
            Object.assign(colorbar, { thickness: 10, len: 0.7, x: 0.88, xanchor: 'left', tickfont: Object.assign({}, PLOT_FONT, { size: 10 }) });
        }

        // Trace 0: selection halo (a rust ring with a dark edge, drawn behind the satellites)
        // Trace 1: the satellites, coloured by residual
        const halo = haloData(sizes);
        const data = [{
            type: 'scatterpolar',
            mode: 'markers',
            r: halo.r,
            theta: halo.theta,
            marker: { color: '#BD5D38', size: halo.size, line: { color: '#212529', width: 2 } },
            hoverinfo: 'skip',
            showlegend: false
        }, {
            type: 'scatterpolar',
            mode: 'markers',
            r: satellites.map(sat => 90 - sat.elevation),
            theta: satellites.map(sat => sat.azimuth),
            marker: {
                color: satellites.map(sat => sat.residual),
                colorscale: RESIDUAL_COLORSCALE,
                cmin: -20,
                cmax: 20,
                size: sizes,
                opacity: 0.95,
                line: { color: '#343a40', width: 1 },
                colorbar
            },
            text: hoverInfo,
            hoverinfo: 'text'
        }];

        const axisStyle = { gridcolor: '#D9D2CB', linecolor: '#D9D2CB', tickfont: PLOT_FONT };
        const layout = {
            polar: {
                bgcolor: 'rgba(0,0,0,0)',
                domain: narrow ? { x: [0.1, 0.84], y: [0, 1] } : { x: [0, 1], y: [0, 1] },
                radialaxis: Object.assign({ visible: true, range: [90, 0] }, axisStyle),
                angularaxis: Object.assign({ direction: 'clockwise' }, axisStyle)
            },
            showlegend: false,
            font: PLOT_FONT,
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            height: narrow ? Math.max(300, width - 20) : Math.min(520, Math.max(380, width)),
            margin: narrow ? { t: 20, r: 40, b: 20, l: 10 } : { t: 30, r: 20, b: 30, l: 20 }
        };

        Plotly.newPlot('skyplotPlotly', data, layout, { responsive: true, displayModeBar: false }).then(() => {
            const skyplotElement = document.getElementById('skyplotPlotly');
            skyplotElement.on('plotly_click', function(event) {
                const point = event.points[0];
                const satelliteId = satellites.find(sat => sat.azimuth === point.theta && (90 - sat.elevation) === point.r).id;

                if (userGuesses.has(satelliteId)) {
                    userGuesses.delete(satelliteId);
                } else {
                    userGuesses.add(satelliteId);
                }

                const updatedHalo = haloData(skyplotElement.data[1].marker.size);
                Plotly.restyle('skyplotPlotly', {
                    r: [updatedHalo.r],
                    theta: [updatedHalo.theta],
                    'marker.size': [updatedHalo.size]
                }, [0]);
            });
        });
    }

    // Handle "Submit Guesses" button to show biases
    document.getElementById("submitGuess").addEventListener("click", () => {
        let correct = 0;
        const feedbackText = [];
        const { positionError3D, positionError4D } = computeWLS(); // Get position errors
    
        userGuesses.forEach(id => {
            if (outliers.has(id)) correct++;
            feedbackText.push(`Satellite ${id}: Bias = ${satellites[id].bias.toFixed(2)} meters`);
        });
    
        const resultText = `You identified <u>${correct} out of ${outliers.size} outliers</u> correctly.<br>
        <u>Estimated Position Error:</u><br>
        3D Position Error: ${positionError3D.toFixed(2)} meters<br>
        4D Position and Time Error: ${positionError4D.toFixed(2)} meters<br>
    `;
    
        document.getElementById("gameResult").innerHTML = `<p>${resultText}</p><p>${feedbackText.join("<br>")}</p>`;
    
        plotSkyplot(true); // Replot to show biases
    });

    // Initial game setup: start from whatever difficulty the select currently shows
    const initialSettings = difficultySettings[document.getElementById("difficultyLevel").value];
    if (initialSettings) {
        numSatellites = initialSettings.numSatellites;
        outlierProbability = initialSettings.outlierProbability;
    }
    includeClockBias = document.getElementById("clockBias").checked;
    initializeGame();
});