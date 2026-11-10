#!/usr/bin/env bash
# Saves one REFD:1000 m message from a HRRR subhourly file, using its .idx.
# Usage: scripts/capture-hrrr-fixture.sh YYYYMMDD HH NN LEAD_MIN [out.grib2]
set -euo pipefail
date=$1 hour=$2 file=$3 lead=$4 out=${5:-src/radar/__fixtures__/refd.grib2}
url="https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.$date/conus/hrrr.t${hour}z.wrfsubhf$file.grib2"
idx=$(curl -fsS -m 30 "$url.idx")
line=$(printf '%s\n' "$idx" | grep -n ":REFD:1000 m above ground:$lead min fcst:" | head -1 | cut -d: -f1)
[ -n "$line" ] || { echo "No REFD step at $lead minutes" >&2; exit 1; }
start=$(printf '%s\n' "$idx" | sed -n "${line}p" | cut -d: -f2)
next=$(printf '%s\n' "$idx" | sed -n "$((line + 1))p" | cut -d: -f2)
[ -n "$next" ] || { echo "REFD is the last record; no end offset" >&2; exit 1; }
curl -fsS -m 60 -r "$start-$((next - 1))" "$url" -o "$out"
echo "$out: $((next - start)) bytes"
