#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// CSV ファイルのパス
const csvPath = path.resolve(__dirname, '../../data/laj_map_0 (2)_0.csv');
const outputPath = path.resolve(__dirname, '../data/laj_maps.json');

// CSV を読み込んでパース
const csvContent = fs.readFileSync(csvPath, 'utf-8');
const lines = csvContent.trim().split('\n');

// ヘッダー行をパース
const headers = parseCSVLine(lines[0]);

// データ行をパース
const data = [];
for (let i = 1; i < lines.length; i++) {
  const values = parseCSVLine(lines[i]);
  const row = {};
  headers.forEach((h, idx) => {
    row[h] = values[idx] || '';
  });
  data.push({
    id: row.field_identifier,
    title: row.title
  });
}

// JSON として保存
fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
console.log(`Generated ${outputPath} with ${data.length} entries`);

// CSV 行をパースするヘルパー関数（ダブルクォート対応）
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);

  return result;
}
