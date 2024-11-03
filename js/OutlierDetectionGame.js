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

    // Generate a random date within the past year
    function getRandomDateWithinDay() {
        const now = new Date();
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(now.getDate() - 1); // Set to one week (7 days) ago
    
        // Generate a random timestamp between one week ago and now
        const randomTimestamp = oneWeekAgo.getTime() + Math.random() * (now.getTime() - oneWeekAgo.getTime());
        return new Date(randomTimestamp);
    }

    // Fetch the latest GPS TLE data
    async function fetchTLEData() {
        const response = await fetch('https://www.celestrak.com/NORAD/elements/gps-ops.txt');
        const tleData = await response.text();
        console.log("TLE data len: ", tleData.length)
        return tleData;
    }

    // Parse TLE data and compute satellite positions relative to trueReceiverPosition
    async function computeSatellitePositions() {
        const tleData = await fetchTLEData();
        const tleLines = tleData.split('\n').filter(line => line.trim() !== '');
        const satellitePositions = [];
    
        for (let i = 0; i < tleLines.length; i += 3) {
            const tleLine1 = tleLines[i + 1];
            const tleLine2 = tleLines[i + 2];
            const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
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
            console.log("\nEstimated Range: ", estimatedRange)
            console.log("True Range: ", sat.measurement)
            console.log("Diff: ", sat.residual)
        });

        // Compute 3D position error (Euclidean distance)
        const positionError3D = Math.sqrt(
            (estimatedPosition.x - trueReceiverPosition.x) ** 2 +
            (estimatedPosition.y - trueReceiverPosition.y) ** 2 +
            (estimatedPosition.z - trueReceiverPosition.z) ** 2
        );

        // Output 3D position error in console and UI
        console.log(`3D Position Error: ${positionError3D.toFixed(2)} meters`);
        document.getElementById("gameResult").innerHTML += `<p>3D Position Error: ${positionError3D.toFixed(2)} meters</p>`;
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
        currentTime = getRandomDateWithinDay(); // Set a new random date each reset
        await generateSatellites(); // Populate satellites array
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
    
        plotSkyplot();
        document.getElementById("gameResult").innerHTML = ""; // Clear result text
        userGuesses.clear();
    }

    document.getElementById("resetGame").addEventListener("click", () => {
        initializeGame();
    });

    // Plot satellites on skyplot with coloring by residuals and optional size adjustment based on bias
    function plotSkyplot(showBiasSize = false) {
        const colors = satellites.map(sat => sat.residual);
        const sizes = satellites.map(sat => showBiasSize ? Math.min(10 + sat.bias * 2, 30) : 10);
        const hoverInfo = satellites.map(sat =>
            showBiasSize
                ? `ID: ${sat.id}<br>Residual: ${sat.residual.toFixed(2)} meters<br>Bias: ${sat.bias.toFixed(2)} meters`
                : `ID: ${sat.id}<br>Residual: ${sat.residual.toFixed(2)} meters`
        );

        const data = [{
            type: 'scatterpolar',
            mode: 'markers',
            r: satellites.map(sat => 90 - sat.elevation),
            theta: satellites.map(sat => sat.azimuth),
            marker: {
                color: colors,
                colorscale: 'RdYlGn',
                cmin: Math.min(...colors),
                cmax: Math.max(...colors),
                size: sizes,
                opacity: 0.8,
                line: { color: 'black', width: 1 },
                colorbar: { title: "Residual (m)" }
            },
            text: hoverInfo,
            hoverinfo: 'text'
        }];

        const layout = {
            polar: {
                radialaxis: { visible: true, range: [90, 0] },
                angularaxis: { direction: "clockwise" }
            },
            showlegend: false,
            title: { text: "Outlier Detection Skyplot", font: { size: 20 } }
        };

        Plotly.newPlot('skyplotPlotly', data, layout).then(() => {
            const skyplotElement = document.getElementById('skyplotPlotly');
            skyplotElement.on('plotly_click', function(event) {
                const point = event.points[0];
                const satelliteId = satellites.find(sat => sat.azimuth === point.theta && (90 - sat.elevation) === point.r).id;

                if (userGuesses.has(satelliteId)) {
                    userGuesses.delete(satelliteId);
                } else {
                    userGuesses.add(satelliteId);
                }

                const updatedColors = satellites.map(sat =>
                    userGuesses.has(sat.id) ? 'lime' : sat.residual
                );

                Plotly.restyle('skyplotPlotly', {
                    'marker.color': [updatedColors]
                });
            });
        });
    }

    // Handle "Submit Guesses" button to show biases
    document.getElementById("submitGuess").addEventListener("click", () => {
        let correct = 0;
        const feedbackText = [];

        userGuesses.forEach(id => {
            if (outliers.has(id)) correct++;
            feedbackText.push(`Satellite ${id}: Bias = ${satellites[id].bias.toFixed(2)} meters`);
        });

        const resultText = `You identified ${correct} out of ${outliers.size} outliers correctly.`;
        document.getElementById("gameResult").innerHTML = `<p>${resultText}</p><p>${feedbackText.join("<br>")}</p>`;

        plotSkyplot(true);
    });

    // Initial game setup
    initializeGame();
});