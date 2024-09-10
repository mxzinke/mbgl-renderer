#!/usr/bin/env node
import fs from 'fs'
import express from 'express'
import { body, query, validationResult } from 'express-validator'
import { program, InvalidOptionArgumentError } from 'commander'
import pino from 'pino-http'

import { version } from '../package.json'
import { render } from './render'

const parseListToFloat = (text) => text.split(',').map(Number)

const PARAMS = {
    style: { in: ['body', 'query'], isObject: true },
    width: { in: ['body', 'query'], isInt: true },
    height: { in: ['body', 'query'], isInt: true },
    padding: { in: ['body', 'query'], isInt: true, optional: true },
    zoom: { in: ['body', 'query'], isFloat: true, optional: true },
    ratio: { in: ['body', 'query'], isFloat: true, optional: true },
    bearing: { in: ['body', 'query'], isFloat: true, optional: true },
    pitch: { in: ['body', 'query'], isFloat: true, optional: true },
    token: { in: ['body', 'query'], isString: true, optional: true },
    images: { in: ['body', 'query'], isObject: true, optional: true },
    imports: { in: ['body', 'query'], isArray: true, optional: true },
}

const renderImage = (params, response, next, tilePath, logger) => {
    const {
        width,
        height,
        token = null,
        padding = 0,
        bearing = null,
        pitch = null,
        imports = null,
    } = params
    let {
        style,
        zoom = null,
        center = null,
        bounds = null,
        ratio = 1,
        images = null,
    } = params

    if (typeof style === 'string') {
        try {
            style = JSON.parse(style)
        } catch (jsonErr) {
            return next(new Error('Error parsing JSON style'))
        }
    }

    if (center !== null) {
        if (typeof center === 'string') {
            center = parseListToFloat(center)
        }

        if (center.length !== 2) {
            return next(
                new Error(
                    `Center must be longitude,latitude. Invalid value found: ${[
                        ...center,
                    ]}`
                )
            )
        }

        if (!Number.isFinite(center[0]) || Math.abs(center[0]) > 180) {
            return next(
                new Error(
                    `Center longitude is outside world bounds (-180 to 180 deg): ${center[0]}`
                )
            )
        }

        if (!Number.isFinite(center[1]) || Math.abs(center[1]) > 90) {
            return next(
                new Error(
                    `Center latitude is outside world bounds (-90 to 90 deg): ${center[1]}`
                )
            )
        }
    }
    if (zoom !== null) {
        zoom = parseFloat(zoom)
        if (zoom < 0 || zoom > 22) {
            return next(
                new Error(
                    `Zoom level is outside supported range (0-22): ${zoom}`
                )
            )
        }
    }
    if (ratio !== null) {
        if (!ratio || ratio < 1) {
            return next(
                new Error(`Ratio is outside supported range (>=1): ${ratio}`)
            )
        }
    }
    if (bounds !== null) {
        if (typeof bounds === 'string') {
            bounds = parseListToFloat(bounds)
        }

        if (bounds.length !== 4) {
            return next(
                new Error(
                    `Bounds must be west,south,east,north. Invalid value found: ${[
                        ...bounds,
                    ]}`
                )
            )
        }
        for (const b of bounds) {
            if (!Number.isFinite(b)) {
                return next(
                    new Error(
                        `Bounds must be west,south,east,north. Invalid value found: ${[
                            ...bounds,
                        ]}`
                    )
                )
            }
        }

        const [west, south, east, north] = bounds
        if (west === east) {
            return next(
                new Error(`Bounds west and east coordinate are the same value`)
            )
        }
        if (south === north) {
            return next(
                new Error(
                    `Bounds south and north coordinate are the same value`
                )
            )
        }

        if (padding) {
            if (Math.abs(padding) >= width / 2) {
                return next(new Error('Padding must be less than width / 2'))
            }
            if (Math.abs(padding) >= height / 2) {
                return next(new Error('Padding must be less than height / 2'))
            }
        }
    }

    if (bearing !== null) {
        if (bearing < 0 || bearing > 360) {
            return next(
                new Error(
                    `Bearing is outside supported range (0-360): ${bearing}`
                )
            )
        }
    }

    if (pitch !== null) {
        if (pitch < 0 || pitch > 60) {
            return next(
                new Error(`Pitch is outside supported range (0-60): ${pitch}`)
            )
        }
    }

    if (!((center && zoom !== null) || bounds)) {
        return next(
            new Error('Either center and zoom OR bounds must be provided')
        )
    }

    if (images !== null) {
        if (typeof images === 'string') {
            images = JSON.parse(images)
        } else if (typeof images !== 'object') {
            return next(new Error('images must be an object or a string'))
        }

        for (const image of Object.values(images)) {
            if (!(image && image.url)) {
                return next(
                    new Error(
                        'Invalid image object; a url is required for each image'
                    )
                )
            }
            try {
                const url = new URL(image.url)
            } catch (e) {
                return next(new Error(`Invalid image URL: ${image.url}`))
            }
        }
    }

    if (imports !== null) {
        if (typeof imports !== 'object' && !Array.isArray(imports)) {
            return next(new Error('imports must be an array'))
        }

        for (const imp of imports) {
            if (!(imp && imp.url && imp.id)) {
                return next(
                    new Error(
                        'Invalid import object; a url and a id is required for each import'
                    )
                )
            }
            if (!imp.url.startsWith('mapbox://styles'))
                try {
                    const url = new URL(imp.url)
                } catch (e) {
                    return next(new Error(`Invalid import URL: ${imp.url}`))
                }
        }
    }

    try {
        render(style, parseInt(width, 10), parseInt(height, 10), {
            zoom,
            center,
            bounds,
            padding,
            tilePath,
            ratio,
            bearing,
            pitch,
            token,
            images,
            imports,
        })
            .then((data) => {
                response.contentType('image/png')
                response.send(data)
            })
            .catch((err) => {
                next(new Error(`Error processing render request: ${err}`))
            })
    } catch (err) {
        next(new Error(`Error processing render request: ${err}`))
    }
}

