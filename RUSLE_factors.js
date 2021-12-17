// ****************************************************************************************************************** //
// *********** Computing the different parameters of the Revised Universal Soil Loss Equation (RUSLE) *************** //
// ****************************************************************************************************************** //

// Computes the Soil Erodibility Factor K from: Renard, K., Foster, G., Weesies, G., McCool, D. & Yoder, D.
// Predicting Soil Erosion by Water: a Guide to Conservation Planning with
// the Revised Universal Soil Loss Equation (RUSLE) (USDA-ARS, Washington, 1997).
exports.factorK = function(state){

    // Import soil covariate datasets from SoilGrids available under EUPL 1.2 licence:
    // de Sousa, L., Poggio, L., Batjes, N.H., Heuvelink, G.B.M., Kempen, B., Ribeiro, E., Rossiter, D.
    // SoilGrids 2.0: producing quality-assessed soil information for the globe. Under submission to SOIL
    function _lowResInputs(){
      var clay = ee.Image("projects/soilgrids-isric/clay_mean");
      clay = clay.select('clay_0-5cm_mean')
             .add(clay.select('clay_5-15cm_mean'))
             .add(clay.select('clay_15-30cm_mean'))
             .divide(3) // compute the mean between all 3 stratas
             .divide(10) // Convert from g to dag, to express the content in percentage
             .rename('clay');

      var sand = ee.Image("projects/soilgrids-isric/sand_mean");
      sand = sand.select('sand_0-5cm_mean')
             .add(sand.select('sand_5-15cm_mean'))
             .add(sand.select('sand_15-30cm_mean'))
             .divide(3) // compute the mean between all 3 stratas
             .divide(10) // Convert from g to dag, to express the content in percentage
             .clamp(0, 20) // Cap the values to 20% sand, to represent very fine sand particles only
             .rename('sand');

      var silt = ee.Image("projects/soilgrids-isric/silt_mean");
      silt = silt.select('silt_0-5cm_mean')
             .add(silt.select('silt_5-15cm_mean'))
             .add(silt.select('silt_15-30cm_mean'))
             .divide(3) // compute the mean between all 3 stratas
             .divide(10) // Convert from g to dag, to express the content in percentage
             .clamp(0, 70) // Cap the values to 70% silt
             .rename('silt');

      var OM = ee.Image("projects/soilgrids-isric/soc_mean");
      OM = OM.select('soc_0-5cm_mean')
           .add(OM.select('soc_5-15cm_mean'))
           .add(OM.select('soc_15-30cm_mean'))
           .divide(3) // compute the mean between all 3 stratas
           .divide(100) // COnvert from dg to dag, to express the OM content in percentage
           .multiply(1.72) // Scaling factor from SOC to SOM, taken from Simons, G., Koster, R., & Droogers, P. (2020).
                            // HiHydroSoil v2. 0-High Resolution Soil Maps of Global Hydraulic Properties.
           .clamp(0, 4) // Cap values to 4% Organic Matter to avoid underestimation of soil erodibility in OM-rich soils
           .rename('OM');

      var bulk_density = ee.Image("projects/soilgrids-isric/bdod_mean");
      bulk_density = bulk_density.select('bdod_0-5cm_mean')
                     .add(bulk_density.select('bdod_5-15cm_mean'))
                     .add(bulk_density.select('bdod_15-30cm_mean'))
                     .divide(3) // compute the mean between all 3 stratas
                     .divide(100) // Convert from cg/cm³ to t/m³
                     .rename('bulk_density');

      return clay.addBands(sand).addBands(silt).addBands(OM).addBands(bulk_density);
    }

    // Import soil covariate datasets from the Africa Soil and Agronomy Data Cube, under Creative Commons License:
    // Hengl, T., Miller, M. A., Križan, J., Shepherd, K. D., Sila, A., Kilibarda, M., ... & Crouch, J. (2021).
    // African soil properties and nutrients mapped at 30 m spatial resolution using two-scale ensemble machine learning
    // Scientific reports, 11(1), 1-18.
    function _highResInputs(){
      var clay = ee.Image("projects/sat-io/open-datasets/iSDAsoil_Africa_30m/clay_content")
                 .select('b1')
                 .rename('clay');

      var sand = ee.Image("projects/sat-io/open-datasets/iSDAsoil_Africa_30m/sand_content")
                 .select('b1')
                 .clamp(0, 20) // Cap the values to 20% sand, to represent very fine sand particles only
                 .rename('sand');

      var silt = ee.Image("projects/sat-io/open-datasets/iSDAsoil_Africa_30m/silt_content")
                 .select('b1')
                 .clamp(0, 70) // Cap the values to 70% silt
                 .rename('silt');

      var OM = ee.Image("projects/sat-io/open-datasets/iSDAsoil_Africa_30m/carbon_organic")
               .select('b1')
               .divide(10) // COnvert from dg to dag, to express the OM content in percentage
               .multiply(1.72) // Scaling factor from SOC to SOM, taken from Simons, G., Koster, R., & Droogers, P.
                               // (2020). HiHydroSoil v2. 0-High Resolution Soil Maps of Global Hydraulic Properties.
               .clamp(0, 4) // Cap values to 4% Organic Matter to avoid underestimation of erodibility in OM-rich soils
               .rename('OM');

      var bulk_density = ee.Image("projects/sat-io/open-datasets/iSDAsoil_Africa_30m/bulk_density")
                         .select('b1')
                         .rename('bulk_density');

      return clay.addBands(sand).addBands(silt).addBands(OM).addBands(bulk_density).unmask(0);
    }

    var africa_list = ee.List(
                      ['Abyei', 'Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cameroon',
                       'Cape Verde', 'Central African Republic', 'Chad', 'Comoros', 'Congo', "C�te d'Ivoire",
                       'Democratic Republic of the Congo', 'Djibouti', 'Egypt', 'Eritrea', 'Ethiopia',
                       'Equatorial Guinea', 'Gabon', 'Gambia', 'Ghana', 'Guinea', 'Guinea-Bissau', 'Kenya', 'Lesotho',
                       'Liberia', 'Libya', 'Madagascar', 'Malawi', 'Mali', 'Mauritania', 'Mauritius', 'Morocco',
                       'Mozambique', 'Namibia', 'Niger', 'Nigeria', 'Rwanda', 'Sao Tome and Principe', 'Senegal',
                       'Seychelles', 'Sierra Leone', 'Somalia', 'South Africa', 'South Sudan', 'Sudan', 'Swaziland',
                       'Togo', 'Tunisia', 'Uganda', 'United Republic of Tanzania', 'Western Sahara', 'Zambia',
                       'Zimbabwe']);

    var soil_covariates = ee.Image(ee.Algorithms.If(africa_list.contains(state), _highResInputs(), _lowResInputs()));
    var clay = soil_covariates.select('clay');
    var sand = soil_covariates.select('sand');
    var silt = soil_covariates.select('silt');
    var OM = soil_covariates.select('OM');
    var bulk_density = soil_covariates.select('bulk_density');

    // Packing density equation and texture classes taken from: R.J. Jones, G. Spoor, A. Thomasson
    // Vulnerability of subsoils in Europe to compaction: a preliminary analysis,
    // Exp. Impact Prev. Subsoil Compact. Eur. Union, 73 (2003), pp. 131-143
    var pack_density = bulk_density.add(clay.multiply(0.009));

    var texture_class = clay.lt(18).and(sand.gt(65)) // Coarse: 1
                        .add((clay.lt(35).and(sand.gt(15))).or(clay.gt(18).and(sand.gt(65))).multiply(2)) // 2: Medium
                        .add(clay.lt(35).and(sand.lt(15)).multiply(3)) // 3: Medium Fine
                        .add(clay.gte(35).and(clay.lte(60)).multiply(4)) // 4: Fine
                        .add(clay.gt(60).multiply(5)); // 5: Very Fine

    // Adding an organic texture class based on an Organic Matter content is 20%, and clay content is 0%,
    // or when Organic Matter content is 30%, and clay content is 50%. The values in between are linearly interpolated.
    // Organic soil definition taken from: Huang, P. T., Patel, M., Santagata, M. C., & Bobet, A. (2009).
    // Classification of organic soils.
    var organic_soil_test = clay.updateMask(OM.gte(20)).interpolate([0, 50], [20, 30], 'clamp');
    texture_class = texture_class
                    .add(texture_class.eq(0).and(OM.gte(organic_soil_test)).unmask(0).multiply(9)); // 9: Organic

    // Texture and packing density used as proxy for the calculation of the soil structure class, as done in
    // Panagos, P., Meusburger, K., Ballabio, C., Borrelli, P., & Alewell, C. (2014).
    // Soil erodibility in Europe: A high-resolution dataset based on LUCAS.
    // Science of the total environment, 479, 189-200.
    var structure_class = texture_class.eq(1).and(pack_density.lt(1.40)).multiply(4)
                          .add(texture_class.eq(1).and(pack_density.gte(1.40).and(pack_density.lte(1.75))).multiply(3))
                          .add(texture_class.eq(1).and(pack_density.gt(1.75)).multiply(2))
                          .add(texture_class.eq(2).and(pack_density.lt(1.40)).multiply(3))
                          .add(texture_class.eq(2).and(pack_density.gte(1.40).and(pack_density.lte(1.75))).multiply(2))
                          .add(texture_class.eq(2).and(pack_density.gt(1.75)).multiply(2))
                          .add(texture_class.eq(3).and(pack_density.lt(1.40)).multiply(2))
                          .add(texture_class.eq(3).and(pack_density.gte(1.40).and(pack_density.lte(1.75))).multiply(2))
                          .add(texture_class.eq(3).and(pack_density.gt(1.75)).multiply(1))
                          .add(texture_class.eq(4).and(pack_density.lt(1.40)).multiply(2))
                          .add(texture_class.eq(4).and(pack_density.gte(1.40).and(pack_density.lte(1.75))).multiply(1))
                          .add(texture_class.eq(4).and(pack_density.gt(1.75)).multiply(1))
                          .add(texture_class.eq(5).and(pack_density.lt(1.40)).multiply(2))
                          .add(texture_class.eq(5).and(pack_density.gte(1.40).and(pack_density.lte(1.75))).multiply(1))
                          .add(texture_class.eq(5).and(pack_density.gt(1.75)).multiply(1))
                          .add(texture_class.eq(9).and(pack_density.lt(1.40)).multiply(4))
                          .add(texture_class.eq(9).and(pack_density.gte(1.40).and(pack_density.lte(1.75))).multiply(3));

    // Global Hydrologic Soil Groups and Saturated Hydraulic Conductivity Ksat from:
    // Simons, G., Koster, R., & Droogers, P. (2020).
    // HiHydroSoil v2. 0-High Resolution Soil Maps of Global Hydraulic Properties.
    // Under MIT License, courtesy of: Copyright (c) 2021 Samapriya Roy
    var hydrologic_group = ee.Image('projects/sat-io/open-datasets/HiHydroSoilv2_0/Hydrologic_Soil_Group_250m');
    var Ksat = ee.Image('projects/sat-io/open-datasets/HiHydroSoilv2_0/ksat/Ksat_0-5cm_M_250m')
               .add(ee.Image('projects/sat-io/open-datasets/HiHydroSoilv2_0/ksat/Ksat_5-15cm_M_250m'))
               .add(ee.Image('projects/sat-io/open-datasets/HiHydroSoilv2_0/ksat/Ksat_15-30cm_M_250m'))
               .divide(3)
               .divide(1e4); // 10 000 scaling factor applied to the ksat dataset

    var cfvo = ee.Image('projects/soilgrids-isric/cfvo_mean');
    cfvo = cfvo.select('cfvo_0-5cm_mean')
           .add(cfvo.select('cfvo_5-15cm_mean'))
           .add(cfvo.select('cfvo_15-30cm_mean'))
           .divide(3) // compute the mean between all 3 stratas
           .divide(10000); // Convert from per10000 to [0,1] range

    // Adjusted Satured Hydraulic Conductivity from:
    // Brakensiek, D. L., Rawls, W. J., & Stephenson, G. R. (1986).
    // Determining the saturated hydraulic conductivity of a soil containing rock fragments.
    // Soil Science Society of America Journal, 50(3), 834-835.
    Ksat = Ksat.multiply(ee.Image(1).subtract(cfvo));

    // Mapping Global Hydrologic Soil Groups to their permeability class equivalents,
    // from high run-off potential (=~ low permeability), to low run-off potential (=~ high permeability).
    // Taken from: USDA (1983) National Soil Survey Handbook. No. 430, US Department of Agriculture, USDA, Washington DC
    var permeability_class = Ksat.gt(146.304).and(hydrologic_group.eq(1)) // 1: Fast and very fast
                             .add(Ksat.lte(146.304).and(Ksat.gt(48.768))
                             .and(hydrologic_group.eq(1).or(hydrologic_group.eq(14))).multiply(2)) // 2. Moderate fast
                             .add(Ksat.lte(48.768).and(Ksat.gt(12.192))
                             .and(hydrologic_group.eq(2).or(hydrologic_group.eq(24))).multiply(3)) // 3: Moderate
                             .add(Ksat.lte(12.192).and(Ksat.gt(4.8768))
                             .and(hydrologic_group.eq(3)).multiply(4)) // 4: Moderate low
                             .add(Ksat.lte(4.8768).and(Ksat.gt(2.4384))
                             .and(hydrologic_group.eq(34)).multiply(5)) // 5: Slow
                             .add(Ksat.lte(2.4384)
                             .and(hydrologic_group.eq(4)).multiply(6)); // 6: Very Slow

    var M = sand.add(silt).multiply(ee.Image(100).subtract(clay)).rename('M'); // Textural factor M

    // Soil Erodibility factor K final equation
    var K = ee.Image(2.1).multiply(1e-4).multiply(M.pow(1.14)).multiply(ee.Image(12).subtract(OM))
            .add(ee.Image(3.25).multiply(structure_class.subtract(2)))
            .add(ee.Image(2.5).multiply(permeability_class.subtract(3)))
            .divide(100)
            .multiply(0.1317); // Convert from US customary unit to the SI metric unit.
    return K
};

