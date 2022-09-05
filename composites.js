// ****************************************************************************************************************** //
// ******************* Module compiling the compositing and time series processing functionalities ****************** //
// ****************************************************************************************************************** //

// A functioned to generate a harmonized time series from a Sentinel-2 Image Collection.
// Harmonized means that the generated temporal aggregates are equally spaced in time,
// i.e. by the number of days specified by the "agg_interval" argument
exports.harmonizedTS = function(masked_collection, band_list, time_intervals, options){

  var band_name = options.band_name || 'NDVI';
  var agg_type = options.agg_type || 'median';

  // a wrapper function for stacking the generated Sentinel-2 temporal aggregates
  function _stackBands(time_interval, stack){
    var outputs = exports.aggregateStack(masked_collection, band_list, time_interval,
                                         {agg_type: agg_type, band_name: band_name});

    return ee.List(stack).add(ee.Image(outputs));
  }

  // Initialize the list of Sentinel_2 images.
  var stack = ee.List([]);

  // Populate the stack of sentinel-2 images with the specified bands/VIs
  var agg_stack = ee.List(time_intervals).iterate(_stackBands, stack);

  return ee.ImageCollection(ee.List(agg_stack)).sort('system:time_start')
};

//Define function to extract time intervals to use to generate the temporal composites from Sentinel collections
exports.extractTimeRanges = function(start, end, agg_interval){
    /*
    Extract the time range data from the received time range and aggregation interval e.g.,
    input time interval: time_interval = ['2019-01-01','2020-01-01'], agg_interval: 60 days
    generate the following time intervals:
    time_range = [("2019-01-01T00:00:00Z", "2019-03-01T00:00:00Z"),
                ("2019-03-01T00:00:00Z", "2019-05-01T00:00:00Z"),
                ("2019-05-01T00:00:00Z", "2019-07-01T00:00:00Z"),
                ("2019-07-01T00:00:00Z", "2019-09-01T00:00:00Z"),
                ("2019-09-01T00:00:00Z", "2019-11-01T00:00:00Z"),
                ("2019-11-01T00:00:00Z", "2020-01-01T00:00:00Z")
    */

    var start_date = ee.Date(start);
    var end_date = ee.Date(end);

    // Number of intervals in the given "time_range" based on the specified "agg_interval" period
    var interval_no = ee.Date(end).difference(ee.Date(start), 'day').divide(agg_interval).round();
    var month_check = ee.Algorithms.If(ee.Number(30.4375 / agg_interval).round().gt(0),
                                       ee.Number(30.4375 / agg_interval).round(),
                                       ee.Number(1)); // The number of aggregation intervals within a month
  
    // Compute the relative date delta (in months) to add to each preceding period to compute the new one
    var rel_delta = ee.Number(end_date.difference(start_date, 'day'))
                    .divide(ee.Number(30.4375).multiply(interval_no)).ceil(); // 30.4375 days = average month length

    // Compute the first time interval end date by adding the relative date delta (in months) to the start date
    end_date = start_date.advance(start_date.advance(rel_delta, 'month')
                                  .difference(start_date, 'day')
                                  .divide(month_check), 'day')
                                  .advance(-1, 'second');

    var time_intervals = ee.List([ee.List([start_date, end_date])]);
    time_intervals = ee.List(ee.List.sequence(1, interval_no.subtract(1)).iterate(function(x,previous){
        start_date = ee.Date(ee.List(ee.List(previous).reverse().get(0)).get(1))
                     .advance(1, 'second'); //end_date of last element
        end_date = start_date
                   .advance(start_date.advance(rel_delta, 'month')
                   .difference(start_date, 'day')
                   .divide(month_check), 'day')
                   .advance(-1, 'second');

        return ee.List(previous).add(ee.List([start_date, end_date]));
    }, time_intervals));

    return time_intervals;
}