// Provide the CLI
program
    .version(version)
    .description('Start a server to render Mapbox GL map requests to images.')
    .option('-p, --port <n>', 'Server port', parseInt)
    .option(
        '-t, --tiles <mbtiles_path>',
        'Directory containing local mbtiles files to render',
        (tilePath) => {
            if (!fs.existsSync(tilePath)) {
                throw new InvalidOptionArgumentError(
                    `Path to mbtiles files does not exist: ${tilePath}`
                )
            }
            return tilePath
        }
    )
    .option('-v, --verbose', 'Enable request logging')
    .parse(process.argv)

const { port = 8000, tiles: tilePath = null, verbose = false } = program.opts()

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(
    pino({
        enabled: verbose,
        autoLogging: {
            ignorePaths: ['/health'],
        },
        redact: {
            paths: [
                'pid',
                'hostname',
                'res.headers.server',
                'req.id',
                'req.connection',
                'req.remoteAddress',
                'req.remotePort',
            ],
            remove: true,
        },
    })
)

const validateParams = Object.entries(PARAMS).flatMap(([param, rules]) => {
    const validators = []
    if (rules.isString) validators.push((value) => typeof value === 'string')
    if (rules.isInt) validators.push((value) => Number.isInteger(Number(value)))
    if (rules.isFloat) validators.push((value) => !isNaN(parseFloat(value)))
    if (rules.isObject) validators.push((value) => typeof value === 'object')
    if (rules.isArray) validators.push((value) => Array.isArray(value))

    return rules.in.map((location) =>
        (location === 'body' ? body : query)(param)
            .if((value) => value !== undefined)
            .custom((value) => validators.every((v) => v(value)))
            .withMessage(`Invalid ${param}`)
    )
})

/**
 * /render (GET): renders an image based on request query parameters.
 */
app.get('/render', validateParams, (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() })
    }
    renderImage(req.query, res, next, tilePath, req.log)
})

/**
 * /render (POST): renders an image based on request body.
 */
app.post('/render', validateParams, (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() })
    }
    renderImage(req.body, res, next, tilePath, req.log)
})

/**
 * List all available endpoints.
 */
app.get('/', (req, res) => {
    const routes = app._router.stack
        .filter((r) => r.route)
        .map((r) => ({
            path: r.route.path,
            methods: Object.keys(r.route.methods),
        }))

    res.json({
        routes,
        version,
    })
})

/**
 * /health: returns 200 to confirm that server is up
 */
app.get('/health', (req, res) => {
    res.sendStatus(200)
})

let tilePathMessage = ''
if (tilePath !== null) {
    tilePathMessage = `\n using local mbtiles in: ${tilePath}`
}

app.listen(port, () => {
    console.log(
        '\n-----------------------------------------------------------------\n',
        `mbgl-renderer server started and listening on port ${port}`,
        tilePathMessage,
        '\n-----------------------------------------------------------------\n'
    )
})

export default { app }