// Retrieves the Global Rainfall Erosivity factor R taken from: Panagos, Panos, et al.
// "Global rainfall erosivity assessment based on high-temporal resolution rainfall records."
// Scientific reports 7.1 (2017): 1-12.
// The data stored in GEE assets is not exposed publicly due to strict terms of usage of ESDAC,
// whereby the data can under NO CIRCUMSTANCES be passed to third parties. It can be requested at the following link:
// https://esdac.jrc.ec.europa.eu/content/global-rainfall-erosivity#tabs-0-description=1
exports.factorR = function(){
    var R = ee.Image('users/soilwatch/GlobalRainfallErosivity2010');

    return R
};

// Retrieves the Slope Length (L) and Slope Steepness (S) factors and combines them into a single LS factor.
exports.factorLS = function(slope_deg, slope_rad, slope_aspect){
    // Import upstream drainage area (referred to as contributing or accumulated area in soil erosion studies) from:
    // Yamazaki D., D. Ikeshima, J. Sosa, P.D. Bates, G.H. Allen, T.M. Pavelsky.
    // MERITHydro:A high-resolution global hydrography map based on latest topography datasets Water Resources Research,
    // vol.55, pp.5053-5073, 2019
    var contrib_area = ee.Image("MERIT/Hydro/v1_0_1").select('upa')
                       .multiply(1000000) // convert to m²
                       .reproject({crs:'EPSG:4326', scale: 30}) // Upsample to 30m to match resolution of AW3D30 DEM.
                       .divide(9) // Divide by 9 to redistribute contributing area from a 90m pixel to a 30m pixel.
                       .clamp(0,4000); // Ignore contributing areas larger than 4000m², typical for soil erosion studies
                                       // For instance: Zhang, Hongming, et al. An improved method for calculating
                                       // slope length (λ) and the LS parameters of the Revised Universal Soil Loss
                                       // Equation for large watersheds. Geoderma 308 (2017):36-45

    // Calculate the slope direction, either 1 for 4-neighbours, or sqrt(2) for diagonal neighbours.
    var slope_direction = slope_aspect.gt(337.5).and(slope_aspect.lte(360))
                                                .or(slope_aspect.gte(0).and(slope_aspect.lte(22.5))).multiply(1)
                          .add(slope_aspect.gt(22.5).and(slope_aspect.lte(77.5)).multiply(ee.Image(2).sqrt()))
                          .add(slope_aspect.gt(77.5).and(slope_aspect.lte(112.5)).multiply(1))
                          .add(slope_aspect.gt(112.5).and(slope_aspect.lte(157.5)).multiply(ee.Image(2).sqrt()))
                          .add(slope_aspect.gt(157.5).and(slope_aspect.lte(202.5)).multiply(1))
                          .add(slope_aspect.gt(202.5).and(slope_aspect.lte(247.5)).multiply(ee.Image(2).sqrt()))
                          .add(slope_aspect.gt(247.5).and(slope_aspect.lte(292.5)).multiply(1))
                          .add(slope_aspect.gt(292.5).and(slope_aspect.lte(337.5)).multiply(ee.Image(2).sqrt()));

    // Rill to interrill erosion factor beta of the Slope length factor L
    var beta = slope_rad.sin()
               .divide(0.0896)
               .divide(ee.Image(3).multiply(slope_rad.sin().pow(0.8).add(0.56)).abs());
    // Slope exponential factor m related to beta
    var m = beta.divide(beta.add(1));

    // Calculation of the slope length (L) and slope steepness (S) factor following: Desmet, P.; Govers, G.
    // A GIS procedure for automatically calculating the ULSE LS factor on topographically complex landscape units.
    //J. Soil Water Conserv. 1996, 51, 427–433.
    var L = ee.Image(2).multiply(contrib_area) // numerator
            //.add(ee.Image(900)) // The contributing area from MERIT Hydro is already calculated at the outlet,
            // so no need to add the grid cell area
            .divide(ee.Image(2).multiply(30).multiply(slope_direction).multiply(22.13)) // denominator
            .pow(m)
            .multiply(m.add(1));

    // Computing the Slope Steepness factor S from: Renard, K., Foster, G., Weesies, G., McCool, D. & Yoder, D.
    // Predicting Soil Erosion by Water: a Guide to Conservation Planning with
    // the Revised Universal Soil Loss Equation (RUSLE) (USDA-ARS, Washington, 1997).
    var S = ee.Algorithms.If(slope_rad.tan().lt(0.09), // Convert slope in radian to steepness (in %)
                             slope_rad.sin().multiply(10.8).add(0.03), // Mild slope condition < 9 %
                             slope_rad.sin().multiply(16.8).subtract(0.5)); // Steep slope condition >= 9%

    return L.multiply(S)
};

