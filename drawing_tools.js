// ****************************************************************************************************************** //
// ******* Module providing a set of Tools to draw shapes and extract statistics for the Soil Erosion App GUI ******* //
// ****************************************************************************************************************** //

var composites = require('users/soilwatch/soilErosionApp:composites.js');
var utils =  require('users/soilwatch/soilErosionApp:utils.js');

// Function to initialize drawing tools, namely a control panel with widget, and the drawing options behind those
// Courtesy of Justin Braaten and his great tutorial(s):
// https://developers.google.com/earth-engine/tutorials/community/drawing-tools-region-reduction
exports.initializeDrawingTools = function(options){

  var map_name = options.map_name || Map;

  function clearGeometry() {
    var layers = drawingTools.layers();
    layers.get(0).geometries().remove(layers.get(0).geometries().get(0));
  }

  function drawRectangle() {
    clearGeometry();
    drawingTools.setShape('rectangle');
    drawingTools.draw();
  }

  function drawPolygon() {
    clearGeometry();
    drawingTools.setShape('polygon');
    drawingTools.draw();
  }

  function drawPoint() {
    clearGeometry();
    drawingTools.setShape('point');
    drawingTools.draw();
  }

  var symbol = {
    rectangle: '⬛',
    polygon: '🔺',
    point: '📍',
  };

  // Initialize the drawing tools panel to display in the GUI
  var controlPanel = ui.Panel({
    widgets: [
      ui.Label('Drill-down Tool', {fontWeight: 'bold'}),
      ui.Label('1. Select a drawing mode.'),
      ui.Button({
        label: symbol.rectangle + ' Rectangle',
        onClick: drawRectangle,
        style: {stretch: 'horizontal'}
      }),
      ui.Button({
        label: symbol.polygon + ' Polygon',
        onClick: drawPolygon,
        style: {stretch: 'horizontal'}
      }),
      ui.Button({
        label: symbol.point + ' Point',
        onClick: drawPoint,
        style: {stretch: 'horizontal'}
      }),
      ui.Label('2. Draw a geometry.'),
      ui.Label('3. Wait for chart to render.'),
      ui.Label(
          '4. Repeat 1-3 or edit/move\ngeometry for a new chart.'
          )
    ],
    style: {position: 'bottom-right',
            fontSize: '10px',
            width: '145px'
    },
    layout: null,
  });

  // Hide default drawing tool, so we can display a customized version
  var drawingTools = map_name.drawingTools();
  drawingTools.setShown(false);

  // Clear all existing geometries that have been added as imports from drawing tools
  while (drawingTools.layers().length() > 0) {
    var layer = drawingTools.layers().get(0);
    drawingTools.layers().remove(layer);
  }

  // Initialize a dummy GeometryLayer with null geometry to act as a placeholder for drawn geometries
  var dummyGeometry =
      ui.Map.GeometryLayer({geometries: null, name: 'geometry', color: '23cba7'});

  drawingTools.layers().add(dummyGeometry);

  return [drawingTools, controlPanel];
};

// Function to generate the series to be used as input to point- or area-based time series plotting
exports.preparePlotSeries = function(image_collection, bs_collection, geom, from_date, date_range, band_list){

  var time_intervals = composites.extractTimeRanges(date_range.get('start'), date_range.get('end'), 15);

  // Extracted Harmonized time series with 15 days interval, resulting in 24 composites in the span of a year.
  var s2_ts = composites.harmonizedTS(image_collection, band_list, time_intervals, {agg_type: 'geomedian'})
                        .map(function(img){return img.toInt16().clip(geom)}); // cloud-masked timeseries
  var s2_bsts = composites.harmonizedTS(bs_collection, band_list, time_intervals, {agg_type: 'geomedian'})
                          .map(function(img){return img.toInt16().clip(geom)}); // GEOS3 masked timeseries

  // Run a harmonic regression on the time series to fill missing data gaps and smoothen the NDVI profile.
  var s2_ts_smooth = composites.harmonicRegression(s2_ts.select('fcover'), 'fcover', 4)
                                                                 // clamping to data range,
                                                                 // as harmonic regression may shoot out of data range
                                                                 .map(function(img){return img.clamp(0, 1e4).toInt16()});

  // Format the series to suit the ui.Chart.array.values() GEE method
  var VI_series = s2_ts_smooth.select('fitted').toList(s2_ts_smooth.size()).reverse();
  var VI_series_bs = s2_bsts.select('fcover').toList(s2_bsts.size()).reverse();
  var doy_series = s2_ts.map(utils.addDOY(from_date)).select('doy').toList(s2_ts.size()).reverse();
  var VI_plot = ee.Image(VI_series.slice(1).iterate(_stack, VI_series.get(0)));
  var VI_plot_bs = ee.Image(VI_series_bs.slice(1).iterate(_stack, VI_series_bs.get(0)));
  var doy_plot = ee.Image(doy_series.slice(1).iterate(_stack, doy_series.get(0))).toInt16();

  return [VI_plot, VI_plot_bs, doy_plot];
};

