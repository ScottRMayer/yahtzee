'use strict';

var test = require('node:test');
var assert = require('node:assert');
var Scoring = require('../scoring.js');

function card(scores, yahtzeeBonus) {
  return { scores: scores || {}, yahtzeeBonus: yahtzeeBonus || 0 };
}

var FULL_UPPER = {
  ones: 5, twos: 10, threes: 15, fours: 20, fives: 25, sixes: 30
};

var FULL_LOWER = {
  threeKind: 30, fourKind: 30, fullHouse: 25,
  smallStraight: 30, largeStraight: 40, yahtzee: 50, chance: 30
};

test('the card has all thirteen boxes', function () {
  assert.strictEqual(Scoring.CATEGORIES.length, 13);
  assert.strictEqual(Scoring.UPPER.length, 6);
  assert.strictEqual(Scoring.LOWER.length, 7);
});

test('upper boxes only offer multiples of their face, zero to five dice', function () {
  assert.deepStrictEqual(Scoring.validValues('ones'), [0, 1, 2, 3, 4, 5]);
  assert.deepStrictEqual(Scoring.validValues('fours'), [0, 4, 8, 12, 16, 20]);
  assert.deepStrictEqual(Scoring.validValues('sixes'), [0, 6, 12, 18, 24, 30]);
});

test('fixed boxes offer their score or a scratch', function () {
  assert.deepStrictEqual(Scoring.validValues('fullHouse'), [0, 25]);
  assert.deepStrictEqual(Scoring.validValues('smallStraight'), [0, 30]);
  assert.deepStrictEqual(Scoring.validValues('largeStraight'), [0, 40]);
  assert.deepStrictEqual(Scoring.validValues('yahtzee'), [0, 50]);
});

test('dice-total boxes span every reachable total', function () {
  ['threeKind', 'fourKind', 'chance'].forEach(function (id) {
    var values = Scoring.validValues(id);
    assert.strictEqual(values[0], 0);
    assert.strictEqual(values[1], 5, id + ' should start at five ones');
    assert.strictEqual(values[values.length - 1], 30, id + ' should end at five sixes');
    assert.strictEqual(values.length, 27);
  });
});

test('scores the rules cannot produce are rejected', function () {
  assert.ok(Scoring.isValidValue('fours', 12));
  assert.ok(!Scoring.isValidValue('fours', 7), 'sevens are not a multiple of four');
  assert.ok(!Scoring.isValidValue('fours', 24), 'only five dice are rolled');
  assert.ok(!Scoring.isValidValue('smallStraight', 25));
  assert.ok(!Scoring.isValidValue('chance', 4), 'five dice total at least five');
  assert.ok(!Scoring.isValidValue('chance', 31));
  assert.ok(!Scoring.isValidValue('nonsense', 0));
});

test('an untouched card totals zero and is not complete', function () {
  var totals = Scoring.scoreCard(card());
  assert.strictEqual(totals.grandTotal, 0);
  assert.strictEqual(totals.boxesFilled, 0);
  assert.strictEqual(totals.complete, false);
  assert.strictEqual(totals.pointsToBonus, 63);
});

test('a scratched box counts as played, not as empty', function () {
  var totals = Scoring.scoreCard(card({ yahtzee: 0 }));
  assert.strictEqual(totals.boxesFilled, 1);
  assert.strictEqual(totals.grandTotal, 0);
});

test('the upper bonus lands exactly at 63', function () {
  var below = Scoring.scoreCard(card({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 17 }));
  assert.strictEqual(below.upperSubtotal, 62);
  assert.strictEqual(below.upperBonus, 0);
  assert.strictEqual(below.bonusEarned, false);
  assert.strictEqual(below.pointsToBonus, 1);
  assert.strictEqual(below.upperTotal, 62);

  var at = Scoring.scoreCard(card({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 }));
  assert.strictEqual(at.upperSubtotal, 63);
  assert.strictEqual(at.upperBonus, 35);
  assert.strictEqual(at.bonusEarned, true);
  assert.strictEqual(at.pointsToBonus, 0);
  assert.strictEqual(at.upperTotal, 98);
});

test('extra Yahtzees add 100 each into the lower total', function () {
  var totals = Scoring.scoreCard(card({ yahtzee: 50 }, 2));
  assert.strictEqual(totals.yahtzeeBonusCount, 2);
  assert.strictEqual(totals.yahtzeeBonusPoints, 200);
  assert.strictEqual(totals.lowerSubtotal, 50);
  assert.strictEqual(totals.lowerTotal, 250);
  assert.strictEqual(totals.grandTotal, 250);
});

test('the bonus count is clamped to something a game can produce', function () {
  assert.strictEqual(Scoring.scoreCard(card({}, -4)).yahtzeeBonusCount, 0);
  assert.strictEqual(Scoring.scoreCard(card({}, 99)).yahtzeeBonusCount, 13);
  assert.strictEqual(Scoring.scoreCard(card({}, 2.7)).yahtzeeBonusCount, 2);
  assert.strictEqual(Scoring.scoreCard(card({}, 'lots')).yahtzeeBonusCount, 0);
  assert.strictEqual(Scoring.scoreCard(card({}, NaN)).yahtzeeBonusCount, 0);
});

test('a finished card adds up across both sections', function () {
  var scores = Object.assign({}, FULL_UPPER, FULL_LOWER);
  var totals = Scoring.scoreCard(card(scores, 3));

  assert.strictEqual(totals.upperSubtotal, 105);
  assert.strictEqual(totals.upperTotal, 140);
  assert.strictEqual(totals.lowerSubtotal, 235);
  assert.strictEqual(totals.lowerTotal, 535);
  assert.strictEqual(totals.grandTotal, 675);
  assert.strictEqual(totals.boxesFilled, 13);
  assert.strictEqual(totals.complete, true);
});

test('a realistic game adds up', function () {
  var totals = Scoring.scoreCard(card({
    ones: 2, twos: 6, threes: 9, fours: 12, fives: 20, sixes: 24,   // 73 -> bonus
    threeKind: 24, fourKind: 0, fullHouse: 25,
    smallStraight: 30, largeStraight: 0, yahtzee: 50, chance: 21
  }, 1));

  assert.strictEqual(totals.upperSubtotal, 73);
  assert.strictEqual(totals.upperTotal, 108);
  assert.strictEqual(totals.lowerSubtotal, 150);
  assert.strictEqual(totals.lowerTotal, 250);
  assert.strictEqual(totals.grandTotal, 358);
  assert.strictEqual(totals.complete, true);
});

test('no winner is declared while boxes are still open', function () {
  var finished = card(Object.assign({}, FULL_UPPER, FULL_LOWER));
  var partway = card({ ones: 4 });
  assert.deepStrictEqual(Scoring.findLeaders([finished, partway]), []);
  assert.deepStrictEqual(Scoring.findLeaders([]), []);
});

test('the highest finished card wins, and ties are reported together', function () {
  var big = card(Object.assign({}, FULL_UPPER, FULL_LOWER));
  var small = card(Object.assign({}, FULL_UPPER, FULL_LOWER, { yahtzee: 0 }));

  assert.deepStrictEqual(Scoring.findLeaders([small, big]), [1]);
  assert.deepStrictEqual(Scoring.findLeaders([big, small, big]), [0, 2]);
});
