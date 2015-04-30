// ELASTIC TERRAIN MAP

// Copyright (C) 2015 Jonas Buddeberg <buddebej * mailbox.org>, 
//                    Bernhard Jenny <jennyb * geo.oregonstate.edu>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

goog.provide('ol.renderer.webgl.TileDemLayer');

goog.require('goog.array');
goog.require('goog.asserts');
goog.require('goog.object');
goog.require('goog.vec.Mat4');
goog.require('goog.vec.Vec4');
goog.require('goog.webgl');
goog.require('ol.TileRange');
goog.require('ol.TileCache');
goog.require('ol.TileState');
goog.require('ol.extent');
goog.require('ol.Kinetic');
goog.require('ol.layer.TileDem');
goog.require('ol.layer.Tile');
goog.require('ol.math');
goog.require('ol.renderer.webgl.Layer');
goog.require('ol.renderer.webgl.tiledemlayer.shader');
goog.require('ol.tilecoord');
goog.require('ol.tilegrid.TileGrid');
goog.require('ol.webgl.Buffer');
goog.require('ol.Elevation');
goog.require('ol.ColorRamp');

/**
 *
 * @constructor
 * @extends {ol.renderer.webgl.Layer}
 * @param {ol.renderer.Map} mapRenderer Map renderer.
 * @param {ol.layer.TileDem} tileDemLayer Tile layer.
 */
ol.renderer.webgl.TileDemLayer = function(mapRenderer, tileDemLayer) {
    goog.base(this, mapRenderer, tileDemLayer);

    /**
     * @private
     * @type {ol.webgl.shader.Fragment}
     */
    this.fragmentShader_ =
        ol.renderer.webgl.tiledemlayer.shader.Fragment.getInstance();

    /**
     * @private
     * @type {ol.webgl.shader.Vertex}
     */
    this.vertexShader_ = ol.renderer.webgl.tiledemlayer.shader.Vertex.getInstance();

    /**
     * @private
     * @type {ol.renderer.webgl.tiledemlayer.shader.Locations}
     */
    this.locations_ = null;

    /**
     * OverlayTiles
     * @private
     * @type {Object.<string, boolean|number|ol.layer.Tile|ol.source.TileImage|function(boolean):boolean>} 
     */
    this.overlay = {
        'Active': false,
        'ID': 0,
        'Tiles': null,
        'Source': null
    };
    /**
     * @private
     * @type {ol.TileRange}
     */
    this.renderedTileRange_ = null;

    /**
     * @private
     * @type {ol.Extent}
     */
    this.renderedFramebufferExtent_ = null;

    /**
     * @private
     * @type {ol.Extent}
     */
    this.visibleFramebufferExtent_ = null;

    /**
     * @private
     * @type {number}
     */
    this.renderedRevision_ = -1;

    /**
     * @private
     * @type {WebGLTexture}
     */
    this.textureHypsometricColors_ = null;

    /**
     * @private
     * @type {WebGLTexture}
     */
    this.textureBathymetricColors_ = null;

    /**
     * @private
     * @type {number}
     */
    this.timeoutCounter_ = 0;

    /**
     * Padding around visible extent in pixel    
     * @private
     * @type {number}
     */
    this.tilePadding_ = 200;

    /**
     * Timeout for loading of tiles = max rendering calls per execution
     * @private
     * @type {number}
     */
    this.timeoutCounterMax_ = 450;

    /**
     * @private
     * @type {ol.TileCache}
     */
    this.tileCache_ = null;

    /**
     * @private
     * @type {ol.tilegrid.TileGrid}
     */
    this.tileGrid_ = null;

    /**
     * Max Zoomlevel of DEM Layer for z-Ordering in Shader
     * @private
     * @type {number}
     */
    this.maxZoom_ = 19;

    /**
     * @private
     * @type {number}
     */
    this.maxElevationInExtent = ol.Elevation.MIN;

    /**
     * @private
     * @type {number}
     */
    this.minElevationInExtent = ol.Elevation.MAX;

    /**
     * @private
     * @type {number}
     */
    this.maxLocalElevation = ol.Elevation.MIN;

    /**
     * @private
     * @type {number}
     */
    this.minLocalElevation = ol.Elevation.MAX;

    /**
     * @private
     * @type {boolean}
     */
    this.freezeMinMax = false;

};

goog.inherits(ol.renderer.webgl.TileDemLayer, ol.renderer.webgl.Layer);

/**
 * @inheritDoc
 */
ol.renderer.webgl.TileDemLayer.prototype.disposeInternal = function() {
    var mapRenderer = this.getWebGLMapRenderer();
    var context = mapRenderer.getContext();
    context.deleteBuffer(this.tileMesh_.vertexBuffer);
    context.deleteBuffer(this.tileMesh_.indexBuffer);
    goog.base(this, 'disposeInternal');
};

/**
 * @inheritDoc
 */
ol.renderer.webgl.TileDemLayer.prototype.handleWebGLContextLost = function() {
    goog.base(this, 'handleWebGLContextLost');
    this.locations_ = null;
};

/**
 * @public
 * @param {boolean} state State
 */
ol.renderer.webgl.TileDemLayer.prototype.setFreezeMinMax = function(state) {
    this.freezeMinMax = state;
};

/**
 * @public
 * @param {Array} xy in Mercator 
 * @param {number} z Zoomlevel
 * @return {ol.TileCoord}
 */