// Retrieves the so-called Sustainability Factor S = 1 / (V*L) ,
// the inverse of the C and P factors of the original RUSLE, to draw contrast with the other erosion-inducing factors
exports.factorS = function(median_image, bs_freq, fcover_ts, sr_band_scale){

  sr_band_scale = sr_band_scale || 1;

  // Landscape factor L, computed as per Karydas & Panagos, 2018, using Sobel 3x3 edge-detection kernel for convolution
  // This increases the importance of intra-field features such as trees, fences, hedgerows, etc,
  // thus providing protection against soil erosion.
  var L = ee.Image(1).add(median_image.select('B8').convolve({kernel: ee.Kernel.sobel()}).abs()
          .add(median_image.select('B8').convolve({kernel: ee.Kernel.sobel().rotate(1)})).abs()
          .divide(sr_band_scale).sqrt());

  // The monthly vegetation factor V, defined as per Karydas & Panagos, 2018,
  // was computed for each month in the specified time interval and the integral was calculated over the time period.
  // Bare soil frequency data scaled and clamped to the range [5,8]
  // was used as proxy for the land use parameter, to simulate the range of conditions from
  // a degraded cropland (high bare soil frequency, 5) to a sustainably managed grassland (low bare soil frequency, 8).
  var fcover_arr = fcover_ts.toArray();

  var pw_mean = fcover_arr.arraySlice(0,1).add(fcover_arr.arraySlice(0,0,-1)).divide(2);
  var fcover_integ = pw_mean.arrayReduce('mean',[0]).abs().toArray()
                            .arraySlice(0, 0, 1).arrayProject([0]).arrayFlatten([['array']]);

  var V = ee.Image(1).subtract(bs_freq).multiply(10).clamp(5, 8).multiply(fcover_integ.divide(sr_band_scale)).exp();
  // The final Sustainability Factor S = 1 / (V*L)
  var S = ee.Image(1).divide(L.multiply(V)).rename('sustainability_factor');

  return S
};
