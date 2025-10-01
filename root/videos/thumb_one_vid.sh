#!/bin/bash

thumbnail_base="/root/thumbnails"

# Create the thumbnail directory if it doesn't exist
mkdir -p "$thumbnail_base"

if [[ -z "$1" || -z "$2" ]]; then
    echo "Usage: $0 <file.mp4> <uniqueVideoId>"
    exit 1
fi

file="$1"
unique_id="$2"

if [[ ! -f "$file" ]]; then
    echo "Error: File $file does not exist."
    exit 1
fi

thumbnail_file="$thumbnail_base/${unique_id}.jpg"

taskset -c 0 ffmpeg -i "$file" -vf "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2" \
    -frames:v 1 "$thumbnail_file"

if [ $? -eq 0 ]; then
    echo "Thumbnail for $file has been created at $thumbnail_file"
else
    echo "Failed to create thumbnail for $file"
fi
