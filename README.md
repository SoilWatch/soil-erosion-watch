# Soil Erosion Watch
### _"If there's a RUSLE in your hedgerow, don't be alarmed now"*_ 

_**RUSLE**: Revised Universal Soil Loss Equation, a well established empirical modelling method to estimate annual soil loss._

<img src="https://user-images.githubusercontent.com/84096586/118025387-c7af8080-b32d-11eb-9ee7-d83983054960.jpg" width="750">

_**hedgerow**: Line of closely spaced grasses, shrubs or trees, planted and trained to form a barrier or 
to mark the boundary of an area, or to prevent soil erosion from wind and water._

<img src="https://user-images.githubusercontent.com/84096586/118025978-53c1a800-b32e-11eb-8098-191d132c2a00.jpg" width="750">

_For the [Google Earth Engine](https://earthengine.google.com/) JavaScript Code Editor_

A Google Earth Engine JavaScript App Source Code to compute the Revised Universal Soil Erosion Equation (RUSLE),
for any location in the world. 
The app is published and can be accessed [here](https://soilwatch.users.earthengine.app/view/soilerosionwatch).
All methods are public and can be imported with the following syntax: 
```js
var <method_name> = require('users/soilwatch/soilErosionApp:<script_name>')
```

![](images/SoilErosionWatch.gif)

## Concept

The state of the world's soils and natural landscapes is dire. FAO's last [Status of the World's Soil Resources](http://www.fao.org/3/i5199e/I5199E.pdf) report
identified that 33% of the Earth's soils are already degraded and that over 90% could become degraded by 2050.
More specifically, Soil erosion on arable or intensively grazed lands are 100-1000 times higher than natural erosion rates.
The consequences of soil degradation are many, the main ones being:
- Decrease in crop yield and soil productivity in general.
- Decrease in biodiversity and ecosystem functions.
- Amplifies hydrogeological risk such as landslides or floods, or inversely to drought due to reduced moisture holding capacity of the soil.
- Increased CO2 emissions from soil organic carbon release into the air.
- Threatens livelihoods due to loss of arable land, and in the worsts of cases leads to conflict and population displacement 
  (e.g. the [Darfur Conflict](https://odihpn.org/magazine/environmental-degradation-and-conflict-in-darfur-implications-for-peace-and-recovery/)).
- Threatens human health due to off-site soil and water pollution.

The culprits are unsustainable land management practices, a problem reinforced by climate change.
Reversing the trend of land degradation requires regreening those degraded surfaces exhibiting bare soil, 
either in the form of reforestation/afforestation, or regenerative agriculture practices for arable land. 
Whether it is cropland, grasslands/rangelands or abandoned land, the overarching concept remains the same: **the more often a surface is green, the better, and should, if possible, be green year-round**.
It's a blunt and over-generalized statement, but it remains undeniable that the main erosion-controlling anthropogenic mechanism is to cover the soil with living or dead biomass.
Although the predication of specific sustainable land management practices is context-specific, 
there is gaping hole in terms of global baseline information on the state of soil erosion, least of all spatially explicit, 
field-level information about land degradation and the temporal dynamics of vegetation cover management. 
Repeat-pass optical satellite imagery can greatly assist in making this baseline assessment, 
and help target landscape restoration efforts or other initiatives such as carbon offsetting projects, in areas where their impact is greatest.

The idea behind the **Soil Erosion Watch App** is to provide a tool for land managers and 
landscape/environment restoration practitioners which enables them to assess the state of erosion in their region of interest, 
down to the field/plot level! The assumption is that soil that is exposed bare at least once in the year or more are at increased risk of erosion. 
The App therefore focuses on those areas only, and masks impervious, water and permanently vegetated areas from the analysis.
Permanently vegetated areas are not monitored for two main reasons: 
- Estimating soil erosion of surfaces not observable by optical satellite imagery is challenging.
- It is assumed that permanently vegetated surfaces are under "sustainable" management, and are susceptible to natural erosion, 
  whereas the idea here to highlight human-induced erosion. There are pitfalls to this assumption, such as forest monocultures, 
  but as George Box once said: 'all models are wrong, but some are useful'. This qualifies as useful, hopefully.
  
It relies on long-standing concept of soil erosion by water, modelled through [RUSLE](https://www.ars.usda.gov/arsuserfiles/64080530/rusle/ah_703.pdf), 
a concept revised many times but which is well established for more than two decades, with constant improvements 
through additional research and experiments that confirm its robustness.
No flashy machine learning involved here, just good ol' empirical modelling of natural erosion phenomena to calculate 
the Annual Soil Erosion Rate A. 

The technique is powerful, but has typically been applied at catchment or watershed level, with locally-derived datasets.
Providing globally applicable soil erosion estimates was futile until recently due to the absence of global soil and environmental covariates 
necessary to calculate RUSLE. 
The advent of high resolution repeat-pass earth observation data has enabled the generation of these global datasets, 
at sufficiently high resolution to model soil erosion globally.

On top of this, new cloud-computing infrastructures paired with global Earth Observation public data catalogs ([Google Earth Engine](https://earthengine.google.com/))
allows building Apps on top of petabytes of imagery assets, without the need to pre-compute and store processed datasets.
This provides additional flexibility in App development, and allows the developer to be more creative and iterate more quickly over concepts.

## RUSLE Equation

The original RUSLE equation looks like this:

```js
var A = R * K * LS * C * P
```

For this App, this equation was adapted following a suggestion from [Karydas & Panagos, 2018](https://www.sciencedirect.com/science/article/pii/S0013935117314044#bib65),
whereby the erosion-inducing factors as numerator factors, and the erosion-controlling factors as denominator factors,
which structures the equation in a more logical way, with the opposite terms organized on either side of the fraction bar.

It looks like this:
```js
var A = (R * K * LS) / (V * L)
```
where `V = 1 / C` and `L = 1 / P`.

Let's focus on the newly introduced erosion-controlling `V` (vegetation) and `L` (landscape) factors. 
For an explanation on the erosion-inducing factors, and more background information on the equation, 
this [blog post]() can be consulted.

### Vegetation Factor V

```js
var Vm = (10 * (1 – BSf) * FCover_m).exp()
var V = Vm.mean()
```

[Wischmeier & Smith 1978](https://naldc.nal.usda.gov/download/CAT79706928/PDF) established from experimental data that 
the relationship between vegetation cover and soil erosion is exponential.
In absence of a good global land use/land cover dataset at the resolution of Sentinel-2 (10m), 
typically used to estimate the C-factor (or V-factor in this case) of the RUSLE equation, 
using a vegetation index time series as a proxy of both the intensity and duration of the vegetation cover is not only a 
good alternative, but probably a better one thanks to the granularity of the time series information.
The vegetation cover frequency `10 * (1 – BSf)` clamped to the `[5,8]` range (5: degraded cropland/pasture condition, 8, 
well-managed grassland condition) is used as replacement to the Land Use/Cover factor, for two main reasons:
- The targeted land uses of this App are essentially croplands, grasslands/rangelands and other bare pervious surfaces,
  so the added value of using land use/cover information is limited.
- There is no high-resolution land cover dataset of reliable enough quality (up-to-date, classification accuracy) and detail (agricultural class nomenclature)
  that can be used in this context. 
  
For the fraction of green vegetation cover `FCover`, a temporal approach is adopted whereby a harmonized 
(equally-spaced temporal aggregation intervals) and smoothened (harmonic regression) time series of monthly composites 
is used to compute the equation for `Vm` as many times as there are monthly `FCover_m` composites available, 
and the mean of all `Vm` terms is computed to get `V`.

The combination of those two factors should model the temporal characteristics of cover vegetation reasonably well.

### Landscape Factor L

```js
L = 1 + (Sf_B8 / DNmax).sqrt()
```

Where `Sf_B8` is the result of a convolution using a 3x3 anisotropic edge detection Sobel filter on Sentinel-2’s NIR band (`B8`). 
The convolution output is normalized by dividing by the maximum potential reflectance value of the B8 band, which in the case of Sentine-2 L2A on GEE is 10000. 
It is a doing a good job at identifying linear (boundaries, terraces) and punctual (trees/bushes in field) features, even on 10m imagery.

![](images/SobelConvolution.gif)


## Features

### Layers
This App provides the following layers at 10m resolution (native Sentinel-2 resolution):
- Spatially-explicit Annual Soil Erosion Rates derived from RUSLE.
  
  <img src="https://user-images.githubusercontent.com/84096586/118026313-abf8aa00-b32e-11eb-8f6a-d2454c27848c.png" width="750">
  
- Locations and timestamp of bare soil occurrence for any location on earth.
  
  <img src="https://user-images.githubusercontent.com/84096586/118026502-db0f1b80-b32e-11eb-95db-4cd3febca089.png" width="750">
  
- Bare soil temporal frequency for any location on earth.
  
  <img src="https://user-images.githubusercontent.com/84096586/118026577-efebaf00-b32e-11eb-8145-0f72f2ec5ad5.png" width="750">
  
- A sustainability factor, ranging from ```[0,1]```, part of the RUSLE equation, and a function of bare soil frequency and fractional vegetation cover.
  It is a proxy of land management sustainability combining cover management and landscape management.
  
  <img src="https://user-images.githubusercontent.com/84096586/118026599-faa64400-b32e-11eb-96c6-b15eb6384eb3.png" width="750">
  
### Global Charts

Moreover, it provides the following global charts:
- A pie chart summarizing the breakdown by type of surface. The analysis focuses on the brown slice of the pie 
  (surfaces bare less at least once, and less than 95% of the time), 
  as it considers permanently vegetated surfaces (green slice) to be already sustainably managed, 
  and the surfaces bare more than 95% of the time as rocky outcrops or surfaces unrecoverable through restoration.
  
  <img src="https://user-images.githubusercontent.com/20474036/118030553-76a28b00-b333-11eb-8d83-18030765d2d9.png" width="750">
  
- The bare soil frequency distribution for the specified area, in the form of a histogram. 
  This provides information on what the most abundant frequency of bare soil exposure typically is for an area.
  
  <img src="https://user-images.githubusercontent.com/20474036/118030499-64c0e800-b333-11eb-8ff3-3cda2de5674a.png" width="750">

- The logarithmic distribution of the annual soil rates. Soil erosion rates are typically skewed towards the low values, 
  making the histogram difficult to interpret. Therefore, normalizing the distribution makes it easier to understand the situation for an area.
  A skewed distribution towards the higher values (0 and above) indicates more severe soil erosion, 
  while a skewed distribution towards the lower values indicates that the landscape is resilient towards soil erosion.

  <img src="https://user-images.githubusercontent.com/20474036/118030314-1e6b8900-b333-11eb-8348-5a99835d5cbe.png" width="750">
  
### Drill-down drawing tool

Another feature of the app is the possibility to draw a geometry on top of the generated layers, 
and extract temporal information about the target location(s).

![](images/SoilErosionWatchDrawingTool.gif)

<img src="https://user-images.githubusercontent.com/20474036/118030459-5246ae80-b333-11eb-8230-eb05bda4d86f.png" width="750">

The green curve is the NDVI for the chosen year, corresponding to the drawn geometry.
The brown dots are the dates where soil was observed bare in that year. 
Bear in mind that averaging is performed if a rectangle or polygon is used, which may flag certain dates of the year as bare, 
but may not be true for all pixels contained within the rectangle/polygon.

As many geometries can be drawn and extracted as desired! So go wild.

### Select a custom area

You can select a custom area in the world that draws your particular interest, and generate all of the above features for that new area.
![](images/SoilErosionWatchAreaSelect.gif)

## Datasets

The App relies on state-of-the-art global opens-source datasets, which deserve to be mentioned for credits:
- [**SoilGrids 250m**](https://git.wur.nl/isric/soilgrids/soilgrids.notebooks/-/blob/master/markdown/access_on_gee.md):
The backbone of this App is the 250m SoiGrids soil covariates, without which attempting to model global soil erosion 
  would be inconsiderable. This work should be published soon:
  `de Sousa, L.,  Poggio, L.,  Batjes, N.H., Heuvelink, G.B.M., Kempen, B., Ribeiro, E.,  Rossiter, D. 
  SoilGrids 2.0: producing quality-assessed soil information for the globe. Under submission to SOIL`
  
- [**Africa Soil and Agronomy 30m datacube**](https://gitlab.com/openlandmap/africa-soil-and-agronomy-data-cube):
Africa gets preferential treatment thanks to these 30m soil covariates, used instead of the 250m SoilGrids covariates.
  This amazing work is summarized in the below publication:
  `Hengl, T., Miller, M. A., Križan, J., Shepherd, K. D., Sila, A.,
  Kilibarda, M., … others. (2021). African soil properties and nutrients
  mapped at 30 m spatial resolution using two-scale ensemble machine
  learning. Scientific Reports, 11(1), 1–18.`

- [**HiHydroSoil v2.0: Global Maps of Soil Hydraulic Properties at 250m resolution**](https://www.futurewater.eu/projects/hihydrosoil/):
A really useful dataset derived from SoilGrids data, focusing on hydraulic properties, which are central to the RUSLE concept, 
  since erosion by water is by far the dominant factor of soil erosion.
  The team behind this dataset published a report describing the provided data:
  `Simons, G.W.H., R. Koster, P. Droogers. 2020. 
  HiHydroSoil v2.0 - A high resolution soil map of global hydraulic properties. FutureWater Report 213.`
  
- [**ALOS AW3D30 DEM V3.2**](https://developers.google.com/earth-engine/datasets/catalog/JAXA_ALOS_AW3D30_V3_2):
  The latest revised 30m DEM from JAXA, an essential asset for modelling erosion:
  `T. Tadono, H. Ishida, F. Oda, S. Naito, K. Minakawa, H. Iwamoto : Precise Global DEM Generation By ALOS PRISM,
  ISPRS Annals of the Photogrammetry, Remote Sensing and Spatial Information Sciences, Vol.II-4, pp.71-76, 2014`

- [**MERIT Hydro: global hydrography datasets**](https://developers.google.com/earth-engine/datasets/catalog/MERIT_Hydro_v1_0_1):
A global hydrological dataset useful for estimating upslope contributing area to Erosion:
  `Yamazaki D., D. Ikeshima, J. Sosa, P.D. Bates, G.H. Allen, T.M. Pavelsky. 
  MERIT Hydro: A high-resolution global hydrography map based on latest topography datasets Water Resources Research, 
  vol.55, pp.5053-5073, 2019`

- [**ESDAC Global Rainfall Erosivity**](https://esdac.jrc.ec.europa.eu/content/global-rainfall-erosivity):
  The European Soil Data Centre is a goldmine of information, 
  and even provides datasets such as the Global Rainfall Erosivity (R factor in RUSLE) dataset based on a network of 3625 ground precipitation stations.
  Panos Panagos' tremendous contribution to the field of soil erosion modelling cannot be under-stated. The relevant publication is:
  `Panagos P., Borrelli P., Meusburger K., Yu B., Klik A., Lim K.J., Yang J.E, Ni J., Miao C., Chattopadhyay N., Sadeghi S.H., 
  Hazbavi Z., Zabihi M., Larionov G.A., Krasnov S.F., Garobets A., Levi Y., Erpul G., Birkel C., Hoyos N., Naipal V., Oliveira P.T.S., 
  Bonilla C.A., Meddi M., Nel W., Dashti H., Boni M., Diodato N., Van Oost K., Nearing M.A., Ballabio C., 2017. 
  Global rainfall erosivity assessment based on high-temporal resolution rainfall records. 
  Scientific Reports 7: 4175.`
  Other RUSLE factors provided by ESDAC are not used due to their coarseness or lack of global availability.
Those are recomputed using SoilGrids and the African Soil and Agronomy data cube for this App.
  
- [**Facebook High Resolution Settlement Layer (HRSL)**](https://research.fb.com/downloads/high-resolution-settlement-layer-hrsl/):
A 30m population layer which proves instrumental to mask out settlement areas from the analysis.
  
- [**GHSL: Global Human Settlement Layers, Built-up Grid 2015**](https://developers.google.com/earth-engine/datasets/catalog/JRC_GHSL_P2016_BUILT_LDSMT_GLOBE_V1):
This dataset is combined with the Facebook HRSL layer to make the built-up mask more complete:
  `Pesaresi, Martino; Ehrilch, Daniele; Florczyk, Aneta J.; Freire, Sergio; Julea, Andreea; Kemper, Thomas; Soille, Pierre; Syrris, Vasileios 
  (2015): GHS built-up grid, derived from Landsat, multitemporal (1975, 1990, 2000, 2014). 
  European Commission, Joint Research Centre (JRC)`
  
- [**JRC Global Surface Water Mapping Layers, v1.2**](https://developers.google.com/earth-engine/datasets/catalog/JRC_GSW1_2_GlobalSurfaceWater):
The Joint Research Centre (JRC) provides a high-resolution global water extent dataset, 
  which similarly to the previous two datasets, can be used to mask out the water from the analysis. 
  The dataset is described in the following publication:
  `Jean-Francois Pekel, Andrew Cottam, Noel Gorelick, Alan S. Belward, 
  High-resolution mapping of global surface water and its long-term changes. Nature 540, 418-422 (2016).`
  
- [**Sentinel-2**](https://developers.google.com/earth-engine/datasets/catalog/sentinel-2):
Last but not least, the highest covariates included in this soil erosion modelling exercise come in the form of Sentinel-2 time series.
  Computing RUSLE with highly granular covariates is essential to grasp field-level variability, 
  and make the modelling results actionable, i.e. to support landscape restoration planning, 
  as well as Monitoring, Reporting and Verification (MRV).
  The default displayed country is Kenya, for which Sentinel-2 country-wide bare soil and temporally-aggregated vegetation composites for 2020 
  are pre-computed and made available publically:
  - Bare Soil Median Composite using the **GEOS3** algorithm from:
    `Demattê, J. A., Safanelli, J. L., Poppiel, R. R., Rizzo, R., Silvero, N. E. Q., de Sousa Mendes, W., ... & da Silva Lisboa, C. J. 
    (2020). Bare earth’s Surface Spectra as a proxy for Soil Resource Monitoring. Scientific reports, 10(1), 1-11.`
    ```js
    var kenya_baresoil_2020 = ee.Image('users/soilwatch/KenyaBareSoilComposite2020');
    ```
  - Bare Soil Frequency, i.e. no of bare soil observations / no of cloud-free observations.
    ```js
    var kenya_bs_freq_2020 = ee.Image('users/soilwatch/KenyaBareSoilFrequency2020');
    ```
  - Median composite of non-bare soil pixels with NDVI > 0.25.
    ```js
    var kenya_median_2020 = ee.Image('users/WilliamOuellette/KenyaMedianComposite2020');
    ```

## Other Credits

Other invaluable resources used to piece this App together are many, but find here the main ones:
- [@jdbcode](https://github.com/jdbcode)'s repositories and contributions to GEE's 
  [community content](https://developers.google.com/earth-engine/tutorials).
  
- [@Samapriya](https://github.com/samapriya)'s [awesome-gee-community-dataset](https://github.com/samapriya/awesome-gee-community-datasets), 
  which was used to access existing datasets (Facebook HSRL layer), but also to reference new datasets like HiHydroSoil v2.0.
  
- Pasquale Borrelli's RUSLE-based global erosion modelling efforts, as illustrated by this paper:
  `Borrelli, P., Robinson, D. A., Fleischer, L. R., Lugato, E., Ballabio, C., Alewell, C., ... & Panagos, P. 
  (2017). An assessment of the global impact of 21st century land use change on soil erosion. 
  Nature communications, 8(1), 1-13.` This effort provided the scientific foundation behind the feasibility and usefulness of global soil erosion modelling.
  This effort builds on those efforts by incorporating high-resolution time series information in the modelling, 
  to provide more valuable field-level information that can support decision-making, and ultimately action.
  
- [Kibret et al., 2020](https://www.tandfonline.com/doi/full/10.1080/22797254.2020.1786466) 's GEE workflow was a great inspiration for 
  the implementation of the harmonic regression to Sentinel-2 data to provide smooth and gapless time series plots.
  
- [@kristofvt](https://github.com/kristofvt)'s contribution of the [sentinelhub custom-script for FCover](https://github.com/sentinel-hub/custom-scripts/tree/master/sentinel-2/fcover), which was adapted for the Google Earth Engine in this repository.
  
- The [GEE App](https://www.earthengine.app/) service, allowing the crunching of GBs in minutes to deliverable valuable, 
  domain-specific insight in the hands of many.
  
- Many other sources of inspiration and scientific papers!
  
## Disclaimer
Aside from Kenya, the underlying covariates used to calculate RUSLE are not pre-computed, 
meaning that the processing time may last up to a few minutes in some cases. 
It is recommended to select sub-administrative areas that are smaller than 10 000 km². 
Theoretically, larger areas can be computed, but patience is required!

Computing a Soil Annual Loss Rate (`A`) layer at global scale for 2020 will be considered once community feedback will be received,
especially from the scientific side, so that the produced data is as relevant and useful as can be.

Feel free to re-use any part of the code to produce your own app, or add your own functionalities on top.

## Footnote
*A few other verses from the same legendary Led Zeppelin's song make me believe environmental restoration was dear to their heart:
- "And a new day will dawn for those who stand long, and the forests will echo with laughter"
- "Yes, there are two paths you can go by, but in the long run there's still time to change the road you're on"

If generating data for a custom area of interest through the App takes longer than the duration of `Stairway to Heaven (8:02)`, 
then you are probably going to have to choose a shorter time period, or a smaller area for aggregation... 
