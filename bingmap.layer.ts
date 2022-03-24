import { TileLayer, TileLayerOptions } from 'leaflet';
import * as L from 'leaflet';

export interface BingOptions extends TileLayerOptions {
  bingMapsKey?: string,
  imagerySet?: string,
  culture?: "en-US",
  minZoom?: 1,
  minNativeZoom?: 1,
  maxNativeZoom?: 19,
  style?: string,
  visible?: boolean,
}

// 'AuUhEkxn8U72sGMKcUR_8mMhD5f882wua87imHOQ9HWl06K-svQjWTGEJAbEPBg6'
export class BingLayer extends TileLayer {
  options: BingOptions;

  static METADATA_URL = "https://dev.virtualearth.net/REST/v1/Imagery/Metadata/Aerial?key=AuUhEkxn8U72sGMKcUR_8mMhD5f882wua87imHOQ9HWl06K-svQjWTGEJAbEPBg6&include=ImageryProviders&uriScheme=https";
  static POINT_METADATA_URL = "https://dev.virtualearth.net/REST/v1/Imagery/Metadata/Aerial/{lat},{lng}?zl={z}&key=AuUhEkxn8U72sGMKcUR_8mMhD5f882wua87imHOQ9HWl06K-svQjWTGEJAbEPBg6&uriScheme=https";

  fetchJsonp = require("fetch-jsonp");
  _url: string;
  _imageryProviders: [];
  _fetch;
  _getSubdomain;
  _attributions: [];
  _updateAttribution;
  _onTileRemove

   VALID_IMAGERY_SETS = [
    'Aerial',
    'AerialWithLabels',
    'AerialWithLabelsOnDemand',
    'Road',
    'RoadOnDemand',
    'CanvasLight',
    'CanvasDark',
    'CanvasGray',
    'OrdnanceSurvey'
  ]
  
   DYNAMIC_IMAGERY_SETS = [
    'AerialWithLabelsOnDemand',
    'RoadOnDemand'
  ]

  constructor(options: BingOptions) {

    super(`https://www.bing.com/api/maps/mapcontrol?callback=GetMap&key=${options.bingMapsKey}`, options)


    if (typeof options === 'string') {
      options = { bingMapsKey: options }
    }
    if (options && options.bingMapsKey) {
      options.bingMapsKey = options.bingMapsKey
      console.warn('use options.bingMapsKey instead of options.BingMapsKey')
    }
    if (!options || !options.bingMapsKey) {
      throw new Error('Must supply options.BingMapsKey')
    }
    options = L.Util.setOptions(this, options)
    if (this.VALID_IMAGERY_SETS.indexOf(options.imagerySet) < 0) {
      throw new Error("'" + options.imagerySet + "' is an invalid imagerySet, see https://github.com/digidem/leaflet-bing-layer#parameters")
    }
    if (options && options.style && this.DYNAMIC_IMAGERY_SETS.indexOf(options.imagerySet) < 0) {
      console.warn('Dynamic styles will only work with these imagerySet choices: ' + this.DYNAMIC_IMAGERY_SETS.join(', '))
    }

    var metaDataUrl = L.Util.template(BingLayer.METADATA_URL, {
      bingMapsKey: this.options.bingMapsKey,
      imagerySet: this.options.imagerySet
    })

    this._imageryProviders = []
    this._attributions = []

    // Keep a reference to the promise so we can use it later
    this._fetch = this.fetchJsonp(metaDataUrl, {jsonpCallback: 'jsonp'})
      .then(function (response) {
        return response.json()
      })
      .then(this._metaDataOnLoad.bind(this))
      .catch(console.error.bind(console))

    // for https://github.com/Leaflet/Leaflet/issues/137
    if (!L.Browser.android) {
      this.on('tileunload', this._onTileRemove)
    }

  }


  toQuadKey(x, y, z) {
    var index = "";
    for (var i = z; i > 0; i--) {
      var b = 0;
      var mask = 1 << (i - 1);
      if ((x & mask) !== 0) b++;
      if ((y & mask) !== 0) b += 2;
      index += b.toString();
    }
    return index;
  }

  toBingBBox(bboxString) {
    var bbox = bboxString.split(",");
    return [bbox[1], bbox[0], bbox[3], bbox[2]];
  }

  createTile(coords, done) {
    var tile = document.createElement("img");

    L.DomEvent.on(
      tile,
      "load",
      L.Util.bind(this._tileOnLoad, this, done, tile)
    );
    L.DomEvent.on(
      tile,
      "error",
      L.Util.bind(this._tileOnError, this, done, tile)
    );

    if (this.options.crossOrigin) {
      tile.crossOrigin = "";
    }
    tile.alt = "";
    // Don't create closure if we don't have to
    if (this._url) {
      tile.src = this.getTileUrl(coords);
    } else {
      this._fetch.then(function () {
        tile.src = this.getTileUrl(coords);
      }.bind(this)
      )
        .catch((e) => {
          console.error(e);
          done(e);
        });
    }
    return tile;
  }

  getTileUrl(coords) {
    var quadkey = this.toQuadKey(coords.x, coords.y, coords.z);
    var url = L.Util.template(this._url, {
      quadkey: quadkey,
      subdomain: this._getSubdomain(coords),
      culture: this.options.culture,
    });
    if (typeof this.options.style === "string") {
      url += "&st=" + this.options.style;
    }
    return url;
  }

  onAdd(map: L.Map) {
    this.options.maxZoom = map.getMaxZoom();
    return super.onAdd(map);
  }

  _removeTile(key) {
    if (this._map.getZoom() >= 20) {
      return;
    }
    return (TileLayer.prototype as any)._removeTile.call(this, key);
  }

  // Update the attribution control every time the map is moved
  onAddBingLayer(map: L.Map) {
    map.on("moveend", this._updateAttribution, this);
    L.TileLayer.prototype.onAdd.call(this, map);
    this._attributions.forEach((attribution) => {
      map.attributionControl.addAttribution(attribution);
    });
  }

  // Clean up events and remove attributions from attribution control
  onRemoveBingLayer(map: L.Map) {
    map.off("moveend", this._updateAttribution, this);
    this._attributions.forEach((attribution) => {
      map.attributionControl.removeAttribution(attribution);
    });
    L.TileLayer.prototype.onRemove.call(this, map);
  }

  getMetaData(latlng, zoom) {
    if (!this._map && (!latlng || !zoom)) {
      return Promise.reject(
        new Error(
          "If layer is not attached to map, you must provide LatLng and zoom"
        )
      );
    }
    latlng = latlng || this._map.getCenter();
    zoom = zoom || this._map.getZoom();
    var PointMetaDataUrl = L.Util.template(
      BingLayer.POINT_METADATA_URL,
      {
        bingMapsKey: this.options.bingMapsKey,
        imagerySet: this.options.imagerySet,
        z: zoom,
        lat: latlng.lat,
        lng: latlng.lng,
      }
    );
    return this.fetchJsonp(PointMetaDataUrl, { jsonpCallback: "jsonp" })
      .then((response) => {
        return response.json();
      })
      .catch(console.error.bind(console));
  }

  _metaDataOnLoad(metaData) {
    if (metaData.statusCode !== 200) {
      throw new Error(
        "Bing Imagery Metadata error: \n" +
        JSON.stringify(metaData, null, "  ")
      );
    }
    var resource = metaData.resourceSets[0].resources[0];
    this._url = resource.imageUrl;
    this._imageryProviders = resource.imageryProviders || [];
    this.options.subdomains = resource.imageUrlSubdomains;
    this._updateAttribution();
    return Promise.resolve();
  }

}
