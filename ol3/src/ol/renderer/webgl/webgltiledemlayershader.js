// This file is automatically generated, do not edit
goog.provide('ol.renderer.webgl.tiledemlayer.shader');

goog.require('ol.webgl.shader');



/**
 * @constructor
 * @extends {ol.webgl.shader.Fragment}
 * @struct
 */
ol.renderer.webgl.tiledemlayer.shader.Fragment = function() {
  goog.base(this, ol.renderer.webgl.tiledemlayer.shader.Fragment.SOURCE);
};
goog.inherits(ol.renderer.webgl.tiledemlayer.shader.Fragment, ol.webgl.shader.Fragment);
goog.addSingletonGetter(ol.renderer.webgl.tiledemlayer.shader.Fragment);


/**
 * @const
 * @type {string}
 */
ol.renderer.webgl.tiledemlayer.shader.Fragment.DEBUG_SOURCE = 'precision highp float;\n\n// texture with encoded elevation values\nuniform sampler2D u_texture;\n\n// length of one tile in meter at equator\nuniform float u_tileSizeM;\n\n// min Elevation in current Extent\nuniform float u_minElevation; \n\n// max Elevation in current Extent\nuniform float u_maxElevation;\n\n// temporary variable for coord transfer to fragment shader\nvarying vec2 v_texCoord;\n\n// decodes input data elevation value and apply exaggeration\nfloat decodeElevation(in vec4 colorChannels, in float exaggeration) {\n    float elevationM = ((colorChannels.r*255.0 + (colorChannels.g*255.0)*256.0)-11000.0)* max(exaggeration*10.0,1.0);\n    return elevationM;\n}\n\n\n// color ramp texture to look up hypsometric tints\nuniform sampler2D u_colorRamp;\n\n// texture with overlay map\nuniform sampler2D u_overlayTexture;\n\n// flag for coloring inland waterbodies\nuniform bool u_waterBodies; \n\n// flag for hillShading\nuniform bool u_hillShading; \n\n// flag for active overlay texture\nuniform bool u_overlayActive;\n\n// flag for testing mode\nuniform bool u_testing;    \n\n// scale threshold values to adapt color ramp \n// u_colorScale.x is lower threshold, u_colorScale.y is upper threshold\nuniform vec2 u_colorScale;\n\n// direction of light source\nuniform vec3 u_light; \n\n// hillShading Opacity for Blending\nuniform float u_hillShadingOpacity; \n\n// hillShading Exaggeration\nuniform float u_hsExaggeration; \n\n// intensity of ambient light\nuniform float u_ambient_light;    \n\n// critical elevation threshold\nuniform float u_critElThreshold;  \n\n// highest elevation in the model\nconst float MAX_ELEVATION = 8800.0; \n\n// cellsize for tile resolution of 256x256 pixel = 1.0/256.0\nconst highp float CELLSIZE = 0.00390625; \n\nvoid main(void) {\n  \n    // read elevations from current cell and neighbours\n        vec2 m_texCoord = v_texCoord;\n\n        // read and decode elevation values from tile texture\n        float absElevation = decodeElevation(texture2D(u_texture, m_texCoord.xy),0.0);\n\n        // read and decode exaggerated elevation values from tile texture\n        float absElevationEx = decodeElevation(texture2D(u_texture, m_texCoord.xy),u_hsExaggeration);\n\n        // compute neighbouring vertices\n            vec3 neighbourRight = vec3(m_texCoord.x+CELLSIZE, 1.0 - m_texCoord.y,0.0);\n            vec3 neighbourAbove = vec3(m_texCoord.x, 1.0 - m_texCoord.y+CELLSIZE,0.0);  \n\n            neighbourRight.z = decodeElevation(texture2D(u_texture, vec2(m_texCoord.x+CELLSIZE, m_texCoord.y)),u_hsExaggeration);\n            neighbourAbove.z = decodeElevation(texture2D(u_texture, vec2(m_texCoord.x, m_texCoord.y-CELLSIZE)),u_hsExaggeration);\n\n            // hack to avoid artifacts in tile borders\n                if(m_texCoord.x >= 1.0-CELLSIZE){ // eastern border of tile\n                    // use neighbour LEFT\n                    neighbourRight = vec3(m_texCoord.x-CELLSIZE, 1.0 - m_texCoord.y,0.0);\n                    neighbourRight.z = decodeElevation(texture2D(u_texture, vec2(m_texCoord.x-CELLSIZE, m_texCoord.y)),u_hsExaggeration);\n                }\n\n                if(m_texCoord.y <= CELLSIZE){ // northern border of tile\n                    // use neighbour BELOW\n                    neighbourAbove = vec3(m_texCoord.x, 1.0 - (m_texCoord.y+CELLSIZE),0.0);\n                    neighbourAbove.z = decodeElevation(texture2D(u_texture, vec2(m_texCoord.x, m_texCoord.y+CELLSIZE)),u_hsExaggeration);\n                }\n          \n    // texture\n        vec4 fragColor;\n        if(u_overlayActive){\n             // use overlay color\n             fragColor = texture2D(u_overlayTexture, m_texCoord);\n        } else {\n            // computation of hypsometric color\n                \n                // scaling of color ramp\n                float elevationRange = u_maxElevation-u_minElevation;\n                float colorMin = u_colorScale.x/elevationRange;\n                float colorMax = u_colorScale.y/elevationRange;             \n                float relativeElevation = ((absElevation/elevationRange) - colorMin) / (colorMax - colorMin);\n                \n                // read corresponding value from color ramp texture\n                fragColor = abs(texture2D(u_colorRamp,vec2(0.5,relativeElevation)));\n\n                // color for water surfaces in flat terrain\n                if(neighbourRight.z == absElevationEx && neighbourAbove.z == absElevationEx){\n                    \n                    // sealevel (0.0m) or below (i.e. negative no data values)\n                    if(absElevation <= 0.0){\n                        fragColor = vec4(0.5058823529,0.7725490196,0.8470588235,1.0);   // set color to blue\n\n                    // if not on sea-level and inland waterBody flag is true    \n                    } else if(u_waterBodies) {\n\n                        // doublecheck if this pixel really belongs to a larger surface with help of remaining two neighbours\n                        //vec3 neighbourAbove = vec3(v_texCoord.x,v_texCoord.y-CELLSIZE/2.0,0.0);  \n                        //vec3 neighbourLeft = vec3(v_texCoord.x+CELLSIZE/2.0,v_texCoord.y,0.0);  \n                        //if(decodeElevation(texture2D(u_texture, neighbourAbove.xy)) == absElevation && decodeElevation(texture2D(u_texture, neighbourLeft.xy)) == absElevation){\n                            fragColor = vec4(0.5058823529,0.7725490196,0.8470588235,1.0);   // set color to blue\n                        //}\n                    }\n                } \n        }\n\n    // computation of hillshading\n        if(u_hillShading){\n            // transform to meter coordinates for normal computation\n            vec3 currentV = vec3(m_texCoord.x*u_tileSizeM,(1.0 - m_texCoord.y)*u_tileSizeM,absElevationEx);\n            neighbourRight.xy *= u_tileSizeM;\n            neighbourAbove.xy *= u_tileSizeM;\n\n            // normal computation\n            vec3 normal = normalize(cross(neighbourRight-currentV,neighbourAbove-currentV));\n\n            if(m_texCoord.x >= 1.0-CELLSIZE){ // eastern border of tile\n                 normal = normalize(cross(currentV-neighbourRight,neighbourAbove-currentV));\n            }\n\n            if(m_texCoord.y <= CELLSIZE){ // northern border of tile\n                 normal = normalize(cross(currentV-neighbourRight,neighbourAbove-currentV));\n            }\n\n            // compute hillShade with help of u_light and normal and blend hypsocolor with hillShade\n            float hillShade = clamp(u_ambient_light * 1.0+ max(dot(normal,normalize(u_light)),0.0),0.0/*-u_hillShadingOpacity*/,1.0);\n            //hillShade = u_hillShadingOpacity + (1.0 - u_hillShadingOpacity) * hillShade;\n            hillShade = pow(hillShade, 1.0 / (1.0 + u_hillShadingOpacity * 2.0));\n            // avoid black shadows\n            hillShade = max(hillShade, 0.25);\n            vec4 hillShadeC = vec4(hillShade,hillShade,hillShade,1.0);\n\n\n            // float hillShadeD = clamp(hillShade,0.2,1.0);\n            // vec4 hillShadeA = vec4(hillShadeD,hillShadeD,hillShadeD,1.0);\n\n            // float hillShadeL = clamp(hillShade,0.1,0.4);\n            // vec4 hillShadeB = vec4(hillShadeL,hillShadeL,hillShadeL,1.0);\n     \n            // vec4 zero = vec4(0,0,0,0);\n            // vec4 one = vec4(1.0,1.0,1.0,1.0);\n            // vec4 two = vec4(2.0,2.0,2.0,2.0);\n\n            //https://en.wikipedia.org/wiki/Blend_modes\n\n            //overlay mixing\n            // if(hillShade < 0.5){\n            //     gl_FragColor = two * hillShadeC * fragColor;\n            // } else {\n            //     gl_FragColor = one-two*(one-hillShadeC)*(one-fragColor);\n            // }\n\n            // hard light mixing\n            // if(fragColor.x < 0.5 || fragColor.y < 0.5 || fragColor.z < 0.5){\n            //     gl_FragColor = two * fragColor * hillShadeC;\n            // } else {\n            //     gl_FragColor = one-two*(one-fragColor)*(one-hillShadeC);\n            // }\n           \n            //screen\n            // gl_FragColor = one-(one-hillShadeC)*(one-fragColor);\n\n            // multiply mixing\n            // gl_FragColor = (fragColor * hillShadeA)*(one-(one-hillShadeB)*(one-fragColor));\n            // gl_FragColor = (one-(one-hillShadeB)*(one-hillShadeA))*fragColor;\n\n\n            gl_FragColor = hillShadeC*fragColor;\n\n        } else {\n            // apply hypsometric color without hillshading\n            gl_FragColor = fragColor;\n        }\n\n    // testing mode\n        if(u_testing){\n\n            float criticalEl = u_minElevation + (u_maxElevation - u_minElevation) * u_critElThreshold;\n            if(absElevation > criticalEl){\n                gl_FragColor = gl_FragColor+vec4(1.0,0.0,0.0,1.0);\n            }\n            if(absElevation < criticalEl){\n                gl_FragColor = gl_FragColor+vec4(0.0,0.5,0.5,1.0);\n            }\n\n            float lineWidth = 2.0 * CELLSIZE;\n            if(m_texCoord.x >= 1.0-lineWidth){\n                gl_FragColor = vec4(0.0,0.0,1.0,1.0);\n            }\n            if(m_texCoord.x <= lineWidth){\n                gl_FragColor = vec4(1.0,0.0,0.0,1.0);\n            }\n            if(m_texCoord.y <= lineWidth){\n                gl_FragColor = vec4(0.0,1.0,0.0,1.0);\n            }\n            if(m_texCoord.y >= 1.0-lineWidth){\n                gl_FragColor = vec4(0.0,0.5,0.5,1.0);\n            } \n            if(mod(m_texCoord.x,65.0*CELLSIZE) < CELLSIZE){\n               gl_FragColor = vec4(0.9,0.9,0.9,0.1);\n            }\n            if(mod(m_texCoord.y,65.0*CELLSIZE) < CELLSIZE){\n               gl_FragColor = vec4(0.9,0.9,0.9,0.1);\n            }\n          \n        }\n}\n';


