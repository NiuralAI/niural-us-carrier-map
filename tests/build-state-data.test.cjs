// Exercises the published functions. Does not call Niural's service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourcePath = process.env.CARRIER_SOURCE || path.join(__dirname, '..', 'assets', 'js', 'main.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
// Fetch's JSON decoder accepts a UTF-8 BOM, as found in the published data.
const readJSON = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', name), 'utf8')
  .replace(/^\uFEFF/, ''));
const stateConfig = readJSON('stateData.json');
const appConfig = readJSON('appConfig.json');

// The IIFE keeps buildStateData private. Disable only the startup call and
// expose the original function, without rewriting its implementation.
const bootstrap = source.indexOf('  init().catch((err) => {');
const ending = source.lastIndexOf('\n})();');
assert.ok(bootstrap > 0 && ending > bootstrap);
const instrumented = source.slice(0, bootstrap)
  + '  globalThis.buildStateDataForReview = buildStateData;\n'
  + source.slice(ending);
const context = vm.createContext({
  document: { getElementById: () => ({}), documentElement: {} },
  d3: { select: () => ({}) },
});
vm.runInContext(instrumented, context, { filename: sourcePath });
const buildStateData = context.buildStateDataForReview;
const build = (data = stateConfig) => buildStateData(data, appConfig);

// Execute the unchanged sidebar renderer too. This tiny D3 stand-in records
// the strings it writes; it is not a browser rendering or screenshot test.
function sidebarValues(info) {
  const values = [];
  const detailStart = source.indexOf('    function renderDetail(name, code, info) {');
  const detailEnd = source.indexOf('\n    /* ', detailStart);
  const formatStart = source.indexOf('    function formatCarrierDisplay(carrierValue) {');
  const formatEnd = source.indexOf('\n    function showTooltip(', formatStart);
  assert.ok(detailStart > 0 && detailEnd > detailStart);
  assert.ok(formatStart > 0 && formatEnd > formatStart);
  const body = {
    html() { return this; },
    append() {
      return {
        text(value) { values.push(String(value)); return this; },
        html(value) { values.push(String(value)); return this; },
      };
    },
  };
  const uiContext = vm.createContext({
    appConfig,
    detailTitle: { text() {} },
    detailBodyKV: body,
    colorForCarrier: () => '#000',
  });
  vm.runInContext(source.slice(formatStart, formatEnd)
    + '\n' + source.slice(detailStart, detailEnd)
    + '\nglobalThis.renderForReview = renderDetail;', uiContext);
  uiContext.renderForReview('Hawaii', 'HI', info);
  return values;
}

for (const code of Object.keys(stateConfig.restrictedStates)) {
  test(`${code}: retains the restriction note from the shipped data`, () => {
    assert.equal(build()[code].coverageNotes,
      stateConfig.restrictedStates[code].coverageNotes);
  });
}

test('the sidebar receives and writes the Hawaii restriction', () => {
  assert.ok(sidebarValues(build().HI)
    .includes(stateConfig.restrictedStates.HI.coverageNotes));
});

test('restricted carrier labels remain restricted', () => {
  for (const code of Object.keys(stateConfig.restrictedStates)) {
    assert.equal(build()[code].carrier, 'Restricted');
  }
});

test('non-conflicting notable details survive on a restricted state', () => {
  assert.equal(build().VT.retirementMandate,
    stateConfig.notableStates.VT.retirementMandate);
});

test('unrestricted states retain their configured coverage notes', () => {
  for (const [code, info] of Object.entries(stateConfig.notableStates)) {
    if (!(code in stateConfig.restrictedStates)) {
      assert.equal(build()[code].coverageNotes, info.coverageNotes);
    }
  }
});

test('large-group and important-state rules are unchanged', () => {
  const result = build();
  assert.equal(result.CA.largeGroupDefinition, '101+ FTEs');
  assert.equal(result.AL.largeGroupDefinition, '51+ FTEs');
  for (const code of Object.keys(stateConfig.importantStates)) {
    assert.equal(result[code].important, true);
  }
});

test('missing optional configuration still builds all 51 state/DC records', () => {
  assert.equal(Object.keys(build({})).length, 51);
});

test('building the data does not mutate its input', () => {
  const before = JSON.stringify(stateConfig);
  build();
  assert.equal(JSON.stringify(stateConfig), before);
});
