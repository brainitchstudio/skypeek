# Today location behavior

Today, desktop navigation, and mobile navigation open one shared location picker.
The weather service always receives the selected coordinates; descriptive map
labels never move a forecast to the center of a town or nearby landmark.

## Selection and migration

- `gps` enables foreground device location after the user chooses it.
- `viewingPlace` remembers a selected saved place independently of `defaultPlace`.
- Older settings without `viewingPlace` continue using their main saved place.
- Removing a viewed place falls back to the main place. Selecting another place
  does not change the main saved place.
- While acquiring GPS without a prior fix, the main saved place is displayed
  explicitly as a fallback. A previous device fix is labeled as last known until
  confirmed. Device fixes and descriptions are retained only in session storage.

## Geographic sources

`/api/location` combines the NWS point's relative town geometry, existing Census
county polygons, and OpenFreeMap/OpenMapTiles road and POI features. The endpoint
uses private, non-cacheable responses. Its bounded one-hour process cache holds
public upstream metadata and tiles; no device fixes are persisted on the server.

Town labels use “Near” because reference-point proximity does not establish city
containment. County containment uses the existing generalized US Atlas polygons;
it is regional context, not a survey-grade boundary determination.

Road and landmark details are optional. Accurate fixes query zoom-14 tiles in a
200-meter neighborhood, including adjacent tiles at tile edges. The resolver
measures road segments, not label positions. Roads require accuracy at most 100m
and distance plus accuracy at most 150m. Allowlisted public/travel POIs require
accuracy at most 50m and distance plus accuracy at most 100m. POIs always use
“Near,” never claim occupancy. Map attribution appears in the picker.

One source failing does not discard results from the others. If naming fails,
coordinate-based weather continues. The client cancels superseded lookups and
times out a name lookup after 15 seconds.

## Foreground movement

The browser location watcher stops while hidden or when viewing a saved place.
Returning to the foreground reacquires location. Meaningful movement is at least
500m (or the reported uncertainty if larger) and normally at least 60 seconds
between accepted moves. Substantially improved accuracy is accepted immediately.
Freshness updates do not move the weather coordinate for small GPS fluctuations.
This builds on the weather service's existing grid/cell caches and source budgets.

## Connected-device release checks

Automated tests cover descriptions, geometry, accuracy filtering, movement rules,
regional fallback, migration, and endpoint validation. Before releasing, check:

1. iOS Safari and installed web app: allow, deny, timeout, retry, and approximate
   location. Confirm Escape, focus return, backdrop dismissal, and sheet scrolling.
2. Change between GPS and several saved places rapidly, including with slow
   weather responses. No old-place weather or alerts should appear under a new name.
3. Test an urban location, rural highway, rest stop, county boundary, and location
   without mapped POIs. Check actual OpenFreeMap coverage and road references.
4. Background the app, move, then return. Ensure the old fix is identified while
   reacquiring, then check all weather screens follow the new viewing location.
5. Open offline with a session fix and cached weather; verify location age and
   weather staleness remain visible and saved-place switching remains available.

Live upstream coverage and browser rendering could not be checked in the restricted
development sandbox: external DNS and binding a local preview port were blocked.
