/*
 * Yahtzee scoring rules.
 *
 * Pure functions, no DOM. Loaded by the browser via a plain <script> tag and
 * by the test suite via require(), so it must stay dependency-free.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Scoring = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var UPPER_BONUS_THRESHOLD = 63;
  var UPPER_BONUS = 35;
  var YAHTZEE_BONUS = 100;
  var MAX_YAHTZEE_BONUS = 13;

  // A hand is five dice, so any "add up the dice" category lands between
  // 5 (all ones) and 30 (all sixes).
  var MIN_DICE_TOTAL = 5;
  var MAX_DICE_TOTAL = 30;

  var CATEGORIES = [
    { id: 'ones', section: 'upper', label: 'Aces', hint: 'Total of all 1s', face: 1 },
    { id: 'twos', section: 'upper', label: 'Twos', hint: 'Total of all 2s', face: 2 },
    { id: 'threes', section: 'upper', label: 'Threes', hint: 'Total of all 3s', face: 3 },
    { id: 'fours', section: 'upper', label: 'Fours', hint: 'Total of all 4s', face: 4 },
    { id: 'fives', section: 'upper', label: 'Fives', hint: 'Total of all 5s', face: 5 },
    { id: 'sixes', section: 'upper', label: 'Sixes', hint: 'Total of all 6s', face: 6 },
    { id: 'threeKind', section: 'lower', label: 'Three of a Kind', hint: 'Total of all 5 dice', kind: 'sum' },
    { id: 'fourKind', section: 'lower', label: 'Four of a Kind', hint: 'Total of all 5 dice', kind: 'sum' },
    { id: 'fullHouse', section: 'lower', label: 'Full House', hint: '3 of a kind + a pair', kind: 'fixed', value: 25 },
    { id: 'smallStraight', section: 'lower', label: 'Small Straight', hint: '4 in a row', kind: 'fixed', value: 30 },
    { id: 'largeStraight', section: 'lower', label: 'Large Straight', hint: '5 in a row', kind: 'fixed', value: 40 },
    { id: 'yahtzee', section: 'lower', label: 'Yahtzee', hint: '5 of a kind', kind: 'fixed', value: 50 },
    { id: 'chance', section: 'lower', label: 'Chance', hint: 'Total of all 5 dice', kind: 'sum' }
  ];

  var BY_ID = {};
  CATEGORIES.forEach(function (category) {
    BY_ID[category.id] = category;
  });

  var UPPER = CATEGORIES.filter(function (c) { return c.section === 'upper'; });
  var LOWER = CATEGORIES.filter(function (c) { return c.section === 'lower'; });

  function getCategory(id) {
    return BY_ID[id] || null;
  }

  function range(from, to) {
    var out = [];
    for (var n = from; n <= to; n++) out.push(n);
    return out;
  }

  /**
   * Every score that is legally reachable in a category, always including 0
   * (a scratched box). The entry UI is built from this, so a value the rules
   * can't produce can never be typed in.
   */
  function validValues(id) {
    var category = getCategory(id);
    if (!category) return [];
    if (category.section === 'upper') {
      // Zero through five dice showing that face.
      return range(0, 5).map(function (count) { return count * category.face; });
    }
    if (category.kind === 'fixed') return [0, category.value];
    return [0].concat(range(MIN_DICE_TOTAL, MAX_DICE_TOTAL));
  }

  function isValidValue(id, value) {
    return validValues(id).indexOf(value) !== -1;
  }

  function isFilled(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function sumSection(scores, categories) {
    return categories.reduce(function (total, category) {
      var value = scores ? scores[category.id] : undefined;
      return isFilled(value) ? total + value : total;
    }, 0);
  }

  function countFilled(scores, categories) {
    return categories.reduce(function (count, category) {
      var value = scores ? scores[category.id] : undefined;
      return isFilled(value) ? count + 1 : count;
    }, 0);
  }

  function clampBonusCount(count) {
    if (typeof count !== 'number' || !isFinite(count)) return 0;
    return Math.max(0, Math.min(MAX_YAHTZEE_BONUS, Math.floor(count)));
  }

  /**
   * Totals for one player's card.
   *
   * card: { scores: { [categoryId]: number }, yahtzeeBonus: number }
   * An absent or null score means the box has not been played yet.
   */
  function scoreCard(card) {
    var scores = (card && card.scores) || {};
    var upperSubtotal = sumSection(scores, UPPER);
    var bonusEarned = upperSubtotal >= UPPER_BONUS_THRESHOLD;
    var upperBonus = bonusEarned ? UPPER_BONUS : 0;
    var bonusCount = clampBonusCount(card && card.yahtzeeBonus);
    var yahtzeeBonusPoints = bonusCount * YAHTZEE_BONUS;
    var lowerSubtotal = sumSection(scores, LOWER);
    var lowerTotal = lowerSubtotal + yahtzeeBonusPoints;
    var boxesFilled = countFilled(scores, CATEGORIES);

    return {
      upperSubtotal: upperSubtotal,
      upperBonus: upperBonus,
      bonusEarned: bonusEarned,
      // How many upper-section points are still needed for the 35 bonus.
      pointsToBonus: bonusEarned ? 0 : UPPER_BONUS_THRESHOLD - upperSubtotal,
      upperTotal: upperSubtotal + upperBonus,
      lowerSubtotal: lowerSubtotal,
      yahtzeeBonusCount: bonusCount,
      yahtzeeBonusPoints: yahtzeeBonusPoints,
      lowerTotal: lowerTotal,
      grandTotal: upperSubtotal + upperBonus + lowerTotal,
      boxesFilled: boxesFilled,
      boxesTotal: CATEGORIES.length,
      complete: boxesFilled === CATEGORIES.length
    };
  }

  /**
   * Indexes of the winning cards: highest grand total, and every card tied
   * with it. Returns [] until all cards are complete.
   */
  function findLeaders(cards) {
    if (!cards || !cards.length) return [];
    var totals = cards.map(function (card) { return scoreCard(card); });
    var allComplete = totals.every(function (t) { return t.complete; });
    if (!allComplete) return [];
    var best = Math.max.apply(null, totals.map(function (t) { return t.grandTotal; }));
    var leaders = [];
    totals.forEach(function (t, index) {
      if (t.grandTotal === best) leaders.push(index);
    });
    return leaders;
  }

  return {
    CATEGORIES: CATEGORIES,
    UPPER: UPPER,
    LOWER: LOWER,
    UPPER_BONUS: UPPER_BONUS,
    UPPER_BONUS_THRESHOLD: UPPER_BONUS_THRESHOLD,
    YAHTZEE_BONUS: YAHTZEE_BONUS,
    MAX_YAHTZEE_BONUS: MAX_YAHTZEE_BONUS,
    getCategory: getCategory,
    validValues: validValues,
    isValidValue: isValidValue,
    isFilled: isFilled,
    scoreCard: scoreCard,
    findLeaders: findLeaders
  };
});
