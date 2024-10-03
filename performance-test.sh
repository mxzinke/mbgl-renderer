#!/bin/bash

trap "exit" INT TERM    # Convert INT and TERM to EXIT
trap "kill 0" EXIT      # Kill all children if we receive EXIT

for e in {1..50}; 
  do for i in {1..10}; 
  do time wget --no-check-certificate \
  --method POST \
  --timeout=30 --quiet \
  --header 'Content-Type: application/json' \
  --body-data '{
    "height": 260,
    "width": 400,
    "center": [
        7.651048234373661,
        45.0206976809919
    ],
    "zoom": 5.061346075431271,
    "bearing": 0,
    "pitch": 0,
    "ratio": 1,
    "style": {
        "id": "styl_gt6s7wmm30rdiwz",
        "name": "Live",
        "metadata": {
            "internal:description": "",
            "internal:workspace": "maximilians-space-0pay",
            "lastEditedBy": "@cm0uyzfu600001333p44c2fxn",
            "lastEditedAt": "2024-09-10T11:52:02.356Z",
            "internal:tags": []
        },
        "version": 8,
        "light": {
            "color": "#ffffff"
        },
        "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        "sources": {
            "planet": {
                "type": "vector",
                "url": "https://tiles.mapstudio.ai/planet.json"
            },
            "hillshades": {
                "type": "raster-dem",
                "tiles": [
                    "https://terrain.mapstudio.ai/{z}/{x}/{y}.png"
                ],
                "minzoom": 0,
                "maxzoom": 14,
                "encoding": "terrarium",
                "tileSize": 64
            }
        },
        "layers": [
            {
                "id": "background",
                "type": "background",
                "paint": {
                    "background-color": "#BDBDBD"
                }
            },
            {
                "id": "earth",
                "type": "fill",
                "source": "planet",
                "source-layer": "earth",
                "paint": {
                    "fill-color": "#F0F7D1"
                }
            },
            {
                "id": "hillshades",
                "type": "hillshade",
                "source": "hillshades",
                "paint": {
                    "hillshade-illumination-direction": 315,
                    "hillshade-shadow-color": "#888888",
                    "hillshade-exaggeration": 0.5
                }
            },
            {
                "id": "water_base",
                "type": "fill",
                "source": "planet",
                "source-layer": "water",
                "filter": [
                    "!=",
                    "pmap:kind",
                    "other"
                ],
                "paint": {
                    "fill-color": {
                        "type": "exponential",
                        "stops": [
                            [
                                4,
                                "#90daee"
                            ],
                            [
                                12,
                                "#65d1e6"
                            ]
                        ]
                    }
                }
            },
            {
                "id": "water_other",
                "type": "fill",
                "source": "planet",
                "source-layer": "water",
                "filter": [
                    "==",
                    "pmap:kind",
                    "other"
                ],
                "paint": {
                    "fill-color": "#edecec"
                }
            },
            {
                "id": "waterways",
                "type": "line",
                "source": "planet",
                "source-layer": "physical_line",
                "filter": [
                    "in",
                    "pmap:kind",
                    "ditch",
                    "canal",
                    "drain"
                ],
                "minzoom": 13,
                "paint": {
                    "line-color": {
                        "type": "exponential",
                        "stops": [
                            [
                                4,
                                "#90daee"
                            ],
                            [
                                12,
                                "#65d1e6"
                            ]
                        ]
                    },
                    "line-width": {
                        "type": "exponential",
                        "stops": [
                            [
                                8,
                                1
                            ],
                            [
                                14,
                                5
                            ]
                        ]
                    }
                }
            }
        ],
        "center": [
            7.651048234373661,
            45.0206976809919
        ],
        "zoom": 5.061346075431271,
        "bearing": 0,
        "pitch": 0
    }
}' \
   'https://static-image-gen.mapstudio.ai/render' \
  --header 'cache-control: no-cache' \
  --header 'pragma: no-cache' \
  -O /dev/null &
  done

  for job in $(jobs -p); do
    wait $job
  done
done