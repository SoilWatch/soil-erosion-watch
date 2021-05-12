// ****************************************************************************************************************** //
// **************************************** Main Soil Erosion Watch App Module ************************************** //
// ****************************************************************************************************************** //

// Import external app dependencies
var cld = require('users/fitoprincipe/geetools:cloud_masks');
var palettes = require('users/gena/packages:palettes');

// Import local app dependencies
var S2Masks = require('users/soilwatch/soilErosionApp:s2_masks.js');
var S2FCover = require('users/soilwatch/soilErosionApp:s2_fcover.js');
var S2Composites = require('users/soilwatch/soilErosionApp:s2_composites.js');
var legends = require('users/soilwatch/soilErosionApp:legends.js');
var drawingTools = require('users/soilwatch/soilErosionApp:drawing_tools.js');
var RUSLEFactors = require('users/soilwatch/soilErosionApp:RUSLE_factors.js');
var charts = require('users/soilwatch/soilErosionApp:charts.js');
var utils = require('users/soilwatch/soilErosionApp:utils.js');

// Import external mask datasets
var not_water = ee.Image("JRC/GSW1_2/GlobalSurfaceWater").select('max_extent').eq(0); // JRC Global Surface Water mask
var jrc_builtup = ee.Image("JRC/GHSL/P2016/BUILT_LDSMT_GLOBE_V1"); // JRC global human settlement layer

// Facebook Population Layer under MIT License, courtesy of: Copyright (c) 2021 Samapriya Roy
var facebook_builtup = ee.ImageCollection("projects/sat-io/open-datasets/hrsl/hrslpop");

// Combine JRC builtup and facebook population as builtup mask
var not_builtup = jrc_builtup.select('built').gt(2)
                  .bitwiseOr(facebook_builtup.mosaic().unmask(0).gt(1))
                  .not();

// The default country in the App display is Kenya
var county = ee.FeatureCollection("FAO/GAUL/2015/level0")
             .filterMetadata('ADM0_NAME', 'equals', 'Kenya').first();

// Compute the low-resolution factors (based on 30-250m covariates) of the RUSLE equation
var K = RUSLEFactors.factorK('Kenya');
var R = RUSLEFactors.factorR();

// Import ALOS AW3D30 latest DEM version v3.2
var dem = ee.ImageCollection("JAXA/ALOS/AW3D30/V3_2").select("DSM");
dem = dem.mosaic().setDefaultProjection(dem.first().select(0).projection());

var slope_deg = ee.Terrain.slope(dem);
var slope_rad = slope_deg.multiply(ee.Image(Math.PI).divide(180));
var slope_aspect = ee.Terrain.aspect(dem);
var LS = RUSLEFactors.factorLS(slope_deg, slope_rad, slope_aspect);

// **Initialize the Button Widgets for the Soil Erosion App GUI **/
// Load states in drop-down menu.
var statesDD = ui.Select([], 'Select Country');
var countiesDD = ui.Select([], 'Select Admin Area Level 1');
var subcountiesDD = ui.Select([], 'Select Admin Area Level 2');

// Load full administrative units list
var states = ee.FeatureCollection("FAO/GAUL/2015/level0").distinct('ADM0_NAME').sort('ADM0_NAME');
var statesNames = states.aggregate_array('ADM0_NAME');
var counties = ee.FeatureCollection("FAO/GAUL/2015/level1");
var subcounties = ee.FeatureCollection("FAO/GAUL/2015/level2");

// Automatically update drop-down menus based on administrative unit selection
statesNames.evaluate(function(states){
  statesDD.items().reset(states)
  statesDD.setPlaceholder('Select a country')
  statesDD.onChange(function(state){
    // once you select a state (onChange) get all counties and fill the dropdown
    countiesDD.setPlaceholder('Loading...')
    var counties = _getCounties(state);
    counties.evaluate(function(countiesNames){
      countiesDD.items().reset(countiesNames)
      countiesDD.setPlaceholder('Select a level 1 sub-administration')
      countiesDD.onChange(function(substate){
        // once you select a county (onChange) get all sub-counties and fill the dropdown
        subcountiesDD.setPlaceholder('Loading...')
        var subcounties = _getSubcounties(substate);
        subcounties.evaluate(function(countiesNames){
        subcountiesDD.items().reset(countiesNames)
        subcountiesDD.setPlaceholder('Select a level 2 sub-administration')
        });
      });
    });
  });
});

