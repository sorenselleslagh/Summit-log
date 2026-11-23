#!/usr/bin/env python3
"""Build a static Camptocamp route file for peaks we already show.

Collaborative route and waypoint documents only. Never call this from the app.
The public API is throttled and responses are cached under /tmp/c2c-cache.
"""
import json
import math
import os
import re
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PEAKS = os.path.join(ROOT, 'data/collections/uiaa-alps-4000.json')
OUT_DIR = os.path.join(ROOT, 'data/camptocamp')
OUT = os.path.join(OUT_DIR, 'routes.json')
CACHE = '/tmp/c2c-cache'
UA = 'SummitLog-data-build/1.0 (one-time static extract of collaborative routes)'
API = 'https://api.camptocamp.org'

SNOW = {'snow_ice_mixed', 'mountain_climbing', 'ice_climbing'}
ROCK = {'rock_climbing'}
HIKE = {'hiking'}


def mercator(x, y):
    lng = x / 20037508.342789244 * 180.0
    lat = y / 20037508.342789244 * 180.0
    lat = 180.0 / math.pi * (2 * math.atan(math.exp(lat * math.pi / 180.0)) - math.pi / 2.0)
    return lat, lng


def hav(a, b):
    x = math.radians(a[1] - b[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    y = math.radians(a[0] - b[0])
    return 6371.0 * math.hypot(x, y)


def fold(value):
    text = str(value or '').lower()
    text = text.replace('é', 'e').replace('è', 'e').replace('ê', 'e').replace('ë', 'e')
    text = text.replace('à', 'a').replace('á', 'a').replace('ô', 'o').replace('ö', 'o').replace('ü', 'u')
    text = re.sub(r'[^a-z0-9]+', ' ', text)
    return text.strip()


def get_json(url):
    os.makedirs(CACHE, exist_ok=True)
    key = re.sub(r'[^a-z0-9]+', '-', url.lower())[:180]
    path = os.path.join(CACHE, key + '.json')
    if os.path.exists(path):
        with open(path) as handle:
            return json.load(handle)
    time.sleep(0.45)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=40) as response:
        data = json.load(response)
    with open(path, 'w') as handle:
        json.dump(data, handle)
    return data


def point_of(doc):
    geom = doc.get('geometry') or {}
    raw = geom.get('geom')
    if not raw:
        return None
    if isinstance(raw, str):
        raw = json.loads(raw)
    coords = raw.get('coordinates')
    if not coords or raw.get('type') != 'Point':
        return None
    if abs(coords[0]) > 180:
        lat, lng = mercator(coords[0], coords[1])
    else:
        lng, lat = coords[0], coords[1]
    return lat, lng


def titles(doc):
    return [item.get('title') or '' for item in doc.get('locales') or []]


def activity_of(values):
    acts = set(values or [])
    snow = bool(acts & SNOW)
    rock = bool(acts & ROCK)
    hike = bool(acts & HIKE)
    if snow and not rock:
        return 'snow-ice-mixed'
    if rock and not snow and not hike:
        return 'rock'
    if hike and not snow and not rock:
        return 'hiking'
    return None


def glacier_of(value):
    if value is None or value == '':
        return None
    text = str(value)
    if text == 'no':
        return False
    if text.startswith('glacier'):
        return True
    return None


def blank():
    return {
        'routeId': None,
        'url': None,
        'name': None,
        'grade': None,
        'glacier': None,
        'activity': None,
        'bestMonths': None
    }


def from_route(route):
    name = ''
    for title in titles(route):
        if title.strip():
            name = title.strip()
            break
    point = point_of(route)
    return {
        'routeId': route.get('document_id'),
        'url': 'https://www.camptocamp.org/routes/' + str(route.get('document_id')),
        'name': name or None,
        'grade': route.get('global_rating') or None,
        'glacier': glacier_of(route.get('glacier_gear')),
        'activity': activity_of(route.get('activities')),
        'bestMonths': None,
        '_elev': route.get('elevation_max'),
        '_point': point
    }


def route_matches(peak, info):
    elev = info.get('_elev')
    if isinstance(elev, (int, float)) and isinstance(peak.get('elevation'), (int, float)):
        if abs(elev - peak['elevation']) <= 120:
            return True
    point = info.get('_point')
    if point and hav((peak['lat'], peak['lng']), point) <= 1.5:
        return True
    return False


def confident_waypoint(peak, docs):
    wanted = fold(peak['name'])
    hits = []
    for doc in docs:
        if doc.get('waypoint_type') not in (None, 'summit'):
            continue
        names = [fold(title) for title in titles(doc)]
        if wanted not in names:
            continue
        point = point_of(doc)
        if not point:
            continue
        dist = hav((peak['lat'], peak['lng']), point)
        if dist <= 1.2:
            hits.append((dist, doc))
    if len(hits) != 1:
        return None
    return hits[0][1]


def normal_route(peak, routes):
    hints = ('voie normale', 'itineraire classique', 'normal route', 'normalweg', 'via normale')
    picked = []
    for route in routes:
        blob = ' '.join(fold(title) for title in titles(route))
        if any(hint in blob for hint in hints):
            info = from_route(route)
            if route_matches(peak, info):
                picked.append(info)
    if len(picked) == 1:
        return picked[0]
    return None


def main():
    with open(PEAKS) as handle:
        peaks = json.load(handle)['collections'][0]['peaks']
    records = {}
    matched = 0
    for peak in peaks:
        info = None
        match = re.search(r'camptocamp\.org/routes/(\d+)', peak.get('sourceUrl') or '')
        if match:
            try:
                route = get_json(API + '/routes/' + match.group(1))
                candidate = from_route(route)
                if route_matches(peak, candidate):
                    info = candidate
            except Exception as err:
                print('route fail', peak['name'], err)
        if not info:
            try:
                found = get_json(API + '/waypoints?wt=summit&limit=8&q=' + urllib.parse.quote(peak['name']))
                waypoint = confident_waypoint(peak, found.get('documents') or [])
                if waypoint:
                    listed = get_json(API + '/routes?limit=30&w=' + str(waypoint['document_id']))
                    info = normal_route(peak, listed.get('documents') or [])
            except Exception as err:
                print('search fail', peak['name'], err)
        if info:
            matched += 1
            info.pop('_elev', None)
            info.pop('_point', None)
            records[peak['id']] = info
            print('match', peak['name'], info.get('grade'), info.get('glacier'), info.get('activity'))
        else:
            records[peak['id']] = blank()
            print('unknown', peak['name'])
    os.makedirs(OUT_DIR, exist_ok=True)
    document = {
        'license': 'CC BY-SA 3.0',
        'source': 'Camptocamp collaborative route and waypoint documents',
        'url': 'https://www.camptocamp.org',
        'note': 'Fields are null when there is no confident match or the source document omits them.',
        'peaks': records
    }
    with open(OUT, 'w') as handle:
        json.dump(document, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print('matched', matched, 'of', len(peaks))


if __name__ == '__main__':
    import urllib.parse
    main()