// Define function to generate the temporally-aggregated image for a given "time_interval"
exports.aggregateStack = function(masked_collection, band_list, time_interval, options){

    var band_name = options.band_name || 'NDVI';
    var agg_type = options.agg_type || 'median';

    time_interval = ee.List(time_interval);
    var agg_interval =  ee.Date(time_interval.get(1)).difference(time_interval.get(0), 'day');

    // Set the centre of the time interval as the system:time_start date
    var timestamp = {'system:time_start': ee.Date(time_interval.get(0))
                                          .advance(ee.Number(agg_interval.divide(2)).ceil(), 'day')
                                          .millis()};
    var agg_image;
    if (agg_type === 'geomedian') {
        // Reduces the time interval using the geomedian, as it performs better for auto-correlated variables,
        //  i.e. spectral bands. See: Roberts, D., Mueller, N., & McIntyre, A. (2017).
        // High-dimensional pixel composites from earth observation time series.
        // IEEE Transactions on Geoscience and Remote Sensing, 55(11), 6254-6264.
        // A condition is provided in case the time interval does not contain any cloud-free images,
        // which likely happens in the sub-tropics when a short aggregation interval is used.
        agg_image = ee.Algorithms.If(
          masked_collection.filterDate(time_interval.get(0), time_interval.get(1)).size().gt(0),
                                       masked_collection.filterDate(time_interval.get(0), time_interval.get(1))
                                       .select(band_list)
                                       .reduce(ee.Reducer.geometricMedian(band_list.length), 4)
                                       .rename(band_list)
                                       .set(timestamp),
                                       ee.Image(ee.List(band_list.slice(1))
                                       .iterate(function(band, stack){return ee.Image(stack).addBands(ee.Image(0).mask())},
                                                ee.Image(0).mask())).rename(band_list).set(timestamp));
    } else if (agg_type === 'median') {
        agg_image = ee.Algorithms.If(
          masked_collection.filterDate(time_interval.get(0), time_interval.get(1)).size().gt(0),
                                       masked_collection.filterDate(time_interval.get(0), time_interval.get(1))
                                       .select(band_list)
                                       .reduce(ee.Reducer.median(), 4)
                                       .rename(band_list)
                                       .set(timestamp),
                                       ee.Image(ee.List(band_list.slice(1))
                                       .iterate(function(band, stack){return ee.Image(stack).addBands(ee.Image(0).mask())},
                                                ee.Image(0).mask())).rename(band_list).set(timestamp));
    } else if (agg_type === 'max_band') {
        agg_image = ee.Algorithms.If(
          masked_collection.filterDate(time_interval.get(0), time_interval.get(1)).size().gt(0),
                                       masked_collection.filterDate(time_interval.get(0), time_interval.get(1))
                                       .select(band_list)
                                       .qualityMosaic(band_name)
                                       .set(timestamp),
                                       ee.Image(ee.List(band_list.slice(1))
                                       .iterate(function(band, stack){return ee.Image(stack).addBands(ee.Image(0).mask())},
                                                ee.Image(0).mask())).rename(band_list).set(timestamp));
    } else if (agg_type === 'sum') {
        agg_image = ee.Algorithms.If(
          masked_collection.filterDate(time_interval.get(0), time_interval.get(1)).size().gt(0),
                                       masked_collection.filterDate(time_interval.get(0), time_interval.get(1))
                                       .select(band_list)
                                       .reduce(ee.Reducer.sum(), 4)
                                       .rename(band_list)
                                       .set(timestamp),
                                       ee.Image(ee.List(band_list.slice(1))
                                       .iterate(function(band, stack){return ee.Image(stack).addBands(ee.Image(0).mask())},
                                                ee.Image(0).mask())).rename(band_list).set(timestamp));
    } else if (agg_type === 'count') {
        agg_image = ee.Algorithms.If(
          masked_collection.filterDate(time_interval.get(0), time_interval.get(1)).size().gt(0),
                                       masked_collection.filterDate(time_interval.get(0), time_interval.get(1))
                                       .select(band_list)
                                       .reduce(ee.Reducer.count(), 4)
                                       .rename(band_list)
                                       .set(timestamp),
                                       ee.Image(ee.List(band_list.slice(1))
                                       .iterate(function(band, stack){return ee.Image(stack).addBands(ee.Image(0).mask())},
                                                ee.Image(0).mask())).rename(band_list).set(timestamp));
    } else if (agg_type === 'mean') {
              agg_image = ee.Algorithms.If(
                masked_collection.filterDate(time_interval.get(0), time_interval.get(1)).size().gt(0),
                                             masked_collection.filterDate(time_interval.get(0), time_interval.get(1))
                                             .select(band_list)
                                             .reduce(ee.Reducer.mean(), 4)
                                             .rename(band_list)
                                             .set(timestamp),
                                             ee.Image(ee.List(band_list.slice(1))
                                             .iterate(function(band, stack){return ee.Image(stack).addBands(ee.Image(0).mask())},
                                                      ee.Image(0).mask())).rename(band_list).set(timestamp));
    }

    return agg_image
}