// Filter the counties list to retrieve the ones matching the selected state
function _getCounties(state){
  // Given a state get all counties
  var feat = ee.Feature(states.filterMetadata('ADM0_NAME', 'equals', state).first());
  var statefp = ee.String(feat.get('ADM0_NAME'));
  var filteredCounties = counties.filterMetadata('ADM0_NAME', 'equals', statefp)
                         .distinct('ADM1_NAME').sort('ADM1_NAME', false);
  var filteredCountiesNames = filteredCounties.aggregate_array('ADM1_NAME');

  return filteredCountiesNames.add(state).reverse()
}

// Filter the sub-counties list to retrieve the ones matching the selected county
function _getSubcounties(state){
  // Given a state get all counties
  var feat = ee.Algorithms.If(
             ee.Number(counties.filterMetadata('ADM1_NAME', 'equals', state).size()).gt(0),
             ee.Feature(counties.filterMetadata('ADM1_NAME', 'equals', state).first()),
             ee.Feature(states.filterMetadata('ADM0_NAME', 'equals', state).first()).set({'ADM1_NAME': state})
             );
  var statefp = ee.String(ee.Feature(feat).get('ADM1_NAME'))
  var filteredCounties = subcounties.filterMetadata('ADM1_NAME', 'equals', statefp)
                         .filterMetadata('ADM0_NAME', 'equals', statesDD.getValue())
                         .distinct('ADM2_NAME').sort('ADM2_NAME', false);
  var filteredCountiesNames = filteredCounties.aggregate_array('ADM2_NAME');

  return filteredCountiesNames.add(state).reverse()
}

// Load years in the drop-down menu.
var yearsDD = ui.Select(['2020'], 'Select Year');

// Allowed years for Sentinel-2 data extraction. No data available before 2016,
// and the L2A surface reflectance information starts in 2019 globally.
var years = ee.Dictionary({'2016': 'COPERNICUS/S2',
                           '2017': 'COPERNICUS/S2',
                           '2018': 'COPERNICUS/S2',
                           '2019': 'COPERNICUS/S2_SR',
                           '2020': 'COPERNICUS/S2_SR',
                           '2021': 'COPERNICUS/S2_SR'
                          });

years.keys().evaluate(function(yearNames){
  yearsDD.items().reset(yearNames)
  yearsDD.setPlaceholder('Select a Year')
});

var periodTypeDD = ui.Select(["5. 12 months"], 'Select Aggregation Interval Type');
var monthsDD = ui.Select([], 'Select Period');

// Define the period types that can be selected in GUI for extracting the Sentinel-2 data.
// Disabled periods inferior to 3 months, as computing RUSLE for periods inferior to a month is not reliable.
// Since the output of RUSLE are annual rates, it is still advised to choose 12 Months as a monitoring period.
var period_types = ee.Dictionary({"1. 1 month": 30,
                                  "2. 2 months": 60,
                                  "3. 3 months": 90,
                                  "4. 6 months": 180,
                                  "5. 12 months": 365
                                 });

// Only month intervals for periods of 1 to 12 months are retained for the drop-down list evaluation.
var months = ee.FeatureCollection(
  [ee.Feature(null, {period_name: "Jan-Dec", period_length: 365, start:'01-01', end: '31-12'}),
  ee.Feature(null, {period_name: "Jan-Jun", period_length: 180, start:'01-01', end: '30-06'}),
  ee.Feature(null, {period_name: "Jun-Dec", period_length: 180, start:'01-07', end:'31-12'}),
  ee.Feature(null, {period_name: "Jan-Mar", period_length: 90, start:'01-01', end: '31-03'}),
  ee.Feature(null, {period_name: "Apr-Jun", period_length:90, start:'01-04', end:'30-06'}),
  ee.Feature(null, {period_name: "July-Sep", period_length:90, start:'01-07', end:'30-09'}),
  ee.Feature(null, {period_name: "Oct-Dec", period_length:90, start:'01-10', end:'31-12'}),
  ee.Feature(null, {period_name: "Jan-Feb", period_length:60, start:'01-01', end:'29-02'}),
  ee.Feature(null, {period_name: "Mar-Apr", period_length:60, start:'01-03', end:'30-04'}),
  ee.Feature(null, {period_name: "May-Jun", period_length:60, start:'01-05', end:'30-06'}),
  ee.Feature(null, {period_name: "Jul-Aug", period_length:60, start:'01-07', end:'31-08'}),
  ee.Feature(null, {period_name: "Sep-Oct", period_length:60, start:'01-09', end:'31-10'}),
  ee.Feature(null, {period_name: "Nov-Dec", period_length:60, start:'01-11', end:'31-12'}),
  ee.Feature(null, {period_name: "January", period_length:30, start:'01-01', end:'31-01'}),
  ee.Feature(null, {period_name: "February", period_length:30, start:'01-02', end:'29-02'}),
  ee.Feature(null, {period_name: "March", period_length:30, start:'01-03', end:'31-03'}),
  ee.Feature(null, {period_name: "April", period_length:30, start:'01-04', end:'30-04'}),
  ee.Feature(null, {period_name: "May", period_length:30, start:'01-05', end:'31-06'}),
  ee.Feature(null, {period_name: "June", period_length:30, start:'01-06', end:'30-06'}),
  ee.Feature(null, {period_name: "July", period_length:30, start:'01-07', end:'31-07'}),
  ee.Feature(null, {period_name: "August", period_length:30, start:'01-08', end:'31-08'}),
  ee.Feature(null, {period_name: "September", period_length:30, start:'01-09', end:'30-09'}),
  ee.Feature(null, {period_name: "October", period_length:30, start:'01-10', end:'31-11'}),
  ee.Feature(null, {period_name: "November", period_length:30, start:'01-11', end:'30-11'}),
  ee.Feature(null, {period_name: "December", period_length:30, start:'01-12', end:'31-12'})
]);