/**
 * @const
 * @type {string}
 */
ol.renderer.webgl.tiledemlayer.shader.Fragment.OPTIMIZED_SOURCE = 'precision highp float;uniform sampler2D a;uniform float b;uniform float c;uniform float d;varying vec2 e;float decodeElevation(in vec4 colorChannels,in float exaggeration){float elevationM=((colorChannels.r*255.0+(colorChannels.g*255.0)*256.0)-11000.0)*max(exaggeration*10.0,1.0);return elevationM;}uniform sampler2D j;uniform sampler2D k;uniform bool l;uniform bool m;uniform bool n;uniform bool o;uniform vec2 p;uniform vec3 q;uniform float r;uniform float s;uniform float t;uniform float u;const float MAX_ELEVATION=8800.0;const highp float CELLSIZE=0.00390625;void main(void){vec2 m_texCoord=e;float absElevation=decodeElevation(texture2D(a,m_texCoord.xy),0.0);float absElevationEx=decodeElevation(texture2D(a,m_texCoord.xy),s);vec3 neighbourRight=vec3(m_texCoord.x+CELLSIZE,1.0-m_texCoord.y,0.0);vec3 neighbourAbove=vec3(m_texCoord.x,1.0-m_texCoord.y+CELLSIZE,0.0);neighbourRight.z=decodeElevation(texture2D(a,vec2(m_texCoord.x+CELLSIZE,m_texCoord.y)),s);neighbourAbove.z=decodeElevation(texture2D(a,vec2(m_texCoord.x,m_texCoord.y-CELLSIZE)),s);if(m_texCoord.x>=1.0-CELLSIZE){neighbourRight=vec3(m_texCoord.x-CELLSIZE,1.0-m_texCoord.y,0.0);neighbourRight.z=decodeElevation(texture2D(a,vec2(m_texCoord.x-CELLSIZE,m_texCoord.y)),s);}if(m_texCoord.y<=CELLSIZE){neighbourAbove=vec3(m_texCoord.x,1.0-(m_texCoord.y+CELLSIZE),0.0);neighbourAbove.z=decodeElevation(texture2D(a,vec2(m_texCoord.x,m_texCoord.y+CELLSIZE)),s);}vec4 fragColor;if(n){fragColor=texture2D(k,m_texCoord);}else{float elevationRange=d-c;float colorMin=p.x/elevationRange;float colorMax=p.y/elevationRange;float relativeElevation=((absElevation/elevationRange)-colorMin)/(colorMax-colorMin);fragColor=abs(texture2D(j,vec2(0.5,relativeElevation)));if(neighbourRight.z==absElevationEx&&neighbourAbove.z==absElevationEx){if(absElevation<=0.0){fragColor=vec4(0.5058823529,0.7725490196,0.8470588235,1.0);}else if(l){fragColor=vec4(0.5058823529,0.7725490196,0.8470588235,1.0);}}}if(m){vec3 currentV=vec3(m_texCoord.x*b,(1.0-m_texCoord.y)*b,absElevationEx);neighbourRight.xy*=b;neighbourAbove.xy*=b;vec3 normal=normalize(cross(neighbourRight-currentV,neighbourAbove-currentV));if(m_texCoord.x>=1.0-CELLSIZE){normal=normalize(cross(currentV-neighbourRight,neighbourAbove-currentV));}if(m_texCoord.y<=CELLSIZE){normal=normalize(cross(currentV-neighbourRight,neighbourAbove-currentV));}float hillShade=clamp(t*1.0+max(dot(normal,normalize(q)),0.0),0.0,1.0);hillShade=pow(hillShade,1.0/(1.0+r*2.0));hillShade=max(hillShade,0.25);vec4 hillShadeC=vec4(hillShade,hillShade,hillShade,1.0);gl_FragColor=hillShadeC*fragColor;}else{gl_FragColor=fragColor;}if(o){float criticalEl=c+(d-c)*u;if(absElevation>criticalEl){gl_FragColor=gl_FragColor+vec4(1.0,0.0,0.0,1.0);}if(absElevation<criticalEl){gl_FragColor=gl_FragColor+vec4(0.0,0.5,0.5,1.0);}float lineWidth=2.0*CELLSIZE;if(m_texCoord.x>=1.0-lineWidth){gl_FragColor=vec4(0.0,0.0,1.0,1.0);}if(m_texCoord.x<=lineWidth){gl_FragColor=vec4(1.0,0.0,0.0,1.0);}if(m_texCoord.y<=lineWidth){gl_FragColor=vec4(0.0,1.0,0.0,1.0);}if(m_texCoord.y>=1.0-lineWidth){gl_FragColor=vec4(0.0,0.5,0.5,1.0);}if(mod(m_texCoord.x,65.0*CELLSIZE)<CELLSIZE){gl_FragColor=vec4(0.9,0.9,0.9,0.1);}if(mod(m_texCoord.y,65.0*CELLSIZE)<CELLSIZE){gl_FragColor=vec4(0.9,0.9,0.9,0.1);}}}';


