# Source Data

Public source CSV files used to generate derived JSON files under `overlay/data/`.

## Files

- `laj_map_metadata.csv`: LAJ map metadata exported from the IIIF management system. Used by `overlay/scripts/csv-to-json.js` to generate `overlay/data/laj_maps.json`.
- `laj_note_metadata_items.csv`: item-level metadata for LAJ note records, derived from the `上位層` sheet of the received note metadata workbook.
- `laj_note_metadata_cards.csv`: card-level metadata for LAJ note images, derived from the `下位層` sheet of the received note metadata workbook.
- `survey-points/output_gc_final_with_dist_fixed_ids.csv`: corrected survey-point geocoding/mesh TSV used by `overlay/scripts/csv-to-survey-points.py` to generate `overlay/data/survey-points.json`.

The note metadata CSV files were checked for obvious private fields or working notes before moving here. The source workbook itself is not placed here because workbook document properties can contain personal names and local path metadata.