// Load period types in the drop-down menu.
period_types.keys().evaluate(function(imgTypesNames)
{
  periodTypeDD.items().reset(imgTypesNames)
  periodTypeDD.setPlaceholder('Select an Aggregation Interval Type')
  periodTypeDD.onChange(function(period_type){
      // once you select a period type (onChange) get all months and fill the dropdown
      monthsDD.setPlaceholder('Loading...')
      var periods = _getPeriods(period_type);
      periods.evaluate(function(monthNames){
        monthsDD.items().reset(monthNames)
        monthsDD.setPlaceholder('Select a time period')
        });
  });
});

// var date_now = ee.Date(Date.now());

// Filter the corresponding period types based on the select period
function _getPeriods(period){
  // Given a state get all counties
  var filteredPeriods = months.filterMetadata('period_length', 'equals', period_types.get(period));

  return filteredPeriods.aggregate_array('period_name')

  // TODO: Filter out the periods that are in the future
  /*
  .filter(ee.Filter.dateRangeContains(
      ee.DateRange(ee.Date.parse('dd-MM-YYYY',
      ee.String(months.filterMetadata('period_name', 'equals', 'item').first().get('start'))
      .cat(ee.String('-' + yearsDD.getValue()))).format('YYYY-MM-dd'), date_now),
      ee.Date.parse('dd-MM-YYYY',
      ee.String(months.filterMetadata('period_name', 'equals', 'item').first().get('end'))
      .cat(ee.String('-' + yearsDD.getValue()))).format('YYYY-MM-dd')))
  */
}


// Add Button Widget to finalize drop-down menu selections.
var add = ui.Button('Display Area of Interest');

var blog_label = ui.Label({value: '❓ Medium ️Blog Post️', style: {fontWeight: 'bold'}})
.setUrl('https://medium.com/@soilwatch/soil-erosion-watch-a-bootstrapped-approach-to-identify-the-worlds-degrading-soils-45babd656fee');

// Add all buttons to the panel
var panel = ui.Panel([blog_label,
                      statesDD,
                      countiesDD,
                      subcountiesDD,
                      periodTypeDD,
                      yearsDD,
                      monthsDD,
                      add],
                      ui.Panel.Layout.flow('vertical'));

panel.style().set({width: '325px'});

ui.root.add(panel);

// App Title
var title_label = ui.Label({
  value: "Soil Erosion Watch",
  style: {
    fontWeight: 'bold',
    fontSize: '18px',
    margin: '0 0 4px 0',
    padding: '2'
    }
}).setUrl('https://github.com/SoilWatch/soil-erosion-watch');

Map.add(title_label);

// Triggers the retrieval of area-based information based on the selection in the button widgets
add.onClick(function(){
  // Clean-up the map and panel displays when new information is requested
  Map.clear();
  Map.setOptions("TERRAIN");
  panel.widgets().reset(button_widgets);
  Map.add(title_label);
  Map.add(legend);

  // Evaluation of the date range provided through the drop-down menu options
  ee.Dictionary({
    start: ee.Date.parse('dd-MM-YYYY',
      ee.String(months.filterMetadata('period_name', 'equals', monthsDD.getValue()).first().get('start'))
      .cat(ee.String('-' + yearsDD.getValue()))).format('YYYY-MM-dd'),
    end: ee.Date.parse('dd-MM-YYYY',
      ee.String(months.filterMetadata('period_name', 'equals', monthsDD.getValue()).first().get('end'))
      .cat(ee.String('-' + yearsDD.getValue()))).format('YYYY-MM-dd')
  }).evaluate(renderDateRange);
});