// Convert image collection to single image with multiple bands.
function _stack (i1, i2)
{
  return ee.Image(i1).addBands(ee.Image(i2))
}

// Draw the time series plot from a set of input series corresponding to custom drawn geometries
exports.drawPlot = function(img, plot_series, geom, year, options){
  
  var map_name = options.map_name || Map;

  // Extract the centroid of the geometry, so as to be able to assign lat/lon coordinates to drawn plots.
  var pt = geom.centroid(0.001);

  // Reduction scale is based on map scale to avoid memory/timeout errors.
  var map_scale = map_name.getScale();
  var scale = map_scale > 100 ? 100 : 10;

  // Generate plot title
  var pt_title = year + ', centroid coordinates (lon/lat): '
                  + ee.Number(pt.coordinates().get(0)).multiply(1e6).round().divide(1e6).getInfo() + ', '
                  + ee.Number(pt.coordinates().get(1)).multiply(1e6).round().divide(1e6).getInfo();
  map_name.addLayer(ee.FeatureCollection([ee.Feature(geom, {})]).draw({color: '#FF0000', strokeWidth: 10}),{}, pt_title);
  
  var plot_colors = ['e41a1c', '377eb8', '4daf4a', '984ea3', 'ff7f00', 'ffff33', 'a65628', 'f781bf', '999999'];

  var y_list = ee.List([]);
  var y_legend = ee.List([]);
  var y_series = {};
  for (var i = 0; i <= plot_series.length-3; i++){
    // Get the crop signature from the reference data points using reduceRegion on the original NDVI time series
    var y = plot_series[i].reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: scale,
                                           maxPixels: 1e13, tileScale: 4}).values();
    y_list = y_list.add(y);
    y_legend = y_legend.add('FCover_smoothened_'+i);
    y_series[i] = {lineWidth: 2, pointSize: 0, color: plot_colors[i]};
  }
  y_series[plot_series.length-2] = {lineWidth: 0, pointSize: 5, color: 'brown' };

  // Fitted (harmonics) Time series
  var y_bs = plot_series[plot_series.length-2].reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: scale,
                                                             maxPixels: 1e13, tileScale: 4}).values()
             // Convert null values to 11000, outside of the data range, so they do not show in the plot.
             .map(function(val){return ee.Number(ee.Algorithms.If(val, val, 11000))})//.slice(0, -1);
  // And the x-axis labels (day of year).
  var x_labels = plot_series[plot_series.length-1].reduceRegion({reducer: ee.Reducer.median(), geometry: geom, scale: scale,
                                                                 maxPixels: 1e13, tileScale: 4}).values()//.slice(1);

  // Generate the y-axis values
  var y_values = ee.Array(y_list.add(y_bs)).transpose();
  
  y_legend = y_legend.add('bare_soil_observed');
  // Plot chart
  var chart = ui.Chart.array.values(y_values, 0, x_labels)
  .setSeriesNames(y_legend)
  .setOptions(
    {
      title: pt_title,
      hAxis: {title: 'Day of Year', viewWindow: {min: 0, max: 365}},
      vAxis: {title: 'FCover', viewWindow: {min: 0, max: 10000}},
      legend: null,
      series: y_series
    });

  // Generate additional statistics using a mean reducer
  var reduced_vals = ee.List(img.reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: scale,
                                               maxPixels: 1e13, tileScale: 4}).values())
                    // dirty trick to round to 3 numbers after decimal
                    .map(function(val){return ee.Number(val).multiply(1000).round().divide(1000)});

  return [chart, reduced_vals];
};