ol.renderer.webgl.TileDemLayer.prototype.getTileCoord = function(xy, z) {
    return this.tileGrid_.getTileCoordForCoordAndZ(xy, z);
};

/**
 * @public
 * @param {Array} xy in Mercator 
 * @param {number|undefined} z Zoomlevel
 * @return {number|null}
 */
ol.renderer.webgl.TileDemLayer.prototype.getElevation = function(xy, z) {
    var tc = this.getTileCoord(xy, ((!goog.isDef(z)) ? 1 : z)),
        xyzKey = ol.tilecoord.getKeyZXY(tc[0], tc[1], tc[2]),
        tileExtent = this.tileGrid_.getTileCoordExtent(tc), // minX, minY, maxX, maxY
        tileXY = [0, 0],
        elevation = 0,
        tile = null;
    // check if tile is in cache
    if (this.tileCache_.containsKey(xyzKey)) {
        tile = this.tileCache_.get(xyzKey);
        tileXY[0] = Math.floor(((xy[0] - tileExtent[0]) / (tileExtent[2] - tileExtent[0])) * 256);
        tileXY[1] = 256 - Math.floor(((xy[1] - tileExtent[1]) / (tileExtent[3] - tileExtent[1])) * 256);
        elevation = ol.Elevation.decode(tile.getPixelValue(tileXY), z);
    }
    return elevation;
};

/**
 * @public
 * @return {Array} min max elevation of current extent
 */
ol.renderer.webgl.TileDemLayer.prototype.getCurrentMinMax = function() {
    return [this.minElevationInExtent, this.maxElevationInExtent];
};

/**
 * @private
 * @param {ol.Tile} tile Tile
 */
ol.renderer.webgl.TileDemLayer.prototype.updateCurrentMinMax = function(tile) {
    if (goog.isDef(tile) && !this.freezeMinMax) {

        var tileCenter = this.tileGrid_.getTileCoordCenter(tile.tileCoord);
        // ignore minMax values if tile is beyond visible extent
        if (ol.extent.containsCoordinate(this.visibleFramebufferExtent_, tileCenter)) {
            var tileMinMax = tile.getMinMaxElevations();
            if (tileMinMax[0] < this.minElevationInExtent && tileMinMax[1] < ol.Elevation.MAX && tileMinMax[1] !== 0 && tileMinMax[0] !== 0) {
                this.minElevationInExtent = tileMinMax[0];
            }
            if (tileMinMax[1] > this.maxElevationInExtent && tileMinMax[1] < ol.Elevation.MAX) {
                this.maxElevationInExtent = tileMinMax[1];
            }
        }
    }
};

/**
 * @private
 */
ol.renderer.webgl.TileDemLayer.prototype.resetCurrentMinMax = function() {
    if (!this.freezeMinMax) {
        this.minElevationInExtent = ol.Elevation.MAX;
        this.maxElevationInExtent = ol.Elevation.MIN;
    }
};

/**
 * @public
 */
ol.renderer.webgl.TileDemLayer.prototype.clearTileCache = function() {
    this.tileCache_.clear();
};

/**
 * @public
 * @param {Array} xy in Mercator 
 * @param {number|undefined} z Zoomlevel
 * @return {Array} min max elevation of coordinate neighborhood
 */