// Render data corresponding to the area and date range specified in the drop-down menu options.
function renderDateRange(date_range){

  date_range = ee.Dictionary(date_range);
  // Assign the widget values to variables
  var adm2_name = subcountiesDD.getValue();
  var adm1_name = countiesDD.getValue();
  var adm0_name = statesDD.getValue();
  var year = yearsDD.getValue();
  var month = monthsDD.getValue();
  var period_type = periodTypeDD.getValue();

  // Ensure that the retrieved county geometry is unique
  var county = ee.Feature(
    ee.FeatureCollection(
      ee.Algorithms.If(ee.String(adm2_name).compareTo(ee.String(adm0_name)).eq(0),
                       states.filterMetadata('ADM0_NAME', 'equals', adm2_name),
                       ee.Algorithms.If(ee.String(adm2_name).compareTo(ee.String(adm1_name)).eq(0),
                                        counties.filter(ee.Filter.and(ee.Filter.equals('ADM0_NAME', adm0_name),
                                                                      ee.Filter.equals('ADM1_NAME', adm2_name))),
                                        subcounties.filter(ee.Filter.and(ee.Filter.equals('ADM0_NAME', adm0_name),
                                                           ee.Filter.equals('ADM2_NAME', adm2_name)))
                                       )
                       )
    ).first());

  Map.centerObject(county.geometry());
  Map.layers().reset([ui.Map.Layer(county, {}, adm2_name)]);

  var date_range_temp = ee.Dictionary({'start': year + '-01-01', 'end': year + '-12-31'});

  // Load the Sentinel-2 collection for the time period and area requested
  var s2_cl = S2Masks.loadImageCollection(ee.String(years.get(year)).getInfo(), date_range_temp, county.geometry());

  // Perform cloud masking using the S2 cloud probabilities assets from s2cloudless,
  // courtesy of Sentinelhub/EU/Copernicus/ESA
  var masked_collection = s2_cl
                          .map(S2Masks.addCloudShadowMask(not_water, 1e4))
                          .map(S2Masks.applyCloudShadowMask)
                          .map(S2FCover.fcover(1e4))
                          .select(['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12', 'fcover']);

  // Apply bare soil filter using the GEOS3 algorithm
  var bs_collection = masked_collection.map(S2Masks.addGEOS3Mask);

  // Set base date to generate a Day of Year layer
  var from_date = ee.Date.parse('YYYY-MM-dd', year + '-01-01');
  // Specify band list required for the plots to generate
  var band_list = ['fcover'];

  // Generate the series to be used as input for the drawing tool plot.
  var plot_series = drawingTools.preparePlotSeries(masked_collection, bs_collection, county.geometry(),
                                                   from_date, date_range_temp, band_list);

  // Apply the actual date range specified, as opposed to the full year (required for the drawing tools plotting)
  masked_collection = masked_collection.filterDate(date_range.get('start'), date_range.get('end'));
  bs_collection = bs_collection.filterDate(date_range.get('start'), date_range.get('end'));
  //v_collection = v_collection.filterDate(date_range.get('start'), date_range.get('end'));

  // Generate harmonized monthly time series of FCover as input to the vegetation factor V
  var fcover_ts = S2Composites.S2HarmonizedTS(masked_collection, band_list, date_range, 30, county.geometry());
  // Run a harmonic regression on the time series to fill missing data gaps and smoothen the NDVI profile.
  var fcover_ts_smooth = S2Composites.S2HarmonicRegression(fcover_ts, 'fcover', 4, county.geometry())
                                                                 // clamping to [0,10000] data range,
                                                                 // as harmonic regression may shoot out of data range
                                                                 .map(function(img){return img.clamp(0, 1e4).toInt16()});

  // Calculate the bare soil frequency,
  // i.e. the number of bare soil observations divided by the number of cloud-free observations
  var bs_freq = bs_collection.select('B2').count()
                .divide(masked_collection.select('B2').count())
                .rename('bare_soil_frequency')
                .clip(county.geometry())
                // Masking out the following: water, built-up, too steep slopes
                .updateMask(not_water.and(not_builtup).and(slope_deg.lte(26.6)));

  // Define a mask that categorizes pixels > 95% frequency as permanently bare,
  // i.e. rocky outcrops and other bare surfaces that have little to no restoration potential
  var bs_freq_mask = bs_freq.gt(0).and(bs_freq.lt(0.95));

  var area_chart =  charts.areaChart(bs_freq, 'bare_soil_frequency', county.geometry(), pie_options);

  bs_freq = bs_freq.updateMask(bs_freq_mask);

  // Aggregate bare soil median composite, and vegetation (the negative of the GEOS3 algorithm) median composite
  var bs_image = bs_collection.median().clip(county.geometry()).updateMask(bs_freq_mask);

  // Aggregate a median composite of the full temporal stack
  var median_image = masked_collection
                     .median()
                     .clip(county.geometry());

  // Compute the sustainability factor S ( 1 / (V * L) )
  var S = RUSLEFactors.factorS(median_image, bs_freq, fcover_ts_smooth.select('fitted'), 1e4);

  // Mask out outputs with S > 0.9, because they likely correspond to rocky outcrops
  // and other surfaces unsuitable for restoration efforts
  bs_freq = bs_freq.updateMask(S.lt(0.9));
  bs_image = bs_image.updateMask(S.lt(0.9));
  S = S.updateMask(S.lt(0.9));

  // Compute the low-resolution factors (based on 30-250m covariates) of the RUSLE equation
  K = RUSLEFactors.factorK(statesDD.getValue());

  // Compute the Annual Soil Loss Rate A, according to the RUSLE equation, originally coined by:
  // Wischmeier & Smith 1978, revised by: Renard, 1997
  // C and P factors refactored into S = 1 / (V * L) as done in Karydas & Panagos, 2018.
  var A = R
         .multiply(K)
         .multiply(LS)
         .multiply(S)
         .rename('soil_erosion_hazard');

  // Initiate drawing tools functionalities
  var drawing_elements2 =  drawingTools.initializeDrawingTools();
  var drawing_tools2 = drawing_elements2[0];
  var control_panel2 = drawing_elements2[1];
  drawing_tools.clear(); // Clean out previous drawing tools for the default Kenya inputs.

  Map.add(control_panel2);

  // Define event when the button is clicked.
  // The time series are generated and plotted in the console.
  drawing_tools2.onDraw(ui.util.debounce(chartCustomTimeSeries, 500));
  drawing_tools2.onEdit(ui.util.debounce(chartCustomTimeSeries, 500));

  function chartCustomTimeSeries(){
      // Get the drawn geometry; it will define the reduction region.
      var aoi = drawing_tools2.layers().get(0).getEeObject();

      // Set the drawing mode back to null; turns drawing off.
      drawing_tools2.setShape(null);

      // The input images required to generate the charts from drawn geometries
      var input_image = slope_rad.tan().multiply(100)
                        .addBands(bs_freq.multiply(100))
                        .addBands(A)
                        .updateMask(bs_freq.gt(0));
      var red_outputs = drawingTools.drawPlot(input_image, plot_series, aoi, year);

      var slope_label = ui.Label(); // Mean Slope Steepness in %
      var bs_freq_label = ui.Label(); // Mean Bare Soil Frequency in %
      var A_label = ui.Label(); // Mean Annual Soil Loss Rate in t.ha-1.year-1
      red_outputs[1].evaluate(function(result){
          result = ee.List(result);
          panel.remove(proc_label);
          slope_label.setValue("Mean Slope Steepness: " + result.get(1).getInfo() + " %");
          bs_freq_label.setValue("Mean Bare Soil Frequency: " + result.get(0).getInfo() + " %");
          A_label.setValue("Mean Annual Soil Loss Rate: " + result.get(2).getInfo() + " t.ha-1.yr-1");
      });

      panel.add(red_outputs[0]);
      panel.add(proc_label);
      panel.add(slope_label);
      panel.add(bs_freq_label);
      panel.add(A_label);
  }

  // Prepare layers to be plotted on Map.
  var bs_image_layer = ui.Map.Layer(bs_image.select(["B4", "B3", "B2"]), {min:0, max:3000}, 'Bare Soil Composite RGB');
  var bs_freq_layer = ui.Map.Layer(bs_freq.multiply(100), viz,'Bare Soil Frequency (BSf, %)');
  var S_layer = ui.Map.Layer(S, viz_S,'Sustainability Factor (S, dimensionless)');
  var A_layer = ui.Map.Layer(A, viz_A, 'Soil Erosion Hazard (A, t.ha-1.yr-1)').setShown(false);
  var county_layer = ui.Map.Layer(county, {}, adm2_name);

  Map.layers().reset([county_layer, bs_image_layer, bs_freq_layer, S_layer, A_layer]);

  // Compute the 98th Percentile to use as upper boundary for rescaling the data range for display
  // This enables the color palette to be adapted to the data range dynamically
  var A_range = ee.Number(A.reduceRegion({
    geometry: county.geometry(),
    scale: 100,
    reducer: ee.Reducer.percentile([98]),
    maxPixels: 1e13,
    tileScale: 4
  }).get('soil_erosion_hazard')).clamp(0, 14).int().add(1);

  var legend_panel_updated = ui.Label();

  // Update the soil erosion hazard legend with the new data range (upper boundary only, bottom stays 0)
  A_range.evaluate(function(result){
    var viz_A = {min: 0, max: result, palette: A_palette};
    var legendPanel = ui.Panel({
      widgets: [
        legend_panel_updated.setValue(result + '+')
        ]
    });
    legend.remove(legend.widgets().get(1));
    legend.insert(1, legendPanel);
    A_layer.setVisParams(viz_A).setShown(true);
  });

  // Generate and plot global charts for the select area
  bs_options['title'] = 'Bare Soil Frequency (BSf) Distribution - ' + adm2_name + ' ' + month + ' ' + year
  var bs_freq_hist = charts.customHistogram(bs_freq.multiply(100), 'bare_soil_frequency',
                                            county.geometry(), 'x', bs_options, 20, 5);

  A_options['title'] = 'Soil Erosion Hazard (Log A) Distribution - ' + adm2_name + ' ' + month + ' ' + year
  var A_hist = charts.customHistogram(A.log(), 'soil_erosion_hazard', county.geometry(), 'label', A_options, null, 0.1);

  panel.add(area_chart);
  panel.add(bs_freq_hist.setChartType('ScatterChart'));
  panel.add(A_hist.setChartType('ColumnChart'));

  // Compute the mean Annual Soil Loss Rate for the selected area and add it to the panel.
  var A_mean = ee.Number(A.reduceRegion({
                             reducer: ee.Reducer.mean(),
                             geometry: county.geometry(),
                             scale: 100,
                             maxPixels: 1e13,
                             tileScale: 4
                         }).get('soil_erosion_hazard'))
  .multiply(1000).round().divide(1000); // Dirty trick to round the data to three numbers after decimal

  var A_mean_result = ui.Label();
  A_mean.evaluate(function(result){
      panel.remove(proc_label);
      A_mean_result.setValue(result + " t.ha-1.yr-1");
  });

  var A_mean_label = ui.Label("Mean Annual Soil Loss Rate in soil-exposed croplands and grasslands for "
                              + adm2_name + ":", {fontWeight: 'bold'});
  panel.add(A_mean_label);
  panel.add(proc_label);
  panel.add(A_mean_result);

  // Add back the disclaimer information to the panel
  panel.add(disclaimer_widgets[0]);
  panel.add(disclaimer_widgets[1]);

  /*
  // Procedure to export the synthetic bare soil information.
  // Cannot export such large datasets through GEE App, but can be done if run in the code editor.
  Export.image.toDrive({
    image: A,
    scale: 10,
    maxPixels: 1e13,
    description: ee.String(adm0_name + '_')
    .cat(ee.String(adm2_name + '_'))
    .cat('RGB_')
    .cat(ee.String(period_types.get(period_type).getInfo() + 'days_'))
    .cat(ee.String(month + '_'))
    .cat(ee.String(year)).getInfo(),
    region: county.geometry(),
    formatOptions: {
    cloudOptimized: true
    }
  });

  // An alternative procedure to export a jpeg through a download URL.
  // Only good for a thumbnail export, due to the limited allowed export size.
  /*
  var DownloadPanel = utils.downloadImg(A, adm2_name);
  panel.add(DownloadPanel);
  */
}

