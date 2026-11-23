// 추적표 XLSX에 마크다운 흔적(\, **)이 남았는지 확인
const E = require('exceljs');
const w = new E.Workbook();
w.xlsx.readFile(__dirname + '/../../deliverables/02_요구사항추적표_v1.0.xlsx').then(() => {
  let n = 0;
  w.eachSheet((s) => s.eachRow((r) => r.eachCell((c) => {
    const v = typeof c.value === 'object' && c.value?.formula ? '' : String(c.value);
    if (v.includes('\\') || v.includes('**')) { n++; console.log(s.name, c.address, v.slice(0, 60)); }
  })));
  console.log('bad cells', n);
});
