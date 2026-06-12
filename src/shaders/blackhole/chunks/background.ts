export const BACKGROUND_CHUNK = `
  // ================================================================
  // PHOTOREALISTIC OUTER SPACE
  //
  // Features:
  //   - Logarithmic spiral arm structure (4 arms with noise perturbation)
  //   - Star clustering via noise-modulated density thresholds
  //   - Domain-warped nebula with filamentary H-alpha/O-III structure
  //   - Weighted spectral distribution (more K/M dwarfs than O/B giants)
  //   - Galactic bulge concentration toward galactic center
  //   - Subtle proper motion over time
  //   - Anti-aliased star edges via fractional cell coordinates
  //   - Bright-star twinkle
  //   - Dark dust lanes with fractal extinction
  // ================================================================

  // Convert direction vector to approximate galactic coordinates
  // Returns (latitude, longitude) where latitude=0 is galactic plane
  vec2 toGalactic(vec3 dir) {
    // Galactic plane is tilted ~60 degrees relative to equatorial
    // We use a simplified rotation to align the Milky Way
    float lat = abs(dir.y * 0.5 + dir.z * 0.866);
    float lon = atan(dir.x, dir.y * 0.866 - dir.z * 0.5);
    return vec2(lat, lon);
  }

  // Spiral arm density factor: returns 0-1 multiplier for star density
  // based on galactic longitude and latitude. Models the Milky Way's
  // 4-arm logarithmic spiral structure with noise perturbation.
  float spiralArms(vec3 dir) {
    vec2 gal = toGalactic(dir);
    float lat = gal.x;
    float lon = gal.y;

    // Log spiral: r = a * exp(b * theta)
    // For Milky Way, arms follow approximately:
    //   arm 0: theta_0 = 0
    //   arm 1: theta_1 = pi/2
    //   arm 2: theta_2 = pi
    //   arm 3: theta_3 = 3*pi/2
    // With pitch angle ~12 degrees (b = cot(pitch) ≈ 4.7)
    float pitch = 4.7;
    float r_gc = 1.0 + abs(lat) * 5.0; // distance from galactic center proxy

    // Compute arm alignment: cos of angular distance to nearest arm
    float armFactor = 0.0;
    for (int i = 0; i < 4; i++) {
      float armTheta = float(i) * 1.5708; // pi/2 spacing
      float spiralAngle = lon - armTheta - pitch * log(r_gc + 0.1);
      float arm = cos(spiralAngle);

      // Widen arms in outer galaxy, narrow near center
      float armWidth = 0.6 + 0.4 * r_gc;
      armFactor = max(armFactor, arm * arm / (armWidth * armWidth));
    }
    armFactor = clamp(armFactor, 0.0, 1.0);

    // Perturb arms with noise for natural waviness
    vec3 noisePos = dir * 2.5 + vec3(1.3, 0.7, 0.5);
    float armWobble = noise(noisePos) * 0.3 + 0.85;

    // Combine with latitude falloff (galactic plane concentration)
    float band = exp(-lat * lat * 15.0);

    // Clumping noise for natural irregularity
    float clump = noise(dir * 3.0 + vec3(0.3, 0.8, 0.2)) * 0.25 + 0.75;

    return band * (0.4 + 0.6 * armFactor * armWobble) * clump;
  }

  // Galactic bulge: dense central concentration toward galactic center
  float galacticBulge(vec3 dir) {
    vec2 gal = toGalactic(dir);
    float lat = gal.x;
    float lon = gal.y;

    // Center at lon=0, lat=0 (galactic center direction)
    float distCenter = sqrt(lon * lon * 0.3 + lat * lat * 8.0);
    float bulge = exp(-distCenter * distCenter * 2.5);
    // Add asymmetry (bar structure)
    float barAngle = lon * 0.5;
    float bar = exp(-lat * lat * 10.0) * max(0.0, cos(barAngle));
    return max(bulge, bar * 0.3);
  }

  // Smooth star color from temperature parameter (0=hot blue, 1=cool red)
  vec3 realisticStarColor(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c0 = vec3(0.5, 0.6, 1.0);   // O (blue-white)
    vec3 c1 = vec3(0.7, 0.8, 1.0);   // B (blue-white)
    vec3 c2 = vec3(0.9, 0.9, 1.0);   // A (white)
    vec3 c3 = vec3(1.0, 0.9, 0.8);   // F (yellow-white)
    vec3 c4 = vec3(1.0, 0.8, 0.6);   // G (yellow, like Sun)
    vec3 c5 = vec3(1.0, 0.6, 0.4);   // K (orange)
    vec3 c6 = vec3(1.0, 0.4, 0.3);   // M (red)

    float s = t * 6.0;
    vec3 col;
    if (s < 1.0) col = mix(c0, c1, s);
    else if (s < 2.0) col = mix(c1, c2, s - 1.0);
    else if (s < 3.0) col = mix(c2, c3, s - 2.0);
    else if (s < 4.0) col = mix(c3, c4, s - 3.0);
    else if (s < 5.0) col = mix(c4, c5, s - 4.0);
    else col = mix(c5, c6, s - 5.0);
    return max(col, vec3(0.0));
  }

  // Render stars for one layer at a given grid scale and density threshold.
  // seedOffset is a float added to hash seeds to differentiate layers.
  vec3 starLayer(vec3 dir, float gridScale, float baseThreshold,
                 float brightnessPow, float brightnessScale,
                 float seedOffset) {
    // Star clustering: modulate threshold with noise so stars form
    // natural groupings instead of uniform distribution
    vec3 clusterPos = dir * gridScale * 0.1 + seedOffset * 0.01;
    float clusterNoise = noise(clusterPos) * 0.15;
    float densityThreshold = clamp(baseThreshold - clusterNoise, 0.5, 0.999);

    // Proper motion: subtle time-based offset to hash coordinates
    // Stars appear to drift ~0.1 arcseconds per year; we exaggerate
    // slightly for visual effect (1 arcsec/year = ~1e-5 rad/s)
    // We use a very slow drift that's noticeable over 30+ seconds
    vec3 pmOffset = vec3(
      sin(u_time * 0.001 + seedOffset * 6.28),
      cos(u_time * 0.0008 + seedOffset * 4.13),
      sin(u_time * 0.0006 + seedOffset * 2.71)
    ) * 0.001;

    // Offset grid origin per layer to break up grid alignment patterns.
    // Without this, all layers share perfectly aligned cell boundaries,
    // creating visible square-grid artifacts for larger stars.
    vec3 gridOffset = vec3(
      seedOffset * 0.137,
      seedOffset * 0.089,
      seedOffset * 0.211
    );
    vec3 gridPos = dir * gridScale + pmOffset + gridOffset;
    vec3 cell = floor(gridPos);
    vec3 fractPos = fract(gridPos) - 0.5;

    float sHash = hash(cell + seedOffset);
    if (sHash <= densityThreshold) return vec3(0.0);

    float brightness = pow(sHash, brightnessPow) * brightnessScale;

    // Weighted spectral distribution: bias toward cooler stars
    // Real stellar population is ~75% M dwarfs, ~12% K, ~7% G, etc.
    // We skew temp hash so cooler (red) stars are more common
    float temp = hash(cell + seedOffset + 73.7);
    temp = pow(temp, 1.5); // Skews toward 1.0 (cooler/redder)
    vec3 col = realisticStarColor(temp);

    // Star shape: pure Gaussian with no hard edge.
    // The radius controls the Gaussian spread (sigma).
    // Critically, we guarantee the star fades to zero BEFORE the cell
    // boundary (dist = 0.5), eliminating the square-clipping artifact
    // where a star's circular shape gets truncated by the square cell.
    float dist = length(fractPos);
    float radius = min(0.08 + brightness * 0.035, 0.42);
    float starVal = exp(-(dist * dist) / (2.0 * radius * radius));
    // Bright core spike for a sharp stellar center
    float core = exp(-dist * dist * 150.0);
    starVal = max(starVal, core);

    // Twinkle for brighter stars
    float twinkle = 1.0;
    if (brightness > 0.5) {
      float twinklePhase = hash(cell + seedOffset + 41.3) * 6.28;
      float twinkleSpeed = 1.5 + hash(cell + seedOffset + 89.7) * 3.0;
      twinkle = 0.75 + 0.25 * sin(u_time * twinkleSpeed + twinklePhase);
    }

    // Galactic extinction: dust reddens and dims stars in galactic plane
    vec2 gal = toGalactic(dir);
    float extinction = exp(-gal.x * gal.x * 8.0) * 0.3;
    col *= (1.0 - extinction * 0.4);

    return col * brightness * twinkle * starVal;
  }

  // Domain-warped nebula: uses noise to warp noise coordinates,
  // creating realistic filamentary and wispy structures.
  vec3 renderNebula(vec3 dir) {
    // Warp the input coordinates using noise (domain warping)
    // This creates the characteristic filamentary structure of real nebulae
    vec3 warp1 = vec3(
      fbm(dir * 1.2 + vec3(0.3, 0.7, 0.1)),
      fbm(dir * 1.2 + vec3(0.8, 0.2, 0.5)),
      fbm(dir * 1.2 + vec3(0.4, 0.6, 0.9))
    ) * 0.5;

    vec3 warpedPos = dir * 1.8 + warp1 + u_time * 0.004;
    float n1 = fbm(warpedPos);

    // Second warp for finer detail
    vec3 warp2 = vec3(
      fbm(dir * 2.5 + vec3(0.1, 0.9, 0.3)),
      fbm(dir * 2.5 + vec3(0.6, 0.4, 0.7)),
      fbm(dir * 2.5 + vec3(0.2, 0.8, 0.5))
    ) * 0.3;

    vec3 warpedPos2 = dir * 3.5 + warp2 - u_time * 0.002;
    float n2 = fbm(warpedPos2);

    // Third sample for diffuse continuum
    vec3 warpedPos3 = dir * 5.0 + vec3(0.5, 0.3, 0.7) + u_time * 0.001;
    float n3 = fbm(warpedPos3);

    // H-alpha emission: bright red filaments
    float hAlpha = max(0.0, n1 - 0.35) * 1.8;
    float hAlphaDetail = max(0.0, n2 - 0.4) * 1.2;

    // O-III emission: blue-green patches
    float oIII = max(0.0, n2 - 0.42) * 1.5;

    // Broad continuum from dust scattering
    float continuum = max(0.0, n3 - 0.25) * 0.4;

    vec3 nebulaColor = vec3(0.0);
    // H-alpha: deep red with squared intensity for sharp filaments
    nebulaColor += vec3(0.65, 0.04, 0.01) * hAlpha * hAlpha;
    nebulaColor += vec3(0.55, 0.03, 0.01) * hAlphaDetail;
    // O-III: blue-green
    nebulaColor += vec3(0.03, 0.2, 0.55) * oIII * oIII;
    // Continuum: warm dusty glow
    nebulaColor += vec3(0.2, 0.15, 0.3) * continuum;

    return nebulaColor * 0.18;
  }

  vec3 starfield(vec3 dir) {
    vec3 stars = vec3(0.0);

    // Composite density map: spiral arms + galactic bulge
    float milkyWay = spiralArms(dir);
    float bulge = galacticBulge(dir);

    // === LAYERED STAR DISTRIBUTION ===

    // Star Density Modulation: u_star_density (0-2 range, 1=default)
    // Scales thresholds so fewer/more stars pass the hash check.
    // density=1.0: unchanged; density=0.0: nearly all suppressed;
    // density=2.0: roughly doubled star count.
    float densityFactor = 1.0 - u_star_density;
    float densityOffset = densityFactor * 0.08;

    // Layer 1: Bright stars (rare, warm colors, with twinkle)
    // Density boosted by spiral arms and bulge
    float thresh1 = clamp(0.995 - milkyWay * 0.003 - bulge * 0.01 + densityOffset, 0.5, 0.999);
    stars += starLayer(dir, 180.0, thresh1, 10.0, 4.0, 0.0);

    // Layer 2: Medium stars (moderate density) — reduced ~30%
    float thresh2 = clamp(0.985 - milkyWay * 0.012 - bulge * 0.025 + densityOffset, 0.5, 0.999);
    stars += starLayer(dir, 400.0, thresh2, 18.0, 1.5, 217.3);

    // Layer 3: Dim stars (dense, spiral arm concentrated) — reduced ~30%
    float thresh3 = clamp(0.962 - milkyWay * 0.030 - bulge * 0.040 + densityOffset, 0.5, 0.999);
    stars += starLayer(dir, 800.0, thresh3, 30.0, 0.8, 433.7);

    // Layer 4: Ultra-dim background stars — reduced ~35%
    float thresh4 = clamp(0.930 - milkyWay * 0.040 - bulge * 0.045 + densityOffset, 0.5, 0.999);
    vec3 gridPos4 = dir * 1500.0;
    vec3 cell4 = floor(gridPos4);
    float sHash4 = hash(cell4 + 617.3);
    if (sHash4 > thresh4) {
      float brightness4 = pow(sHash4, 50.0) * 0.3;
      float temp4 = hash(cell4 + 811.7);
      temp4 = pow(temp4, 1.5); // Weight toward cooler stars
      stars += realisticStarColor(temp4) * brightness4;
    }

    // Milky Way unresolved haze: glowing along spiral arms and bulge
    // Reduced ~30% to match lower star count
    float haze = milkyWay * 0.013 + bulge * 0.018;
    stars += vec3(haze * 0.55, haze * 0.45, haze * 0.75);

    // Galactic bulge extra glow (reduced ~30%)
    stars += vec3(0.6, 0.5, 0.3) * bulge * 0.010;

    // Dark dust lanes along galactic plane (fractal extinction)
    vec2 gal = toGalactic(dir);
    float galacticLat = gal.x;
    float dustNoise = fbm(dir * 6.0 + vec3(0.5, 0.2, 0.8));
    float dustLane = exp(-galacticLat * galacticLat * 40.0) * (0.25 + 0.35 * dustNoise);
    stars *= (1.0 - dustLane * 0.55);

    // Nebula emission (additive, after dust)
    stars += renderNebula(dir);

    return stars;
  }
`;
