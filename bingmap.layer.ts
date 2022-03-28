import * as L from 'leaflet';
import { TileLayer, TileLayerOptions } from 'leaflet';

export enum VALID_IMAGERY_SETS {
  'Aerial' = 'Aerial',
  'AerialWithLabels' = 'AerialWithLabels',
  'AerialWithLabelsOnDemand' = 'AerialWithLabelsOnDemand',
  'Road' = 'Road',
  'RoadOnDemand' = 'RoadOnDemand',
  'CanvasLight' = 'CanvasLight',
  'CanvasDark' = 'CanvasDark',
  'CanvasGray' = 'CanvasGray',
  'OrdnanceSurvey' = 'OrdnanceSurvey',
}
export enum DYNAMIC_IMAGERY_SETS {
  'AerialWithLabelsOnDemand' = 'AerialWithLabelsOnDemand',
  'RoadOnDemand' = 'RoadOnDemand',
}
export interface BingOptions extends TileLayerOptions {
  bingMapsKey: string;
  imagerySet?: VALID_IMAGERY_SETS;
  culture?: 'en-US';
  minZoom?: 1;
  minNativeZoom?: 1;
  maxNativeZoom?: 19;
  style?: DYNAMIC_IMAGERY_SETS;
  visible?: boolean;
}

export class BingLayer extends TileLayer {
  options: BingOptions;

  static METADATA_URL =
    'https://dev.virtualearth.net/REST/v1/Imagery/Metadata/Aerial?key=AuUhEkxn8U72sGMKcUR_8mMhD5f882wua87imHOQ9HWl06K-svQjWTGEJAbEPBg6&include=ImageryProviders&uriScheme=https';
  static POINT_METADATA_URL =
    'https://dev.virtualearth.net/REST/v1/Imagery/Metadata/Aerial/{lat},{lng}?zl={z}&key=AuUhEkxn8U72sGMKcUR_8mMhD5f882wua87imHOQ9HWl06K-svQjWTGEJAbEPBg6&uriScheme=https';

  _imageryProviders: [];
  _getSubdomain;
  _attributions: [];
  _updateAttribution;
  _onTileRemove;
  _url: string;

  constructor(options: BingOptions) {
    super(null, options);

    options = L.Util.setOptions(this, options);

    this._imageryProviders = [];
    this._attributions = [];

    if (!L.Browser.android) {
      this.on('tileunload', this._onTileRemove);
    }
  }

  _fetch() {
    var metaDataUrl = L.Util.template(BingLayer.METADATA_URL, {
      bingMapsKey: this.options.bingMapsKey,
      imagerySet: this.options.imagerySet,
    });
    return fetch(metaDataUrl)
      .then(function (response) {
        return response.json();
      })
      .then(this._metaDataOnLoad.bind(this))
      .catch(console.error.bind(console));
  }

  toQuadKey(x, y, z) {
    var index = '';
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
    var bbox = bboxString.split(',');
    return [bbox[1], bbox[0], bbox[3], bbox[2]];
  }

  createTile(coords, done) {
    var tile = document.createElement('img');

    L.DomEvent.on(
      tile,
      'load',
      L.Util.bind(this._tileOnLoad, this, done, tile)
    );
    L.DomEvent.on(
      tile,
      'error',
      L.Util.bind(this._tileOnError, this, done, tile)
    );

    if (this.options.crossOrigin) {
      tile.crossOrigin = '';
    }
    tile.alt = '';
    // Don't create closure if we don't have to
    if (this._url) {
      tile.src = this.getTileUrl(coords);
    } else {
      this._fetch()
        .then(
          function () {
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
    if (typeof this.options.style === 'string') {
      url += '&st=' + this.options.style;
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
    map.on('moveend', this._updateAttribution, this);
    L.TileLayer.prototype.onAdd.call(this, map);
    this._attributions.forEach((attribution) => {
      map.attributionControl.addAttribution(attribution);
    });
  }

  // Clean up events and remove attributions from attribution control
  onRemoveBingLayer(map: L.Map) {
    map.off('moveend', this._updateAttribution, this);
    this._attributions.forEach((attribution) => {
      map.attributionControl.removeAttribution(attribution);
    });
    L.TileLayer.prototype.onRemove.call(this, map);
  }

  _metaDataOnLoad(metaData) {
    if (metaData.statusCode !== 200 && metaData.statusCode !== 429) {
      throw new Error(
        'Bing Imagery Metadata error: \n' + JSON.stringify(metaData, null, '  ')
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
