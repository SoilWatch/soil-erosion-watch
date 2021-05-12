// ****************************************************************************************************************** //
// ******* Module providing a set of Tools to draw shapes and extract statistics for the Soil Erosion App GUI ******* //
// ****************************************************************************************************************** //

var S2Composites = require('users/soilwatch/soilErosionApp:s2_composites.js');
var utils =  require('users/soilwatch/soilErosionApp:utils.js');

// Function to initialize drawing tools, namely a control panel with widget, and the drawing options behind those
// Courtesy of Justin Braaten and his great tutorial(s):
// https://developers.google.com/earth-engine/tutorials/community/drawing-tools-region-reduction
exports.initializeDrawingTools = function(){

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
  var drawingTools = Map.drawingTools();
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

  // Extracted Harmonized time series with 15 days interval, resulting in 24 composites in the span of a year.
  var s2_ts = S2Composites.S2HarmonizedTS(image_collection, band_list, date_range, 15, geom); // cloud-masked timeseries
  var s2_bsts = S2Composites.S2HarmonizedTS(bs_collection, band_list, date_range, 15, geom); // GEOS3 masked timeseries

  // Run a harmonic regression on the time series to fill missing data gaps and smoothen the NDVI profile.
  var s2_ts_smooth = S2Composites.S2HarmonicRegression(s2_ts.select('fcover'), 'fcover', 4, geom)
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
exports.drawPlot = function(img, plot_series, geom, year){
  // Extract the centroid of the geometry, so as to be able to assign lat/lon coordinates to drawn plots.
  var pt = geom.centroid(0.001);

  // Reduction scale is based on map scale to avoid memory/timeout errors.
  var map_scale = Map.getScale();
  var scale = map_scale > 100 ? 100 : 10;

  // Generate plot title
  var pt_title = year + ', centroid coordinates (lon/lat): '
                  + ee.Number(pt.coordinates().get(0)).multiply(1e6).round().divide(1e6).getInfo() + ', '
                  + ee.Number(pt.coordinates().get(1)).multiply(1e6).round().divide(1e6).getInfo();
  Map.addLayer(ee.FeatureCollection([ee.Feature(geom, {})]).draw({color: '#FF0000', strokeWidth: 10}),{}, pt_title);

  // Get the crop signature from the reference data points using reduceRegion on the original NDVI time series
  var y = plot_series[0].reduceRegion(ee.Reducer.mean(), geom, scale).values();
  // Fitted (harmonics) Time series
  var y_bs = plot_series[1].reduceRegion(ee.Reducer.mean(), geom, scale).values()
            // Convert null values to 11000, outside of the data range, so they do not show in the plot.
            .map(function(val){return ee.Number(ee.Algorithms.If(val, val, 11000))})//.slice(0, -1);
  // And the x-axis labels (day of year).
  var x_labels = plot_series[2].reduceRegion(ee.Reducer.median(), geom, scale).values()//.slice(1);

  // Generate the y-axis values
  var y_values = ee.Array.cat([y, y_bs], 1);

  // Plot chart
  var chart = ui.Chart.array.values(y_values, 0, x_labels)
  .setSeriesNames(['FCover_smoothened', 'bare_soil_observed'])
  .setOptions(
    {
      title: pt_title,
      hAxis: {title: 'Day of Year', viewWindow: {min: 0, max: 365}},
      vAxis: {title: 'FCover', viewWindow: {min: 0, max: 10000}},
      legend: null,
      series: {
        0: {lineWidth: 2, pointSize: 0, color: 'green' },
        1: {lineWidth: 0, pointSize: 5, color: 'brown' }
      }
    });

  // Generate additional statistics using a mean reducer
  var reduced_vals = ee.List(img.reduceRegion(ee.Reducer.mean(), geom, scale).values())
                    // dirty trick to round to 3 numbers after decimal
                    .map(function(val){return ee.Number(val).multiply(1000).round().divide(1000)});

  return [chart, reduced_vals];
};
