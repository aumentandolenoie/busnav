const test = require('node:test');
const assert = require('node:assert');
const D = require('../deviazioni.js');

const data = {
  version: 1, updatedAt: '2026-11-25T15:00:00+00:00',
  communications: [
    { number: 656, date: '2026-11-23', status: 'sostituita', replacedBy: 665,
      windows: [{ from: '2026-11-24T20:30', to: '2026-11-25T05:30' }], detours: [] },
    { number: 665, date: '2026-11-25', status: 'valida', replaces: [656], title: 'Chiusura raccordo Marco Polo',
      windows: [{ from: '2026-11-25T20:30', to: '2026-11-26T05:30' }, { from: '2026-11-26T20:30', to: '2026-11-27T05:30' },
        { from: '2026-11-27T20:30', to: '2026-11-28T05:30' }],
      detours: [{ route: 665135, base: 135 }, { route: 665132, base: 132 }] },
  ],
  routes: [
    // Padova → Aeroporto: detoured stretch from 31 to 43 km of 44 km.
    { id: 665135, base: 135, communication: 665, leaveAtM: 31000, rejoinAtM: 43000, baseLengthM: 44000, points: [] },
    // Aeroporto → Padova: detoured stretch in the first 13 km.
    { id: 665132, base: 132, communication: 665, leaveAtM: 300, rejoinAtM: 13000, baseLengthM: 45600, points: [] },
    // A route of a replaced communication is never used.
    { id: 656135, base: 135, communication: 656, leaveAtM: 0, rejoinAtM: 44000, baseLengthM: 44000, points: [] },
  ],
};
const at = (d, hm) => new Date(2026, 10, d, ...hm.split(':').map(Number));

test('trip on the detoured stretch inside a window uses the detour', () => {
  const f = D.forTrip(data, 135, at(25, '20:30'), at(25, '21:30'));
  assert.equal(f.route.id, 665135);
  assert.equal(f.communication.number, 665);
});

test('detour only when the bus reaches the closure inside the window (±5 min)', () => {
  // Padova → Aeroporto, 45 min: the detour starts 31/44 of the way, about 32 min after departure.
  assert.equal(D.forTrip(data, 135, at(25, '19:42'), at(25, '20:27')), null); // there at 20:14
  assert.equal(D.forTrip(data, 135, at(25, '19:30'), at(25, '20:15')), null); // P008, there at 20:02
  assert.equal(D.forTrip(data, 135, at(25, '19:55'), at(25, '20:40')).route.id, 665135); // there at 20:27
  // Aeroporto → Padova: the detour starts right after departure.
  assert.equal(D.forTrip(data, 132, at(25, '19:50'), at(25, '20:35')), null);
  assert.equal(D.forTrip(data, 132, at(25, '20:30'), at(25, '21:15')).route.id, 665132);
});

test('a trip ending before the window keeps the normal route', () => {
  assert.equal(D.forTrip(data, 135, at(25, '18:30'), at(25, '19:30')), null);
});

test('airport trip at 05:20 is on the stretch before 05:30, at 05:40 it is not', () => {
  assert.equal(D.forTrip(data, 132, at(26, '05:20'), at(26, '06:20')).route.id, 665132);
  assert.equal(D.forTrip(data, 132, at(26, '05:45'), at(26, '06:45')), null);
});

test('replaced communication is never active, even inside its own window', () => {
  // 24 Nov night: only the cancelled n.656 covered it.
  assert.equal(D.forTrip(data, 135, at(24, '21:00'), at(24, '22:00')), null);
});

test('other GPX are untouched', () => {
  assert.equal(D.forTrip(data, 133, at(25, '21:00'), at(25, '22:00')), null);
});

test('manual trip from now, with the timetable duration', () => {
  assert.equal(D.forNow(data, 135, at(26, '22:00'), 45).route.id, 665135);
  assert.equal(D.forNow(data, 135, at(26, '12:00'), 45), null);
  assert.equal(D.forNow(data, 135, at(25, '19:42'), 45), null);
  assert.equal(D.forNow(data, 132, at(25, '19:42'), 45), null);
  assert.equal(D.forNow(data, 132, at(25, '20:28'), 45).route.id, 665132);
});

test('shift rows after midnight belong to the next day', () => {
  const t = D.legTimes(new Date(2026, 10, 25), '00:10', '01:05', '19:30');
  assert.equal(t.start.getDate(), 26);
  assert.equal(t.start.getHours(), 0);
  const u = D.legTimes(new Date(2026, 10, 25), '23:50', '00:45', '19:30');
  assert.equal(u.start.getDate(), 25);
  assert.equal(u.end.getDate(), 26);
});

test('states and list', () => {
  assert.equal(D.state(data.communications[1], at(25, '16:00')), 'programmata');
  assert.equal(D.state(data.communications[1], at(25, '22:00')), 'in-corso');
  assert.equal(D.state(data.communications[1], at(29, '12:00')), 'conclusa');
  assert.equal(D.state(data.communications[0], at(25, '22:00')), 'sostituita');
  const list = D.list(data, at(25, '16:00'));
  assert.deepEqual(list.map(x => x.communication.number), [665, 656]);
  assert.deepEqual(D.list(data, at(29, '12:00')).map(x => x.communication.number), [665]);
  assert.deepEqual(D.list(data, at(31, '12:00')), []);
});

test('newer copy wins', () => {
  const remote = { ...data, updatedAt: '2026-11-26T08:00:00+00:00' };
  assert.equal(D.newer(data, remote), remote);
  assert.equal(D.newer(remote, data), remote);
  assert.equal(D.newer(null, data), data);
  assert.equal(D.newer(data, { version: 2 }), data);
});
