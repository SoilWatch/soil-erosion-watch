// ****************************************************************************************************************** //
// *************************** Module generating the legends for the Soil Erosion App GUI *************************** //
// ****************************************************************************************************************** //

// Function to populate the color palette legends for the app layers
exports.populateLegend = function(legend, legend_name, viz_params, add_char_min, add_char_max){

    // Create legend title
    var legend_title = ui.Label({
      value: legend_name,
      style: {
      fontWeight: 'bold',
      fontSize: '12px',
      margin: '0 0 0 0',
      padding: '0',
      width: '115px'
      }
      });

    // Add the title to the panel
    legend.add(legend_title);

    // create the legend image
    var lon = ee.Image.pixelLonLat().select('latitude');
    var gradient = lon.multiply(ee.Number(viz_params.max).subtract(viz_params.min).divide(100)).add(viz_params.min);
    var legend_image = gradient.visualize(viz_params);

    // create text on top of legend
    var legend_panel_max = ui.Panel({
      widgets: [
      ui.Label(viz_params['max'] + add_char_max)
      ],
      });

    legend.add(legend_panel_max);

    // create thumbnail from the image
    var thumbnail = ui.Thumbnail({
      image: legend_image ,
      params: {bbox: '0,0,10,100', dimensions:'10x25'},
      style: {padding: '1px', position: 'bottom-center'}
      });

    // add the thumbnail to the legend
    legend.add(thumbnail);

    // create text on top of legend
    var legend_panel_min = ui.Panel({
      widgets: [
      ui.Label(viz_params['min'] + add_char_min)
      ],
      });

    legend.add(legend_panel_min);

    return legend
};
