update events
set catalog_data = jsonb_set(
      jsonb_set(catalog_data, '{lat}', 'null'::jsonb, true),
      '{lng}',
      'null'::jsonb,
      true
    ),
    updated_at = now()
where jsonb_typeof(catalog_data->'lat') = 'number'
  and jsonb_typeof(catalog_data->'lng') = 'number'
  and (
    (
      (catalog_data->>'lat')::double precision = 0
      and (catalog_data->>'lng')::double precision = 0
    )
    or (catalog_data->>'lat')::double precision not between -90 and 90
    or (catalog_data->>'lng')::double precision not between -180 and 180
  );