// Calculate the bare soil frequency,
// i.e. the number of bare soil observations divided by the number of cloud-free observations
var bs_freq = ee.Image('users/soilwatch/KenyaBareSoilFrequency2020')
              .divide(100)
              .updateMask(not_builtup.and(not_water).and(slope_deg.lte(26.6)))
              .rename('bare_soil_frequency');

// Define a mask that categorizes pixels > 95% frequency as permanently bare,
// i.e. rocky outcrops and other bare surfaces that have little to no restoration potential
var bs_freq_mask = bs_freq.gt(0).and(bs_freq.lt(0.95));

var pie_options = {title: 'Proportion of total area (in km²) observed bare/non-bare',
                  colors: ['green', 'brown', 'yellow'],
                  sliceVisibilityThreshold: 0 // Don't group small slices.
                }
var area_chart =  charts.areaChart(bs_freq, 'bare_soil_frequency', county.geometry(), pie_options);

bs_freq = bs_freq.updateMask(bs_freq_mask);

// Load pre-generated bare soil, median and FCover monthly composites from GEE assets
// This allows the display of an entire country like Kenya without having to compute the data on-the-fly
var bs_image = ee.Image('users/soilwatch/KenyaBareSoilComposite2020');
bs_image = bs_image.updateMask(bs_freq_mask);
var median_image = ee.Image('users/WilliamOuellette/KenyaMedianComposite2020');
var fcover_ts_smooth = ee.ImageCollection("users/soilwatch/KenyaFcover2020");