/**
 * @const
 * @type {string}
 */
ol.renderer.webgl.tiledemlayer.shader.Fragment.SOURCE = goog.DEBUG ?
    ol.renderer.webgl.tiledemlayer.shader.Fragment.DEBUG_SOURCE :
    ol.renderer.webgl.tiledemlayer.shader.Fragment.OPTIMIZED_SOURCE;



/**
 * @constructor
 * @extends {ol.webgl.shader.Vertex}
 * @struct
 */
ol.renderer.webgl.tiledemlayer.shader.Vertex = function() {
  goog.base(this, ol.renderer.webgl.tiledemlayer.shader.Vertex.SOURCE);
};
goog.inherits(ol.renderer.webgl.tiledemlayer.shader.Vertex, ol.webgl.shader.Vertex);
goog.addSingletonGetter(ol.renderer.webgl.tiledemlayer.shader.Vertex);


/**
 * @const
 * @type {string}
 */
ol.renderer.webgl.tiledemlayer.shader.Vertex.DEBUG_SOURCE = '\n// texture with encoded elevation values\nuniform sampler2D u_texture;\n\n// length of one tile in meter at equator\nuniform float u_tileSizeM;\n\n// min Elevation in current Extent\nuniform float u_minElevation; \n\n// max Elevation in current Extent\nuniform float u_maxElevation;\n\n// temporary variable for coord transfer to fragment shader\nvarying vec2 v_texCoord;\n\n// decodes input data elevation value and apply exaggeration\nfloat decodeElevation(in vec4 colorChannels, in float exaggeration) {\n    float elevationM = ((colorChannels.r*255.0 + (colorChannels.g*255.0)*256.0)-11000.0)* max(exaggeration*10.0,1.0);\n    return elevationM;\n}\n\n\n// vertex coordinates for tile mesh\nattribute vec2 a_position;\n\n// tile offset in current framebuffer view\nuniform vec4 u_tileOffset;\n\n// current shearing factor\nuniform vec2 u_scaleFactor;\n\n// current depth depends on zoomlevel\nuniform float u_z;\n\nvoid main(void) { \n\n    // Orientation of coordinate system in vertex shader:\n    // y\n    // ^ \n    // |\n    // |\n    // ------>  x\n\n    // pass current vertex coordinates to fragment shader\n    v_texCoord = a_position;\n    \n    // compute y-flipped texture coordinates for further processing in fragment-shader\n    v_texCoord.y = 1.0 - v_texCoord.y;\n\n    // read and decode elevation for current vertex\n    float absElevation = decodeElevation(texture2D(u_texture, v_texCoord.xy),0.0);\n    float nElevation = u_maxElevation*(absElevation-u_minElevation)/(u_maxElevation-u_minElevation);\n    \n    // shift vertex positions by given shearing factors\n    // z value has to be inverted to get a left handed coordinate system and to make the depth test work\n    gl_Position = vec4((a_position+(nElevation * u_scaleFactor.xy) / u_tileSizeM) * u_tileOffset.xy + u_tileOffset.zw, \n                        (u_z-abs(absElevation/u_tileSizeM)), \n                        1.0);\n}\n\n';


