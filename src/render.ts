/* eslint-disable no-new */
import path from 'path'
// sharp must be before zlib and other imports or sharp gets wrong version of zlib and breaks on some servers
import sharp from 'sharp'
import geoViewport from '@mapbox/geo-viewport'
import maplibre, {
    type ResourceKind,
    type RequestResponse,
} from '@maplibre/maplibre-gl-native'
import pino from 'pino'

const TILE_REGEXP = RegExp('mbtiles://([^/]+)/(\\d+)/(\\d+)/(\\d+)')
const MBTILES_REGEXP = /mbtiles:\/\/(\S+?)(?=[/"]+)/gi

const logger = pino({
    formatters: {
        level: (label) => ({ level: label }),
    },
    redact: {
        paths: ['pid', 'hostname'],
        remove: true,
    },
})

// @ts-ignore
maplibre.on('message', (msg) => {
    switch (msg.severity) {
        case 'ERROR': {
            logger.error(msg.text)
            break
        }
        case 'WARNING': {
            if (msg.class === 'ParseStyle') {
                // can't throw an exception here or it crashes NodeJS process
                logger.error(`Error parsing style: ${msg.text}`)
            } else {
                logger.warn(msg.text)
            }
            break
        }

        default: {
            // NOTE: includes INFO
            logger.info(msg.text)
            break
        }
    }
})

export const isMapboxURL = (url: string) => url.startsWith('mapbox://')
export const isMapboxStyleURL = (url: string) =>
    url.startsWith('mapbox://styles/')

/**
 * Normalize a Mapbox style URL to a full URL
 * @param {string} url - url to mapbox source in style json, e.g. "url": "mapbox://styles/mapbox/streets-v12"
 * @param {string} token - mapbox public token
 */
export const normalizeMapboxStyleURL = (url: string, token: string) => {
    try {
        const origin = new URL(url)
        const urlObject = new URL(`https://api.mapbox.com${origin.pathname}`)
        urlObject.searchParams.set('access_token', token)
        urlObject.searchParams.set('secure', 'true')
        return urlObject.toString()
    } catch (e) {
        const msg = `Could not normalize Mapbox style URL: ${url}\n${e}`
        logger.error(msg)
        throw new Error(msg)
    }
}

/**
 * Normalize a Mapbox sprite URL to a full URL
 * @param {string} url - url to mapbox sprite, e.g. "url": "mapbox://sprites/mapbox/streets-v9.png"
 * @param {string} token - mapbox public token
 *
 * Returns {string} - url, e.g., "https://api.mapbox.com/styles/v1/mapbox/streets-v9/sprite.png?access_token=<token>"
 */
export const normalizeMapboxSpriteURL = (url: string, token: string) => {
    try {
        const origin = new URL(url)
        const urlObject = new URL(`https://api.mapbox.com${origin.pathname}`)

        const extMatch = /(\.png|\.json)$/g.exec(url)
        const ratioMatch = /(@\d+x)\./g.exec(url)

        if (extMatch) {
            const extPart = extMatch[1]
            const ratioPart = ratioMatch ? ratioMatch[1] : ''
            urlObject.pathname = `/styles/v1${urlObject.pathname}/sprite${ratioPart}${extPart}`
        }

        urlObject.searchParams.set('access_token', token)
        return urlObject.toString()
    } catch (e) {
        const msg = `Could not normalize Mapbox sprite URL: ${url}\n${e}`
        logger.error(msg)
        throw new Error(msg)
    }
}

/**
 * Normalize a Mapbox glyph URL to a full URL
 * @param {string} url - url to mapbox sprite, e.g. "url": "mapbox://sprites/mapbox/streets-v9.png"
 * @param {string} token - mapbox public token
 *
 * Returns {string} - url, e.g., "https://api.mapbox.com/styles/v1/mapbox/streets-v9/sprite.png?access_token=<token>"
 */
export const normalizeMapboxGlyphURL = (url: string, token: string) => {
    try {
        const origin = new URL(url)
        const urlObject = new URL(`https://api.mapbox.com${origin.pathname}`)
        urlObject.searchParams.set('access_token', token)
        return urlObject.toString()
    } catch (e) {
        const msg = `Could not normalize Mapbox glyph URL: ${url}\n${e}`
        logger.error(msg)
        throw new Error(msg)
    }
}

/**
 * Fetch a remotely hosted tile.
 * Empty or missing tiles return null data to the callback function, which
 * result in those tiles not rendering but no errors being raised.
 *
 * @param {String} url - URL of the tile
 * @param {function} callback - callback to call with (err, {data})
 */
const getRemoteTile = async (
    url: string,
    callback: (err: Error | null, data?: RequestResponse | null) => unknown
) => {
    console.log('Started', url)
    console.time(url)
    fetch(url, {
        method: 'GET',
        headers: {
            Origin: 'http://localhost:3000',
            'Accept-Encoding': 'gzip, deflate, br',
            Connection: 'close',
        },
        signal: AbortSignal.timeout(15000),
    })
        .then(async (res) => {
            if (res.status === 204) {
                return null
            }

            if (res.status === 404) {
                logger.warn(`Missing tile at: ${url}`)
                return null
            }

            if (!res.ok) {
                const msg = `request for remote tile failed: ${url} (status: ${res.status})`
                logger.error(msg)
                throw new Error(msg)
            }

            const response: RequestResponse = {
                data: new Uint8Array(await res.arrayBuffer()),
                etag: res.headers.get('etag') || undefined,
            }

            console.log(res.headers.get('CF-Cache-Status'))

            if (res.headers.get('last-modified')) {
                response.modified = new Date(
                    res.headers.get('last-modified') || ''
                )
            }

            if (res.headers.get('expires')) {
                response.expires = new Date(res.headers.get('expires') || '')
            }

            console.timeEnd(url)
            return response
        })
        .then((res) => callback(null, res))
        .catch((error) => {
            console.timeEnd(url)
            callback(error)
        })
}

/**
 * Fetch a remotely hosted asset: glyph, sprite, etc
 * Anything other than a HTTP 200 response results in an exception.
 *
 *
 * @param {String} url - URL of the asset
 * @param {function} callback - callback to call with (err, {data})
 */
const getRemoteAsset = (
    url: string,
    callback: (err: Error | null, data?: RequestResponse) => unknown
) => {
    fetch(url, {
        method: 'GET',
        headers: {
            'Accept-Encoding': 'gzip, deflate, br',
        },
    })
        .then(async (res) => {
            if (!res.ok) {
                const msg = `Request for remote asset failed: ${url} (Status: ${res.status})`
                logger.error(msg)
                throw new Error(msg)
            }

            const response: RequestResponse = {
                data: new Uint8Array(await res.arrayBuffer()),
            }

            const modified = res.headers.get('last-modified')
            if (modified) {
                response.modified = new Date(modified)
            }

            const expires = res.headers.get('expires')
            if (expires) {
                response.expires = new Date(expires)
            }

            const etag = res.headers.get('etag')
            if (etag) {
                response.etag = etag
            }

            return response
        })
        .then((response) => callback(null, response))
        .catch((err) => callback(err))
}

/**
 * Fetch a remotely hosted asset: glyph, sprite, etc
 * Anything other than a HTTP 200 response results in an exception.
 *
 * @param {String} url - URL of the asset
 * returns a Promise
 */
const getRemoteAssetPromise = (url: string) => {
    return new Promise<RequestResponse | undefined>((resolve, reject) => {
        getRemoteAsset(url, (err, data) => {
            if (err) {
                return reject(err)
            }
            return resolve(data)
        })
    })
}

/**
 * Fetch a remotely hosted json file
 * Anything other than a HTTP 200 response results in an exception.
 *
 * @param {String} url - URL of the asset
 * returns a Promise
 */
const getRemoteJSON = (url: string) => {
    return fetch(url)
        .then((response) => {
            if (!response.ok) {
                const msg = `Anfrage für Remote-Asset fehlgeschlagen: ${response.url} (Status: ${response.status})`
                logger.error(msg)
                throw new Error(msg)
            }
            return response.json()
        })
        .then((data) => {
            return data
        })
        .catch((error) => {
            throw error
        })
}

/**
 * Get Remote Style Import (e.g. from Mapbox)
 *
 * @param {String} url - URL of the asset
 * @param {String} token - Mapbox access token (optional)
 */
const getRemoteStyleImport = async (url: string, token: string) => {
    const importStyleUrl = isMapboxStyleURL(url)
        ? normalizeMapboxStyleURL(url, token)
        : url
    if (!importStyleUrl) throw new Error('Invalid import style URL')

    try {
        const importedStyle = await getRemoteJSON(importStyleUrl)
        if (!importedStyle)
            throw new Error(`Could not fetch import style: ${importStyleUrl}`)
        if (
            typeof importedStyle !== 'object' ||
            importedStyle === null ||
            !('version' in importedStyle) ||
            importedStyle.version !== 8
        )
            throw new Error(
                `Invalid import style: ${importedStyle} (Version Required: 8)`
            )

        return importedStyle
    } catch (e: any) {
        logger.error(e.message)
        throw new Error(
            `Could not fetch import style from ${importStyleUrl} - ${e.toString()}`
        )
    }
}

/**
 * requestHandler constructs a request handler for the map to load resources.
 *
 * @param {String} - path to tilesets (optional)
 * @param {String} - Mapbox GL token (optional; required for any Mapbox hosted resources)
 */
const requestHandler = (
    { url, kind }: { url: string; kind: ResourceKind },
    callback: (err: Error | null, data?: RequestResponse | null) => unknown
) => {
    if (isMapboxURL(url)) {
        const msg = 'mapbox access token is required'
        logger.error(msg)
        return callback(new Error('Mapbox not supported!'))
    }

    try {
        switch (kind) {
            case 2: {
                // source
                getRemoteAsset(url, callback)

                break
            }
            case 3: {
                // tile
                getRemoteTile(url, callback)

                break
            }
            case 4: {
                // glyph
                getRemoteAsset(url, callback)
                break
            }
            case 5: {
                // sprite image
                getRemoteAsset(url, callback)
                break
            }
            case 6: {
                // sprite json
                getRemoteAsset(url, callback)
                break
            }
            // @ts-expect-error - ResourceKind.ImageSource is not typed
            case 7: {
                // image source
                getRemoteAsset(url, callback)
                break
            }
            default: {
                // NOT HANDLED!
                const msg = `error Request kind not handled: ${kind}`
                logger.error(msg)
                throw new Error(msg)
            }
        }
    } catch (err) {
        const msg = `Error while making resource request to: ${url}\n${err}`
        logger.error(msg)
        return callback(new Error(msg))
    }
}

/**
 * Load an icon image from base64 data or a URL and add it to the map.
 *
 * @param {Object} map - Mapbox GL map object
 * @param {String} id - id of image to add
 * @param {Object} options - options object with {url, pixelRatio, sdf}.  url is required
 */
const loadImage = async (
    map: any,
    id: string,
    {
        url,
        pixelRatio = 1,
        sdf = false,
    }: { url: string; pixelRatio?: number; sdf?: boolean }
) => {
    if (!url) {
        const msg = `Invalid url for image: ${id}`
        logger.error(msg)
        throw new Error(msg)
    }

    try {
        let imgBuffer: Buffer
        if (url.startsWith('data:')) {
            imgBuffer = Buffer.from(url.split('base64,')[1], 'base64')
        } else {
            const img = await getRemoteAssetPromise(url)
            if (!img?.data) {
                const msg = `Could not load image: ${id}`
                logger.error(msg)
                throw new Error(msg)
            }
            imgBuffer = Buffer.from(img.data)
        }
        const img = sharp(imgBuffer)
        const metadata = await img.metadata()
        const data = await img.raw().toBuffer()
        await map.addImage(id, data, {
            width: metadata.width,
            height: metadata.height,
            pixelRatio,
            sdf,
        })
    } catch (e) {
        const msg = `Error loading icon image: ${id}\n${e}`
        logger.error(msg)
        throw new Error(msg)
    }
}

/**
 * Load all icon images to the map.
 * @param {Object} map - Mapbox GL map object
 * @param {Object} images - object with {id: {url, ...other image properties}}
 */
const loadImages = async (map: any, images: any) => {
    if (images !== null) {
        const imageRequests = Object.entries(images).map(
            async ([id, image]) => {
                await loadImage(map, id, image as { url: string })
            }
        )

        // await for all requests to complete
        await Promise.all(imageRequests)
    }
}

/**
 * Render the map, returning a Promise.
 *
 * @param {Object} map - Mapbox GL map object
 * @param {Object} options - Mapbox GL map options
 * @returns
 */
const renderMap = (map: any, options: any) => {
    return new Promise((resolve, reject) => {
        map.render(options, (err: any, buffer: any) => {
            if (err) return reject(err)

            return resolve(buffer)
        })
    })
}

/**
 * Convert premultiplied image buffer from Mapbox GL to RGBA PNG format.
 * @param {Uint8Array} buffer - image data buffer
 * @param {Number} width - image width
 * @param {Number} height - image height
 * @param {Number} ratio - image pixel ratio
 * @returns
 */
const toPNG = async (buffer: any, width: any, height: any, ratio: any) => {
    // Un-premultiply pixel values
    // Mapbox GL buffer contains premultiplied values, which are not handled correctly by sharp
    // https://github.com/mapbox/mapbox-gl-native/issues/9124
    // since we are dealing with 8-bit RGBA values, normalize alpha onto 0-255 scale and divide
    // it out of RGB values

    for (let i = 0; i < buffer.length; i += 4) {
        const alpha = buffer[i + 3]
        const norm = alpha / 255
        if (alpha === 0) {
            buffer[i] = 0
            buffer[i + 1] = 0
            buffer[i + 2] = 0
        } else {
            buffer[i] /= norm
            buffer[i + 1] = buffer[i + 1] / norm
            buffer[i + 2] = buffer[i + 2] / norm
        }
    }

    return sharp(buffer, {
        raw: {
            width: Math.round(width * ratio),
            height: Math.round(height * ratio),
            channels: 4,
        },
    })
        .png()
        .toBuffer()
}

/**
 * Asynchronously render a map using Mapbox GL, based on layers specified in style.
 * Returns PNG image data (via async / Promise).
 *
 * If zoom and center are not provided, bounds must be provided
 * and will be used to calculate center and zoom based on image dimensions.
 *
 * @param {Object} style - Mapbox GL style object
 * @param {number} width - width of output map (default: 1024)
 * @param {number} height - height of output map (default: 1024)
 * @param {Object} - configuration object containing style, zoom, center: [lng, lat],
 * width, height, bounds: [west, south, east, north], ratio, padding
 * @param {String} tilePath - path to directory containing local mbtiles files that are
 * referenced from the style.json as "mbtiles://<tileset>"
 */
export const render = async (
    style: any,
    width = 1024,
    height = 1024,
    options: any
) => {
    const {
        bounds = null,
        bearing = 0,
        pitch = 0,
        token = null,
        ratio = 1,
        padding = 0,
        images = null,
        imports = null,
    } = options
    let { center = null, zoom = null, tilePath = null } = options

    if (!style) {
        const msg = 'style is a required parameter'
        throw new Error(msg)
    }
    if (!(width && height)) {
        const msg =
            'width and height are required parameters and must be non-zero'
        throw new Error(msg)
    }

    if (center !== null) {
        if (center.length !== 2) {
            const msg = `Center must be longitude,latitude.  Invalid value found: ${[
                ...center,
            ]}`
            throw new Error(msg)
        }

        if (Math.abs(center[0]) > 180) {
            const msg = `Center longitude is outside world bounds (-180 to 180 deg): ${center[0]}`
            throw new Error(msg)
        }

        if (Math.abs(center[1]) > 90) {
            const msg = `Center latitude is outside world bounds (-90 to 90 deg): ${center[1]}`
            throw new Error(msg)
        }
    }

    if (zoom !== null && (zoom < 0 || zoom > 22)) {
        const msg = `Zoom level is outside supported range (0-22): ${zoom}`
        throw new Error(msg)
    }

    if (bearing !== null && (bearing < 0 || bearing > 360)) {
        const msg = `bearing is outside supported range (0-360): ${bearing}`
        throw new Error(msg)
    }

    if (pitch !== null && (pitch < 0 || pitch > 60)) {
        const msg = `pitch is outside supported range (0-60): ${pitch}`
        throw new Error(msg)
    }

    if (bounds !== null) {
        if (bounds.length !== 4) {
            const msg = `Bounds must be west,south,east,north.  Invalid value found: ${[
                ...bounds,
            ]}`
            throw new Error(msg)
        }

        if (padding) {
            // padding must not be greater than width / 2 and height / 2
            if (Math.abs(padding) >= width / 2) {
                throw new Error('Padding must be less than width / 2')
            }
            if (Math.abs(padding) >= height / 2) {
                throw new Error('Padding must be less than height / 2')
            }
        }
    }

    // calculate zoom and center from bounds and image dimensions
    if (bounds !== null && (zoom === null || center === null)) {
        const viewport = geoViewport.viewport(
            bounds,
            // add padding to width and height to effectively
            // zoom out the target zoom level.
            [width - 2 * padding, height - 2 * padding],
            undefined,
            undefined,
            undefined,
            true
        )
        zoom = Math.max(viewport.zoom - 1, 0)
        /* eslint-disable prefer-destructuring */
        center = viewport.center
    }

    // validate that all local mbtiles referenced in style are
    // present in tilePath and that tilePath is not null
    if (tilePath) {
        tilePath = path.normalize(tilePath)
    }

    const correctedStyle = style
    if (imports !== null && imports.length > 0) {
        const importedStyles = await Promise.all(
            imports.map(async (e: { id: string; url: string }) => ({
                id: e.id,
                url: e.url,
                style: await getRemoteStyleImport(e.url, token),
            }))
        )

        importedStyles.forEach(({ id, style: importedStyle }, idx) => {
            const importId = id || idx.toString()

            // Add sources from imported styles
            Object.keys(importedStyle.sources).forEach((key) => {
                correctedStyle.sources[
                    key === 'composite' ? importId : `${importId}-${key}`
                ] = importedStyle.sources[key]
            })

            // Add layers from imported styles (before layers from local styles)
            const importedLayers = importedStyle.layers.map((layer: any) => ({
                ...layer,
                source: !layer.source
                    ? undefined
                    : layer.source === 'composite'
                    ? importId
                    : `${importId}-${layer.source}`,
            }))
            correctedStyle.layers = [
                ...importedLayers,
                ...correctedStyle.layers,
            ]

            // Add fog, if it is not yet set by the local styles
            if (typeof importedStyle.fog === 'object' && !correctedStyle.fog) {
                correctedStyle.fog = importedStyle.fog
            }

            // Glyphs
            if (
                typeof importedStyle.glyphs === 'string' &&
                !correctedStyle.glyphs
            ) {
                correctedStyle.glyphs = importedStyle.glyphs
            }

            // Sprite
            if (
                typeof importedStyle.sprite === 'string' &&
                !correctedStyle.sprite
            ) {
                correctedStyle.sprite = importedStyle.sprite
            }
        })
    }

    const localMbtilesMatches =
        JSON.stringify(correctedStyle).match(MBTILES_REGEXP)
    if (localMbtilesMatches) {
        throw new Error('Local mbtiles not supported!')
    }

    const map = new maplibre.Map({
        ratio,
    })

    map.load(correctedStyle)

    await loadImages(map, images)

    logger.info('map loaded')

    const buffer = await renderMap(map, {
        zoom,
        center,
        height,
        width,
        bearing,
        pitch,
    })

    logger.info('map rendered')
    map.release()

    return toPNG(buffer, width, height, ratio)
}

export default render
