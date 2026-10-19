-- Deleted transactions must retain only the id, deletion marker, and sync timestamp.
UPDATE transactions
   SET date = '1970-01-01',
       time = '',
       description = '',
       amount = 0,
       direction = 0,
       category = 'Other',
       source = '',
       flags = 0,
       note = ''
 WHERE deleted = 1;