// Compute the sustainability factor S = 1 / (V * L)
// The pre-computed median image and the FCover monthly time series for 2020 are used to speed up the computing.
var S = RUSLEFactors.factorS(median_image, bs_freq, fcover_ts_smooth.select('fitted'), 1e4);

// Mask out outputs with S > 0.9, because they likely correspond to rocky outcrops
// and other surfaces unsuitable for restoration efforts
bs_freq = bs_freq.updateMask(S.lt(0.9));
bs_image = bs_image.updateMask(S.lt(0.9));
S = S.updateMask(S.lt(0.9));

// Compute the Annual Soil Loss Rate A, according to the RUSLE equation, originally coined by:
// Wischmeier & Smith 1978, revised by: Renard, 1997
// C and P factors refactored into S = 1 / (V * L) as done in Karydas & Panagos, 2018.
var A = R
     .multiply(K)
     .multiply(LS)
     .multiply(S)
     .rename('soil_erosion_hazard');

// Load the palettes to be used for the visualization of the loaded layers.
var bs_freq_palette = palettes.matplotlib.plasma[7];
var A_palette = palettes.colorbrewer.YlOrBr[9].reverse().slice(0,-1);
var S_palette = palettes.colorbrewer.RdYlGn[11].reverse().slice(2, -1);

