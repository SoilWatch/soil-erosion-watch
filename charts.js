// ****************************************************************************************************************** //
// ************************* Module generating the panel charts for the Soil Erosion App GUI ************************ //
// ****************************************************************************************************************** //

// Function to generate area pie chart breaking down observed bare surfaces from vegetated surfaces
exports.areaChart = function(img, band_name, geom, options){
  // Compute the count of pixels observed bare < 95% of time
  var bs_area = ee.Number(img.updateMask(img.lt(0.95)).reduceRegion({
                            geometry: geom,
                            scale: 100,
                            reducer: ee.Reducer.count(),
                            maxPixels: 1e13,
                            tileScale: 4
                          }).get(band_name));

  // Compute the count of pixels observed > 95 % of time
  var bs_area_perm = ee.Number(img.updateMask(img.gte(0.95)).reduceRegion({
                                geometry: geom,
                                scale: 100,
                                reducer: ee.Reducer.count(),
                                maxPixels: 1e13,
                                tileScale: 4
                               }).get(band_name));

  // Compute the total area based on the unmasked image of the area
  var total_area = ee.Number(img.unmask(0).clip(geom)
                             .reduceRegion({
                                geometry: geom,
                                scale: 100,
                                reducer: ee.Reducer.count(),
                                maxPixels: 1e13,
                                tileScale: 4
                             }).get(band_name));

  var bs_freq_area = bs_area.divide(total_area); // % of bare areas < 95%
  var bs_freq_area_perm = bs_area_perm.divide(total_area); // % of bare area > 95%
  var true_total_area = geom.area().divide(100).round().divide(100); // true area based on geometry

  // Adjusted areas using the true total area, to avoid biased surface area estimations from pixel counting. See:
  // Gallego, F. Javier. "Remote sensing and land cover area estimation."
  // International Journal of Remote Sensing 25.15 (2004): 3019-3047.
  var true_bs_area = true_total_area.multiply(bs_freq_area).round();
  var true_perm_area = true_total_area.multiply(bs_freq_area_perm).round();

  // Compile results in a feature collection for plotting
  var area_fc = ee.FeatureCollection([
  ee.Feature(null, {area_type: 'never observed bare', area: true_total_area
                                                            .subtract(true_bs_area).subtract(true_perm_area)}),
  ee.Feature(null, {area_type: 'observed bare < 95% of time', area: true_bs_area}),
  ee.Feature(null, {area_type: 'observed bare > 95% of time', area: true_perm_area})
  ]);

  // Create the summary pie chart.
  var area_chart = ui.Chart.feature.byFeature({
      features: area_fc,
      xProperty: 'area_type',
      yProperties: ['area']
    })
    .setChartType('PieChart')
    .setOptions(options);

  return area_chart
};

// Function to generate custom histograms from input images
exports.customHistogram = function(img, band_name, geom, series_prop, options, max_buckets, min_bucket_width){

  max_buckets = max_buckets || null;
  min_bucket_width = min_bucket_width || null;

  // The result of the region reduction by `autoHistogram` is an array. Get the
  // array and cast it as such for good measure.
  var hist_array = ee.Array(img.reduceRegion({
      reducer: ee.Reducer.autoHistogram({maxBuckets:max_buckets, minBucketWidth: min_bucket_width}),
      geometry: geom,
      scale: 100,
      maxPixels: 1e13,
      tileScale: 4
  }).get(band_name));

  var features = ee.FeatureCollection(hist_array.toList().map(function(pair) {
    pair = ee.List(pair);
    return ee.Feature(null, {
        'x': pair.get(0),
        'y': pair.get(1),
        'label': band_name
      })
  }));

  // Chart the two arrays using the `ui.Chart.array.values` function.
  var hist_chart = ui.Chart.feature.groups({
    features: features,
    xProperty: 'x',
    yProperty: 'y',
    seriesProperty: series_prop})
    //.setSeriesNames([band_name])
    .setOptions(options);

  return hist_chart
};
