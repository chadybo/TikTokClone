#!/bin/bash

output_base="/var/www/media"

if [[ -z "$1" || -z "$2" ]]; then
    echo "Usage: $0 <file.mp4> <uniqueVideoId>"
    exit 1
fi

file="$1"
unique_id="$2"

manifest_file="${output_base}/${unique_id}.mpd"

if [[ -f "$manifest_file" ]]; then
    echo "Skipping $file: Manifest file $manifest_file already exists."
    exit 0
fi

echo "Processing $file..."

taskset -c 0 ffmpeg -threads 1 -i "$file" \
    -map 0:v:0 -b:v:4 512k -s:v:4 640x360 -vf "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2" \
    -map 0:v:0 -b:v:5 768k -s:v:5 960x540 -vf "scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2" \
    -map 0:v:0 -b:v:7 1024k -s:v:7 1280x720 -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
    -init_seg_name "${unique_id}_chunk_\$RepresentationID\$init.m4s" \
    -media_seg_name "${unique_id}_chunk_\$RepresentationID\$_\$Number\$.m4s" \
    -adaptation_sets "id=0,streams=v" \
    -seg_duration 10 \
    -f dash "$manifest_file"