ol.renderer.webgl.TileDemLayer.prototype.getLocalMinMax = function(xy, z) {

    // compute local coordinates of a segment within a tile (see imagetile.js)
    var getSegmentCoord = function(tc, segmentsXY) {
            // Tile minX, minY, maxX, maxY
            var tileExtent = this.tileGrid_.getTileCoordExtent(tc),

                // Length of tile edge in web mercator
                tileLengthXCoord = tileExtent[2] - tileExtent[0],
                tileLengthYCoord = tileExtent[3] - tileExtent[1],

                segmentSizeRel = 1 / segmentsXY,
                segmentSizeAbsX = tileLengthXCoord * segmentSizeRel,
                segmentSizeAbsY = tileLengthYCoord * segmentSizeRel,

                // Compute Segment Coordinates
                segmentX = Math.ceil((xy[0] - tileExtent[0]) / segmentSizeAbsX) - 1,
                // flip coordinates
                segmentY = segmentsXY - Math.ceil((xy[1] - tileExtent[1]) / segmentSizeAbsY);

            return [segmentX, segmentY];
        }.bind(this),

        // create a two dimensional array
        make2dArray = function(size) {
            var destArray = new Array(size);
            for (var l = 0; l < size; l = l + 1) {
                destArray[l] = new Array(size);
            }
            return destArray;
        },

        // create a matrix that contains coordinates of adjacent neighbors
        createAdjacentNeighborMatrix = function(x, y, flipy) {
            var destMatrix = make2dArray(3);
            //  0 1 2
            //  3 4 5
            //  6 7 8

            // 4 is center object with xy coordinates

            var sign = (flipy) ? -1 : 1;
            // row 0
            destMatrix[0] = [{
                x: x - 1,
                y: y + 1 * sign
            }, {
                x: x,
                y: y + 1 * sign
            }, {
                x: x + 1,
                y: y + 1 * sign
            }];
            // row 1 
            destMatrix[1] = [{
                x: x - 1,
                y: y
            }, {
                x: x, // center object
                y: y // center object
            }, {
                x: x + 1,
                y: y
            }];
            // row 2 
            destMatrix[2] = [{
                x: x - 1,
                y: y - 1 * sign
            }, {
                x: x,
                y: y - 1 * sign
            }, {
                x: x + 1,
                y: y - 1 * sign
            }];
            return destMatrix;
        };

    var // number of segments i.e. 3x3
        neighborhoodSize = 3,
        // coordinates for clicked tile
        clickedTileCoord = this.getTileCoord(xy, ((!goog.isDef(z)) ? 1 : z)),
        // tile key for clicked tile
        clickedXyzKey = ol.tilecoord.getKeyZXY(clickedTileCoord[0], clickedTileCoord[1], clickedTileCoord[2]),
        // handle for tile that was clicked
        clickedTile = null;
    // test if tile is in cache
    if (this.tileCache_.containsKey(clickedXyzKey)) {
        clickedTile = this.tileCache_.get(clickedXyzKey);
        var // number of segments per tile in XY direction
            tileSegmentsXY = clickedTile.segmentsXY,
            // segment coordinates for clicked segment within tile (see imagetile.js)
            clickedSegmentCoord = getSegmentCoord(clickedTileCoord, tileSegmentsXY),
            // minMax for clicked segment
            clickedSegmentMinMax = clickedTile.getSegmentMinMaxElevations(clickedSegmentCoord),

            // matrix for coordinates of neighbor tiles relative to clicked tile
            neighborTilesCoordinates = createAdjacentNeighborMatrix(clickedTileCoord[1], clickedTileCoord[2], false),
            // matrix for coordinates of neighbor segments relative to clicked segment
            neighborSegmentsCoordinates = createAdjacentNeighborMatrix(clickedSegmentCoord[0] + tileSegmentsXY, clickedSegmentCoord[1] + tileSegmentsXY, true),
            // number of segments in global segment array
            neighborSegmentsXY = neighborhoodSize * tileSegmentsXY,
            // array for all segments in one array for entire neighborhood
            neighborSegmentStore = make2dArray(neighborSegmentsXY),
            localMinMax = [0.0, 0.0];

        if (ol.Elevation.MinMaxNeighborhoodSize === 0) {
            // compute only single segment minmax
            localMinMax = clickedSegmentMinMax;
        } else {
            // compute neighborhood segment minMax
            // loop through destination tile segments store and get copies of all tile segments 
            for (var segmentRow = 0; segmentRow < neighborSegmentsXY; segmentRow++) {
                for (var segmentCol = 0; segmentCol < neighborSegmentsXY; segmentCol++) {
                    var // compute row and column of tile that contains the segment
                        tileRow = goog.math.safeFloor(segmentRow / tileSegmentsXY),
                        tileCol = goog.math.safeFloor(segmentCol / tileSegmentsXY),
                        tile = null,
                        xyzKey = ol.tilecoord.getKeyZXY(clickedTileCoord[0], neighborTilesCoordinates[tileRow][tileCol].x, neighborTilesCoordinates[tileRow][tileCol].y);
                    // get handle for the relevant tile
                    if (this.tileCache_.containsKey(xyzKey)) {
                        tile = this.tileCache_.get(xyzKey);
                        // get the segments
                        var nSegments = tile.getSegments(),
                            // copy the corresponding segment from the tile segment store to the global segment store
                            segmentCopy = nSegments[goog.math.safeFloor(segmentCol / neighborhoodSize)][goog.math.safeFloor(segmentRow / neighborhoodSize)];
                        neighborSegmentStore[segmentCol][segmentRow] = segmentCopy;
                    }
                }
            }

            var segmentCounter = 0;
            // read minMax for relevant segments
            for (var segmentRow = 0; segmentRow < neighborhoodSize; segmentRow++) {
                for (var segmentCol = 0; segmentCol < neighborhoodSize; segmentCol++) {

                    var segmentX = neighborSegmentsCoordinates[segmentRow][segmentCol].x,
                        segmentY = neighborSegmentsCoordinates[segmentRow][segmentCol].y;

                    if (goog.isDef(neighborSegmentStore[segmentX][segmentY])) {
                        localMinMax[0] += neighborSegmentStore[segmentX][segmentY][0];
                        localMinMax[1] += neighborSegmentStore[segmentX][segmentY][1];
                        segmentCounter++;
                    }
                }
            }
            // average minMax values
            localMinMax[0] = localMinMax[0] / segmentCounter;
            localMinMax[1] = localMinMax[1] / segmentCounter;
        }
        return localMinMax;
    } else {
        return [this.minElevationInExtent, this.maxElevationInExtent];
    }
};


/**
 * VertexBuffer contains vertices: meshResolution * meshResolution
 * IndexBuffer contains elements for vertexBuffer
 * @private
 * @return {Object.<string, ol.webgl.Buffer>} vertexBuffer, indexBuffer
 */
ol.renderer.webgl.TileDemLayer.prototype.getTileMesh = function(meshResolution) {
    var vb = [],
        tb = [],
        ib = [],
        v = 0,
        vertices = meshResolution, // number of vertices per edge
        cellSize = 1 / (vertices - 1);
    // rows
    for (var x = 0; x < vertices; x += 1) {
        // columns
        for (var y = 0; y < vertices; y += 1) {
            // vertex coordinates
            vb.push(x * cellSize, y * cellSize);
            // dont draw triangles beyond tile extend!      
            if (x < vertices - 1 && y < vertices - 1) {
                // two triangles
                // v+vertices *\ * v+vertices+1
                //          v * \* v+1
                ib.push(v, v + vertices, v + 1, v + vertices, v + vertices + 1, v + 1);
            }
            v += 1;
        }
    }
    return {
        vertexBuffer: new ol.webgl.Buffer(vb),
        indexBuffer: new ol.webgl.Buffer(ib)
    };
};

