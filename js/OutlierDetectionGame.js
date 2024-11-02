document.addEventListener("DOMContentLoaded", function () {
    const truePosition = { x: 1000, y: 1000, z: 1000 };
    const userGuesses = new Set();
    let satellites = [];
    let outliers = new Set();
    let includeClockBias = false; // Default to no clock bias
    let trueClockBias = 0; // Default clock bias value
    let numSatellites = 10;
    let outlierProbability = 0.1;
    let currentTime;

    // Observer's geodetic coordinates (latitude, longitude, height)
    const observerGd = {
    latitude: satellite.degreesToRadians(37.7749),  // Example: San Francisco, CA
    longitude: satellite.degreesToRadians(-122.4194),
    height: 0.0  // Height in kilometers
    };

    // Generate a random date within the past year
    function getRandomDateWithinYear() {
        const now = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(now.getFullYear() - 1);
    
        // Generate a random timestamp between one year ago and now
        const randomTimestamp = oneYearAgo.getTime() + Math.random() * (now.getTime() - oneYearAgo.getTime());
        return new Date(randomTimestamp);
    }

    // Function to fetch TLE data (example using CelesTrak)
    async function fetchTLEData() {
    const response = await fetch('https://www.celestrak.com/NORAD/elements/gps-ops.txt');
    const tleData = await response.text();
    return tleData;
    }

    // Function to parse TLE data and compute satellite positions
    async function computeSatellitePositions() {
    const tleData = await fetchTLEData();
    const tleLines = tleData.split('\n').filter(line => line.trim() !== '');
    const satellites = [];

    for (let i = 0; i < tleLines.length; i += 3) {
        const tleLine1 = tleLines[i + 1];
        const tleLine2 = tleLines[i + 2];
        const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
        const positionAndVelocity = satellite.propagate(satrec, currentTime);
        const positionEci = positionAndVelocity.position;
        const gmst = satellite.gstime(currentTime);
        const positionGd = satellite.eciToGeodetic(positionEci, gmst);
        const lookAngles = satellite.ecfToLookAngles(observerGd, satellite.eciToEcf(positionEci, gmst));

        if (lookAngles.elevation > 0) {  // Only include satellites above the horizon
        satellites.push({
            azimuth: satellite.radiansToDegrees(lookAngles.azimuth),
            elevation: satellite.radiansToDegrees(lookAngles.elevation)
        });
        }
    }

    return satellites;
    }
  
    // Difficulty configurations
    const difficultySettings = {
      easy: { numSatellites: 5, outlierProbability: 0.3 },
      medium: { numSatellites: 5, outlierProbability: 0.4 },
      hard: { numSatellites: 5, outlierProbability: 0.5 }
    };
  
    // Event listener to change difficulty settings
    document.getElementById("difficultyLevel").addEventListener("change", function (event) {
      const difficulty = event.target.value;
      const settings = difficultySettings[difficulty];
      numSatellites = settings.numSatellites;
      outlierProbability = settings.outlierProbability;
      initializeGame(); // Reinitialize game with new difficulty
    });
  
    // Event listener for the clock bias checkbox
    document.getElementById("clockBias").addEventListener("change", function (event) {
      includeClockBias = event.target.checked;
      trueClockBias = includeClockBias ? 5 : 0; // Set clock bias value if included
      initializeGame(); // Reinitialize game with new clock bias setting
    });
  
    // Call computeSatellitePositions to get realistic satellite positions
    async function generateSatellites() {
    satellites = [];
    outliers = new Set();
    
    // Fetch and compute satellite positions from TLE data
    const realSatellites = await computeSatellitePositions();

    // Limit the number of satellites based on the chosen difficulty
    realSatellites.slice(0, numSatellites).forEach((sat, i) => {
        const azimuth = sat.azimuth;
        const elevation = sat.elevation;
        const isOutlier = Math.random() < outlierProbability;
        const bias = isOutlier ? 10 + Math.random() * 10 : 0;

        const distance = 20200 + (Math.random() - 0.5) * 1000;
        const x = truePosition.x + distance * Math.cos(azimuth * Math.PI / 180) * Math.cos(elevation * Math.PI / 180);
        const y = truePosition.y + distance * Math.sin(azimuth * Math.PI / 180) * Math.cos(elevation * Math.PI / 180);
        const z = truePosition.z + distance * Math.sin(elevation * Math.PI / 180);

        const trueRange = Math.sqrt((x - truePosition.x) ** 2 + (y - truePosition.y) ** 2 + (z - truePosition.z) ** 2);
        const measurement = trueRange + bias + trueClockBias + (Math.random() - 0.5);

        satellites.push({ id: i, x, y, z, azimuth, elevation, measurement, bias, isOutlier });
        if (isOutlier) outliers.add(i);
    });
    }
  
    // Function to compute residuals based on WLS estimate, including clock bias
    function computeWLS() {
      const initialGuess = { x: 900, y: 900, z: 900, cb: 0 }; // Include initial clock bias estimate
      const estimatedPosition = weightedLeastSquares(satellites, initialGuess);
  
      satellites.forEach(sat => {
        const estimatedRange = Math.sqrt(
          (sat.x - estimatedPosition.x) ** 2 +
          (sat.y - estimatedPosition.y) ** 2 +
          (sat.z - estimatedPosition.z) ** 2
        ) + estimatedPosition.cb; // Include clock bias in range estimate
        sat.residual = sat.measurement - estimatedRange; // Signed residual
      });
    }
  
    // Weighted Least Squares (WLS) function with clock bias estimation
    function weightedLeastSquares(satellites, initialGuess, maxIterations = 10, tolerance = 1e-6) {
      let { x, y, z, cb } = initialGuess;
      for (let iter = 0; iter < maxIterations; iter++) {
        let H = [];
        let W = [];
        let deltaR = [];
  
        satellites.forEach(sat => {
          const rangeEstimate = Math.sqrt((sat.x - x) ** 2 + (sat.y - y) ** 2 + (sat.z - z) ** 2) + cb;
          const residual = sat.measurement - rangeEstimate;
          const weight = 1 / (0.1 + Math.abs(residual));
  
          // Include clock bias column only if enabled
          const row = [(x - sat.x) / rangeEstimate, (y - sat.y) / rangeEstimate, (z - sat.z) / rangeEstimate];
          if (includeClockBias) {
            row.push(1);
          }
          H.push(row);
          W.push(weight);
          deltaR.push(residual);
        });
  
        H = math.matrix(H);
        W = math.diag(W);
        deltaR = math.matrix(deltaR);
  
        const Ht = math.transpose(H);
        
        // Add a small regularization term to the diagonal of HtWH for stability
        const HtWH = math.add(math.multiply(Ht, W, H), math.multiply(math.identity(H.size()[1]), 1e-6));
  
        try {
          const HtWH_inv = math.inv(HtWH);
          const delta = math.multiply(HtWH_inv, Ht, W, deltaR);
  
          x += delta.get([0]);
          y += delta.get([1]);
          z += delta.get([2]);
          if (includeClockBias) cb += delta.get([3]); // Update clock bias estimate only if included
  
          if (math.norm(delta) < tolerance) break;
        } catch (error) {
          console.error("Matrix inversion failed, likely due to a singular matrix:", error);
          break;
        }
      }
      return { x, y, z, cb };
    }
  
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
            userGuesses.has(sat.id) ? 'blue' : sat.residual
          );
  
          Plotly.restyle('skyplotPlotly', {
            'marker.color': [updatedColors]
          });
        });
      });
    }
  
    // Update initializeGame to use async/await for generateSatellites
    async function initializeGame() {
        currentTime = getRandomDateWithinYear(); // Set a new random date each reset
        await generateSatellites();
        computeWLS();
        plotSkyplot();
        document.getElementById("gameResult").innerHTML = ""; // Clear result text
        userGuesses.clear();
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
  
      plotSkyplot(true); // Replot with updated hover text and marker sizes
    });
  
    // Handle "Reset" button to reset the game
    document.getElementById("resetGame").addEventListener("click", () => {
      initializeGame();
    });
  
    // Initial game setup
    initializeGame();
  });