// Visualization parameters for the respective layers
var viz = {min: 0, max:100, palette: bs_freq_palette};
var viz_S = {min: 0, max:1, palette: S_palette};
var viz_A = {min: 0, max: 15, palette: A_palette};

// set position of panel
var legend = ui.Panel({
  style: {
  position: 'bottom-left',
  padding: '8px 15px'
  }
  });

// Populate the legend panel
legend = legends.populateLegend(legend, "Soil Erosion Hazard (A, t.ha-1.year-1)", viz_A, "", "+");
legend = legends.populateLegend(legend, "Sustainability Factor (S, dimensionless)", viz_S," (positive)"," (negative)");
legend = legends.populateLegend(legend, "Bare Soil Frequency (BSf, %)", viz, "", "");

// Prepare layers to be plotted on Map.
var bs_image_layer = ui.Map.Layer(bs_image.select(["B4", "B3", "B2"]), {min: 0, max: 3000}, 'Bare Soil Composite RGB');
var bs_freq_layer = ui.Map.Layer(bs_freq.multiply(100), viz,'Bare Soil Frequency (BSf, %)');
var S_layer = ui.Map.Layer(S, viz_S,'Sustainability Factor (S, dimensionless)');
var A_layer = ui.Map.Layer(A, viz_A,'Soil Erosion Hazard (A, t.ha-1.year-1)');
var county_layer = ui.Map.Layer(ee.Feature(county), {}, 'Kenya');

Map.setOptions("TERRAIN")
Map.centerObject(county.geometry(), 7);
Map.layers().reset([county_layer, bs_image_layer, bs_freq_layer, S_layer, A_layer]);

// Initiate drawing tools functionalities
var drawing_elements =  drawingTools.initializeDrawingTools();
var drawing_tools = drawing_elements[0];
var control_panel = drawing_elements[1];

Map.add(control_panel);
Map.add(legend);

// Generate and plot global charts for the select area
var bs_options = {title: 'Bare Soil Frequency (BSf) Distribution - Kenya Jan-Dec 2020',
              hAxis: {title: '% of bare soil occurence'},
              vAxis: {title: 'surface area (hectares)'},
              legend: {position: 'none'},
              pointSize: 10,
              colors: ["#420a68", "#530e6c", "#63136e", "#731a6e", "#83206b", "#932567", "#a42b61",
                       "#b43359", "#c33b4f", "#d04545", "#dd5039", "#e85e2d", "#f06e21", "#f77f13",
                       "#fa9207", "#fca40b", "#fcb91d", "#f9cc35", "#f5e155"]

};
var bs_freq_hist = charts.customHistogram(bs_freq.multiply(100), 'bare_soil_frequency',
                                          county.geometry(), 'x', bs_options, 20, 5);

var A_options =  {title: 'Soil Erosion Hazard (Log A) Distribution - Kenya Jan-Dec 2020',
          hAxis: {title: 'log ton/hectare/year'},
          vAxis: {title: 'surface area (hectares)'},
          legend: {position: 'none'},
          series: {0: {color: "#993404"}}
};

