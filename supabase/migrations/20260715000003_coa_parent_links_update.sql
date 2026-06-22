-- Phase 0a: Resolve parent_id links setelah COA seed
BEGIN;

-- Aset Lancar children
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1-1100')
  WHERE account_code IN ('1-1110');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1-1500')
  WHERE account_code IN ('1-1510','1-1520');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1-1000')
  WHERE account_code IN ('1-1100','1-1200','1-1300','1-1400','1-1450','1-1500');

-- Aset Tetap
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1-2000')
  WHERE account_code IN ('1-2100','1-2200','1-2900');

-- Liabilitas Lancar
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2-1200')
  WHERE account_code IN ('2-1210','2-1220');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2-1000')
  WHERE account_code IN ('2-1100','2-1200','2-1300','2-1400','2-1500');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2-2000')
  WHERE account_code IN ('2-2100');

-- Modal
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '3-1000')
  WHERE account_code IN ('3-1100','3-1200','3-1300','3-1400','3-1900');

-- Pendapatan
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '4-1100')
  WHERE account_code IN ('4-1110','4-1120','4-1130','4-1140');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '4-1200')
  WHERE account_code IN ('4-1210','4-1220','4-1230');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '4-1000')
  WHERE account_code IN ('4-1100','4-1200','4-1900');

-- Beban
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5-1000')
  WHERE account_code IN ('5-1100');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5-2000')
  WHERE account_code IN ('5-2100','5-2200','5-2300','5-2400','5-2500','5-2600','5-2700','5-2800','5-2900','5-2950');
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5-3000')
  WHERE account_code IN ('5-3100','5-3150','5-3200','5-3300');

COMMIT;