// Runs an harmonic regression through the Sentinel-2 time series provided
// The returned time series is gapless and smoothened, for better interpretation when plotted
// Adapted from: Kibret, K. S., Marohn, C., & Cadisch, G. (2020).
// Use of MODIS EVI to map crop phenology, identify cropping systems,
// detect land use change and drought risk in Ethiopia–an application of Google Earth Engine.
// European Journal of Remote Sensing, 53(1), 176-191.
exports.harmonicRegression = function(ts, band, harmonics){

  // Define the number of cycles per year to model.
  // Make a list of harmonic frequencies to model.
  // These also serve as band name suffixes.
  var harmonic_frequencies = ee.List.sequence(1, harmonics);
  var from_date = ts.first().date();

  // Function to get a sequence of band names for harmonic terms.
  function _constructBandNames(base, list) {
    return ee.List(list).map(function(i) {
      return ee.String(base).cat(ee.Number(i).int());
    });
  }

  // Construct lists of names for the harmonic terms.
  var cos_names = _constructBandNames('cos_', harmonic_frequencies);
  var sin_names = _constructBandNames('sin_', harmonic_frequencies);

  // Independent variables.
  var independents = ee.List(['constant', 't']).cat(cos_names).cat(sin_names);

  // Function to add a time band.
  function _addDependents(image) {
    // Compute time in fractional years since the epoch.
    var years = image.date().difference(from_date, 'year');
    var time_rad = ee.Image(years.multiply(2 * Math.PI)).rename('t');
    var constant = ee.Image(1);
    return image.addBands(constant).addBands(time_rad.float());
  }

  // Function to compute the specified number of harmonics
  // and add them as bands.  Assumes the time band is present.
  function _addHarmonics(freqs) {
    return function(image) {
      // Make an image of frequencies.
      var frequencies = ee.Image.constant(freqs);
      // This band should represent time in radians.
      var time = ee.Image(image).select('t');
      // Get the cosine terms.
      var cosines = time.multiply(frequencies).cos().rename(cos_names);
      // Get the sin terms.
      var sines = time.multiply(frequencies).sin().rename(sin_names);
      return image.addBands(cosines).addBands(sines);
    };
  }

  var fourier_terms = ts
                      .select(band)
                      .map(_addDependents)
                      .map(_addHarmonics(harmonic_frequencies));

  // The output of the regression reduction is a 4x1 array image.
  var harmonic_trend = fourier_terms
                       .select(independents.add(band))
                       .reduce(ee.Reducer.linearRegression(independents.length(), 1));

  // Turn the array image into a multi-band image of coefficients.
  var harmonic_coefs = harmonic_trend.select('coefficients')
    .arrayProject([0])
    .arrayFlatten([independents]);

  // Compute fitted values.
  var fitted_harmonic = fourier_terms.map(function(image) {

    return image.addBands(image.select(independents)
                          .multiply(harmonic_coefs)
                          .reduce('sum').int()
                          .rename('fitted'));
  });

  // Extract the fitted and original band
  var predicted = fitted_harmonic.select(['fitted', band]);

   // Sort chronologically in ascending order.
  var series = predicted.sort('system:time_start', true);

  // Get the timestamp from the most recent image in the reference collection.
  var time0 = predicted.first().get('system:time_start');

  // Create a first image with constant value
  var first = ee.List([
    // Rename the first band 'fitted'; second 'fittedp'.
    ee.Image(0).set('system:time_start', time0).select([0], ['fitted'])
    .addBands(ee.Image(0).select([0], ['fittedp']))
  ]);

  // Copies the band value of the previous image to the current image and add it as band.
  // The band is renamed to 'fittedp'.
  // The image with its band value and the band value from previous image is added to the list.
  function _accumulatep(image, list){
    var previous = ee.Image(ee.List(list).get(-1)).select(['fitted'],['fittedp']);
    var added = image.addBands(previous)
      .set('system:time_start', image.get('system:time_start'));
    return ee.List(list).add(added);
  }

  // Create an ImageCollection of images with the new band coppied from the previous image by iterating.
  // Since the return type of iterate is unknown, it needs to be cast to a List.
  var cumulativep0 = ee.ImageCollection(ee.List(series.iterate(_accumulatep, first)));

  // Remove the first  image as it contains the first image with the constant 0.
  var cumulativep = cumulativep0.filter(ee.Filter.neq('system:index','0'));

  // Sort chronologically in ascending order the new image collection with the current and previos image value.
  var seriesn = cumulativep.sort('system:time_start', false);

  // Get the timestamp from the most recent image in the reference collection.
  var time0n = seriesn.first().get('system:time_start');

// Create a first image with constant value
  var firstn = ee.List([
    // Rename the first band 'fitted'.
    ee.Image(0).set('system:time_start', time0n).select([0], ['fitted'])
        .addBands(ee.Image(0).select([0], ['fittedp']))
        .addBands(ee.Image(0).select([0], ['fittedn']))
  ]);

  // Copies the band value of the next image to the current image and add it as band.
  // The band is renamed to 'fittedn'.
  // The image with its band value, the band value from previous and next images is added to the list.
  function _accumulaten(image, list) {
    var previous = ee.Image(ee.List(list).get(-1)).select(['fitted'],['fittedn']);
    var added = image.addBands(previous)
      .set('system:time_start', image.get('system:time_start'));
    return ee.List(list).add(added);
  }

  // Create an ImageCollection of images with the new band copied from previous and next image by iterating.
  // Since the return type of iterate is unknown, it needs to be cast to a List.
  var cumulativepn00 = ee.ImageCollection(ee.List(seriesn.iterate(_accumulaten, firstn)));

  var cumulative = cumulativepn00.filter(ee.Filter.neq('system:index','0')); // Remove, contains constant 0 image
  cumulative = cumulative.sort('system:time_start', true); // Order the collection by ascending timestamps

   return ee.ImageCollection(cumulative.toList(cumulative.size()));
};