/**
 * @inheritDoc
 */
ol.renderer.webgl.TileDemLayer.prototype.prepareFrame = function(frameState, layerState, context) {
    // INIT
    var mapRenderer = this.getWebGLMapRenderer();
    var map = mapRenderer.map_;
    var gl = context.getGL();
    var viewState = frameState.viewState;
    var viewZoom = map.getView().getZoom();
    var projection = viewState.projection;
    var tileDemLayer = this.getLayer();
    goog.asserts.assertInstanceof(tileDemLayer, ol.layer.TileDem);
    var tileSource = tileDemLayer.getSource();

    if (goog.isNull(this.tileCache_)) {
        this.tileCache_ = /** @type {ol.source.TileImage} */ (tileSource).tileCache;
    }
    var tileGrid = tileSource.getTileGridForProjection(projection);
    if (goog.isNull(this.tileGrid_)) {
        this.tileGrid_ = tileGrid;
    }
    var z = tileGrid.getZForResolution(viewState.resolution);
    var tileResolution = tileGrid.getResolution(z);
    var tilePixelSize = tileSource.getTilePixelSize(z, frameState.pixelRatio, projection);
    var pixelRatio = tilePixelSize / tileGrid.getTileSize(z);
    var tilePixelResolution = tileResolution / pixelRatio;
    var tileGutter = tileSource.getGutter();
    var center = viewState.center;
    var extent;
    this.timeoutCounter_++;

    // increase tile extent 
    var padding = {
        x: this.tilePadding_,
        y: this.tilePadding_
    };
    if (tileResolution == viewState.resolution) {
        this.visibleFramebufferExtent_ = ol.extent.getForViewAndSize(center, tileResolution, viewState.rotation, [frameState.size[0], frameState.size[1]]);
        center = this.snapCenterToPixel(center, tileResolution, [frameState.size[0] - padding.x, frameState.size[1] - padding.y]);
        extent = ol.extent.getForViewAndSize(center, tileResolution, viewState.rotation, [frameState.size[0] + padding.x, frameState.size[1] + padding.y]);
    } else {
        extent = frameState.extent;
    }

    var tileRange = tileGrid.getTileRangeForExtentAndResolution(extent, tileResolution);
    var framebufferExtent;

    // LOAD SHADERS
    var program = context.getProgram(this.fragmentShader_, this.vertexShader_);
    context.useProgram(program);
    if (goog.isNull(this.locations_)) {
        this.locations_ = new ol.renderer.webgl.tiledemlayer.shader.Locations(gl, program);
    }

    if (!goog.isNull(this.renderedTileRange_) && this.renderedTileRange_.equals(tileRange) && this.renderedRevision_ == tileSource.getRevision()) {
        // DO NOTHING, RE-RENDERING NOT NEEDED
        framebufferExtent = this.renderedFramebufferExtent_;
    } else {
        // (RE-)RENDER COMPLETE VIEWPORT 
        // COMPUTE EXTENT OF FRAMEBUFFER
        var tileRangeSize = tileRange.getSize();
        var maxDimension = Math.max(tileRangeSize[0] * tilePixelSize, tileRangeSize[1] * tilePixelSize);
        var framebufferDimension = ol.math.roundUpToPowerOfTwo(maxDimension);
        var framebufferExtentDimension = tilePixelResolution * framebufferDimension;
        var origin = tileGrid.getOrigin(z);
        var minX = origin[0] + tileRange.minX * tilePixelSize * tilePixelResolution;
        var minY = origin[1] + tileRange.minY * tilePixelSize * tilePixelResolution;
        framebufferExtent = [
            minX, minY,
            minX + framebufferExtentDimension, minY + framebufferExtentDimension
        ];

        this.bindFramebuffer(frameState, framebufferDimension);
        gl.viewport(0, 0, framebufferDimension, framebufferDimension);

        // CLEAR BUFFERS
        gl.clearColor(0, 0, 0, 0);
        gl.clear(goog.webgl.COLOR_BUFFER_BIT);
        gl.clearDepth(1.0);
        gl.clear(goog.webgl.DEPTH_BUFFER_BIT);

        // INTIAL CHECK FOR OVERLAY
        if (!goog.isNull(tileDemLayer.getOverlayTiles())) { // check if a Layer was defined for overlay
            this.overlay.Id = map.getLayers().getArray().indexOf(tileDemLayer.getOverlayTiles());
            if (this.overlay.Id >= 0) {
                this.overlay.Active = true;
            }
        } else {
            this.overlay.Active = false;
        }

        // TERRAIN SHEARING
        var shearX, shearY, shearingFactor;
        if (tileDemLayer.getTerrainInteraction()) {
            // from current terrain interaction
            shearingFactor = tileDemLayer.getTerrainShearing();
            shearX = shearingFactor.x;
            shearY = shearingFactor.y;

        } else {
            // from obliqueInclination angle and current rotation
            shearingFactor = (1.0 / Math.tan(goog.math.toRadians(tileDemLayer.getObliqueInclination()))) * (this.maxElevationInExtent - this.minElevationInExtent);
            shearX = shearingFactor * Math.sin(-viewState.rotation);
            shearY = shearingFactor * Math.cos(-viewState.rotation);
        }

        // u_scaleFactor: factors for plan oblique shearing
        gl.uniform2f(this.locations_.u_scaleFactor, shearX, shearY);
        // u_tileSizeM: estimated size of one tile in meter at the equator (dependend of current zoomlevel z)
        gl.uniform1f(this.locations_.u_tileSizeM, 40000000.0 / Math.pow(2.0, z));

        // FRAGMENT SHADER PARAMETER
        // u_overlayActive: Is overlay active?
        gl.uniform1f(this.locations_.u_overlayActive, this.overlay.Active === true ? 1.0 : 0.0);
        // u_colorScale: pass colorScale factor to adapt color ramp dynamically
        gl.uniform2f(this.locations_.u_colorScale, tileDemLayer.getColorScale()[0], tileDemLayer.getColorScale()[1]);
        // u_stackedCardb: pass stackedCardboard flag
        gl.uniform1f(this.locations_.u_stackedCardb, tileDemLayer.getStackedCardboard() === true ? 1.0 : 0.0);
        // u_waterBodies: pass waterBodies to toggle rendering of inland waterBodies
        gl.uniform1f(this.locations_.u_waterBodies, tileDemLayer.getWaterBodies() === true ? 1.0 : 0.0);
        // u_shading: pass flag to activate Shading
        gl.uniform1f(this.locations_.u_shading, tileDemLayer.getShading() === true ? 1.0 : 0.0);
        // u_ShadingOpacity: pass ShadingOpacity
        gl.uniform1f(this.locations_.u_shadingOpacity, tileDemLayer.getShadingOpacity());
        // u_hsExaggeration: pass ShadingExaggeration
        gl.uniform1f(this.locations_.u_hsExaggeration, tileDemLayer.getShadingExaggeration());

        // u_testing: pass flag to activate testing mode
        gl.uniform1f(this.locations_.u_testing, tileDemLayer.getTesting() === true ? 1.0 : 0.0);

        // u_light: compute light direction from Zenith and Azimuth and dependend of current map rotation
        var zenithRad = goog.math.toRadians(90.0 - tileDemLayer.getLightZenith()),
            azimuthRad = goog.math.toRadians(tileDemLayer.getLightAzimuth()) + viewState.rotation,
            lightZ = Math.cos(zenithRad),
            lightY = Math.sin(zenithRad) * Math.cos(azimuthRad),
            lightX = Math.sin(zenithRad) * Math.sin(azimuthRad);
        gl.uniform3f(this.locations_.u_light, lightX, lightY, lightZ);
        // u_ambient_light: pass intensity for an ambient light source
        gl.uniform1f(this.locations_.u_ambient_light, tileDemLayer.getAmbientLight());

        gl.uniform1f(this.locations_.u_minElevation, this.minElevationInExtent);
        gl.uniform1f(this.locations_.u_maxElevation, this.maxElevationInExtent);

        // COLORING
        // create lookup texture only once
        if (goog.isNull(this.textureHypsometricColors_)) {
            this.textureHypsometricColors_ = gl.createTexture();
        }
        var arrayHypsometryColors = new Uint8Array(ol.ColorRamp.hypsometry[tileDemLayer.getColorRamp()]);
        gl.activeTexture(goog.webgl.TEXTURE2);
        gl.bindTexture(goog.webgl.TEXTURE_2D, this.textureHypsometricColors_);

        // read color ramp array
        gl.texImage2D(goog.webgl.TEXTURE_2D, 0, goog.webgl.RGBA, 1, arrayHypsometryColors.length / 4, 0, goog.webgl.RGBA, goog.webgl.UNSIGNED_BYTE, arrayHypsometryColors);
        gl.texParameteri(goog.webgl.TEXTURE_2D, goog.webgl.TEXTURE_MIN_FILTER, goog.webgl.LINEAR);
        gl.texParameteri(goog.webgl.TEXTURE_2D, goog.webgl.TEXTURE_MAG_FILTER, goog.webgl.LINEAR);
        gl.texParameteri(goog.webgl.TEXTURE_2D, goog.webgl.TEXTURE_WRAP_S, goog.webgl.CLAMP_TO_EDGE);
        gl.texParameteri(goog.webgl.TEXTURE_2D, goog.webgl.TEXTURE_WRAP_T, goog.webgl.CLAMP_TO_EDGE);
        gl.uniform1i(this.locations_.u_hypsoColors, 2);

        // create lookup texture only once
        if (goog.isNull(this.textureBathymetricColors_)) {
            this.textureBathymetricColors_ = gl.createTexture();
        }
        var arrayBathymetryColors = new Uint8Array(ol.ColorRamp.bathymetry[tileDemLayer.getColorRamp()]);
        gl.activeTexture(goog.webgl.TEXTURE3);
        gl.bindTexture(goog.webgl.TEXTURE_2D, this.textureBathymetricColors_);

        // read color ramp array
        gl.texImage2D(goog.webgl.TEXTURE_2D, 0, goog.webgl.RGBA, 1, arrayBathymetryColors.length / 4, 0, goog.webgl.RGBA, goog.webgl.UNSIGNED_BYTE, arrayBathymetryColors);
        gl.texParameteri(goog.webgl.TEXTURE_2D, goog.webgl.TEXTURE_MIN_FILTER, goog.webgl.LINEAR);
        gl.texParameteri(goog.webgl.TEXTURE_2D, goog.webgl.TEXTURE_MAG_FILTER, goog.webgl.LINEAR);
        gl.texParameteri(goog.webgl.TEXTURE_2D, goog.webgl.TEXTURE_WRAP_S, goog.webgl.CLAMP_TO_EDGE);
        gl.texParameteri(goog.webgl.TEXTURE_2D, goog.webgl.TEXTURE_WRAP_T, goog.webgl.CLAMP_TO_EDGE);
        gl.uniform1i(this.locations_.u_bathyColors, 3);

        // MESH 
        // check if mesh resolution has changed
        if (!goog.isObject(this.tileMesh_) || this.tileMesh_.resolution != tileDemLayer.getResolution()) {
            // drop old buffers
            if (goog.isObject(this.tileMesh_)) {
                context.deleteBuffer(this.tileMesh_.vertexBuffer);
                context.deleteBuffer(this.tileMesh_.indexBuffer);
            }
            // compute mesh for current resolution
            /**
             * @private
             * @type {Object.<string, ol.webgl.Buffer>}
             */
            this.tileMesh_ = this.getTileMesh(goog.math.safeCeil(tileDemLayer.getResolution() * 128));
            this.tileMesh_.resolution = tileDemLayer.getResolution();
        }

        // Write the vertex coordinates to the buffer object
        context.bindBuffer(goog.webgl.ARRAY_BUFFER, this.tileMesh_.vertexBuffer);
        gl.enableVertexAttribArray(this.locations_.a_position);
        gl.vertexAttribPointer(this.locations_.a_position, 2, goog.webgl.FLOAT, false, 0, 0);
        // Write the indices to the buffer object
        context.bindBuffer(goog.webgl.ELEMENT_ARRAY_BUFFER, this.tileMesh_.indexBuffer);

        // SELECT TILE IMAGES AND BIND AS TEXTURES

        /** @type {Object.<number, Object.<string, ol.Tile>>} */
        var tilesToDrawByZ = {};
        tilesToDrawByZ[z] = {};
        var cIfLoaded = function(usource, self) {
            return self.createGetTileIfLoadedFunction(
                function(tile) {
                    return !goog.isNull(tile) &&
                        tile.getState() == ol.TileState.LOADED &&
                        mapRenderer.isTileTextureLoaded(tile);
                }, usource, pixelRatio, projection);
        };
        var findLoadedTiles = goog.bind(tileSource.findLoadedTiles, tileSource, tilesToDrawByZ, cIfLoaded(tileSource, this));
        var useInterimTilesOnError = tileDemLayer.getUseInterimTilesOnError();
        var allTilesLoaded = true;
        var tmpExtent = ol.extent.createEmpty();
        var tmpTileRange = new ol.TileRange(0, 0, 0, 0);
        var childTileRange, tile, tileState, x, y, tileExtent;

        /** @type {Array.<number>} */
        var zs;
        var u_tileOffset = goog.vec.Vec4.createFloat32();
        var i, ii, sx, sy, tileKey, tilesToDraw, tx, ty;

        /** @type {Object.<string, *>} */
        var fullyLoaded = {};

        /** @type {Object.<number, Object.<string, ol.Tile>>} */
        var overlayTilesToDrawByZ = {};
        var overlayTile, overlayTileState, overlayTilesToDraw;

        // determines offset for each tile in target framebuffer and passes uniform to shader
        var defUniformOffset = function(tile, renderer) {
            tileExtent = tileGrid.getTileCoordExtent(tile.tileCoord, tmpExtent);
            //minX, maxX, minY, maxY
            sx = 2 * (tileExtent[2] - tileExtent[0]) /
                framebufferExtentDimension;
            sy = 2 * (tileExtent[3] - tileExtent[1]) /
                framebufferExtentDimension;
            tx = 2 * (tileExtent[0] - framebufferExtent[0]) /
                framebufferExtentDimension - 1;
            ty = 2 * (tileExtent[1] - framebufferExtent[1]) /
                framebufferExtentDimension - 1;
            goog.vec.Vec4.setFromValues(u_tileOffset, sx, sy, tx, ty);
            gl.uniform4fv(renderer.locations_.u_tileOffset, u_tileOffset);
        };

        this.resetCurrentMinMax();
        // CREATE TEXTURE QUEUE AND DRAW TILES
        if (this.overlay.Active) {
            // RENDER TILES WITH OVERLAY

            // type cast because ol.Map stores layers only as layer.Base, which does not offer getSources()
            this.overlay.Tiles = /** @type {ol.layer.Tile} */ (map.getLayers().getArray()[this.overlay.Id]);
            goog.asserts.assertInstanceof(this.overlay.Tiles, ol.layer.Tile);
            this.overlay.Source = this.overlay.Tiles.getSource();
            overlayTilesToDrawByZ[z] = {};

            var findLoadedOverlayTiles = goog.bind(this.overlay.Source.findLoadedTiles, this.overlay.Source, overlayTilesToDrawByZ, cIfLoaded(this.overlay.Source, this));

            for (x = tileRange.minX; x <= tileRange.maxX; ++x) {
                for (y = tileRange.minY; y <= tileRange.maxY; ++y) {

                    tile = tileSource.getTile(z, x, y, pixelRatio, projection);
                    overlayTile = this.overlay.Source.getTile(z, x, y, pixelRatio, projection);

                    tileState = tile.getState();
                    overlayTileState = overlayTile.getState();
                    if (tileState == ol.TileState.LOADED && overlayTileState == ol.TileState.LOADED) {
                        if (mapRenderer.isTileTextureLoaded(tile) && mapRenderer.isTileTextureLoaded(overlayTile)) {
                            tilesToDrawByZ[z][ol.tilecoord.toString(tile.tileCoord)] = tile;
                            overlayTilesToDrawByZ[z][ol.tilecoord.toString(overlayTile.tileCoord)] = overlayTile;
                            continue;
                        }
                    } else if (tileState == ol.TileState.EMPTY ||
                        (tileState == ol.TileState.ERROR &&
                            !useInterimTilesOnError)) {
                        continue;
                    }

                    allTilesLoaded = false;
                    // put preload tiles from higher zoomlevels into queue
                    fullyLoaded.overlay = tileGrid.forEachTileCoordParentTileRange(overlayTile.tileCoord, findLoadedOverlayTiles, null, tmpTileRange, tmpExtent);
                    fullyLoaded.dem = tileGrid.forEachTileCoordParentTileRange(tile.tileCoord, findLoadedTiles, null, tmpTileRange, tmpExtent);
                    if (!fullyLoaded.overlay || !fullyLoaded.dem) {
                        childTileRange = tileGrid.getTileCoordChildTileRange(tile.tileCoord, tmpTileRange, tmpExtent);
                        if (!goog.isNull(childTileRange)) {
                            findLoadedOverlayTiles(z + 1, childTileRange);
                            findLoadedTiles(z + 1, childTileRange);
                        }
                    }
                }
            }

            // Overlay tiles get loaded first. The corresponding dem tiles are loaded accordingly.
            zs = goog.array.map(goog.object.getKeys(overlayTilesToDrawByZ), Number);
            goog.array.sort(zs);

            for (i = 0, ii = zs.length; i < ii; ++i) {
                overlayTilesToDraw = overlayTilesToDrawByZ[zs[i]];
                if (tilesToDrawByZ.hasOwnProperty(zs[i])) {
                    tilesToDraw = tilesToDrawByZ[zs[i]];
                } else {
                    tilesToDraw = overlayTilesToDraw;
                }
                // iterate through tile queue: bind texture (+overlay), draw triangles
                for (tileKey in overlayTilesToDraw) {

                    // draw only when dem tile is available
                    if (tilesToDraw.hasOwnProperty(tileKey)) {
                        if (tilesToDraw[tileKey].getState() == ol.TileState.LOADED) {
                            overlayTile = overlayTilesToDraw[tileKey];

                            // overlay texture             
                            gl.activeTexture(goog.webgl.TEXTURE1);
                            mapRenderer.bindTileTexture(overlayTile, tilePixelSize, tileGutter * pixelRatio, goog.webgl.LINEAR, goog.webgl.LINEAR);
                            gl.uniform1i(this.locations_.u_overlayTexture, 1);

                            // dem texture
                            gl.activeTexture(goog.webgl.TEXTURE0);
                            mapRenderer.bindTileTexture(tilesToDraw[tileKey], tilePixelSize, tileGutter * pixelRatio, goog.webgl.NEAREST, goog.webgl.NEAREST);
                            gl.uniform1i(this.locations_.u_texture, 0);

                            // pass original zoom level of current tile for reverse z-ordering to avoid artifacts 
                            gl.uniform1f(this.locations_.u_z, 1.0 - ((zs[i] + 1) / (this.maxZoom_ + 1)));
                            // pass zoomlevel of this tile and zoomlevel of current view
                            gl.uniform2f(this.locations_.u_zoom, zs[i], (goog.isDef(viewZoom)) ? viewZoom : zs[i]);

                            // determine offset for each tile in target framebuffer
                            defUniformOffset(overlayTile, this);

                            // draw triangle mesh. getCount is number of triangles * 2, method added in webgl.buffer
                            gl.drawElements(goog.webgl.TRIANGLES, this.tileMesh_.indexBuffer.getCount(), goog.webgl.UNSIGNED_INT, 0);
                            this.updateCurrentMinMax(tilesToDraw[tileKey]);
                        }
                    }
                }
            }
        } else {
            // RENDER TILES WITHOUT OVERLAY

            for (x = tileRange.minX; x <= tileRange.maxX; ++x) {
                for (y = tileRange.minY; y <= tileRange.maxY; ++y) {
                    tile = tileSource.getTile(z, x, y, pixelRatio, projection);
                    tileState = tile.getState();
                    if (tileState == ol.TileState.LOADED) {
                        if (mapRenderer.isTileTextureLoaded(tile)) {
                            tilesToDrawByZ[z][ol.tilecoord.toString(tile.tileCoord)] = tile;
                            continue;
                        }
                    } else if (tileState == ol.TileState.EMPTY || (tileState == ol.TileState.ERROR && !useInterimTilesOnError)) {
                        continue;
                    }
                    allTilesLoaded = false;
                    // preload tiles from lower zoomlevels
                    fullyLoaded.dem = tileGrid.forEachTileCoordParentTileRange(tile.tileCoord, findLoadedTiles, null, tmpTileRange, tmpExtent);
                    // do some preloading of higher zoomlevels??
                    if (!fullyLoaded.dem) {
                        childTileRange = tileGrid.getTileCoordChildTileRange(tile.tileCoord, tmpTileRange, tmpExtent);
                        if (!goog.isNull(childTileRange)) {
                            findLoadedTiles(z + 1, childTileRange);
                        }
                    }
                }
            }

            zs = goog.array.map(goog.object.getKeys(tilesToDrawByZ), Number);
            goog.array.sort(zs);
            for (i = 0, ii = zs.length; i < ii; ++i) {
                tilesToDraw = tilesToDrawByZ[zs[i]];
                // iterate through tile queue
                for (tileKey in tilesToDraw) {
                    tile = tilesToDraw[tileKey];

                    // pass original zoom level of current tile for reverse z-ordering to avoid artifacts 
                    gl.uniform1f(this.locations_.u_z, 1.0 - ((zs[i] + 1) / (this.maxZoom_ + 1)));
                    // pass zoomlevel of this tile and zoomlevel of current view
                    gl.uniform2f(this.locations_.u_zoom, zs[i], (goog.isDef(viewZoom)) ? viewZoom : zs[i]);

                    // determine offset for each tile in target framebuffer
                    defUniformOffset(tile, this);
                    goog.vec.Vec4.setFromValues(u_tileOffset, sx, sy, tx, ty);
                    gl.uniform4fv(this.locations_.u_tileOffset, u_tileOffset);
                    // TILE TEXTURE
                    gl.activeTexture(goog.webgl.TEXTURE0);
                    mapRenderer.bindTileTexture(tile, tilePixelSize, tileGutter * pixelRatio, goog.webgl.NEAREST, goog.webgl.NEAREST);
                    gl.uniform1i(this.locations_.u_texture, 0);
                    // draw triangle mesh. getCount is number of triangles * 2, method added in webgl.buffer
                    gl.drawElements(goog.webgl.TRIANGLES, this.tileMesh_.indexBuffer.getCount(), goog.webgl.UNSIGNED_INT, 0);
                    this.updateCurrentMinMax(tile);
                }
            }
        }
        // TEST IF EVERYTHING IS LOADED
        // render at elast two passes (for correct minMax computation)
        // until every tile is loaded and rendered or until timeout value is reached
        if (this.timeoutCounter_ > 1 && (allTilesLoaded || this.timeoutCounter_ > this.timeoutCounterMax_)) {
            this.renderedTileRange_ = tileRange;
            this.renderedFramebufferExtent_ = framebufferExtent;
            this.renderedRevision_ = tileSource.getRevision();
            // goog.asserts.assert(this.timeoutCounter_ < this.timeoutCounterMax_, 'Loading of tiles timed out.');
            // console.log('extent: ', this.renderedFramebufferExtent_);
            // console.log('resolution: ',viewState.resolution);
            // console.log(this.minElevationInExtent,this.maxElevationInExtent);
            this.timeoutCounter_ = 0;
        } else {
            this.renderedTileRange_ = null;
            this.renderedRevision_ = -1;
            frameState.animate = true;
        }
    }

    // LOAD TILES AND MAINTAIN QUEUE
    var tileTextureQueue = mapRenderer.getTileTextureQueue();
    var loadTiles = function(usource, layer, self) {
        self.updateUsedTiles(frameState.usedTiles, usource, z, tileRange);
        self.manageTilePyramid(frameState, usource, tileGrid, pixelRatio, projection, extent, z, layer.getPreload(),
            /**
             * @param {ol.Tile} tile Tile.
             */
            function(tile) {
                if (tile.getState() == ol.TileState.LOADED &&
                    !mapRenderer.isTileTextureLoaded(tile) &&
                    !tileTextureQueue.isKeyQueued(tile.getKey())) {
                    tileTextureQueue.enqueue([
                        tile,
                        tileGrid.getTileCoordCenter(tile.tileCoord),
                        tileGrid.getResolution(tile.tileCoord[0]),
                        tilePixelSize, tileGutter * pixelRatio
                    ]);
                }
            }, self);
        self.scheduleExpireCache(frameState, usource);
        self.updateLogos(frameState, usource);
    };

    loadTiles(tileSource, tileDemLayer, this);
    if (this.overlay.Active) {
        loadTiles(this.overlay.Source, this.overlay.Tiles, this);
    }

    // ZOOM AND ROTATION
    var texCoordMatrix = this.texCoordMatrix;
    goog.vec.Mat4.makeIdentity(texCoordMatrix);
    goog.vec.Mat4.translate(texCoordMatrix, (center[0] - framebufferExtent[0]) /
        (framebufferExtent[2] - framebufferExtent[0]), (center[1] - framebufferExtent[1]) /
        (framebufferExtent[3] - framebufferExtent[1]),
        0);
    if (viewState.rotation !== 0) {
        goog.vec.Mat4.rotateZ(texCoordMatrix, viewState.rotation);
    }
    goog.vec.Mat4.scale(texCoordMatrix,
        frameState.size[0] * viewState.resolution /
        (framebufferExtent[2] - framebufferExtent[0]),
        frameState.size[1] * viewState.resolution /
        (framebufferExtent[3] - framebufferExtent[1]),
        1);
    goog.vec.Mat4.translate(texCoordMatrix, -0.5, -0.5,
        0);

    return true;
};