/**
 * @const
 * @type {string}
 */
ol.renderer.webgl.tiledemlayer.shader.Vertex.OPTIMIZED_SOURCE = 'uniform sampler2D a;uniform float b;uniform float c;uniform float d;varying vec2 e;float decodeElevation(in vec4 colorChannels,in float exaggeration){float elevationM=((colorChannels.r*255.0+(colorChannels.g*255.0)*256.0)-11000.0)*max(exaggeration*10.0,1.0);return elevationM;}attribute vec2 f;uniform vec4 g;uniform vec2 h;uniform float i;void main(void){e=f;e.y=1.0-e.y;float absElevation=decodeElevation(texture2D(a,e.xy),0.0);float nElevation=d*(absElevation-c)/(d-c);gl_Position=vec4((f+(nElevation*h.xy)/b)*g.xy+g.zw,(i-abs(absElevation/b)),1.0);}';


/**
 * @const
 * @type {string}
 */
ol.renderer.webgl.tiledemlayer.shader.Vertex.SOURCE = goog.DEBUG ?
    ol.renderer.webgl.tiledemlayer.shader.Vertex.DEBUG_SOURCE :
    ol.renderer.webgl.tiledemlayer.shader.Vertex.OPTIMIZED_SOURCE;



/**
 * @constructor
 * @param {WebGLRenderingContext} gl GL.
 * @param {WebGLProgram} program Program.
 * @struct
 */