var A_hist = charts.customHistogram(A.log(), 'soil_erosion_hazard', county.geometry(), 'label', A_options, null, 0.1);

panel.add(area_chart);
panel.add(bs_freq_hist.setChartType('ScatterChart'));
panel.add(A_hist.setChartType('ColumnChart'));

// The mean value for the Kenya data was computed offline to speed up its recovery, and corresponds to 3.251 t.ha-1.yr-1
var A_mean_label = ui.Label("Mean Annual Soil Loss Rate in soil-exposed croplands and grasslands for Kenya:",
                            {fontWeight: 'bold'});
var A_mean_result  = ui.Label("3.251 t.ha-1.year-1");
panel.add(A_mean_label);
panel.add(A_mean_result);

// Insert a disclaimer to try something different if Time-outs are encountered
panel.add(ui.Label("Disclaimer:", {fontWeight: 'bold'}));
panel.add(ui.Label('If an error is encountered when plotting the charts, try a shorter aggregation interval or a smaller sub-administrative unit'));

var date_range_temp = ee.Dictionary({'start': '2020-01-01', 'end': '2020-12-31'});

// Define event when the button is clicked.
// The time series are generated and plotted in the console.
drawing_tools.onDraw(ui.util.debounce(chartDefaultTimeSeries, 500));
drawing_tools.onEdit(ui.util.debounce(chartDefaultTimeSeries, 500));

// Create widget to display while outputs are being processed.
var proc_label = ui.Label('⚙️ Processing mean outputs, please wait...');

function chartDefaultTimeSeries(){
  // Get the drawn geometry; it will define the reduction region.
  var aoi = drawing_tools.layers().get(0).getEeObject();

  // Load the Sentinel-2 collection for the time period and area requested
  var s2_cl = S2Masks.loadImageCollection('COPERNICUS/S2_SR', date_range_temp, aoi);

  // Perform cloud masking using the S2 cloud probabilities assets from s2cloudless,
  // courtesy of Sentinelhub/EU/Copernicus/ESA
  var masked_collection = s2_cl
                          .map(S2Masks.addCloudShadowMask(not_water, 1e4))
                          .map(S2Masks.applyCloudShadowMask)
                          .map(S2FCover.fcover(1e4))
                          .select(['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12', 'fcover']);

  // Apply bare soil filter using the GEOS3 algorithm
  var bs_collection = masked_collection.map(S2Masks.addGEOS3Mask);

  // Set base date to generate a Day of Year layer
  var from_date =  ee.Date.parse('YYYY-MM-dd', date_range_temp.get('start'));
  // Specify band list required for the plots to generate
  var band_list = ['fcover'];

  // Generate the series to be used as input for the drawing tool plot.
  var plot_series = drawingTools.preparePlotSeries(masked_collection, bs_collection, aoi,
                                                   from_date, date_range_temp, band_list);

  // Set the drawing mode back to null; turns drawing off.
  drawing_tools.setShape(null);

  // The input images required to generate the charts from drawn geometries
  var input_image = slope_rad.tan().multiply(100)
                    .addBands(bs_freq.multiply(100))
                    .addBands(A)
                    .updateMask(bs_freq.gt(0));
  var red_outputs = drawingTools.drawPlot(input_image, plot_series, aoi, '2020');

  var slope_label = ui.Label(); // Mean Slope Steepness in %
  var bs_freq_label = ui.Label(); // Mean Bare Soil Frequency in %
  var A_label = ui.Label(); // Mean Annual Soil Loss Rate in t.ha-1.year-1

  red_outputs[1].evaluate(function(result){
      result = ee.List(result);
      panel.remove(proc_label);
      slope_label.setValue("Mean Slope Steepness: " + result.get(1).getInfo() + " %");
      bs_freq_label.setValue("Mean Bare Soil Frequency: " + result.get(0).getInfo() + " %");
      A_label.setValue("Mean Annual Soil Loss Rate: " + result.get(2).getInfo() + " t.ha-1.yr-1");
  });

  panel.add(red_outputs[0]);
  panel.add(proc_label);
  panel.add(slope_label);
  panel.add(bs_freq_label);
  panel.add(A_label);
}

// Stashing GUI Buttons to carry over when onClick event occurs
var elems = panel.widgets();
var button_widgets = [elems.get(0), elems.get(1), elems.get(2), elems.get(3), elems.get(4), elems.get(5), elems.get(6), elems.get(7)];

// Stashing Disclaimer Labels to carry over when onClick event occurs
var disclaimer_widgets = [elems.get(13), elems.get(14)];