ol.renderer.webgl.tiledemlayer.shader.Locations = function(gl, program) {

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_ambient_light = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_ambient_light' : 't');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_colorRamp = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_colorRamp' : 'j');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_colorScale = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_colorScale' : 'p');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_critElThreshold = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_critElThreshold' : 'u');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_hillShading = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_hillShading' : 'm');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_hillShadingOpacity = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_hillShadingOpacity' : 'r');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_hsExaggeration = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_hsExaggeration' : 's');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_light = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_light' : 'q');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_maxElevation = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_maxElevation' : 'd');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_minElevation = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_minElevation' : 'c');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_overlayActive = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_overlayActive' : 'n');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_overlayTexture = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_overlayTexture' : 'k');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_scaleFactor = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_scaleFactor' : 'h');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_testing = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_testing' : 'o');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_texture = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_texture' : 'a');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_tileOffset = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_tileOffset' : 'g');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_tileSizeM = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_tileSizeM' : 'b');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_waterBodies = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_waterBodies' : 'l');

  /**
   * @type {WebGLUniformLocation}
   */
  this.u_z = gl.getUniformLocation(
      program, goog.DEBUG ? 'u_z' : 'i');

  /**
   * @type {number}
   */
  this.a_position = gl.getAttribLocation(
      program, goog.DEBUG ? 'a_position' : 'f');
};
